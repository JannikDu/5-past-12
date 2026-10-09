import { EventCategory, type ClimateEvent } from '../domain/climate-event.ts';
import type { EvidenceQuery, EvidenceSearchResult } from '../domain/evidence.ts';
import { fingerprint } from './evidence-identity.ts';

/** fetchedAt is transport provenance, not a change in the scientific event context. */
export function assessmentEventContext(event: ClimateEvent) {
  const provenance = { provider: event.provenance.provider, externalId: event.provenance.externalId, dataKind: event.provenance.dataKind };
  return { ...event, provenance };
}
export function eventFingerprint(event: ClimateEvent) { return fingerprint(assessmentEventContext(event)); }
export function assessmentQueries(event: ClimateEvent): EvidenceQuery[] {
  const location = event.location.label ?? `coordinates ${event.location.marker.join(', ')} (place name unavailable)`;
  const observed = `${event.time.firstObservedAt.slice(0, 10)} to ${event.time.lastObservedAt.slice(0, 10)} (observation dates)`;
  const magnitude = event.observations.filter(o => o.magnitude).slice(-3).map(o => `${o.magnitude!.value} ${o.magnitude!.unit}`).join('; ');
  const category = event.categories.join(', ');
  // These are search terms, never attribution conclusions or strength labels.
  const mechanisms: Partial<Record<EventCategory, string>> = {
    [EventCategory.Wildfire]: 'evaporative demand vegetation fuel moisture fire weather heat humidity drought',
    [EventCategory.Storm]: 'sea surface temperature atmospheric moisture heavy rainfall cyclone intensity rapid intensification sea level storm surge circulation',
    [EventCategory.Flood]: 'heavy precipitation atmospheric moisture catchment soil saturation sea level',
    [EventCategory.Drought]: 'evapotranspiration evaporative demand soil moisture precipitation circulation',
    [EventCategory.Heat]: 'greenhouse warming heatwave intensity frequency temperature',
    [EventCategory.Temperature]: 'greenhouse warming extreme temperature circulation',
    [EventCategory.Ice]: 'ocean warming atmospheric warming ice melt feedbacks',
    [EventCategory.Volcano]: 'eruption geological triggers volcanic climate forcing evidence for anthropogenic influence',
    [EventCategory.Earthquake]: 'tectonic geological triggers seismicity evidence for anthropogenic climate influence',
  };
  const mechanismTerms = event.categories.map(c => mechanisms[c] ?? 'temperature moisture precipitation circulation').join('; ');
  const specific = `${event.title}; ${location}; ${observed}; ${category}; ${event.summary?.slice(0, 500) ?? ''}; ${magnitude}`;
  const options = { eventType: event.categories[0], eventDate: new Date(event.time.firstObservedAt), region: event.location.label ?? undefined, limit: 12 };
  return [
    { ...options, text: `Event-specific anthropogenic climate change attribution study counterfactual likelihood intensity: ${specific}`, evidenceTypes: ['direct_attribution'], sourceTypes: ['attribution_study'] },
    { ...options, text: `Observed historical regional climate trends relevant to ${category} in ${location}. ${specific}. Separate observations from future projections.` },
    { ...options, text: `Scientific physical mechanisms potentially connecting anthropogenic warming and ${category}: ${mechanismTerms}. ${specific}` },
    { ...options, text: `Comparable historical ${category} events attribution studies regional physical conditions ${location}. ${specific}. Examine scientific comparability and limitations.`, evidenceTypes: ['analogue_attribution'], sourceTypes: ['attribution_study'] },
  ];
}
export function selectAssessmentPassages(searches: EvidenceSearchResult[][], limit = 24): EvidenceSearchResult[] {
  const lists = searches.map(results => {
    const counts = new Map<string, number>();
    return results.filter(c => {
      const count = counts.get(c.sourceId) ?? 0; counts.set(c.sourceId, count + 1); return count < 2;
    });
  });
  const selected = new Map<string, EvidenceSearchResult>(); const contents = new Set<string>(); const counts = new Map<string, number>();
  // First maximize publication diversity; then permit complementary passages.
  for (const cap of [1, 4]) {
    for (let index = 0; index < Math.max(0, ...lists.map(l => l.length)); index++) for (const list of lists) {
      const c = list[index];
      if (!c || selected.has(c.chunkId) || contents.has(c.content) || (counts.get(c.sourceId) ?? 0) >= cap) continue;
      selected.set(c.chunkId, c); contents.add(c.content); counts.set(c.sourceId, (counts.get(c.sourceId) ?? 0) + 1);
      if (selected.size === limit) return [...selected.values()];
    }
  }
  return [...selected.values()];
}
