import {
  DataKind, EventCategory, EventStatus, EvidenceStatus, Severity, SourceKind,
  type ClimateEvent, type EventGeometry, type EventObservation, type EventSource,
  type Position, isClimateEvent,
} from '../../domain/climate-event.ts';
import type { EventBatch, EventQuery, EventSourceProvider } from './event-source.ts';

const API = 'https://eonet.gsfc.nasa.gov/api/v3';
const categories: Record<string, EventCategory> = {
  wildfires: EventCategory.Wildfire,
  severeStorms: EventCategory.Storm,
  floods: EventCategory.Flood,
  drought: EventCategory.Drought,
  tempExtremes: EventCategory.Temperature,
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

function externalId(value: unknown): value is string {
  return typeof value === 'string' && value.trim() === value && /^EONET_[\w-]+$/.test(value);
}

function date(value: unknown): string | null {
  // Date.parse alone silently rolls impossible dates (e.g. February 30) forward.
  if (typeof value !== 'string' || value.trim() !== value) return null;
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!parts) return null;
  const [, year, month, day, hour, minute, second, offsetHour, offsetMinute] = parts;
  const leap = Number(year) % 4 === 0 && (Number(year) % 100 !== 0 || Number(year) % 400 === 0);
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1
    || Number(day) > monthDays[Number(month) - 1] || Number(hour) > 23
    || Number(minute) > 59 || Number(second) > 59
    || Number(offsetHour ?? 0) > 23 || Number(offsetMinute ?? 0) > 59) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  const utc = new Date(timestamp).toISOString();
  // Keep the domain's UTC strings lexicographically sortable within four-digit years.
  return /^\d{4}-/.test(utc) ? utc : null;
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
  if (!Array.isArray(value) || (value.length !== 2 && value.length !== 3)) return null;
  const [longitude, latitude, altitude] = value;
  return typeof longitude === 'number' && Number.isFinite(longitude) && Math.abs(longitude) <= 180
    && typeof latitude === 'number' && Number.isFinite(latitude) && Math.abs(latitude) <= 90
    && (value.length === 2 || (typeof altitude === 'number' && Number.isFinite(altitude)))
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
    ? { value: value.magnitudeValue, unit: value.magnitudeUnit.trim(),
        description: nonempty(value.magnitudeDescription) ? value.magnitudeDescription.trim() : null }
    : null;
  return { time, geometry: shape, magnitude };
}

/** Runtime validation lives here; no cast of an untrusted response into the domain. */
export function normalizeEonetEvent(raw: unknown, fetchedAt: string): ClimateEvent | null {
  const fetchedTime = date(fetchedAt);
  if (!record(raw) || !externalId(raw.id)
    || !nonempty(raw.title) || !Array.isArray(raw.geometry)
    || !Array.isArray(raw.categories) || !raw.categories.length
    || !Array.isArray(raw.sources) || !fetchedTime) return null;
  const closedAt = date(raw.closed);
  if (raw.closed !== null && !closedAt) return null;
  const observations = raw.geometry.map(observation)
    .filter((item): item is EventObservation => item !== null)
    .sort((a, b) => a.time.localeCompare(b.time));
  // Reject an entire record with malformed geometry rather than inventing its latest position.
  if (!observations.length || observations.length !== raw.geometry.length) return null;
  const latest = observations[observations.length - 1];
  const normalizedCategories = new Set<EventCategory>();
  for (const category of raw.categories) {
    if (!record(category) || !nonempty(category.id)) return null;
    normalizedCategories.add(Object.hasOwn(categories, category.id) ? categories[category.id] : EventCategory.Other);
  }
  const sources: EventSource[] = [{
    id: `eonet:${raw.id}`, name: 'NASA EONET event record',
    url: `${API}/events/${encodeURIComponent(raw.id)}`, kind: SourceKind.EventReport,
  }];
  for (const source of raw.sources) {
    if (!record(source) || !nonempty(source.id)) continue;
    const url = httpUrl(source.url);
    if (url && !sources.some((item) => item.url === url)) {
      sources.push({ id: `${source.id.trim()}:${sources.length}`, name: source.id.trim(), url, kind: SourceKind.EventReport });
    }
  }
  const event: ClimateEvent = {
    id: `eonet:${raw.id}`, title: raw.title.trim(),
    categories: [...normalizedCategories],
    summary: nonempty(raw.description) ? raw.description.trim() : null,
    location: { label: null, geometry: latest.geometry,
      marker: latest.geometry.type === 'Point' ? latest.geometry.coordinates : latest.geometry.coordinates[0][0] },
    time: { firstObservedAt: observations[0].time, lastObservedAt: latest.time, closedAt },
    status: raw.closed === null ? EventStatus.Open : EventStatus.Closed,
    severity: Severity.Unknown,
    observations, sources,
    evidence: { status: EvidenceStatus.Unverified, references: [] },
    provenance: { provider: 'eonet', externalId: raw.id, fetchedAt: fetchedTime, dataKind: DataKind.Reported },
  };
  // Feed and direct detail lookups must obey exactly the same domain contract.
  return isClimateEvent(event) ? event : null;
}

