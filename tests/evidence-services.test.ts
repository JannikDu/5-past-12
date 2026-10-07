import test from 'node:test';
import assert from 'node:assert/strict';
import { EvidenceIngestionService, registerEvidenceProvider } from '../src/services/evidence-ingestion.ts';
import { EvidenceRebuildService } from '../src/services/evidence-rebuild.ts';
import { DefaultEvidenceRetrievalService } from '../src/services/evidence-retrieval.ts';
import { sourceHash } from '../src/services/evidence-identity.ts';
import { EvidenceError, type Generation, type NormalizedEvidenceSource, type ProviderLease } from '../src/domain/evidence.ts';
import { EventCategory } from '../src/domain/climate-event.ts';
import type { EvidenceFetchBatch, EvidenceFetchOptions } from '../src/data/providers/evidence-source.ts';
import type { EvidenceRepository, StoreEvidenceInput } from '../src/data/repositories/evidence-repository.ts';
import type { EmbeddingProvider } from '../src/data/embeddings/embedding-provider.ts';
import { chunker, profile, source, vector } from './helpers/evidence-fixtures.ts';

const generation: Generation = { id: crypto.randomUUID(), profile };
const lease: ProviderLease = { providerId: 'independent-test-source', owner: crypto.randomUUID(),
  progress: { since: null, state: {}, pending: [], recheckAfter: null, recheckCursor: null, recheckThrough: null } };
function batch(sources: NormalizedEvidenceSource[]): EvidenceFetchBatch<NormalizedEvidenceSource> {
  return { items: sources.map(raw => ({ itemId: raw.url, lane: 'discovery', raw })), failures: [], skipped: 0,
    state: {}, complete: { discovery: true, backfill: true, recheck: true, pending: true } };
}
// Only the ports exercised by a unit test are supplied. Unexpected calls fail.
function repository(ports: Partial<EvidenceRepository>): EvidenceRepository { return ports as EvidenceRepository; }

test('typed provider registration forwards replay/budgets and atomically stores normalized provenance', async () => {
  const s = source('Independent publication', 'Paragraph one.\n\n' + 'Climate findings with uncertainty. '.repeat(160));
  const existingId = crypto.randomUUID(); const expectedVersionId = crypto.randomUUID();
  const writes: StoreEvidenceInput[] = []; const embeddingInputs: string[][] = [];
  const controller = new AbortController();
  const options: EvidenceFetchOptions = { replay: ['opaque:42'], since: '2026-10-01T00:00:00Z', state: { cursor: 'next' }, maxItems: 6, maxPages: 2, signal: controller.signal };
  const ingestion = new EvidenceIngestionService(repository({
    findSource: async url => { assert.equal(url, s.url); return { id: existingId, sourceVersionId: expectedVersionId, contentHash: '0'.repeat(64) }; },
    storeSource: async input => { writes.push(input); return { status: 'stored', sourceCreated: false, versionCreated: true }; },
  }), { profile: profile.embedding, embed: async (texts, purpose, signal) => {
    assert.equal(purpose, 'document'); assert.equal(signal, controller.signal); embeddingInputs.push(texts); return texts.map(() => vector());
  } }, chunker);
  const registered = registerEvidenceProvider({ id: lease.providerId, name: 'Independent source', async fetchNew(received) {
    assert.equal(received, options);
    return { ...batch([]), items: [{ itemId: 'opaque:42', lane: 'pending', raw: { publication: s } }] };
  } }, { async normalize(raw) { return raw.publication; } }, ingestion);
  const pass = await registered.run(options, generation, lease);
  assert.deepEqual(pass.outcomes.map(o => [o.itemId, o.lane, o.status, o.sourceCreated, o.versionCreated]), [['opaque:42', 'pending', 'stored', false, true]]);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0], { source: s, contentHash: await sourceHash(s), generationId: generation.id, expectedVersionId, lease, itemId: 'opaque:42',
    chunks: chunker.chunk(s.normalizedText).map(chunk => ({ ...chunk, embedding: vector() })) });
  assert.deepEqual(embeddingInputs, [writes[0].chunks.map(chunk => chunk.content)]);
});

test('unchanged publications skip embeddings even when category order and duplicates differ', async () => {
  const original = { ...source(), eventTypes: [EventCategory.Wildfire, EventCategory.Drought] };
  const reordered = { ...original, eventTypes: [EventCategory.Drought, EventCategory.Wildfire, EventCategory.Drought] };
  let embeds = 0; let writes = 0;
  const ingestion = new EvidenceIngestionService(repository({
    findSource: async () => ({ id: crypto.randomUUID(), sourceVersionId: crypto.randomUUID(), contentHash: await sourceHash(original) }),
    storeSource: async () => { writes++; throw new Error('Unexpected write'); },
  }), { profile: profile.embedding, embed: async () => { embeds++; return []; } }, chunker);
  const result = await ingestion.ingest(batch([original, reordered]), { async normalize(raw) { return raw; } }, generation, lease);
  assert.deepEqual(result.outcomes.map(o => o.status), ['unchanged', 'unchanged']);
  assert.equal(embeds, 0); assert.equal(writes, 0);
});

