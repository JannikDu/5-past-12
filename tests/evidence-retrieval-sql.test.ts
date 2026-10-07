import test from 'node:test';
import assert from 'node:assert/strict';
import { evidenceDatabase } from './helpers/evidence-database.ts';
import { chunker, profile, source, vector } from './helpers/evidence-fixtures.ts';
import { sourceHash } from '../src/services/evidence-identity.ts';
import { DefaultEvidenceRetrievalService } from '../src/services/evidence-retrieval.ts';
import { EvidenceChunker } from '../src/services/evidence-chunker.ts';
import type { NormalizedEvidenceSource } from '../src/domain/evidence.ts';
import { EventCategory } from '../src/domain/climate-event.ts';

test('hybrid SQL retrieval combines independently eligible candidate branches with bounded preferences', async t => {
  const { db, repository } = await evidenceDatabase(); t.after(() => db.close());
  const generation = await repository.ensureGeneration(profile);
  const lease = (await repository.acquireLease('retrieval-fixtures', crypto.randomUUID(), 600))!;
  async function store(s: NormalizedEvidenceSource, embedding = vector()) {
    await repository.storeSource({ source: s, contentHash: await sourceHash(s), generationId: generation.id, lease, itemId: s.url, expectedVersionId: null,
      chunks: chunker.chunk(s.normalizedText).map(chunk => ({ ...chunk, embedding })) });
  }
  // More than the minimum candidate budget: a lexical hit genuinely cannot enter
  // the first 50 semantic candidates. One publication per passage avoids cap bias.
  for (let i = 0; i < 55; i++) await store({ ...source(`Regional report ${i}`, `Regional weather monitoring report ${i}. Rainfall observations have substantial uncertainty.`),
    eventTypes: [], region: null, eventStart: null, eventEnd: null, evidenceType: 'general_context', sourceType: 'article' });
  const lexicalOnly = { ...source('Monteverde observations', 'Monteverde wildfire observations describe dry soils and uncertainty.'),
    eventTypes: [], region: null, eventStart: null, eventEnd: null, publishedAt: null, evidenceType: 'event_context' as const, sourceType: 'observation' as const };
  await store(lexicalOnly, vector(0.2, Math.sqrt(0.96)));

  await t.test('a lexical-only low-cosine result is recovered outside the semantic pool', async () => {
    const semantic = (await db.query<{ source_url: string }>('select * from public.match_evidence_chunks($1::extensions.vector,50,null,null,null,null,null)', [JSON.stringify(vector())])).rows;
    assert.equal(semantic.length, 50); assert.ok(semantic.every(row => row.source_url !== lexicalOnly.url));
    const results = await repository.search({ text: 'Monteverde', limit: 3 }, vector(), generation.id, 2);
    const hit = results.find(row => row.sourceUrl === lexicalOnly.url)!;
    assert.ok(hit, 'The lexical branch must recover the omitted semantic candidate');
    assert.ok(Math.abs(hit.similarity - 0.2) < 1e-5);
    assert.ok(Math.abs(hit.score - 1 / 61) < 1e-10, 'A lexical-only hit contributes exactly one RRF rank');
    assert.equal(hit.publishedAt, null); assert.equal((await repository.findByChunkId(hit.chunkId))!.sourceUrl, lexicalOnly.url);
  });

  await t.test('no lexical matches still yield semantic results in deterministic rank order', async () => {
    const results = await repository.search({ text: 'unindexedterm', limit: 3 }, vector(), generation.id, 2);
    assert.equal(results.length, 3);
    results.forEach((row, index) => {
      assert.equal(row.similarity, 1); assert.ok(Math.abs(row.score - 1 / (61 + index)) < 1e-10);
    });
    assert.deepEqual(await repository.search({ text: 'unindexedterm', limit: 3 }, vector(), generation.id, 2), results);
  });

  const explicit = { ...source('Explicit event interval', 'Monteverde wildfire study with a documented event interval.'),
    eventStart: '2026-10-07T23:00:00Z', eventEnd: '2026-10-08T02:00:00Z', publishedAt: '2026-10-10T12:00:00Z' };
  const publicationOnly = { ...source('Publication date only', 'Monteverde wildfire context published without an event interval.'), eventStart: null, eventEnd: null, publishedAt: '2026-10-07T12:00:00Z' };
  await store(explicit); await store(publicationOnly);
  await t.test('large candidate pools retain every source and metadata/date preferences add only bounded bonuses', async () => {
    const baseline = await repository.search({ text: 'Monteverde', evidenceTypes: [], sourceTypes: [], limit: 100 }, vector(), generation.id, 2);
    const preferred = await repository.search({ text: 'Monteverde', eventType: EventCategory.Wildfire, region: ' sPaIn ',
      eventDate: new Date('2026-10-07T00:00:00Z'), evidenceTypes: ['analogue_attribution', 'event_context'], sourceTypes: ['attribution_study'], limit: 100 }, vector(), generation.id, 2);
    assert.equal(baseline.length, 58); assert.equal(preferred.length, 58);
    assert.deepEqual(new Set(preferred.map(row => row.chunkId)), new Set(baseline.map(row => row.chunkId)));
    for (const url of [explicit.url, publicationOnly.url, lexicalOnly.url]) {
      const delta = preferred.find(row => row.sourceUrl === url)!.score - baseline.find(row => row.sourceUrl === url)!.score;
      const expected = url === explicit.url ? 0.005 : url === publicationOnly.url ? 0.004 : 0.001;
      assert.ok(Math.abs(delta - expected) < 1e-10, `${url}: unexpected metadata/date bonus ${delta}`);
    }
  });

  await t.test('latest search caps publications and suppresses substantially overlapping passages', async () => {
    const denseChunker = new EvidenceChunker({ size: 400, overlap: 280, minSize: 100 });
    // A separate processing generation is required when chunk settings change.
    const target = { ...profile, chunking: denseChunker.profile };
    const owner = crypto.randomUUID(); const status = await repository.startRebuild(target, owner);
    for (const id of status.manifest) {
      const version = await repository.readVersion(id);
      await repository.stageRebuild(status, id, denseChunker.chunk(version.source.normalizedText).map(chunk => ({ ...chunk, embedding: vector() })));
    }
    await repository.activateRebuild((await repository.rebuildStatus())!);
    const nextGeneration = await repository.ensureGeneration(target);
    const long = source('Long wildfire report', Array.from({ length: 30 }, (_, i) => `Spain wildfire observation ${i}: dry conditions remain uncertain. `).join(''));
    await repository.storeSource({ source: long, contentHash: await sourceHash(long), generationId: nextGeneration.id, lease, itemId: long.url, expectedVersionId: null,
      chunks: denseChunker.chunk(long.normalizedText).map(chunk => ({ ...chunk, embedding: vector() })) });
    const results = await repository.search({ text: 'Spain wildfire', limit: 10 }, vector(), nextGeneration.id, 3);
    const longResults = results.filter(row => row.sourceUrl === long.url);
    assert.equal(longResults.length, 3); assert.ok(results.some(row => row.sourceUrl !== long.url));
    const spans = (await db.query<{ id: string; span_start: number; span_end: number }>('select id,span_start,span_end from public.evidence_version_chunks where id=any($1::uuid[])', [longResults.map(row => row.chunkId)])).rows;
    for (let i = 0; i < spans.length; i++) for (let j = i + 1; j < spans.length; j++) {
      const overlap = Math.max(0, Math.min(spans[i].span_end, spans[j].span_end) - Math.max(spans[i].span_start, spans[j].span_start));
      assert.ok(overlap / Math.min(spans[i].span_end - spans[i].span_start, spans[j].span_end - spans[j].span_start) < 0.7);
    }
  });
});

