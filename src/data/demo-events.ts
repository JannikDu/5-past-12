import {
  DataKind, EventCategory, EventStatus, EvidenceStatus, Severity,
  type ClimateEvent, type Position,
} from '../domain/climate-event.ts';

const fixtures: readonly [string, EventCategory, string, Position][] = [
  ['california', EventCategory.Wildfire, 'California, USA', [-121, 39]],
  ['atlantic', EventCategory.Storm, 'North Atlantic', [-58, 25]],
  ['brazil', EventCategory.Flood, 'Southern Brazil', [-51, -30]],
  ['europe', EventCategory.Heat, 'Central Europe', [13, 50]],
  ['east-africa', EventCategory.Drought, 'East Africa', [38, 1]],
  ['south-asia', EventCategory.Flood, 'South Asia', [90, 24]],
  ['australia', EventCategory.Wildfire, 'Southeastern Australia', [148, -36]],
  ['greenland', EventCategory.Ice, 'Greenland', [-42, 68]],
];

/** Entirely fictional fixtures; no fabricated reports, impacts, or attribution. */
export const demoEvents: ClimateEvent[] = fixtures.map(([id, category, label, coordinates]) => {
  const time = '2026-10-01T00:00:00.000Z';
  const geometry = { type: 'Point' as const, coordinates };
  return {
    id: `demo:${id}`, title: `${category} · ${label} (demo)`, categories: [category],
    summary: 'Fictional event for exploring the prototype. This is not a report of an actual event.',
    location: { label, geometry, marker: coordinates },
    time: { firstObservedAt: time, lastObservedAt: time, closedAt: null },
    status: EventStatus.Unknown, severity: Severity.Unknown,
    observations: [{ time, geometry, magnitude: null }], sources: [],
    evidence: { status: EvidenceStatus.Missing, references: [] },
    provenance: { provider: 'demo', externalId: id, fetchedAt: time, dataKind: DataKind.Demo },
  };
});
