import { DataKind, EventCategory, type ClimateEvent } from '../domain/climate-event.ts';
import { AssessmentError } from '../domain/climate-assessment.ts';
import type { DiscoveryStudy, StudyDiscoveryRepository, StudyLookup } from '../data/repositories/study-discovery.ts';
import type { CatalogLease, ClimateEventCatalog } from '../data/repositories/climate-event-catalog.ts';
import type { EventSourceProvider } from '../data/providers/event-source.ts';
import { assessmentWindow, withinAssessmentWindow } from './assessment-window.ts';
import { eventFingerprint } from './assessment-context.ts';
import { fetchCompleteEventWindow } from './event-window.ts';

const words = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().match(/[\p{L}]+/gu) ?? [];
const generic = new Set('wildfire wildfires fire fires flood floods storm storms hurricane typhoon tropical cyclone super severe extreme heat temperature drought in at the of and a an'.split(' '));
const months = 'january february march april may june july august september october november december'.split(' ');
const genericPlaceRecord = (event: ClimateEvent) => /^(?:wildfires?|floods?|drought|temperature extremes?)\s+in\s+/i.test(event.title);
export const studyEventPriority = (event: ClimateEvent) => genericPlaceRecord(event) ? 0 : 1;

/** Selection hints only. Provider observations and scientific passages are verified separately. */
export function studyEventQuery(study: DiscoveryStudy, now: Date): { start: string; end: string; category: EventCategory } | null {
  const source = study.source;
  const category = [EventCategory.Storm, EventCategory.Wildfire, EventCategory.Flood, EventCategory.Drought, EventCategory.Temperature]
    .find(value => source.eventTypes.includes(value) || (value === EventCategory.Temperature && source.eventTypes.includes(EventCategory.Heat)));
  if (!category) return null;
  let start = source.eventStart?.slice(0, 10); let end = source.eventEnd?.slice(0, 10);
  if (!start) {
    // Prefer the event month in the opening text. Inferred years only narrow a
    // provider lookup; they never become event data or direct-attribution anchors.
    const lead = source.normalizedText.slice(0, 2000);
    const mentions = [...lead.matchAll(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\b(?:\s+(?:\d{1,2}(?:st|nd|rd|th)?[,–-]?\s*)?(20\d{2}))?/gi)];
    const mention = mentions.find(value => value[2]) ?? mentions[0];
    const publication = source.publishedAt ? new Date(source.publishedAt) : null;
    if (mention && (mention[2] || publication)) {
      const month = months.indexOf(mention[1].toLowerCase());
      const year = mention[2] ? Number(mention[2]) : publication!.getUTCFullYear() - (month > publication!.getUTCMonth() ? 1 : 0);
      start = new Date(Date.UTC(year, month, 1) - 14 * 86400000).toISOString().slice(0, 10);
      end ??= new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10);
    } else if (publication) {
      start = new Date(publication.getTime() - 60 * 86400000).toISOString().slice(0, 10);
      end ??= publication.toISOString().slice(0, 10);
    }
  }
  if (!start) return null;
  end ??= new Date(Date.parse(`${start}T00:00:00Z`) + 45 * 86400000).toISOString().slice(0, 10);
  const window = assessmentWindow(now);
  start = start < window.start ? window.start : start; end = end > window.end ? window.end : end;
  if (start > end || Date.parse(end) - Date.parse(start) > 1096 * 86400000) return null;
  return { start, end, category };
}

/** Full distinctive event identity, including place words, avoids arbitrary category matches. */
export function studyMatchesEvent(study: DiscoveryStudy, event: ClimateEvent): boolean {
  const identity = words(event.title).filter(word => word.length > 2 && !generic.has(word));
  // Country-only provider records must match the studied headline/opening event,
  // not a researcher's affiliation or a distant comparison in the full article.
  const context = genericPlaceRecord(event) ? study.source.normalizedText.split(/\n\s*\n/)[0] : study.source.normalizedText;
  const supplied = new Set(words(`${study.source.title} ${context}`));
  return identity.length > 0 && identity.every(word => supplied.has(word));
}

export async function discoverStudyEvents(catalog: ClimateEventCatalog, studies: StudyDiscoveryRepository,
  provider: EventSourceProvider, lease: CatalogLease, now: Date): Promise<{ discovered: number; lookups: StudyLookup[] }> {
  const selected = await studies.next(lease); const discovered = new Set<string>(); const lookups: StudyLookup[] = [];
  for (const study of selected) {
    const query = studyEventQuery(study, now);
    let events: ClimateEvent[];
    try {
      events = query ? (await fetchCompleteEventWindow(provider, query.start, query.end, 6, query.category))
        .filter(event => event.provenance.dataKind === DataKind.Reported && withinAssessmentWindow(event, now)
          && event.categories.includes(query.category) && studyMatchesEvent(study, event)) : [];
      if (events.length > 200) throw new AssessmentError('budget', 'Study lookup matched too many events');
    } catch (error) {
      const lookup: StudyLookup = { studyVersionId: study.id, outcome: 'incomplete', eventIds: [], query,
        errorCode: error instanceof AssessmentError ? error.code : 'provider_unavailable' };
      await studies.record(lease, lookup); lookups.push(lookup); continue;
    }
    const items = await Promise.all(events.map(async event => ({ event, fingerprint: await eventFingerprint(event), priority: studyEventPriority(event) })));
    for (let index = 0; index < items.length; index += 100) await catalog.upsert(lease, items.slice(index, index + 100));
    const lookup: StudyLookup = { studyVersionId: study.id, outcome: events.length ? 'matched' : query ? 'no_match' : 'not_eligible',
      eventIds: events.map(event => event.id), query };
    // Commit each completed study before generation or selection of the next study.
    await studies.record(lease, lookup); lookups.push(lookup);
    for (const event of events) discovered.add(event.id);
  }
  return { discovered: discovered.size, lookups };
}
