import { isClimateEvent, parseEventId, type ClimateEvent } from '../domain/climate-event.ts';
import { demoEvents } from './demo-events.ts';
import { EonetProvider } from './providers/eonet.ts';
import type { EventSourceProvider } from './providers/event-source.ts';

export const eventProviders: ReadonlyMap<string, EventSourceProvider> = new Map([
  ['eonet', new EonetProvider()],
]);

export function eventDetailUrl(event: ClimateEvent): string {
  if (!parseEventId(event.id)) throw new TypeError('Invalid namespaced event ID.');
  return `/events/detail?id=${encodeURIComponent(event.id)}`;
}

export async function findEvent(id: string, signal?: AbortSignal): Promise<ClimateEvent | null> {
  const parsed = parseEventId(id);
  if (!parsed) return null;
  if (parsed.provider === 'demo') return demoEvents.find((event) => event.id === id) ?? null;
  const provider = eventProviders.get(parsed.provider);
  if (!provider) return null;
  const event = await provider.fetchEvent(parsed.externalId, signal);
  if (event !== null && (!isClimateEvent(event) || event.id !== id || provider.id !== parsed.provider)) {
    throw new Error('Event provider returned an invalid or mismatched event.');
  }
  return event;
}
