import { AssessmentError } from '../domain/climate-assessment.ts';
import type { ClimateEvent, EventCategory } from '../domain/climate-event.ts';
import type { EventSourceProvider } from '../data/providers/event-source.ts';

/** Bisect saturated date windows; incomplete lookups must never be checkpointed. */
export async function fetchCompleteEventWindow(provider: EventSourceProvider, start: string, end: string,
  maxRequests = 16, category?: EventCategory): Promise<ClimateEvent[]> {
  const events = new Map<string, ClimateEvent>(); let requests = 0;
  async function read(first: string, last: string): Promise<void> {
    if (++requests > maxRequests) throw new AssessmentError('budget', 'Study event lookup exceeded the provider request budget');
    const batch = await provider.fetchEvents({ start: first, end: last, limit: 200, category });
    if (batch.events.length + batch.skipped >= 200) {
      if (first === last) throw new AssessmentError('budget', 'A single EONET day is saturated; study discovery is incomplete');
      const middle = new Date(Math.floor((Date.parse(`${first}T00:00:00Z`) + Date.parse(`${last}T00:00:00Z`)) / 2));
      const day = middle.toISOString().slice(0, 10); const next = new Date(`${day}T00:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
      await read(first, day); await read(next.toISOString().slice(0, 10), last); return;
    }
    for (const event of batch.events) events.set(event.id, event);
  }
  await read(start, end); return [...events.values()];
}
