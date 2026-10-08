import test from 'node:test';
import assert from 'node:assert/strict';
import { EvidenceHttpClient } from '../src/data/http.ts';
import { FeatherlessEmbeddingProvider } from '../src/data/embeddings/featherless.ts';
import { SupabaseEvidenceRepository } from '../src/data/repositories/supabase-evidence.ts';
import { profile, vector } from './helpers/evidence-fixtures.ts';

test('discovery publication hints use the server-only source catalog and reject malformed records', async () => {
  for (const valid of [true, false]) {
    const repository = new SupabaseEvidenceRepository({ url: 'https://database.test', secretKey: 'fake-server-key' }, { fetch: async (input, init) => {
      const url = new URL(String(input)); assert.equal(url.pathname, '/rest/v1/evidence_sources');
      assert.equal(url.searchParams.get('current_version_id'), 'not.is.null'); assert.equal(url.searchParams.get('select'), 'title');
      assert.equal(new Headers(init?.headers).get('apikey'), 'fake-server-key'); assert.equal(init?.redirect, 'manual');
      return Response.json(valid ? [{ title: 'A named-event publication' }] : [{ title: null }]);
    } });
    if (valid) assert.deepEqual(await repository.discoveryPublicationTitles(), ['A named-event publication']);
    else await assert.rejects(repository.discoveryPublicationTitles(), { code: 'contract' });
  }
});

test('redirect rejection works in workerd and never follows or retries a credentialed redirect', async () => {
  let requests = 0;
  const http = new EvidenceHttpClient({ retries: 3, fetch: async (_url, init) => {
    requests++; assert.equal(init?.redirect, 'manual');
    return new Response(null, { status: 302, headers: { Location: 'https://untrusted.example/' } });
  } });
  await assert.rejects(http.json('https://trusted.example/', { redirect: 'error', headers: { Authorization: 'Bearer fake' } }), /HTTP redirect blocked/);
  assert.equal(requests, 1);
});

test('Featherless retries rate limits with the same authenticated batch and keeps output order', async () => {
  const requests: { url: string; input: string[]; model: string; dimensions: number; encoding_format: string }[] = [];
  const sleeps: number[] = [];
  const provider = new FeatherlessEmbeddingProvider({ apiKey: 'test-embedding-key', model: profile.embedding.model, baseUrl: 'https://embedding.test/v1', batchSize: 2 }, {
    sleep: async ms => { sleeps.push(ms); }, fetch: async (url, init) => {
      assert.equal(init?.method, 'POST'); assert.equal(init?.redirect, 'manual');
      const headers = new Headers(init?.headers); assert.equal(headers.get('Authorization'), 'Bearer test-embedding-key'); assert.equal(headers.get('apikey'), null);
      const body = JSON.parse(String(init?.body)); requests.push({ url: String(url), ...body });
      if (requests.length === 1) return new Response(null, { status: 429, headers: { 'retry-after': '1' } });
      return Response.json({ data: body.input.map((text: string, index: number) => ({ index, embedding: vector(Number(text)) })).reverse() });
    },
  });
  assert.deepEqual((await provider.embed(['1', '2', '3'], 'document')).map(v => v[0]), [1, 2, 3]);
  assert.deepEqual(requests.map(r => r.input), [['1', '2'], ['1', '2'], ['3']]); assert.deepEqual(sleeps, [1000]);
  assert.ok(requests.every(r => r.url === 'https://embedding.test/v1/embeddings' && r.model === profile.embedding.model && r.dimensions === 1536 && r.encoding_format === 'float'));
});

test('embedding authentication and invalid response errors are not retried', async () => {
  for (const [response, code] of [
    [new Response(null, { status: 401 }), 'authentication'],
    [Response.json({ data: [{ index: 0, embedding: Array(1024).fill(1) }] }), 'embedding'],
    [new Response('temporarily malformed JSON'), 'contract'],
  ] as const) {
    let calls = 0;
    const provider = new FeatherlessEmbeddingProvider({ apiKey: 'fake', model: profile.embedding.model }, { fetch: async () => { calls++; return response; }, sleep: async () => {} });
    await assert.rejects(provider.embed(['Published findings'], 'document'), { code }); assert.equal(calls, 1);
  }
});

