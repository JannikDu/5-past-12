import type { ClimateEvent, EventCategory } from '../../domain/climate-event.ts';

export interface EventQuery {
  /** Positive integer lookback in days; providers document and reject unsupported ranges. */
  days?: number;
  /** Explicit UTC-day range, supplied together and mutually exclusive with days. */
  start?: string;
  end?: string;
  category?: EventCategory;
  /** Positive integer result cap; providers document and reject unsupported ranges. */
  limit?: number;
  signal?: AbortSignal;
}

export interface EventBatch {
  events: ClimateEvent[];
  /** Nonnegative integer count of malformed or duplicate records excluded from events. */
  skipped: number;
}

export interface EventSourceProvider {
  /** Stable lowercase namespace matching every returned event's provenance.provider. */
  readonly id: string;
  readonly name: string;
  /** Return validated, unique events; reject transport/feed failures and cancellation. */
  fetchEvents(query?: EventQuery): Promise<EventBatch>;
  /**
   * Lookup a decoded external ID independently of the feed. Return null for missing
   * or invalid IDs; reject transport/response failures and cancellation. A result's
   * provenance and namespaced ID must match this provider and the requested ID.
   */
  fetchEvent(externalId: string, signal?: AbortSignal): Promise<ClimateEvent | null>;
}
