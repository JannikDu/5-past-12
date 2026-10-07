import test from 'node:test';
import assert from 'node:assert/strict';
import { EvidenceIngestionService, registerEvidenceProvider } from '../src/services/evidence-ingestion.ts';
import { EvidenceIngestionJob } from '../src/services/evidence-job.ts';
import { EvidenceRebuildService } from '../src/services/evidence-rebuild.ts';
import { DefaultEvidenceRetrievalService } from '../src/services/evidence-retrieval.ts';
import { ClimateCentralEvidenceProvider } from '../src/data/providers/climate-central-evidence.ts';
import { WorldWeatherAttributionEvidenceProvider } from '../src/data/providers/world-weather-attribution-evidence.ts';
import { ClimateCentralEvidenceNormalizer } from '../src/data/normalizers/climate-central-evidence.ts';
import { WorldWeatherAttributionEvidenceNormalizer } from '../src/data/normalizers/world-weather-attribution-evidence.ts';
import { sourceHash } from '../src/services/evidence-identity.ts';
import { EventCategory } from '../src/domain/climate-event.ts';
import type { EmbeddingProvider } from '../src/data/embeddings/embedding-provider.ts';
import type { Generation, NormalizedEvidenceSource, ProviderLease } from '../src/domain/evidence.ts';
import type { StoreEvidenceInput } from '../src/data/repositories/evidence-repository.ts';
import { count, evidenceDatabase } from './helpers/evidence-database.ts';
import { chunker, profile, source, vector, csiHtml, wwaFeed, wwaArticle, wwaUrl } from './helpers/evidence-fixtures.ts';

