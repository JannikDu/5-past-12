/** Internal vocabulary: external providers must normalize into these types. */
export enum EventCategory {
  Wildfire = 'Wildfire',
  Storm = 'Storm',
  Flood = 'Flood',
  Drought = 'Drought',
  Heat = 'Extreme heat',
  Temperature = 'Temperature extremes',
  Ice = 'Sea and lake ice',
  Volcano = 'Volcano',
  Earthquake = 'Earthquake',
  Landslide = 'Landslide',
  Dust = 'Dust and haze',
  Snow = 'Snow',
  Other = 'Other',
}

export enum EventStatus {
  Open = 'Open',
  Closed = 'Closed',
  Unknown = 'Unknown',
}

export enum Severity {
  Unknown = 'Unknown',
  Low = 'Low',
  Moderate = 'Moderate',
  High = 'High',
  Extreme = 'Extreme',
}

/** Attribution evidence, separate from the existence of an event report. */
export enum EvidenceStatus {
  Missing = 'No attribution evidence',
  Unverified = 'Attribution not assessed',
  Supported = 'Supported by attribution evidence',
}

export enum SourceKind {
  EventReport = 'Event report',
  ScientificStudy = 'Scientific study',
}

export enum DataKind {
  Reported = 'Reported event',
  Demo = 'Demo event',
}

/** GeoJSON order: finite longitude [-180, 180], latitude [-90, 90], in degrees. */
export type Position = readonly [longitude: number, latitude: number];

export type EventGeometry =
  | { type: 'Point'; coordinates: Position }
  /** Nonempty rings with at least three distinct vertices, closed by repeating the first vertex. */
  | { type: 'Polygon'; coordinates: readonly (readonly Position[])[] };

export interface EventObservation {
  time: string; // Canonical UTC timestamp from toISOString(); observation time, not necessarily onset.
  geometry: EventGeometry;
  magnitude: { value: number; unit: string; description: string | null } | null;
}

export interface EventSource {
  id: string;
  name: string;
  url: string; // Validated HTTP(S) at the provider boundary.
  kind: SourceKind;
}

export interface AttributionEvidence {
  sourceId: string; // References a ScientificStudy in this event's sources, never an event report.
  finding: string;
  passage: string | null;
}

export interface ClimateEvent {
  id: string; // Namespaced by provider to avoid collisions.
  title: string;
  categories: readonly EventCategory[];
  summary: string | null;
  location: {
    label: string | null;
    /** Latest geometry; a polygon marker uses its first boundary vertex. */
    geometry: EventGeometry;
    marker: Position;
  };
  time: {
    firstObservedAt: string;
    lastObservedAt: string;
    /** Provider-reported closure, not necessarily the event's absolute end. */
    closedAt: string | null;
  };
  status: EventStatus;
  /** Unknown unless the provider has a justified severity classification; magnitude is separate. */
  severity: Severity;
  /** Nonempty, sorted by observation time ascending. */
  observations: readonly EventObservation[];
  sources: readonly EventSource[];
  evidence: {
    status: EvidenceStatus;
    references: readonly AttributionEvidence[];
  };
  provenance: {
    provider: string;
    externalId: string;
    fetchedAt: string;
    dataKind: DataKind;
  };
}

/** Split once: a provider's opaque external identifier may itself contain colons. */
export function parseEventId(id: string): { provider: string; externalId: string } | null {
  const separator = id.indexOf(':');
  const provider = id.slice(0, separator), externalId = id.slice(separator + 1);
  if (separator < 1 || !/^[a-z][a-z0-9-]*$/.test(provider)
    || !externalId.trim() || externalId !== externalId.trim()
    || hasControlCharacters(externalId)) return null;
  // A malformed Unicode ID cannot be safely encoded into the detail URL.
  try { encodeURIComponent(id); } catch { return null; }
  return { provider, externalId };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
}

function timestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

function position(value: unknown): value is Position {
  return Array.isArray(value) && value.length === 2
    && typeof value[0] === 'number' && Number.isFinite(value[0]) && Math.abs(value[0]) <= 180
    && typeof value[1] === 'number' && Number.isFinite(value[1]) && Math.abs(value[1]) <= 90;
}

function samePosition(a: Position, b: Position): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

function geometry(value: unknown): value is EventGeometry {
  if (!record(value)) return false;
  if (value.type === 'Point') return position(value.coordinates);
  return value.type === 'Polygon' && Array.isArray(value.coordinates) && value.coordinates.length > 0
    && !value.coordinates.includes(undefined)
    && value.coordinates.every((ring: unknown) => Array.isArray(ring) && ring.length >= 4
      && !ring.includes(undefined) && ring.every(position) && samePosition(ring[0], ring[ring.length - 1])
      && new Set(ring.map((point) => `${point[0]},${point[1]}`)).size >= 3);
}

