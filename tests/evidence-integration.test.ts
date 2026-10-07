import test from 'node:test';
import assert from 'node:assert/strict';
import { evidenceApplication, projection } from './helpers/evidence-application.ts';
import { count, evidenceDatabase } from './helpers/evidence-database.ts';
import { source, profile, chunker, vector, csiHtml, wwaFeed, wwaArticle, wwaUrl, wwaBody } from './helpers/evidence-fixtures.ts';
import { sourceHash } from '../src/services/evidence-identity.ts';
import { EvidenceError, type NormalizedEvidenceSource } from '../src/domain/evidence.ts';
import { EvidenceRebuildService } from '../src/services/evidence-rebuild.ts';
import { EvidenceChunker } from '../src/services/evidence-chunker.ts';
import type { StoreEvidenceInput } from '../src/data/repositories/evidence-repository.ts';
import { EventCategory } from '../src/domain/climate-event.ts';

test('configured provider/Featherless/Supabase integrations ingest tracking duplicates once and retrieve durable citations', async t => {
  const duplicateFeed = wwaFeed([wwaUrl, `${wwaUrl}?utm_source=mail`].map(url => ({ url, title: 'Mediterranean heat attribution study', body: wwaBody, date: 'Mon, 03 Aug 2020 12:00:00 GMT', category: 'Extreme heat' })));
  const { services, db, requests } = await evidenceApplication(t, { http: url => url.pathname === '/feed/' && !url.search ? new Response(duplicateFeed) : undefined });
  const first = await services.job.run();
  assert.deepEqual(first.providers.map(p => [p.providerId, p.failed, p.insertedSources]), [['climate-central', 0, 1], ['world-weather-attribution', 0, 1]]);
  assert.equal(await count(db, 'evidence_sources'), 2); assert.equal(await count(db, 'evidence_source_versions'), 2);
  assert.ok(requests.every(r => r.model === services.profile.embedding.model && r.dimensions === 1536 && r.encoding_format === 'float' && r.input.length <= 2));
  assert.ok(requests.every(r => r.input.every(text => !text.startsWith('Instruct:'))));
  const before = await projection(db); const batches = requests.length; const retained = await count(db, 'evidence_version_chunks');
  const repeat = await services.job.run(); assert.ok(repeat.providers.every(p => p.failed === 0));
  assert.equal(requests.length, batches); assert.deepEqual(await projection(db), before); assert.equal(await count(db, 'evidence_version_chunks'), retained);
  const results = await services.retrieval.search({ text: 'wildfire conditions in Spain and the Mediterranean', eventType: EventCategory.Wildfire, region: ' Spain ', evidenceTypes: [], sourceTypes: [], limit: 10 });
  assert.equal(results.length, 2); assert.equal(new Set(results.map(r => r.sourceId)).size, 2);
  assert.deepEqual(new Set(results.map(r => r.sourceUrl)), new Set([wwaUrl, 'https://www.climatecentral.org/climate-shift-index-alert#alert-spain']));
  assert.equal(results.find(r => r.sourceUrl === wwaUrl)!.evidenceType, 'analogue_attribution');
  assert.equal(results.find(r => r.publisher === 'Climate Central')!.evidenceType, 'event_context');
  assert.match(requests.at(-1)!.input[0], /^Instruct: .+\nQuery: wildfire conditions/);
  for (const result of results) {
    const citation = Object.fromEntries(Object.entries(result).filter(([key]) => !['similarity', 'score'].includes(key)));
    assert.deepEqual(await services.retrieval.findByChunkId(result.chunkId), citation);
  }
});

