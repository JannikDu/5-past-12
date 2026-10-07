import type { EmbeddingProfile } from '../../domain/evidence.ts';
export interface EmbeddingProvider {
  readonly profile: EmbeddingProfile;
  embed(texts: string[], purpose: 'document' | 'query', signal?: AbortSignal): Promise<number[][]>;
}
