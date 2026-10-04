/** Internal vocabulary: external providers must normalize into these types. */
export enum EventCategory {
  Wildfire = 'Wildfire',
  Storm = 'Storm',
  Flood = 'Flood',
  Drought = 'Drought',
  Heat = 'Extreme heat',
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

/** GeoJSON order: longitude, latitude (degrees). */
export type Position = readonly [longitude: number, latitude: number];

export type EventGeometry =
  | { type: 'Point'; coordinates: Position }
  | { type: 'Polygon'; coordinates: readonly (readonly Position[])[] };

export interface EventObservation {
  time: string; // ISO 8601, UTC. An observation time, not necessarily onset.
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
  sourceId: string;
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
  severity: Severity;
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