function sameGeometry(a: EventGeometry, b: EventGeometry): boolean {
  if (a.type === 'Point' && b.type === 'Point') return samePosition(a.coordinates, b.coordinates);
  return a.type === 'Polygon' && b.type === 'Polygon' && a.coordinates.length === b.coordinates.length
    && a.coordinates.every((ring, index) => ring.length === b.coordinates[index].length
      && ring.every((point, vertex) => samePosition(point, b.coordinates[index][vertex])));
}

function observation(value: unknown): value is EventObservation {
  if (!record(value) || !timestamp(value.time) || !geometry(value.geometry)) return false;
  const magnitude = value.magnitude;
  return magnitude === null || (record(magnitude) && typeof magnitude.value === 'number'
    && Number.isFinite(magnitude.value) && nonempty(magnitude.unit)
    && (magnitude.description === null || nonempty(magnitude.description)));
}

function source(value: unknown): value is EventSource {
  if (!record(value) || !nonempty(value.id) || !nonempty(value.name)
    || typeof value.url !== 'string' || !/^https?:\/\//i.test(value.url)
    || value.url !== value.url.trim() || value.url.includes(' ') || hasControlCharacters(value.url)
    || !Object.values(SourceKind).includes(value.kind as SourceKind)) return false;
  try {
    const url = new URL(value.url);
    return !!url.hostname && !url.username && !url.password;
  } catch { return false; }
}

function evidenceReference(value: unknown): value is AttributionEvidence {
  return record(value) && nonempty(value.sourceId) && nonempty(value.finding)
    && (value.passage === null || nonempty(value.passage));
}

/**
 * Validate normalized data from any provider or persisted JSON. This checks structural
 * and provenance consistency, not whether a scientific finding is true or sufficient.
 * Providers remain responsible for normalization and evidence assessment.
 */
export function isClimateEvent(value: unknown): value is ClimateEvent {
  if (!record(value) || typeof value.id !== 'string' || !nonempty(value.title)
    || (value.summary !== null && !nonempty(value.summary))
    || !Array.isArray(value.categories) || !value.categories.length || value.categories.includes(undefined)
    || !value.categories.every((item) => Object.values(EventCategory).includes(item))
    || new Set(value.categories).size !== value.categories.length
    || !Object.values(EventStatus).includes(value.status as EventStatus)
    || !Object.values(Severity).includes(value.severity as Severity)
    || !Array.isArray(value.observations) || !value.observations.length || value.observations.includes(undefined)
    || !value.observations.every(observation)
    || !Array.isArray(value.sources) || value.sources.includes(undefined) || !value.sources.every(source)) return false;

  const { location, time, provenance, evidence, observations, sources } = value;
  const id = parseEventId(value.id);
  if (!id || !record(location) || (location.label !== null && !nonempty(location.label))
    || !geometry(location.geometry) || !position(location.marker)
    || !record(time) || !timestamp(time.firstObservedAt) || !timestamp(time.lastObservedAt)
    || (time.closedAt !== null && !timestamp(time.closedAt))
    || !record(provenance) || provenance.provider !== id.provider || provenance.externalId !== id.externalId
    || !timestamp(provenance.fetchedAt) || !Object.values(DataKind).includes(provenance.dataKind as DataKind)
    || !record(evidence) || !Object.values(EvidenceStatus).includes(evidence.status as EvidenceStatus)
    || !Array.isArray(evidence.references) || evidence.references.includes(undefined)
    || !evidence.references.every(evidenceReference)) return false;

  const latest = observations[observations.length - 1];
  const marker = latest.geometry.type === 'Point' ? latest.geometry.coordinates : latest.geometry.coordinates[0][0];
  if (time.firstObservedAt !== observations[0].time || time.lastObservedAt !== latest.time
    || observations.some((item, index) => index > 0 && item.time < observations[index - 1].time)
    || !sameGeometry(location.geometry, latest.geometry) || !samePosition(location.marker, marker)
    || (value.status === EventStatus.Closed) !== (time.closedAt !== null)
    || new Set(sources.map((item) => item.id)).size !== sources.length) return false;

  const scientificSourceIds = new Set(sources.filter((item) => item.kind === SourceKind.ScientificStudy).map((item) => item.id));
  return (evidence.status !== EvidenceStatus.Supported || evidence.references.length > 0)
    && (evidence.status !== EvidenceStatus.Missing || evidence.references.length === 0)
    && evidence.references.every((reference) => scientificSourceIds.has(reference.sourceId));
}