test('a later Featherless batch failure keeps the old publication intact and durable replay recovers the correction', async t => {
  let revision = false; let fail = true; let correctionBatches = 0;
  const correctedBody = `<p>This attribution study reports CORRECTED wildfire findings with uncertainty. ${'CORRECTED climate findings remain uncertain. '.repeat(100)}</p>`;
  const { services, db, requests } = await evidenceApplication(t, { http: (url, init) => {
    if (revision && url.href === wwaUrl) return new Response(wwaArticle(correctedBody));
    if (revision && url.hostname === 'www.climatecentral.org') return new Response(csiHtml('New Spain wildfire context with updated scientific qualifications.'));
    if (url.hostname === 'embedding.test') {
      const body = JSON.parse(String(init?.body));
      if (body.input.some((text: string) => text.includes('CORRECTED')) && ++correctionBatches === 2 && fail) return new Response(null, { status: 503 });
    }
    return undefined;
  } });
  await services.job.run();
  const oldHead = (await services.repository.findSource(wwaUrl))!;
  const oldChunks = (await db.query<{ id: string; content: string }>('select id,content from public.evidence_chunks where source_id=$1 order by chunk_index', [oldHead.id])).rows;
  const oldCitation = await services.retrieval.findByChunkId(oldChunks[0].id);
  revision = true;
  await db.exec("update public.evidence_ingestion_state set progress=jsonb_set(progress,'{recheckAfter}','null') where provider_id='world-weather-attribution'");
  const failed = await services.job.run();
  assert.equal(failed.providers.find(p => p.providerId === 'world-weather-attribution')!.failed, 1);
  assert.equal(failed.providers.find(p => p.providerId === 'climate-central')!.stored, 1);
  assert.ok(correctionBatches >= 2, 'Failure must follow a successful document batch');
  assert.equal((await services.repository.findSource(wwaUrl))!.sourceVersionId, oldHead.sourceVersionId);
  assert.deepEqual((await db.query('select id,content from public.evidence_chunks where source_id=$1 order by chunk_index', [oldHead.id])).rows, oldChunks);
  const pending = (await db.query<{ progress: { pending: string[] } }>("select progress from public.evidence_ingestion_state where provider_id='world-weather-attribution'")).rows[0].progress.pending;
  assert.deepEqual(pending, [wwaUrl]);
  fail = false;
  const recovered = await services.job.run(); assert.ok(recovered.providers.every(p => p.failed === 0));
  assert.notEqual((await services.repository.findSource(wwaUrl))!.sourceVersionId, oldHead.sourceVersionId);
  assert.deepEqual(await services.retrieval.findByChunkId(oldChunks[0].id), oldCitation);
  assert.ok((await services.retrieval.search({ text: 'CORRECTED wildfire' })).some(r => r.sourceUrl === wwaUrl && r.content.includes('CORRECTED')));
  const batches = requests.length; await services.job.run(); assert.equal(requests.length, batches);
});

test('overlapping jobs skip only the leased provider and preserve exactly one stored copy', async t => {
  let unblock!: () => void; const blocked = new Promise<void>(resolve => { unblock = resolve; });
  let started!: () => void; const entered = new Promise<void>(resolve => { started = resolve; });
  let firstCsiRequest = true;
  const { services, db } = await evidenceApplication(t, { http: async url => {
    if (url.hostname === 'www.climatecentral.org' && firstCsiRequest) { firstCsiRequest = false; started(); await blocked; }
    return undefined;
  } });
  const active = services.job.run(); await entered;
  let overlap: Awaited<ReturnType<typeof services.job.run>>;
  try { overlap = await services.job.run(); } finally { unblock(); }
  const completed = await active;
  assert.equal(overlap.providers.find(p => p.providerId === 'climate-central')!.status, 'already-running');
  assert.equal(overlap.providers.find(p => p.providerId === 'world-weather-attribution')!.stored, 1);
  assert.ok(completed.providers.every(p => p.failed === 0));
  assert.equal(await count(db, 'evidence_sources'), 2); assert.equal(await count(db, 'evidence_source_versions'), 2);
  assert.equal(await count(db, 'evidence_chunks'), await count(db, 'evidence_version_chunks'));
  const owners = (await db.query<{ owner: string | null }>('select owner from public.evidence_ingestion_state')).rows;
  assert.deepEqual(owners.map(row => row.owner), [null, null]);
});

