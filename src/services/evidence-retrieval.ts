import { EventCategory } from '../domain/climate-event.ts';
import { EvidenceError, evidenceTypes, sourceTypes, validateVector, type EvidenceQuery, type EvidenceSearchResult, type ProcessingProfile } from '../domain/evidence.ts';
import type { EmbeddingProvider } from '../data/embeddings/embedding-provider.ts';
import type { EvidenceRepository } from '../data/repositories/evidence-repository.ts';
import { stableJson } from './evidence-identity.ts';

export interface EvidenceRetrievalService { search(query: EvidenceQuery): Promise<EvidenceSearchResult[]> }
export interface EvidenceCitationReader { findByChunkId(chunkId: string): ReturnType<EvidenceRepository['findByChunkId']> }
export function validateQuery(query: EvidenceQuery): EvidenceQuery {
  if (!query || typeof query.text !== 'string' || !query.text.trim()) throw new EvidenceError('validation', 'Evidence query text must be nonblank');
  const limit = query.limit ?? 10;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new EvidenceError('validation', 'Evidence query limit must be an integer from 1 to 100');
  if (query.eventType !== undefined && !Object.values(EventCategory).includes(query.eventType)) throw new EvidenceError('validation', 'Invalid event category');
  if (query.region !== undefined && (typeof query.region !== 'string' || !query.region.trim())) throw new EvidenceError('validation', 'Supplied region must be nonblank');
  if (query.eventDate !== undefined && (!(query.eventDate instanceof Date) || !Number.isFinite(query.eventDate.getTime()))) throw new EvidenceError('validation', 'Event date must be a valid Date');
  if (query.evidenceTypes !== undefined && (!Array.isArray(query.evidenceTypes) || !query.evidenceTypes.every(t => evidenceTypes.includes(t)))) throw new EvidenceError('validation', 'Invalid evidence preference');
  if (query.sourceTypes !== undefined && (!Array.isArray(query.sourceTypes) || !query.sourceTypes.every(t => sourceTypes.includes(t)))) throw new EvidenceError('validation', 'Invalid source preference');
  return { ...query, text: query.text.trim(), region: query.region?.trim(), limit };
}
export class DefaultEvidenceRetrievalService implements EvidenceRetrievalService, EvidenceCitationReader {
  constructor(private readonly repository: EvidenceRepository, private readonly embeddings: EmbeddingProvider, private readonly profile: ProcessingProfile, private readonly publicationCap = 2) {
    if (stableJson(embeddings.profile) !== stableJson(profile.embedding)) throw new EvidenceError('generation', 'Retrieval embedding adapter differs from its declared profile');
  }
  async search(input: EvidenceQuery): Promise<EvidenceSearchResult[]> {
    const query = validateQuery(input);
    const generation = await this.repository.ensureGeneration(this.profile);
    const vectors = await this.embeddings.embed([query.text], 'query');
    if (vectors.length !== 1) throw new EvidenceError('embedding', 'Query requires one embedding');
    validateVector(vectors[0]);
    return this.repository.search(query, vectors[0], generation.id, this.publicationCap);
  }
  findByChunkId(id: string) { return this.repository.findByChunkId(id); }
}