test('local pgvector contracts and complete ingestion/retrieval/rebuild pipeline', async t => {
  const { db, repository, diagnostics } = await evidenceDatabase();
  t.after(() => db.close());
  let generation: Generation; let lease: ProviderLease; let first: StoreEvidenceInput;
  let oldChunkId: string; let oldVersionId: string;
  const makeInput = async (s: NormalizedEvidenceSource, expectedVersionId: string | null = null): Promise<StoreEvidenceInput> => ({
    source: s, contentHash: await sourceHash(s), generationId: generation.id, lease, itemId: s.url, expectedVersionId,
    chunks: chunker.chunk(s.normalizedText).map(chunk => ({ ...chunk, embedding: vector() })),
  });
  await t.test('initialize profile and refuse incompatible ordinary configuration', async () => {
    generation = await repository.ensureGeneration(profile);
    assert.equal((await repository.ensureGeneration(profile)).id, generation.id);
    await assert.rejects(repository.ensureGeneration({ ...profile, embedding: { ...profile.embedding, model: 'different-model' } }), { code: 'generation' });
    lease = (await repository.acquireLease('fixtures', crypto.randomUUID(), 600))!;
    assert.ok(lease);
  });
  await t.test('atomic first insert and idempotent uncertain-response replay', async () => {
    first = await makeInput(source('Spain wildfire', 'Spain wildfire conditions.\n\n' + 'Historical Mediterranean fire weather uncertainty. '.repeat(120)));
    assert.deepEqual(await repository.storeSource(first), { status: 'stored', sourceCreated: true, versionCreated: true }, diagnostics.join('\n'));
    assert.deepEqual(await repository.storeSource(first), { status: 'unchanged', sourceCreated: false, versionCreated: false });
    assert.equal(await count(db, 'evidence_sources'), 1); assert.equal(await count(db, 'evidence_source_versions'), 1);
    const result = (await repository.search({ text: 'wildfire conditions Spain Mediterranean', region: ' Spain ', eventType: EventCategory.Wildfire, limit: 10 }, vector(), generation.id, 2))[0];
    assert.ok(result); oldChunkId = result.chunkId; oldVersionId = result.sourceVersionId;
    assert.equal(result.sourceUrl, first.source.url); assert.ok(result.score > 0); assert.equal(result.similarity, 1);
  });
  await t.test('invalid later chunk rolls back source, version and current projection', async () => {
    const before = [await count(db, 'evidence_sources'), await count(db, 'evidence_source_versions'), await count(db, 'evidence_version_chunks'), await count(db, 'evidence_chunks')];
    const invalid = await makeInput({ ...source('new invalid source'), normalizedText: 'new invalid passage' });
    for (const embedding of [Array(1536).fill(0), Array(1024).fill(1), Array(1537).fill(1)]) {
      invalid.chunks[0].embedding = embedding;
      await assert.rejects(db.query('select public.store_evidence_source($1::jsonb)', [JSON.stringify(invalid)]));
    }
    assert.deepEqual([await count(db, 'evidence_sources'), await count(db, 'evidence_source_versions'), await count(db, 'evidence_version_chunks'), await count(db, 'evidence_chunks')], before);
    const corrupt = await makeInput({ ...first.source, title: 'Corrected title' }, oldVersionId);
    corrupt.chunks.at(-1)!.content = 'text not in retained original';
    await assert.rejects(repository.storeSource(corrupt), { code: 'validation' });
    assert.equal((await repository.findSource(first.source.url))!.sourceVersionId, oldVersionId);
  });
  await t.test('shorter corrections preserve old citations and stale revisions are fenced', async () => {
    const correction = await makeInput({ ...first.source, title: 'Corrected Spain study', normalizedText: 'Corrected Spain wildfire conditions with uncertain Mediterranean context.' }, oldVersionId);
    assert.deepEqual(await repository.storeSource(correction), { status: 'stored', sourceCreated: false, versionCreated: true });
    assert.equal(await count(db, 'evidence_chunks'), 1);
    const citation = (await repository.findByChunkId(oldChunkId))!;
    assert.equal(citation.sourceTitle, first.source.title); assert.equal(citation.sourceVersionId, oldVersionId);
    assert.match(citation.content, /Historical/);
    await assert.rejects(repository.storeSource(await makeInput({ ...first.source, normalizedText: 'Stale correction' }, oldVersionId)), { code: 'conflict' });
    const current = (await repository.findSource(first.source.url))!;
    // Reverting to retained content reuses immutable version/chunk IDs.
    assert.deepEqual(await repository.storeSource({ ...first, expectedVersionId: current.sourceVersionId }), { status: 'stored', sourceCreated: false, versionCreated: false });
    assert.equal((await repository.findSource(first.source.url))!.sourceVersionId, oldVersionId);
    assert.ok((await db.query('select id from public.evidence_chunks where id=$1', [oldChunkId])).rows.length);
  });
  await t.test('provider leases use server expiry and reject stale checkpoints/writes', async () => {
    assert.equal(await repository.acquireLease('fixtures', crypto.randomUUID(), 600), null);
    const expired = (await repository.acquireLease('expired', crypto.randomUUID(), 1))!;
    await db.exec("update public.evidence_ingestion_state set expires_at=clock_timestamp()-interval '1 second' where provider_id='expired'");
    const next = (await repository.acquireLease('expired', crypto.randomUUID(), 600))!;
    await assert.rejects(repository.checkpoint(expired, expired.progress), { code: 'lease' });
    await assert.rejects(repository.storeSource({ ...first, lease: expired }), { code: 'lease' });
    await repository.checkpoint(next, { ...next.progress, pending: ['old-item-outside-overlap'], state: { backfillPage: 17 } });
    await repository.checkpoint(next, { ...next.progress, pending: ['old-item-outside-overlap'], state: { backfillPage: 17 } });
    const resumed = (await repository.acquireLease('expired', crypto.randomUUID(), 600))!;
    assert.deepEqual(resumed.progress.pending, ['old-item-outside-overlap']); assert.equal(resumed.progress.state.backfillPage, 17);
  });
  let embeddingCalls = 0; const purposes: string[] = [];
  const embeddings: EmbeddingProvider = { profile: profile.embedding, async embed(texts, purpose) { embeddingCalls++; purposes.push(purpose); return texts.map(() => vector()); } };
  const ingestion = new EvidenceIngestionService(repository, embeddings, chunker);
  const fetcher: typeof fetch = async input => {
    const url = String(input);
    if (url.includes('climatecentral')) return new Response(csiHtml());
    if (url === wwaUrl) return new Response(wwaArticle().replace('</head>', '<meta property="article:modified_time" content="2020-08-04T12:00:00Z"></head>'));
    return new Response(url.includes('paged=') ? wwaFeed([]) : wwaFeed());
  };
  const providers = [registerEvidenceProvider(new ClimateCentralEvidenceProvider({ fetch: fetcher }), new ClimateCentralEvidenceNormalizer(), ingestion),
    registerEvidenceProvider(new WorldWeatherAttributionEvidenceProvider({ fetch: fetcher }), new WorldWeatherAttributionEvidenceNormalizer(), ingestion)];
  const job = new EvidenceIngestionJob(providers, repository, profile, { info() {} });
  await t.test('both fixtures ingest twice with zero duplicate records or embeddings', async () => {
    const firstRun = await job.run(); assert.ok(firstRun.providers.every(p => p.failed === 0), JSON.stringify({ firstRun, diagnostics }));
    assert.equal(firstRun.providers.reduce((n, p) => n + p.stored, 0), 2);
    const before = [await count(db, 'evidence_sources'), await count(db, 'evidence_source_versions'), await count(db, 'evidence_version_chunks'), embeddingCalls];
    const repeat = await job.run(); assert.ok(repeat.providers.every(p => p.failed === 0), JSON.stringify(repeat));
    assert.deepEqual([await count(db, 'evidence_sources'), await count(db, 'evidence_source_versions'), await count(db, 'evidence_version_chunks'), embeddingCalls], before);
    assert.ok(purposes.every(p => p === 'document'));
  });
  await t.test('weekly cycles use the injected clock, resume cursors, and keep unchanged articles idempotent', async () => {
    const dueJob = new EvidenceIngestionJob(providers, repository, profile, { info() {} }, { now: () => new Date('2099-11-01T00:00:00Z') });
    const before = embeddingCalls;
    const first = await dueJob.run(); assert.ok(first.providers.every(p => p.failed === 0), JSON.stringify(first));
    assert.ok(first.providers.every(p => p.lanes.recheck > 0));
    const second = await dueJob.run(); assert.ok(second.providers.every(p => p.failed === 0));
    assert.equal(embeddingCalls, before);
    const control = await db.query<{ progress: { recheckThrough: string | null; recheckAfter: string } }>("select progress from public.evidence_ingestion_state where provider_id='world-weather-attribution'");
    assert.equal(control.rows[0].progress.recheckThrough, null);
    assert.equal(control.rows[0].progress.recheckAfter, '2099-11-08T00:00:00.000Z');
  });
  await t.test('hybrid search keeps historical and differently tagged context eligible with diverse citations', async () => {
    const retrieval = new DefaultEvidenceRetrievalService(repository, embeddings, profile, 2);
    const results = await retrieval.search({ text: 'wildfire conditions in Spain and the Mediterranean', eventType: EventCategory.Wildfire, region: 'Spain', eventDate: new Date('2026-10-06'), limit: 10 });
    assert.ok(results.some(r => r.publisher === 'Climate Central'));
    assert.ok(results.some(r => r.publisher === 'World Weather Attribution'));
    assert.ok(results.some(r => r.sourceUrl === wwaUrl && r.publishedAt?.startsWith('2020')));
    assert.equal(purposes.at(-1), 'query');
    for (const result of results) assert.deepEqual(await repository.findByChunkId(result.chunkId), Object.fromEntries(Object.entries(result).filter(([key]) => !['similarity', 'score'].includes(key))));
    assert.ok(results.every(r => results.filter(other => other.sourceId === r.sourceId).length <= 2));
    const noHints = await retrieval.search({ text: 'wildfire conditions in Spain and the Mediterranean', evidenceTypes: [], sourceTypes: [] });
    assert.ok(noHints.length);
  });
  await t.test('bounded positive date bonus uses event time and low cosine lexical hits remain eligible', async () => {
    const context = await makeInput({ ...source('low cosine exact lexical', 'Spanish namedfire exactplace wildfire conditions in Spain and the Mediterranean.'), region: null, eventTypes: [], publishedAt: null });
    context.chunks.forEach(c => { c.embedding = vector(0.2, Math.sqrt(0.96)); });
    await repository.storeSource(context);
    const results = await repository.search({ text: 'Spanish namedfire exactplace', eventType: EventCategory.Wildfire, region: 'Spain', limit: 10 }, vector(), generation.id, 2);
    const hit = results.find(r => r.sourceUrl === context.source.url)!;
    assert.ok(hit); assert.ok(Math.abs(hit.similarity - 0.2) < 0.0001);
    const without = await repository.search({ text: 'wildfire conditions', limit: 10 }, vector(), generation.id, 2);
    const withDate = await repository.search({ text: 'wildfire conditions', eventDate: new Date('2020-07-10'), limit: 10 }, vector(), generation.id, 2);
    const old = without.find(r => r.sourceVersionId === oldVersionId)!;
    assert.ok(Math.abs(withDate.find(r => r.chunkId === old.chunkId)!.score - old.score - 0.001) < 1e-8);
  });
  await t.test('item failure persists generic replay and other providers continue', async () => {
    let fail = true;
    const failingEmbeddings: EmbeddingProvider = { profile: profile.embedding, async embed(texts) { if (fail) throw new Error('fake failure'); return texts.map(() => vector()); } };
    const isolated = new EvidenceIngestionService(repository, failingEmbeddings, chunker);
    const rawProvider = { id: 'generic', name: 'generic', async fetchNew(options: { replay?: string[] } = {}) {
      if (!fail) assert.deepEqual(options.replay, ['generic-id']);
      return { items: [{ itemId: 'generic-id', lane: 'discovery' as const, raw: source('generic replay') }], failures: [], skipped: 0,
        complete: { discovery: true, backfill: true, recheck: true, pending: true }, state: {} };
    } };
    const isolatedJob = new EvidenceIngestionJob([{ id: 'broken-provider', async run() { throw new Error('provider unavailable'); } },
      registerEvidenceProvider(rawProvider, { async normalize(raw) { return raw; } }, isolated)], repository, profile, { info() {} });
    const failed = await isolatedJob.run(); assert.equal(failed.providers[0].status, 'failed'); assert.equal(failed.providers[1].status, 'failed');
    fail = false;
    const recovery = await isolatedJob.run(); assert.equal(recovery.providers[1].stored, 1);
  });
  const target = { ...profile, embedding: { ...profile.embedding, queryPolicy: 'changed-query-policy' } };
  await t.test('rebuild stages retained originals, fences stale work, resumes and preserves citations', async () => {
    const rebuildEmbeddings = { ...embeddings, profile: target.embedding };
    const rebuild = new EvidenceRebuildService(repository, rebuildEmbeddings, chunker, target);
    const owner = crypto.randomUUID(); const result = await rebuild.run('start', owner, 1);
    assert.equal(result.status, 'maintenance');
    await assert.rejects(repository.ensureGeneration(profile), { code: 'maintenance' });
    await assert.rejects(repository.search({ text: 'fire' }, vector(), generation.id, 2), { code: 'maintenance' });
    await assert.rejects(repository.storeSource(first), { code: 'maintenance' });
    assert.ok(await repository.findByChunkId(oldChunkId));
    const status = (await rebuild.status())!; assert.equal(status.completed.length, 1);
    await assert.rejects(repository.activateRebuild(status), { code: 'contract' });
    await assert.rejects(repository.resumeRebuild(target, crypto.randomUUID()), { code: 'lease' });
    await db.exec("update public.evidence_corpus_state set rebuild_expires_at=clock_timestamp()-interval '1 second'");
    await assert.rejects(repository.stageRebuild(status, status.manifest[0], first.chunks), { code: 'lease' });
    const resumed = await rebuild.run('resume', crypto.randomUUID(), 100);
    assert.equal(resumed.status, 'ready');
    await assert.rejects(repository.ensureGeneration(profile), { code: 'generation' });
    const newGeneration = await repository.ensureGeneration(target); assert.notEqual(newGeneration.id, generation.id);
    await assert.rejects(repository.search({ text: 'fire' }, vector(), generation.id, 2), { code: 'generation' });
    assert.equal((await repository.findByChunkId(oldChunkId))!.sourceVersionId, oldVersionId);
    const latest = await repository.search({ text: 'fire' }, vector(), newGeneration.id, 2); assert.ok(latest.every(r => r.chunkId !== oldChunkId));
    generation = newGeneration;
  });
  await t.test('explicit compatible abort and immutable archive/grants', async () => {
    const owner = crypto.randomUUID(); const status = await repository.startRebuild(profile, owner);
    assert.equal((await repository.startRebuild(profile, owner)).generation.id, status.generation.id);
    await assert.rejects(repository.abortRebuild(profile, owner), { code: 'generation' });
    await repository.abortRebuild(target, owner); assert.equal(await repository.rebuildStatus(), null);
    await repository.abortRebuild(target, owner);
    assert.equal((await repository.ensureGeneration(target)).id, generation.id);
    assert.equal((await repository.findByChunkId(oldChunkId))!.sourceVersionId, oldVersionId);
    assert.ok(status.manifest.length > 0);
    const head = (await repository.findSource(first.source.url))!;
    await db.query('update public.evidence_sources set embedding_profile=$1::jsonb where id=$2', ['{}', head.id]);
    await assert.rejects(repository.ensureGeneration(target), { code: 'generation' });
    await db.query('update public.evidence_sources set embedding_profile=$1::jsonb where id=$2', [JSON.stringify(target.embedding), head.id]);
    await assert.rejects(db.query('update public.evidence_version_chunks set content=$1 where id=$2', ['changed', oldChunkId]), /immutable/);
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(db.exec('select * from public.evidence_source_versions'), /permission denied/);
      await assert.rejects(db.exec("select public.evidence_control('rebuild-status','{}')"), /permission denied/);
      await db.exec('reset role');
    }
    const original = await db.query('select * from public.match_evidence_chunks($1::extensions.vector,10,null,null,null,null,null)', [JSON.stringify(vector())]);
    assert.ok(original.rows.length);
  });
});