test('lost successful store/checkpoint responses are safely retried through the HTTP adapter', async t => {
  const interrupted = new Set<string>(); const attempts = new Map<string, number>();
  const { services, db, requests } = await evidenceApplication(t, { retries: 2, http: async (url, init, local) => {
    if (url.hostname !== 'database.test') return undefined;
    const body = JSON.parse(String(init?.body));
    const store = url.pathname.endsWith('/store_evidence_source'); const checkpoint = body.action === 'checkpoint';
    if (!store && !checkpoint) return undefined;
    const key = store ? `store:${body.payload.source.url}` : `checkpoint:${body.payload.providerId}`;
    attempts.set(key, (attempts.get(key) ?? 0) + 1);
    const response = await local.fetch(url.href, init);
    if (response.ok && !interrupted.has(key)) { interrupted.add(key); return new Response(null, { status: 503 }); }
    return response;
  } });
  const summary = await services.job.run(); assert.ok(summary.providers.every(p => p.failed === 0), JSON.stringify(summary));
  assert.equal(interrupted.size, 4); assert.deepEqual([...attempts.values()], [2, 2, 2, 2]);
  assert.equal(await count(db, 'evidence_sources'), 2); assert.equal(await count(db, 'evidence_source_versions'), 2);
  const before = await projection(db); const batches = requests.length;
  await services.job.run(); assert.deepEqual(await projection(db), before); assert.equal(requests.length, batches);
  const results = await services.retrieval.search({ text: 'wildfire Spain Mediterranean' }); assert.equal(results.length, 2);
  for (const result of results) assert.equal((await services.retrieval.findByChunkId(result.chunkId))!.content, result.content);
});

test('bounded WWA history resumes from persisted state without reembedding old items', async t => {
  const historical = ['a', 'b', 'c'].map(id => ({ url: `https://www.worldweatherattribution.org/historical-drought-${id}/`, title: `Historical drought study ${id}`, body: wwaBody, date: 'Sun, 01 Jan 2017 12:00:00 GMT', category: 'Drought' }));
  const { services, db, requests } = await evidenceApplication(t, { env: { EVIDENCE_MAX_ITEMS_PER_PROVIDER: '3', EVIDENCE_MAX_PAGES_PER_PROVIDER: '2' }, http: url => {
    if (url.hostname === 'www.climatecentral.org') return new Response('<html data-alerts-empty></html>');
    if (url.pathname === '/feed/' && url.searchParams.get('paged') === '2') return new Response(wwaFeed(historical));
    if (historical.some(item => item.url === url.href)) return new Response(wwaArticle(undefined, url.href).replace('2020-08-03T12:00:00Z', '2017-01-01T12:00:00Z'));
    return undefined;
  } });
  const first = await services.job.run();
  assert.equal(first.providers.find(p => p.providerId === 'world-weather-attribution')!.status, 'incomplete');
  assert.equal(await count(db, 'evidence_sources'), 3);
  const checkpoint = (await db.query<{ progress: { state: { backfillPage: number; deferred: { id: string }[] } } }>("select progress from public.evidence_ingestion_state where provider_id='world-weather-attribution'")).rows[0].progress.state;
  assert.equal(checkpoint.backfillPage, 3); assert.deepEqual(checkpoint.deferred.map(item => item.id), [historical[2].url]);
  const next = await services.job.run(); assert.ok(next.providers.every(p => p.failed === 0));
  assert.equal(await count(db, 'evidence_sources'), 4); assert.equal(await count(db, 'evidence_source_versions'), 4);
  const urls = (await db.query<{ url: string; published_at: Date }>('select url,published_at from public.evidence_sources order by url')).rows;
  for (const item of historical) assert.equal(new Date(urls.find(row => row.url === item.url)!.published_at).toISOString(), '2017-01-01T12:00:00.000Z');
  const batches = requests.length; const before = await projection(db);
  await services.job.run(); assert.equal(requests.length, batches); assert.deepEqual(await projection(db), before);
});

