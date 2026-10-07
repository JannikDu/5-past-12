import type { TestContext } from 'node:test';
import { createEvidenceServices } from '../../src/server/evidence.ts';
import { evidenceDatabase } from './evidence-database.ts';
import { csiHtml, wwaFeed, wwaArticle, wwaUrl, vector } from './evidence-fixtures.ts';

type LocalDatabase = Awaited<ReturnType<typeof evidenceDatabase>>;
export interface EmbeddingRequest { input: string[]; model: string; dimensions: number; encoding_format: string }
type HttpOverride = (url: URL, init: RequestInit | undefined, local: LocalDatabase) => Promise<Response | undefined> | Response | undefined;

/** Real providers, services, HTTP adapters and migrated SQL; no external HTTP. */
export async function evidenceApplication(t: TestContext, options: { http?: HttpOverride; retries?: number; env?: Record<string, string> } = {}) {
  const local = await evidenceDatabase(); t.after(() => local.db.close());
  const requests: EmbeddingRequest[] = [];
  const env = {
    SUPABASE_URL: 'https://database.test', SUPABASE_SECRET_KEY: 'test-database-key',
    FEATHERLESS_API_KEY: 'test-embedding-key', FEATHERLESS_EMBEDDING_MODEL: 'Qwen/Qwen3-Embedding-4B',
    FEATHERLESS_BASE_URL: 'https://embedding.test/v1', FEATHERLESS_EMBEDDING_BATCH_SIZE: '2',
    EVIDENCE_CHUNK_SIZE: '600', EVIDENCE_CHUNK_OVERLAP: '100', EVIDENCE_CHUNK_MIN_SIZE: '100',
    EVIDENCE_MAX_ITEMS_PER_PROVIDER: '6', EVIDENCE_MAX_PAGES_PER_PROVIDER: '3',
    EVIDENCE_RETRIEVAL_MAX_CHUNKS_PER_SOURCE: '1', ...options.env,
  };
  const services = createEvidenceServices(env, { logger: { info() {} }, http: {
    retries: options.retries ?? 0, sleep: async () => {}, fetch: async (input, init) => {
      const url = new URL(String(input));
      if (url.hostname === 'embedding.test') requests.push(JSON.parse(String(init?.body)));
      const overridden = await options.http?.(url, init, local);
      if (overridden) return overridden;
      if (url.hostname === 'database.test') return local.fetch(input, init);
      if (url.hostname === 'embedding.test') {
        const request = requests.at(-1)!;
        return Response.json({ data: request.input.map((_text, index) => ({ index, embedding: vector() })).reverse() });
      }
      if (url.hostname === 'www.climatecentral.org') return new Response(csiHtml());
      if (url.href === wwaUrl) return new Response(wwaArticle());
      if (url.hostname === 'www.worldweatherattribution.org' && url.pathname === '/feed/') return new Response(url.searchParams.has('paged') ? wwaFeed([]) : wwaFeed());
      throw new Error(`Unexpected test HTTP destination: ${url.hostname}${url.pathname}`);
    },
  } });
  return { ...local, services, requests };
}

export async function projection(db: LocalDatabase['db']) {
  return (await db.query<{ url: string; current_version_id: string; generation_id: string; id: string; content: string; chunk_index: number }>(
    'select s.url,s.current_version_id,s.generation_id,c.id,c.content,c.chunk_index from public.evidence_sources s join public.evidence_chunks c on c.source_id=s.id order by s.url,c.chunk_index')).rows;
}