test('additive functions resolve an existing pgvector extension schema', async t => {
  const { db, repository } = await evidenceDatabase(undefined, 'vector_alt');
  t.after(() => db.close());
  const generation = await repository.ensureGeneration(profile);
  const lease = (await repository.acquireLease('alternate', crypto.randomUUID(), 600))!;
  const s = source('alternate schema');
  await repository.storeSource({ source: s, contentHash: await sourceHash(s), generationId: generation.id, lease,
    itemId: s.url, expectedVersionId: null, chunks: chunker.chunk(s.normalizedText).map(c => ({ ...c, embedding: vector() })) });
  assert.equal((await repository.search({ text: 'wildfire' }, vector(), generation.id, 2)).length, 1);
  const old = await db.query('select * from public.match_evidence_chunks($1::vector_alt.vector,10,null,null,null,null,null)', [JSON.stringify(vector())]);
  assert.equal(old.rows.length, 1);
});

test('legacy adoption preserves original IDs, blocks unknown profiles and requires full explicit reconciliation', async t => {
  const legacyId = crypto.randomUUID();
  const { db, repository } = await evidenceDatabase(async db => {
    const inserted = await db.query<{ id: string }>("insert into public.evidence_sources(title,publisher,url,source_type,evidence_type) values('Legacy','Known publisher','https://example.org/legacy','article','event_context') returning id");
    await db.query('insert into public.evidence_chunks(id,source_id,chunk_index,content,embedding) values($1,$2,0,$3,$4::extensions.vector)', [legacyId, inserted.rows[0].id, 'Known legacy passage', JSON.stringify(vector())]);
  });
  t.after(() => db.close());
  assert.equal((await repository.findByChunkId(legacyId))!.content, 'Known legacy passage');
  await assert.rejects(repository.ensureGeneration(profile), { code: 'legacy' });
  await assert.rejects(db.query('select public.evidence_adopt_legacy($1::jsonb,$2::jsonb)', [JSON.stringify(profile), '[]']), /every existing source/);
  const s = { ...source('legacy'), url: 'https://example.org/legacy', normalizedText: 'Verified original legacy document. Known legacy passage.' };
  const publication = { source: s, providerId: 'legacy-reviewed', itemId: 'legacy-id', contentHash: await sourceHash(s),
    chunks: chunker.chunk(s.normalizedText).map(c => ({ ...c, embedding: vector() })) };
  await db.query('select public.evidence_adopt_legacy($1::jsonb,$2::jsonb)', [JSON.stringify(profile), JSON.stringify([publication])]);
  assert.ok(await repository.ensureGeneration(profile));
  assert.equal((await repository.findByChunkId(legacyId))!.sourceTitle, 'Legacy');
  assert.equal(await count(db, 'evidence_source_versions'), 2);
});
