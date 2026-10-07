import { EvidenceError, validateSource, validateVector, type Generation, type ProviderLease, type WorkLane } from '../domain/evidence.ts';
import type { EvidenceSourceProvider, EvidenceFetchOptions, EvidenceFetchBatch } from '../data/providers/evidence-source.ts';
import type { EvidenceNormalizer } from '../data/normalizers/evidence-normalizer.ts';
import type { EmbeddingProvider } from '../data/embeddings/embedding-provider.ts';
import type { EvidenceRepository } from '../data/repositories/evidence-repository.ts';
import { EvidenceChunker } from './evidence-chunker.ts';
import { sourceHash, sameProfile } from './evidence-identity.ts';

export interface ItemOutcome { itemId: string; lane: WorkLane; status: 'stored' | 'unchanged' | 'invalid' | 'failed'; chunks: number; normalized: boolean; sourceCreated?: boolean; versionCreated?: boolean; error?: string }
export interface IngestionPass { batch: Omit<EvidenceFetchBatch<never>, 'items'>; outcomes: ItemOutcome[]; fetched: number }
export interface RegisteredEvidenceProvider {
  readonly id: string;
  run(options: EvidenceFetchOptions, generation: Generation, lease: ProviderLease): Promise<IngestionPass>;
}
export class EvidenceIngestionService {
  constructor(private readonly repository: EvidenceRepository, private readonly embeddings: EmbeddingProvider, private readonly chunker: EvidenceChunker) {}
  async ingest<TRaw>(batch: EvidenceFetchBatch<TRaw>, normalizer: EvidenceNormalizer<TRaw>, generation: Generation, lease: ProviderLease, signal?: AbortSignal): Promise<IngestionPass> {
    if (!sameProfile(generation.profile, { embedding: this.embeddings.profile, chunking: this.chunker.profile })) throw new EvidenceError('generation', 'Ingestion adapters differ from the active processing profile');
    const outcomes: ItemOutcome[] = [];
    for (const item of batch.items) {
      let normalized = false;
      try {
        signal?.throwIfAborted();
        const source = await normalizer.normalize(item.raw);
        if (!source) { outcomes.push({ itemId: item.itemId, lane: item.lane, status: 'invalid', chunks: 0, normalized, error: 'validation' }); continue; }
        validateSource(source);
        normalized = true;
        const hash = await sourceHash(source); const current = await this.repository.findSource(source.url);
        if (current?.contentHash === hash) { outcomes.push({ itemId: item.itemId, lane: item.lane, status: 'unchanged', chunks: 0, normalized }); continue; }
        const passages = this.chunker.chunk(source.normalizedText);
        if (!passages.length) throw new EvidenceError('validation', 'Source has no useful passages');
        const vectors = await this.embeddings.embed(passages.map(p => p.content), 'document', signal);
        if (vectors.length !== passages.length) throw new EvidenceError('embedding', 'Document embedding cardinality mismatch');
        vectors.forEach(validateVector);
        const result = await this.repository.storeSource({ source, contentHash: hash, chunks: passages.map((p, i) => ({ ...p, embedding: vectors[i] })),
          generationId: generation.id, expectedVersionId: current?.sourceVersionId ?? null, lease, itemId: item.itemId });
        outcomes.push({ itemId: item.itemId, lane: item.lane, ...result, normalized, chunks: result.status === 'stored' ? passages.length : 0 });
      } catch (error) {
        outcomes.push({ itemId: item.itemId, lane: item.lane, status: !normalized && error instanceof EvidenceError && error.code === 'validation' ? 'invalid' : 'failed', normalized, chunks: 0, error: error instanceof EvidenceError ? error.code : 'processing' });
      }
    }
    const { items, ...metadata } = batch;
    return { batch: metadata, outcomes, fetched: items.length };
  }
}
export function registerEvidenceProvider<TRaw>(provider: EvidenceSourceProvider<TRaw>, normalizer: EvidenceNormalizer<TRaw>, ingestion: EvidenceIngestionService): RegisteredEvidenceProvider {
  return { id: provider.id, async run(options, generation, lease) {
    const batch = await provider.fetchNew(options); return ingestion.ingest(batch, normalizer, generation, lease, options.signal);
  } };
}
