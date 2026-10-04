import {
  DataKind, EventCategory, EventStatus, EvidenceStatus, Severity, SourceKind,
  type ClimateEvent, type EventGeometry, type EventObservation, type EventSource,
  type Position,
} from '../../domain/climate-event.ts';
import type { EventBatch, EventQuery, EventSourceProvider } from './event-source.ts';

const API = 'https://eonet.gsfc.nasa.gov/api/v3';
const categories: Record<string, EventCategory> = {
  wildfires: EventCategory.Wildfire,
  severeStorms: EventCategory.Storm,
  floods: EventCategory.Flood,
  drought: EventCategory.Drought,
  tempExtremes: EventCategory.Heat,
  seaLakeIce: EventCategory.Ice,
  volcanoes: EventCategory.Volcano,
  earthquakes: EventCategory.Earthquake,
  landslides: EventCategory.Landslide,
  dustHaze: EventCategory.Dust,
  snow: EventCategory.Snow,
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function date(value: unknown): string | null {
  // Require a timestamp with an explicit timezone, rather than locale-dependent parsing.
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
}

function httpUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
      ? url.href : null;
  } catch { return null; }
}

function position(value: unknown): Position | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const [longitude, latitude] = value;
  return typeof longitude === 'number' && Number.isFinite(longitude) && Math.abs(longitude) <= 180
    && typeof latitude === 'number' && Number.isFinite(latitude) && Math.abs(latitude) <= 90
    ? [longitude, latitude] : null;
}

function geometry(value: Record<string, unknown>): EventGeometry | null {
  if (value.type === 'Point') {
    const coordinates = position(value.coordinates);
    return coordinates ? { type: 'Point', coordinates } : null;
  }
  if (value.type !== 'Polygon' || !Array.isArray(value.coordinates) || !value.coordinates.length) return null;
  const rings: Position[][] = [];
  for (const rawRing of value.coordinates) {
    if (!Array.isArray(rawRing) || rawRing.length < 4) return null;
    const ring: Position[] = [];
    for (const rawPoint of rawRing) {
      const point = position(rawPoint);
      if (!point) return null;
      ring.push(point);
    }
    const first = ring[0], last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) return null;
    rings.push(ring);
  }
  return { type: 'Polygon', coordinates: rings };
}

function observation(value: unknown): EventObservation | null {
  if (!record(value)) return null;
  const time = date(value.date), shape = geometry(value);
  if (!time || !shape) return null;
  const magnitude = typeof value.magnitudeValue === 'number' && Number.isFinite(value.magnitudeValue)
    && nonempty(value.magnitudeUnit)
    ? { value: value.magnitudeValue, unit: value.magnitudeUnit,
        description: nonempty(value.magnitudeDescription) ? value.magnitudeDescription : null }
    : null;
  return { time, geometry: shape, magnitude };
}

/** Runtime validation lives here; no cast of an untrusted response into the domain. */
export function normalizeEonetEvent(raw: unknown, fetchedAt: string): ClimateEvent | null {
  if (!record(raw) || !nonempty(raw.id) || !/^EONET_[\w-]+$/.test(raw.id)
    || !nonempty(raw.title) || !Array.isArray(raw.geometry)
    || !Array.isArray(raw.categories) || !Array.isArray(raw.sources)) return null;
  if (raw.closed !== null && !date(raw.closed)) return null;
  const observations = raw.geometry.map(observation)
    .filter((item): item is EventObservation => item !== null)
    .sort((a, b) => a.time.localeCompare(b.time));
  // Reject an entire record with malformed geometry rather than inventing its latest position.
  if (!observations.length || observations.length !== raw.geometry.length) return null;
  const latest = observations[observations.length - 1];
  const normalizedCategories = [...new Set(raw.categories.map((item: unknown) =>
    record(item) && typeof item.id === 'string' ? categories[item.id] ?? EventCategory.Other : EventCategory.Other))];
  const sources: EventSource[] = [{
    id: `eonet:${raw.id}`, name: 'NASA EONET event record',
    url: `${API}/events/${encodeURIComponent(raw.id)}`, kind: SourceKind.EventReport,
  }];
  for (const source of raw.sources) {
    if (!record(source) || !nonempty(source.id)) continue;
    const url = httpUrl(source.url);
    if (url && !sources.some((item) => item.url === url)) {
      sources.push({ id: `${source.id}:${sources.length}`, name: source.id, url, kind: SourceKind.EventReport });
    }
  }
  return {
    id: `eonet:${raw.id}`, title: raw.title.trim(),
    categories: normalizedCategories.length ? normalizedCategories : [EventCategory.Other],
    summary: nonempty(raw.description) ? raw.description.trim() : null,
    location: { label: null, geometry: latest.geometry,
      marker: latest.geometry.type === 'Point' ? latest.geometry.coordinates : latest.geometry.coordinates[0][0] },
    time: { firstObservedAt: observations[0].time, lastObservedAt: latest.time, closedAt: date(raw.closed) },
    status: raw.closed === null ? EventStatus.Open : EventStatus.Closed,
    severity: Severity.Unknown,
    observations, sources,
    evidence: { status: EvidenceStatus.Unverified, references: [] },
    provenance: { provider: 'eonet', externalId: raw.id, fetchedAt, dataKind: DataKind.Reported },
  };
}

export class EonetProvider implements EventSourceProvider {
  readonly id = 'eonet';
  readonly name = 'NASA EONET';

  constructor(private readonly fetcher: typeof fetch = globalThis.fetch.bind(globalThis)) {}

  private async request(url: URL, signal?: AbortSignal): Promise<unknown | null> {
    const timeout = AbortSignal.timeout(15_000);
    const response = await this.fetcher(url, {
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      headers: { Accept: 'application/json' },
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`NASA EONET returned HTTP ${response.status}.`);
    return response.json();
  }

  async fetchEvents({ days = 30, limit = 60, signal }: EventQuery = {}): Promise<EventBatch> {
    if (!Number.isInteger(days) || days < 1 || days > 365
      || !Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error('Invalid event query.');
    const url = new URL(`${API}/events`);
    url.search = new URLSearchParams({ days: String(days), limit: String(limit), status: 'all' }).toString();
    const data = await this.request(url, signal);
    if (!record(data) || !Array.isArray(data.events)) throw new Error('NASA EONET returned an invalid event feed.');
    const fetchedAt = new Date().toISOString();
    const events: ClimateEvent[] = [];
    let skipped = 0;
    for (const raw of data.events) {
      const event = normalizeEonetEvent(raw, fetchedAt);
      if (event && !events.some((item) => item.id === event.id)) events.push(event);
      else skipped++;
    }
    events.sort((a, b) => b.time.lastObservedAt.localeCompare(a.time.lastObservedAt));
    return { events, skipped };
  }

  async fetchEvent(externalId: string, signal?: AbortSignal): Promise<ClimateEvent | null> {
    if (!/^EONET_[\w-]+$/.test(externalId)) return null;
    const data = await this.request(new URL(`${API}/events/${encodeURIComponent(externalId)}`), signal);
    if (data === null) return null;
    const event = normalizeEonetEvent(data, new Date().toISOString());
    if (!event || event.provenance.externalId !== externalId) throw new Error('NASA EONET returned an invalid event record.');
    return event;
  }
}
