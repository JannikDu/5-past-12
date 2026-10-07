import { EvidenceError, validateVector, type EmbeddingProfile } from '../../domain/evidence.ts';
import type { EmbeddingProvider } from './embedding-provider.ts';
import { EvidenceHttpClient, type HttpOptions } from '../http.ts';

export const queryInstruction = 'Given a climate-event query, retrieve relevant scientific climate evidence.';
export class FeatherlessEmbeddingProvider implements EmbeddingProvider {
  readonly profile: EmbeddingProfile;
  private readonly http: EvidenceHttpClient;
  constructor(private readonly config: { apiKey: string; model: string; baseUrl?: string; batchSize?: number }, http: HttpOptions = {}) {
    if (!config.apiKey.trim() || !config.model.trim() || !Number.isInteger(config.batchSize ?? 32) || (config.batchSize ?? 32) < 1) throw new EvidenceError('validation', 'Featherless API key, model and positive batch size are required');
    const endpoint = (config.baseUrl ?? 'https://api.featherless.ai/v1').replace(/\/$/, '');
    const qwen = config.model.startsWith('Qwen/Qwen3-Embedding-');
    this.profile = { provider: 'featherless-v1', endpoint, model: config.model, dimensions: 1536,
      documentPolicy: 'plain-v1', queryPolicy: qwen ? `qwen-v1:Instruct: ${queryInstruction}\nQuery: ` : 'plain-v1' };
    this.http = new EvidenceHttpClient({ ...http, timeoutMs: http.timeoutMs ?? 30000 });
  }
  async embed(texts: string[], purpose: 'document' | 'query', signal?: AbortSignal): Promise<number[][]> {
    if (!['document', 'query'].includes(purpose) || texts.some(t => typeof t !== 'string' || !t.trim())) throw new EvidenceError('validation', 'Embedding requires nonblank text and a valid purpose');
    const vectors: number[][] = [];
    const size = this.config.batchSize ?? 32;
    for (let offset = 0; offset < texts.length; offset += size) {
      const batch = texts.slice(offset, offset + size);
      const input = batch.map(text => purpose === 'query' && this.profile.queryPolicy.startsWith('qwen-v1:') ? `${this.profile.queryPolicy.slice('qwen-v1:'.length)}${text}` : text);
      const response = await this.http.json(`${this.profile.endpoint}/embeddings`, {
        method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${this.config.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.config.model, input, dimensions: 1536, encoding_format: 'float' }), signal,
      });
      if (!response || typeof response !== 'object' || !('data' in response) || !Array.isArray(response.data) || response.data.length !== batch.length) throw new EvidenceError('embedding', 'Embedding response cardinality mismatch');
      const ordered = new Map<number, number[]>();
      for (const row of response.data) {
        if (!row || typeof row !== 'object' || !Number.isInteger(row.index) || row.index < 0 || row.index >= batch.length || ordered.has(row.index)) throw new EvidenceError('embedding', 'Embedding indices must be unique and complete');
        validateVector(row.embedding); ordered.set(row.index, row.embedding);
      }
      for (let i = 0; i < batch.length; i++) vectors.push(ordered.get(i)!);
    }
    return vectors;
  }
}
