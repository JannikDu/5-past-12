import { EvidenceError, evidenceTypes, sourceTypes, validateSource, validateVector,
  type EmbeddedChunk, type EvidenceCitation, type EvidenceQuery, type EvidenceSearchResult,
  type Generation, type ProcessingProfile, type ProviderLease, type ProviderProgress,
  type RebuildStatus, type SourceHead, type SourceVersion, type KnownPublication } from '../../domain/evidence.ts';
import type { EvidenceRepository, StoreEvidenceInput, StoreEvidenceResult } from './evidence-repository.ts';
import { EvidenceHttpClient, type HttpOptions } from '../http.ts';
import { sameProfile } from '../../services/evidence-identity.ts';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new EvidenceError('contract', 'Database returned an invalid object');
  return value as Record<string, unknown>;
}
function string(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== 'string' || !value.trim()) throw new EvidenceError('contract', `Invalid evidence result field: ${key}`);
  return value;
}
function identifier(row: Record<string, unknown>, key: string): string {
  const value = string(row, key);
  if (!uuid.test(value)) throw new EvidenceError('contract', `Invalid evidence identifier: ${key}`);
  return value;
}
export function mapEvidenceCitation(value: unknown): EvidenceCitation {
  const row = object(value);
  const evidenceType = string(row, 'evidence_type'); const sourceType = string(row, 'source_type');
  if (!evidenceTypes.includes(evidenceType as typeof evidenceTypes[number]) || !sourceTypes.includes(sourceType as typeof sourceTypes[number])) throw new EvidenceError('contract', 'Unsupported evidence classification');
  const url = string(row, 'source_url');
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new EvidenceError('contract', 'Invalid evidence URL'); }
  if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new EvidenceError('contract', 'Invalid evidence URL');
  const published = row.published_at;
  if (published !== null && (typeof published !== 'string' || !Number.isFinite(Date.parse(published)))) throw new EvidenceError('contract', 'Invalid publication date');
  return { chunkId: identifier(row, 'chunk_id'), sourceId: identifier(row, 'source_id'), sourceVersionId: identifier(row, 'source_version_id'),
    content: string(row, 'content'), sourceTitle: string(row, 'source_title'), publisher: string(row, 'publisher'), sourceUrl: url,
    evidenceType: evidenceType as EvidenceCitation['evidenceType'], sourceType: sourceType as EvidenceCitation['sourceType'], publishedAt: published as string | null };
}
export function mapEvidenceSearchResult(value: unknown): EvidenceSearchResult {
  const row = object(value); const citation = mapEvidenceCitation(row);
  if (typeof row.similarity !== 'number' || !Number.isFinite(row.similarity) || row.similarity < -1.000001 || row.similarity > 1.000001 ||
      typeof row.score !== 'number' || !Number.isFinite(row.score) || row.score < 0) throw new EvidenceError('contract', 'Invalid evidence ranking scores');
  return { ...citation, similarity: row.similarity, score: row.score };
}
export class SupabaseEvidenceRepository implements EvidenceRepository {
  private readonly http: EvidenceHttpClient;
  private readonly endpoint: string;
  constructor(private readonly config: { url: string; secretKey: string }, options: HttpOptions = {}) {
    const url = new URL(config.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !config.secretKey.trim()) throw new EvidenceError('validation', 'Supabase URL and secret key are required');
    this.endpoint = `${config.url.replace(/\/$/, '')}/rest/v1/rpc`;
    this.http = new EvidenceHttpClient({ ...options, maxBytes: options.maxBytes ?? 8 * 1024 * 1024 });
  }
  /** Discovery ordering only; titles never establish claim support or attribution. */
  async discoveryPublicationTitles(): Promise<string[]> {
    const parameters = new URLSearchParams({ select: 'title', current_version_id: 'not.is.null', order: 'published_at.desc', limit: '500' });
    const response = await this.http.json(`${this.config.url.replace(/\/$/, '')}/rest/v1/evidence_sources?${parameters}`, {
      headers: { apikey: this.config.secretKey }, redirect: 'error' });
    if (!Array.isArray(response) || response.length > 500) throw new EvidenceError('contract', 'Invalid discovery publication list');
    return response.map(value => string(object(value), 'title'));
  }
  private async rpc(name: string, input: Record<string, unknown>): Promise<unknown> {
    let response;
    try { response = await this.http.request(`${this.endpoint}/${name}`, { method: 'POST', redirect: 'error',
      headers: { apikey: this.config.secretKey, 'Content-Type': 'application/json' }, body: JSON.stringify(input) }); }
    catch (error) {
      if (error instanceof EvidenceError) throw error;
      throw new EvidenceError('database', 'Evidence database request failed');
    }
    if (response.status < 200 || response.status >= 300) {
      if ([401, 403].includes(response.status)) throw new EvidenceError('authentication', 'Evidence database credentials or grants were rejected');
      const known = response.text.match(/evidence:(maintenance|generation|conflict|lease|legacy|validation|embedding|contract)\b/)?.[1] as EvidenceError['code'] | undefined;
      throw new EvidenceError(known ?? 'database', known ? `Evidence database rejected operation: ${known}` : `Evidence database operation failed (${response.status})`);
    }
    try { return JSON.parse(response.text); } catch { throw new EvidenceError('contract', 'Evidence database returned invalid JSON'); }
  }
  private control<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> { return this.rpc('evidence_control', { action, payload }) as Promise<T>; }
  async ensureGeneration(profile: ProcessingProfile): Promise<Generation> {
    const result = object(await this.control('generation', { profile })); identifier(result, 'id');
    if (!result.profile || !sameProfile(result.profile as ProcessingProfile, profile)) throw new EvidenceError('generation', 'Database processing profile differs from runtime configuration');
    return result as unknown as Generation;
  }
  async findSource(url: string): Promise<SourceHead | null> {
    const value = await this.control('find-source', { url });
    if (value === null) return null;
    const row = object(value); identifier(row, 'id'); identifier(row, 'sourceVersionId');
    if (row.contentHash !== null && (typeof row.contentHash !== 'string' || !/^[a-f0-9]{64}$/.test(row.contentHash))) throw new EvidenceError('contract', 'Invalid source content hash');
    return row as unknown as SourceHead;
  }
  async storeSource(input: StoreEvidenceInput): Promise<StoreEvidenceResult> {
    validateSource(input.source); input.chunks.forEach(c => validateVector(c.embedding));
    const response = object(await this.rpc('store_evidence_source', { payload: input }));
    if (!['stored', 'unchanged'].includes(String(response.status)) || typeof response.sourceCreated !== 'boolean' || typeof response.versionCreated !== 'boolean') throw new EvidenceError('contract', 'Invalid store outcome');
    return response as unknown as StoreEvidenceResult;
  }
  acquireLease(providerId: string, owner: string, seconds: number) { return this.control<ProviderLease | null>('lease', { providerId, owner, seconds }); }
  async checkpoint(lease: ProviderLease, progress: ProviderProgress) { await this.control('checkpoint', { providerId: lease.providerId, owner: lease.owner, progress }); }
  knownItems(providerId: string, after: string | null, through: string, limit: number) { return this.control<KnownPublication[]>('known-items', { providerId, after, through, limit }); }
  async search(query: EvidenceQuery, embedding: number[], generationId: string, publicationCap: number): Promise<EvidenceSearchResult[]> {
    validateVector(embedding);
    const results = await this.rpc('hybrid_match_evidence_chunks', { payload: { embedding, generationId, publicationCap,
      query: { ...query, eventDate: query.eventDate?.toISOString().slice(0, 10) } } });
    if (!Array.isArray(results)) throw new EvidenceError('contract', 'Evidence search must return an array');
    return results.map(mapEvidenceSearchResult);
  }
  async findByChunkId(chunkId: string) {
    if (!uuid.test(chunkId)) throw new EvidenceError('validation', 'Citation ID must be a UUID');
    const result = await this.rpc('evidence_citation', { chunk_id: chunkId });
    return result === null ? null : mapEvidenceCitation(result);
  }
  async findByChunkIds(chunkIds: string[]): Promise<EvidenceCitation[]> {
    if (chunkIds.length > 100 || chunkIds.some(id => !uuid.test(id))) throw new EvidenceError('validation', 'Invalid citation batch');
    if (!chunkIds.length) return [];
    const result = await this.rpc('evidence_citations', { chunk_ids: [...new Set(chunkIds)] });
    if (!Array.isArray(result)) throw new EvidenceError('contract', 'Invalid citation batch response');
    const citations = result.map(mapEvidenceCitation);
    if (new Set(citations.map(c => c.chunkId)).size !== citations.length || citations.some(c => !chunkIds.includes(c.chunkId)))
      throw new EvidenceError('contract', 'Unexpected citation batch identity');
    return citations;
  }
  startRebuild(profile: ProcessingProfile, owner: string) { return this.control<RebuildStatus>('rebuild-start', { profile, owner }); }
  rebuildStatus() { return this.control<RebuildStatus | null>('rebuild-status'); }
  resumeRebuild(profile: ProcessingProfile, owner: string) { return this.control<RebuildStatus>('rebuild-resume', { profile, owner }); }
  async readVersion(id: string) {
    const version = await this.control<SourceVersion>('read-version', { id }); validateSource(version.source); return version;
  }
  async stageRebuild(status: RebuildStatus, versionId: string, chunks: EmbeddedChunk[]) {
    chunks.forEach(c => validateVector(c.embedding));
    await this.control('rebuild-stage', { owner: status.owner, generationId: status.generation.id, versionId, chunks });
  }
  async activateRebuild(status: RebuildStatus) { await this.control('rebuild-activate', { owner: status.owner, generationId: status.generation.id }); }
  async abortRebuild(profile: ProcessingProfile, owner: string) { await this.control('rebuild-abort', { profile, owner }); }
}