test('interrupted rebuild resumes only unfinished versions and atomically switches the complete generation', async t => {
  const { services, db } = await evidenceApplication(t); await services.job.run();
  const original = await projection(db); const citation = await services.retrieval.findByChunkId(String(original[0].id));
  const targetChunker = new EvidenceChunker({ size: 400, overlap: 80, minSize: 100 });
  const target = { ...services.profile, chunking: targetChunker.profile, embedding: { ...services.profile.embedding, queryPolicy: 'changed-query-policy' } };
  const documentInputs: string[][] = []; let fail = true;
  const rebuild = new EvidenceRebuildService(services.repository, { profile: target.embedding, embed: async texts => {
    if (texts[0] === 'Climate evidence document.') return texts.map(() => vector());
    documentInputs.push(texts);
    if (documentInputs.length === 2 && fail) throw new EvidenceError('embedding', 'Embedding API unavailable');
    return texts.map(() => vector());
  } }, targetChunker, target);
  const owner = crypto.randomUUID();
  await assert.rejects(rebuild.run('start', owner, 100), { code: 'embedding' });
  const paused = (await rebuild.status())!; assert.equal(paused.manifest.length, 2); assert.equal(paused.completed.length, 1);
  assert.deepEqual(await projection(db), original); assert.deepEqual(await services.retrieval.findByChunkId(String(original[0].id)), citation);
  await assert.rejects(services.retrieval.search({ text: 'wildfire' }), { code: 'maintenance' });
  const completed = await services.repository.readVersion(paused.completed[0]);
  const staged = targetChunker.chunk(completed.source.normalizedText).map(chunk => ({ ...chunk, embedding: vector() }));
  const retained = await count(db, 'evidence_version_chunks');
  await services.repository.stageRebuild(paused, completed.id, staged); assert.equal(await count(db, 'evidence_version_chunks'), retained);
  fail = false;
  assert.equal((await rebuild.run('resume', owner, 100)).status, 'ready');
  assert.equal(documentInputs.length, 3); assert.deepEqual(documentInputs[1], documentInputs[2]);
  assert.equal(await count(db, 'evidence_source_versions'), 2);
  const active = await services.repository.ensureGeneration(target); assert.notEqual(active.id, original[0].generation_id);
  const current = await projection(db); assert.ok(current.every(row => row.generation_id === active.id));
  assert.ok(current.every(row => !original.some(old => old.id === row.id)));
  assert.deepEqual(await services.retrieval.findByChunkId(String(original[0].id)), citation);
  await assert.rejects(services.repository.search({ text: 'wildfire' }, vector(), String(original[0].generation_id), 2), { code: 'generation' });
});

test('aborting a partially staged rebuild restores the original searchable corpus', async t => {
  const { services, db } = await evidenceApplication(t); await services.job.run();
  const before = await projection(db); const owner = crypto.randomUUID();
  const target = { ...services.profile, embedding: { ...services.profile.embedding, model: 'replacement-model' } };
  const status = await services.repository.startRebuild(target, owner);
  const version = await services.repository.readVersion(status.manifest[0]);
  await services.repository.stageRebuild(status, version.id, new EvidenceChunker(services.config.chunking).chunk(version.source.normalizedText).map(c => ({ ...c, embedding: vector() })));
  await services.repository.abortRebuild(services.profile, owner);
  assert.equal(await services.repository.rebuildStatus(), null); assert.deepEqual(await projection(db), before);
  assert.equal((await services.repository.ensureGeneration(services.profile)).id, before[0].generation_id);
  assert.equal((await db.query<{ status: string }>('select status from public.evidence_processing_generations where id=$1', [status.generation.id])).rows[0].status, 'aborted');
  assert.equal((await services.retrieval.search({ text: 'wildfire Spain' })).length, 2);
});

