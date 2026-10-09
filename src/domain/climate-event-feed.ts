import { isClimateEvent, type ClimateEvent } from './climate-event.ts';
import { AssessmentError, assessmentLevels, choice, object, type AssessmentLevel } from './climate-assessment.ts';
export interface ConnectionIndicator { eventId: string; humanInfluence: AssessmentLevel; evidenceStrength: AssessmentLevel; stale: boolean }
export interface ClimateEventFeed {
  events: ClimateEvent[]; indicators: ConnectionIndicator[]; updatedAt: string | null; historyEnd: string | null;
  counts: { total: number; pending: number; failed: number; insufficient: number; connections: number };
}
export function parseClimateEventFeed(value: unknown): ClimateEventFeed {
  const row = object(value); const counts = object(row.counts);
  if (!Array.isArray(row.events) || row.events.length>200 || !row.events.every(isClimateEvent) || new Set(row.events.map(e=>e.id)).size!==row.events.length ||
    !Array.isArray(row.indicators) || row.indicators.length!==row.events.length) throw new AssessmentError('validation','Invalid climate event feed');
  for (const key of ['total','pending','failed','insufficient','connections']) if (!Number.isSafeInteger(counts[key]) || Number(counts[key])<0) throw new AssessmentError('validation','Invalid feed counts');
  const events=row.events as ClimateEvent[];
  const indicators = row.indicators.map((value,i) => { const indicator=object(value);
    if (indicator.eventId!==events[i].id || typeof indicator.stale!=='boolean') throw new AssessmentError('validation','Invalid event indicator');
    return { eventId: indicator.eventId as string, stale: indicator.stale,
      humanInfluence: choice(indicator.humanInfluence,assessmentLevels), evidenceStrength: choice(indicator.evidenceStrength,assessmentLevels) };
  });
  if (row.updatedAt!==null && (typeof row.updatedAt!=='string' || !Number.isFinite(Date.parse(row.updatedAt)))) throw new AssessmentError('validation','Invalid feed timestamp');
  if (row.historyEnd!==null && (typeof row.historyEnd!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.historyEnd))) throw new AssessmentError('validation','Invalid history cursor');
  return { events: row.events as ClimateEvent[],indicators,updatedAt: row.updatedAt as string|null,historyEnd: row.historyEnd as string|null,
    counts: counts as unknown as ClimateEventFeed['counts'] };
}
