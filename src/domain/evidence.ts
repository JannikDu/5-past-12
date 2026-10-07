import { EventCategory } from './climate-event.ts';

export const evidenceTypes = ['direct_attribution', 'event_context', 'analogue_attribution', 'general_context'] as const;
export const sourceTypes = ['attribution_study', 'scientific_report', 'observation', 'dataset', 'article'] as const;
export type EvidenceType = typeof evidenceTypes[number];
export type SourceType = typeof sourceTypes[number];
export type WorkLane = 'discovery' | 'backfill' | 'recheck' | 'pending';
export type JsonObject = Record<string, unknown>;

export interface NormalizedEvidenceSource {
  title: string;
  publisher: string;
  url: string;
  evidenceType: EvidenceType;
  sourceType: SourceType;
  eventTypes: EventCategory[];
  region: string | null;
  eventStart: string | null;
  eventEnd: string | null;
  publishedAt: string | null;
  sourceUpdatedAt: string | null;
  normalizedText: string;
  normalizationProfile: string;
}
export interface ChunkSpan { content: string; chunkIndex: number; start: number; end: number }
export interface EmbeddedChunk extends ChunkSpan { embedding: number[] }
export interface ChunkingProfile { version: string; size: number; overlap: number; minSize: number }
export interface EmbeddingProfile {
  provider: string; endpoint: string; model: string; dimensions: 1536;
  documentPolicy: string; queryPolicy: string;
}
export interface ProcessingProfile { embedding: EmbeddingProfile; chunking: ChunkingProfile }
export interface Generation { id: string; profile: ProcessingProfile }
export interface SourceHead { id: string; sourceVersionId: string; contentHash: string | null }
export interface SourceVersion {
  id: string; sourceId: string; source: NormalizedEvidenceSource; providerId: string; itemId: string;
}
export interface EvidenceQuery {
  text: string; eventType?: EventCategory; region?: string; eventDate?: Date;
  evidenceTypes?: EvidenceType[]; sourceTypes?: SourceType[]; limit?: number;
}
export interface EvidenceCitation {
  chunkId: string; sourceId: string; sourceVersionId: string; content: string;
  sourceTitle: string; publisher: string; sourceUrl: string;
  evidenceType: EvidenceType; sourceType: SourceType; publishedAt: string | null;
}
export interface EvidenceSearchResult extends EvidenceCitation { similarity: number; score: number }
export interface ProviderProgress {
  since: string | null; state: JsonObject; pending: string[];
  recheckAfter: string | null; recheckCursor: string | null; recheckThrough: string | null;
}
export interface ProviderLease { providerId: string; owner: string; progress: ProviderProgress }
export interface KnownPublication { itemId: string; publishedAt: string | null }
export interface RebuildStatus {
  generation: Generation; previousGenerationId: string; owner: string; expiresAt: string;
  manifest: string[]; completed: string[];
}
export type EvidenceErrorCode = 'validation' | 'http' | 'authentication' | 'timeout' | 'cancelled' |
  'contract' | 'embedding' | 'database' | 'maintenance' | 'generation' | 'conflict' | 'lease' | 'legacy';
export class EvidenceError extends Error {
  constructor(public readonly code: EvidenceErrorCode, message: string, options?: ErrorOptions) {
    super(message, options); this.name = 'EvidenceError';
  }
}

export function validateVector(value: unknown): asserts value is number[] {
  if (!Array.isArray(value) || value.length !== 1536) {
    throw new EvidenceError('embedding', `Expected 1536 embedding values; received ${Array.isArray(value) ? value.length : 'invalid data'}`);
  }
  if (!Array.from(value).every(v => typeof v === 'number' && Number.isFinite(v)) || !value.some(v => v !== 0)) {
    throw new EvidenceError('embedding', 'Embedding must contain finite numbers and have nonzero norm');
  }
}
export function validateSource(source: NormalizedEvidenceSource): void {
  let u: URL;
  try { u = new URL(source.url); } catch { throw new EvidenceError('validation', 'Invalid normalized evidence URL'); }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password ||
      !source.title.trim() || !source.publisher.trim() || !source.normalizedText.trim() || !source.normalizationProfile ||
      !evidenceTypes.includes(source.evidenceType) || !sourceTypes.includes(source.sourceType) ||
      !source.eventTypes.every(t => Object.values(EventCategory).includes(t)) ||
      (source.region !== null && !source.region.trim())) throw new EvidenceError('validation', 'Invalid normalized evidence source');
  for (const value of [source.eventStart, source.eventEnd, source.publishedAt, source.sourceUpdatedAt]) {
    if (value !== null && !Number.isFinite(Date.parse(value))) throw new EvidenceError('validation', 'Invalid evidence date');
  }
  if (source.eventStart && source.eventEnd && Date.parse(source.eventStart) > Date.parse(source.eventEnd)) throw new EvidenceError('validation', 'Event interval is reversed');
}