test('retrieval handles an empty corpus and rechecks generation after query embedding has started', async t => {
  const { db, repository } = await evidenceDatabase(); t.after(() => db.close());
  const generation = await repository.ensureGeneration(profile);
  assert.deepEqual(await repository.search({ text: 'wildfire' }, vector(), generation.id, 2), []);
  assert.equal(await repository.findByChunkId(crypto.randomUUID()), null);
  const lease = (await repository.acquireLease('transition-fixture', crypto.randomUUID(), 600))!;
  const s = source('Transition publication');
  await repository.storeSource({ source: s, contentHash: await sourceHash(s), generationId: generation.id, lease, itemId: s.url, expectedVersionId: null,
    chunks: chunker.chunk(s.normalizedText).map(chunk => ({ ...chunk, embedding: vector() })) });
  const citation = (await repository.search({ text: 'wildfire' }, vector(), generation.id, 2))[0];
  const target = { ...profile, embedding: { ...profile.embedding, queryPolicy: 'replacement-query-policy' } };

  await t.test('maintenance beginning during embedding surfaces an error rather than empty matches', async () => {
    const owner = crypto.randomUUID(); let queries = 0;
    const retrieval = new DefaultEvidenceRetrievalService(repository, { profile: profile.embedding, embed: async (_texts, purpose) => {
      assert.equal(purpose, 'query'); queries++; await repository.startRebuild(target, owner); return [vector()];
    } }, profile);
    await assert.rejects(retrieval.search({ text: 'wildfire' }), { code: 'maintenance' }); assert.equal(queries, 1);
    assert.equal((await repository.findByChunkId(citation.chunkId))!.content, citation.content);
    await repository.abortRebuild(profile, owner);
  });

  await t.test('activation during embedding rejects the stale generation and preserves earlier citations', async () => {
    const retrieval = new DefaultEvidenceRetrievalService(repository, { profile: profile.embedding, embed: async () => {
      const status = await repository.startRebuild(target, crypto.randomUUID());
      for (const id of status.manifest) {
        const version = await repository.readVersion(id);
        await repository.stageRebuild(status, id, chunker.chunk(version.source.normalizedText).map(chunk => ({ ...chunk, embedding: vector() })));
      }
      await repository.activateRebuild((await repository.rebuildStatus())!); return [vector()];
    } }, profile);
    await assert.rejects(retrieval.search({ text: 'wildfire' }), { code: 'generation' });
    const active = await repository.ensureGeneration(target);
    assert.notEqual(active.id, generation.id);
    const latest = (await repository.search({ text: 'wildfire' }, vector(), active.id, 2))[0];
    assert.notEqual(latest.chunkId, citation.chunkId); assert.equal(latest.sourceVersionId, citation.sourceVersionId);
    assert.equal((await repository.findByChunkId(citation.chunkId))!.content, citation.content);
  });
});