test('SQL deduplicates simultaneous identical writes and rejects a competing stale correction', async t => {
  const { db, repository } = await evidenceDatabase(); t.after(() => db.close());
  const generation = await repository.ensureGeneration(profile);
  const leases = await Promise.all(['writer-a', 'writer-b'].map(id => repository.acquireLease(id, crypto.randomUUID(), 600)));
  const s = source('Concurrent publication');
  const input = async (publication: NormalizedEvidenceSource, writer: number, expectedVersionId: string | null): Promise<StoreEvidenceInput> => ({ source: publication, contentHash: await sourceHash(publication),
    generationId: generation.id, lease: leases[writer]!, itemId: publication.url, expectedVersionId, chunks: chunker.chunk(publication.normalizedText).map(c => ({ ...c, embedding: vector() })) });
  const identical = await Promise.all([0, 1].map(async writer => repository.storeSource(await input(s, writer, null))));
  assert.deepEqual(identical.map(result => result.status).sort(), ['stored', 'unchanged']);
  assert.equal(await count(db, 'evidence_sources'), 1); assert.equal(await count(db, 'evidence_source_versions'), 1);
  const oldHead = (await repository.findSource(s.url))!;
  const original = (await repository.search({ text: 'wildfire' }, vector(), generation.id, 2))[0];
  const corrections = [source(s.title, 'First corrected scientific finding.'), source(s.title, 'Second competing scientific finding.')];
  const results = await Promise.allSettled(corrections.map(async (correction, writer) => repository.storeSource(await input(correction, writer, oldHead.sourceVersionId))));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const rejected = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
  assert.equal(rejected.reason.code, 'conflict'); assert.equal(await count(db, 'evidence_source_versions'), 2);
  assert.equal((await repository.findByChunkId(original.chunkId))!.content, original.content);
  const winner = results.findIndex(result => result.status === 'fulfilled');
  assert.equal((await repository.search({ text: 'scientific finding' }, vector(), generation.id, 2))[0].content, corrections[winner].normalizedText);
});

test('public client roles cannot read evidence or execute privileged citation, ingestion and retrieval RPCs', async t => {
  const { services, db } = await evidenceApplication(t); await services.job.run();
  const before = await projection(db); const chunkId = before[0].id;
  const rpcs = [
    { name: 'evidence_citation', sql: 'select public.evidence_citation($1::uuid)', args: [chunkId] },
    { name: 'evidence_control', sql: "select public.evidence_control('rebuild-status','{}')", args: [] },
    { name: 'store_evidence_source', sql: 'select public.store_evidence_source($1::jsonb)', args: ['{}'] },
    { name: 'hybrid_match_evidence_chunks', sql: 'select public.hybrid_match_evidence_chunks($1::jsonb)', args: [JSON.stringify({ embedding: vector(), generationId: before[0].generation_id, query: { text: 'wildfire' } })] },
  ];
  for (const role of ['anon', 'authenticated']) {
    for (const table of ['evidence_sources', 'evidence_chunks', 'evidence_source_versions', 'evidence_version_chunks']) {
      await assert.rejects(db.transaction(async tx => { await tx.exec(`set local role ${role}`); return tx.query(`select * from public.${table}`); }), new RegExp(`permission denied for table ${table}`));
    }
    for (const rpc of rpcs) {
      await assert.rejects(db.transaction(async tx => { await tx.exec(`set local role ${role}`); return tx.query(rpc.sql, rpc.args); }), new RegExp(`permission denied for function ${rpc.name}`));
    }
  }
  assert.deepEqual(await projection(db), before);
  assert.equal((await services.retrieval.findByChunkId(chunkId))!.content, before[0].content);
});