test('caller cancellation during response consumption stops retries immediately', async () => {
  const controller = new AbortController(); let calls = 0;
  const http = new EvidenceHttpClient({ fetch: async (_url, init) => {
    calls++;
    return new Response(new ReadableStream({ start(stream) {
      init!.signal!.addEventListener('abort', () => stream.error(new Error('Request aborted')), { once: true });
      controller.abort();
    } }));
  }, sleep: async () => { throw new Error('Cancellation must not back off'); } });
  await assert.rejects(http.json('https://api.test', { signal: controller.signal }), { code: 'cancelled' });
  assert.equal(calls, 1);
});

test('HTTP supports Retry-After dates and caps long server-directed waits', async t => {
  t.mock.method(Date, 'now', () => Date.parse('2026-10-07T12:00:00Z'));
  const sleeps: number[] = []; let calls = 0;
  const http = new EvidenceHttpClient({ fetch: async () => {
    calls++;
    if (calls === 1) return new Response(null, { status: 503, headers: { 'Retry-After': 'Wed, 07 Oct 2026 12:00:04 GMT' } });
    if (calls === 2) return new Response(null, { status: 429, headers: { 'Retry-After': '120' } });
    return Response.json({ recovered: true });
  }, sleep: async ms => { sleeps.push(ms); } });
  assert.deepEqual(await http.json('https://api.test'), { recovered: true }); assert.deepEqual(sleeps, [4000, 10000]);
});

test('Supabase search serializes UTC dates and preferences through the privileged RPC contract', async () => {
  const generationId = crypto.randomUUID();
  const repository = new SupabaseEvidenceRepository({ url: 'https://database.test', secretKey: 'test-database-key' }, { fetch: async (url, init) => {
    assert.equal(String(url), 'https://database.test/rest/v1/rpc/hybrid_match_evidence_chunks');
    const headers = new Headers(init?.headers); assert.equal(headers.get('apikey'), 'test-database-key'); assert.equal(headers.get('Authorization'), null);
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body.payload, { generationId, publicationCap: 2, embedding: vector(), query: {
      text: 'Spain wildfire', eventDate: '2026-10-08', evidenceTypes: [], sourceTypes: ['observation'], limit: 5,
    } });
    return Response.json([]);
  } });
  assert.deepEqual(await repository.search({ text: 'Spain wildfire', eventDate: new Date('2026-10-07T23:30:00-03:00'), evidenceTypes: [], sourceTypes: ['observation'], limit: 5 }, vector(), generationId, 2), []);
});

test('Supabase distinguishes outage/authentication failures from empty matches and retries only transient HTTP', async () => {
  let calls = 0;
  const recovered = new SupabaseEvidenceRepository({ url: 'https://database.test', secretKey: 'fake' }, { sleep: async () => {}, fetch: async () => {
    calls++; return calls === 1 ? new Response(null, { status: 503 }) : Response.json([]);
  } });
  assert.deepEqual(await recovered.search({ text: 'evidence' }, vector(), crypto.randomUUID(), 2), []); assert.equal(calls, 2);
  for (const [status, code, attempts] of [[403, 'authentication', 1], [503, 'database', 3]] as const) {
    calls = 0;
    const failed = new SupabaseEvidenceRepository({ url: 'https://database.test', secretKey: 'fake' }, { fetch: async () => { calls++; return new Response(null, { status }); }, sleep: async () => {} });
    await assert.rejects(failed.search({ text: 'evidence' }, vector(), crypto.randomUUID(), 2), { code }); assert.equal(calls, attempts);
  }
});