export class EonetProvider implements EventSourceProvider {
  readonly id = 'eonet';
  readonly name = 'NASA EONET';

  private readonly fetcher: typeof fetch;

  constructor(fetcher: typeof fetch = globalThis.fetch.bind(globalThis)) {
    this.fetcher = fetcher;
  }

  private async request(url: URL, signal?: AbortSignal, allowNotFound = false): Promise<unknown> {
    // Use widely supported browser primitives and release listeners/timers after body parsing.
    const controller = new AbortController();
    const cancel = () => controller.abort(signal?.reason);
    if (signal?.aborted) cancel();
    else signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => controller.abort(new DOMException('NASA EONET request timed out.', 'TimeoutError')), 15_000);
    try {
      controller.signal.throwIfAborted();
      const response = await this.fetcher(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      controller.signal.throwIfAborted();
      // undefined distinguishes a genuine 404 from a malformed JSON null response.
      if (allowNotFound && response.status === 404) return undefined;
      if (!response.ok) throw new Error(`NASA EONET returned HTTP ${response.status}.`);
      const data: unknown = await response.json();
      controller.signal.throwIfAborted();
      return data;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
    }
  }

  async fetchEvents(query: EventQuery = {}): Promise<EventBatch> {
    const { days = 30, limit = 60, signal, start, end, category } = query;
    const historical = start !== undefined || end !== undefined;
    const validDay = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
      && date(`${value}T00:00:00Z`)?.slice(0, 10) === value;
    if ((historical ? query.days !== undefined || !validDay(start) || !validDay(end) || start > end
      || Date.parse(end) - Date.parse(start) > 1096 * 86400000 : !Number.isInteger(days) || days < 1 || days > 365)
      || !Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error('Invalid event query.');
    const categoryId = category === undefined ? undefined : Object.keys(categories).find(id => categories[id] === category);
    if (category !== undefined && !categoryId) throw new Error('Unsupported EONET category.');
    const url = new URL(`${API}/events`);
    const parameters = new URLSearchParams({ limit: String(limit), status: 'all' });
    if (historical) { parameters.set('start', start!); parameters.set('end', end!); }
    else parameters.set('days', String(days));
    if (categoryId) parameters.set('category', categoryId);
    url.search = parameters.toString();
    const data = await this.request(url, signal);
    if (!record(data) || !Array.isArray(data.events)) throw new Error('NASA EONET returned an invalid event feed.');
    const fetchedAt = new Date().toISOString();
    const events: ClimateEvent[] = [];
    const ids = new Set<string>();
    let skipped = 0;
    for (const raw of data.events) {
      const event = normalizeEonetEvent(raw, fetchedAt);
      if (event && !ids.has(event.id)) {
        events.push(event);
        ids.add(event.id);
      } else skipped++;
    }
    events.sort((a, b) => b.time.lastObservedAt.localeCompare(a.time.lastObservedAt));
    return { events, skipped };
  }

  async fetchEvent(id: string, signal?: AbortSignal): Promise<ClimateEvent | null> {
    if (!externalId(id)) return null;
    const data = await this.request(new URL(`${API}/events/${encodeURIComponent(id)}`), signal, true);
    if (data === undefined) return null;
    const event = normalizeEonetEvent(data, new Date().toISOString());
    if (!event || event.provenance.externalId !== id) throw new Error('NASA EONET returned an invalid event record.');
    return event;
  }
}