test('an item normalization or embedding failure leaves other publications usable', async () => {
  const sources = ['excluded', 'broken-normalization', 'broken-embedding', 'usable'].map(name => source(name, `${name} scientific finding.`));
  const writes: StoreEvidenceInput[] = [];
  const ingestion = new EvidenceIngestionService(repository({ findSource: async () => null, storeSource: async input => {
    writes.push(input); return { status: 'stored', sourceCreated: true, versionCreated: true };
  } }), { profile: profile.embedding, embed: async texts => {
    if (texts[0].includes('broken-embedding')) throw new EvidenceError('authentication', 'Embedding credentials rejected');
    return texts.map(() => vector());
  } }, chunker);
  const result = await ingestion.ingest(batch(sources), { async normalize(raw) {
    if (raw.title === 'excluded') return null;
    if (raw.title === 'broken-normalization') throw new EvidenceError('contract', 'Changed source structure');
    return raw;
  } }, generation, lease);
  assert.deepEqual(result.outcomes.map(o => [o.status, o.error]), [['invalid', 'validation'], ['failed', 'contract'], ['failed', 'authentication'], ['stored', undefined]]);
  assert.deepEqual(writes.map(w => w.source.title), ['usable']);
});

test('incomplete or invalid chunk embeddings never reach atomic persistence', async () => {
  const s = source('Long publication', 'Scientific findings and their qualifications. '.repeat(150));
  const passages = chunker.chunk(s.normalizedText);
  assert.ok(passages.length > 1, 'Fixture must require multiple embeddings');
  for (const vectors of [passages.slice(1).map(() => vector()), passages.map((_, i) => i === 1 ? Array(1024).fill(1) : vector())]) {
    let writes = 0;
    const ingestion = new EvidenceIngestionService(repository({ findSource: async () => null, storeSource: async () => { writes++; throw new Error('Unexpected write'); } }),
      { profile: profile.embedding, embed: async () => vectors }, chunker);
    const result = await ingestion.ingest(batch([s]), { async normalize(raw) { return raw; } }, generation, lease);
    assert.equal(result.outcomes[0].status, 'failed'); assert.equal(result.outcomes[0].error, 'embedding'); assert.equal(writes, 0);
  }
});

test('incompatible ingestion generation fails before normalization or integration calls', async () => {
  let calls = 0;
  const ingestion = new EvidenceIngestionService(repository({ findSource: async () => { calls++; return null; } }),
    { profile: profile.embedding, embed: async () => { calls++; return []; } }, chunker);
  await assert.rejects(ingestion.ingest(batch([source()]), { async normalize(raw) { calls++; return raw; } },
    { ...generation, profile: { ...profile, embedding: { ...profile.embedding, model: 'other-model' } } }, lease), { code: 'generation' });
  assert.equal(calls, 0);
});

test('retrieval validates generation before embedding and forwards normalized preferences', async () => {
  const calls: string[] = [];
  const retrieval = new DefaultEvidenceRetrievalService(repository({
    ensureGeneration: async received => { assert.deepEqual(received, profile); calls.push('generation'); return generation; },
    search: async (query, embedding, id, cap) => {
      calls.push('search'); assert.deepEqual(query, { text: 'Spain wildfire', region: 'Spain', limit: 10, evidenceTypes: [], sourceTypes: ['observation'] });
      assert.deepEqual(embedding, vector()); assert.equal(id, generation.id); assert.equal(cap, 3); return [];
    },
  }), { profile: profile.embedding, embed: async (texts, purpose) => {
    calls.push('embedding'); assert.deepEqual(texts, ['Spain wildfire']); assert.equal(purpose, 'query'); return [vector()];
  } }, profile, 3);
  assert.deepEqual(await retrieval.search({ text: '  Spain wildfire  ', region: ' Spain ', evidenceTypes: [], sourceTypes: ['observation'] }), []);
  assert.deepEqual(calls, ['generation', 'embedding', 'search']);
  let embeddings = 0;
  const paused = new DefaultEvidenceRetrievalService(repository({ ensureGeneration: async () => { throw new EvidenceError('maintenance', 'Rebuilding'); } }),
    { profile: profile.embedding, embed: async () => { embeddings++; return [vector()]; } }, profile);
  await assert.rejects(paused.search({ text: 'Spain wildfire' }), { code: 'maintenance' }); assert.equal(embeddings, 0);
});

test('rebuild capability failures leave maintenance untouched', async () => {
  let starts = 0;
  for (const embed of [async () => { throw new EvidenceError('authentication', 'Invalid credentials'); }, async () => [vector(), Array(1024).fill(1)]]) {
    const embeddings: EmbeddingProvider = { profile: profile.embedding, embed };
    const rebuild = new EvidenceRebuildService(repository({ startRebuild: async () => { starts++; throw new Error('Unexpected maintenance'); } }), embeddings, chunker, profile);
    await assert.rejects(rebuild.run('start', crypto.randomUUID()), error => error instanceof EvidenceError && ['authentication', 'embedding'].includes(error.code));
  }
  assert.equal(starts, 0);
});
