import type { ClimateEvent } from '../domain/climate-event.ts';
import { demoEvents } from './demo-events.ts';
import { EonetProvider } from './providers/eonet.ts';
import type { EventSourceProvider } from './providers/event-source.ts';

export const eventProviders: ReadonlyMap<string, EventSourceProvider> = new Map([
  ['eonet', new EonetProvider()],
]);

export function eventDetailUrl(event: ClimateEvent): string {
  return `/events/detail?id=${encodeURIComponent(event.id)}`;
}

export async function findEvent(id: string, signal?: AbortSignal): Promise<ClimateEvent | null> {
  const separator = id.indexOf(':');
  if (separator < 1) return null;
  const providerId = id.slice(0, separator), externalId = id.slice(separator + 1);
  if (providerId === 'demo') return demoEvents.find((event) => event.id === id) ?? null;
  const provider = eventProviders.get(providerId);
  return provider ? provider.fetchEvent(externalId, signal) : null;
}
