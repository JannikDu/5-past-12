import type { JsonObject, WorkLane } from '../../domain/evidence.ts';

export interface EvidenceFetchOptions {
  since?: string | null; state?: JsonObject; replay?: string[]; recheck?: string[];
  publicationDates?: Record<string, string | null>;
  maxItems?: number; maxPages?: number; overlapDays?: number; signal?: AbortSignal;
}
export interface EvidenceEnvelope<TRaw> { itemId: string; lane: WorkLane; raw: TRaw }
export interface FetchDiagnostic { lane: WorkLane; itemId?: string; code: string }
export interface EvidenceFetchBatch<TRaw> {
  items: EvidenceEnvelope<TRaw>[]; failures: FetchDiagnostic[]; skipped: number; unchanged?: number;
  skippedItems?: FetchDiagnostic[];
  complete: Record<WorkLane, boolean>; state: JsonObject;
}
export interface EvidenceSourceProvider<TRaw> {
  readonly id: string; readonly name: string;
  fetchNew(options?: EvidenceFetchOptions): Promise<EvidenceFetchBatch<TRaw>>;
}
