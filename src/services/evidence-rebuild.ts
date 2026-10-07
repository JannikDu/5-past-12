import { EvidenceError, validateVector, type ProcessingProfile } from '../domain/evidence.ts';
import type { EvidenceRepository } from '../data/repositories/evidence-repository.ts';
import type { EmbeddingProvider } from '../data/embeddings/embedding-provider.ts';
import { EvidenceChunker } from './evidence-chunker.ts';
import { sameProfile } from './evidence-identity.ts';

export class EvidenceRebuildService {
  constructor(private readonly repository: EvidenceRepository, private readonly embeddings: EmbeddingProvider, private readonly chunker: EvidenceChunker, private readonly profile: ProcessingProfile) {
    if (!sameProfile(profile, { embedding: embeddings.profile, chunking: chunker.profile })) throw new EvidenceError('generation', 'Rebuild adapters differ from the declared processing profile');
  }
  status() { return this.repository.rebuildStatus(); }
  abort(owner: string) { return this.repository.abortRebuild(this.profile, owner); }
  async run(mode: 'start' | 'resume', owner: string, budget = 20, signal?: AbortSignal) {
    if (!Number.isInteger(budget) || budget < 1) throw new EvidenceError('validation', 'Rebuild budget must be positive');
    // Capability check precedes the maintenance transition.
    const precheck = await this.embeddings.embed(['Climate evidence document.', 'Drought and heat evidence.'], 'document', signal);
    if (precheck.length !== 2) throw new EvidenceError('embedding', 'Capability check requires two embeddings');
    precheck.forEach(validateVector);
    let status = mode === 'start' ? await this.repository.startRebuild(this.profile, owner) : await this.repository.resumeRebuild(this.profile, owner);
    const generationId = status.generation.id;
    let processed = 0;
    for (const versionId of status.manifest.filter(id => !status.completed.includes(id)).slice(0, budget)) {
      signal?.throwIfAborted();
      const version = await this.repository.readVersion(versionId);
      if (!version.source.normalizedText) throw new EvidenceError('legacy', 'Rebuild requires a verified retained original document');
      const chunks = this.chunker.chunk(version.source.normalizedText);
      const vectors = await this.embeddings.embed(chunks.map(c => c.content), 'document', signal);
      if (!chunks.length || vectors.length !== chunks.length) throw new EvidenceError('embedding', 'Rebuild embedding cardinality mismatch');
      vectors.forEach(validateVector);
      await this.repository.stageRebuild(status, versionId, chunks.map((chunk, i) => ({ ...chunk, embedding: vectors[i] })));
      processed++;
    }
    const latest = await this.repository.rebuildStatus();
    if (!latest || latest.owner !== owner || latest.generation.id !== generationId) throw new EvidenceError('lease', 'Rebuild ownership changed before activation');
    status = latest;
    if (status.completed.length === status.manifest.length) { await this.repository.activateRebuild(status); return { status: 'ready' as const, processed, total: status.manifest.length }; }
    return { status: 'maintenance' as const, processed, completed: status.completed.length, total: status.manifest.length, owner: status.owner, expiresAt: status.expiresAt };
  }
}
