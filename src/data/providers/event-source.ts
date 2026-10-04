import type { ClimateEvent } from '../../domain/climate-event.ts';

export interface EventQuery {
  days?: number;
  limit?: number;
  signal?: AbortSignal;
}

export interface EventBatch {
  events: ClimateEvent[];
  /** Malformed records are skipped, never silently presented as valid. */
  skipped: number;
}

export interface EventSourceProvider {
  readonly id: string;
  readonly name: string;
  fetchEvents(query?: EventQuery): Promise<EventBatch>;
  /** Direct lookup allows a detail URL to survive reloads and feed changes. */
  fetchEvent(externalId: string, signal?: AbortSignal): Promise<ClimateEvent | null>;
}
