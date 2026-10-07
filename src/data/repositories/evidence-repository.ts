import type { EmbeddedChunk, EvidenceCitation, EvidenceQuery, EvidenceSearchResult, Generation,
  NormalizedEvidenceSource, ProcessingProfile, ProviderLease, ProviderProgress, RebuildStatus,
  SourceHead, SourceVersion, KnownPublication } from '../../domain/evidence.ts';

export interface StoreEvidenceInput {
  source: NormalizedEvidenceSource; contentHash: string; chunks: EmbeddedChunk[];
  generationId: string; expectedVersionId: string | null; lease: ProviderLease; itemId: string;
}
export interface StoreEvidenceResult { status: 'stored' | 'unchanged'; sourceCreated: boolean; versionCreated: boolean }
export interface EvidenceRepository {
  ensureGeneration(profile: ProcessingProfile): Promise<Generation>;
  findSource(url: string): Promise<SourceHead | null>;
  storeSource(input: StoreEvidenceInput): Promise<StoreEvidenceResult>;
  acquireLease(providerId: string, owner: string, seconds: number): Promise<ProviderLease | null>;
  checkpoint(lease: ProviderLease, progress: ProviderProgress): Promise<void>;
  knownItems(providerId: string, after: string | null, through: string, limit: number): Promise<KnownPublication[]>;
  search(query: EvidenceQuery, embedding: number[], generationId: string, publicationCap: number): Promise<EvidenceSearchResult[]>;
  findByChunkId(chunkId: string): Promise<EvidenceCitation | null>;
  startRebuild(profile: ProcessingProfile, owner: string): Promise<RebuildStatus>;
  rebuildStatus(): Promise<RebuildStatus | null>;
  resumeRebuild(profile: ProcessingProfile, owner: string): Promise<RebuildStatus>;
  readVersion(id: string): Promise<SourceVersion>;
  stageRebuild(status: RebuildStatus, versionId: string, chunks: EmbeddedChunk[]): Promise<void>;
  activateRebuild(status: RebuildStatus): Promise<void>;
  abortRebuild(profile: ProcessingProfile, owner: string): Promise<void>;
}
