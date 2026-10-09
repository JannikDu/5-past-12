import assert from 'node:assert/strict';
import test from 'node:test';
import { evidenceDatabase } from './helpers/evidence-database.ts';
import { chunker, profile, source, vector } from './helpers/evidence-fixtures.ts';
import { citation, draft, event as fixtureEvent, review } from './helpers/assessment-fixtures.ts';
import { DataKind } from '../src/domain/climate-event.ts';
import { SupabaseClimateEventCatalog } from '../src/data/repositories/climate-event-catalog.ts';
import { eventFingerprint } from '../src/services/assessment-context.ts';
import { SupabaseAssessmentRepository } from '../src/data/repositories/supabase-assessment.ts';
import { DefaultEvidenceRetrievalService } from '../src/services/evidence-retrieval.ts';
import { DefaultClimateAssessmentService } from '../src/services/climate-assessment.ts';
import { sourceHash } from '../src/services/evidence-identity.ts';
import type { EvidenceCitation } from '../src/domain/evidence.ts';
import type { ClimateAssessment } from '../src/domain/climate-assessment.ts';

test('additive assessment migration: real SQL persistence, immutable citation history, rollback and security', async t => {
  const local = await evidenceDatabase(undefined, 'extensions', true); t.after(() => local.db.close());
  const { db, repository: evidence } = local;
  const event={...fixtureEvent,id:'eonet:EONET_CEDAR_TEST',provenance:{...fixtureEvent.provenance,provider:'eonet',externalId:'EONET_CEDAR_TEST',dataKind:DataKind.Reported}};
  const repository = new SupabaseAssessmentRepository({ url: 'https://database.test', secretKey: 'fake' }, { fetch: local.fetch, retries: 0 });
  const generation = await evidence.ensureGeneration(profile);
  const lease = (await evidence.acquireLease('assessment-fixture', crypto.randomUUID(), 600))!;
  const original = { ...source('Cedar Ridge attribution', citation().content), evidenceType: 'general_context' as const };
  async function store(s = original) {
    const head = await evidence.findSource(s.url);
    await evidence.storeSource({ source: s, contentHash: await sourceHash(s), generationId: generation.id, lease, itemId: s.url,
      expectedVersionId: head?.sourceVersionId ?? null, chunks: chunker.chunk(s.normalizedText).map(c => ({ ...c, embedding: vector() })) });
  }
  await store();
  const retrieval = new DefaultEvidenceRetrievalService(evidence, { profile: profile.embedding, embed: async () => [vector()] }, profile);
  let calls = 0;
  const llm = { model: 'fixture-science', complete: async (_prompt: string, data: unknown) => {
    calls++;
    if (calls % 2) {
      const passages = (data as { passages: { segments: { passageId: string }[] }[] }).passages;
      return { ...draft(), claims: draft().claims.map(c => ({ ...c, citations: [{ passageId: passages[0].segments[0].passageId }] })) };
    }
    return review((data as { passages: EvidenceCitation[] }).passages[0]);
  } };
  const service = new DefaultClimateAssessmentService(repository, retrieval, llm, () => new Date('2026-10-09T12:00:00Z'));
  const assessment = await service.assess(event);
  assert.equal(assessment.humanInfluence, 'high'); assert.equal(assessment.evidenceStrength, 'high');
  assert.equal((await service.assess(event)).id, assessment.id); assert.equal(calls, 2);
  assert.deepEqual((await repository.latest(event.id))!.assessment, assessment);
  assert.equal((await db.query('select * from public.climate_assessment_citations')).rows.length, 1);
  await repository.save(assessment); // Replay after a lost successful HTTP response is safe.
  assert.equal((await db.query('select * from public.climate_assessments')).rows.length, 1);
  const catalog=new SupabaseClimateEventCatalog({url:'https://database.test',secretKey:'fake'},{fetch:local.fetch,retries:0});
  const jobLease=(await catalog.acquire())!;const eventHash=await eventFingerprint(event);
  await catalog.upsert(jobLease,[{event,fingerprint:eventHash,priority:1}]);
  await catalog.begin(jobLease,event.id,eventHash,llm.model);await catalog.finish(jobLease,event.id,eventHash,llm.model,assessment);
  const connectionFeed=await catalog.feed();assert.equal(connectionFeed.events[0].id,event.id);assert.equal(connectionFeed.indicators[0].humanInfluence,'high');assert.equal(connectionFeed.counts.connections,1);
  await catalog.release(jobLease,{},undefined,true);

  await t.test('citation mismatches, unknown IDs and duplicate citations atomically roll back', async () => {
    for (const mutate of [
      (a: ClimateAssessment) => { a.claims[0].citations[0].sourceId = crypto.randomUUID(); },
      (a: ClimateAssessment) => { a.claims[0].citations[0].sourceVersionId = crypto.randomUUID(); },
      (a: ClimateAssessment) => { a.claims[0].citations[0].chunkId = crypto.randomUUID(); },
      (a: ClimateAssessment) => { a.claims[0].citations[0].passage = 'Invented finding'; },
      (a: ClimateAssessment) => { a.claims[0].citations.push(a.claims[0].citations[0]); },
    ]) {
      const invalid = structuredClone(assessment); invalid.id = crypto.randomUUID(); mutate(invalid);
      await assert.rejects(repository.save(invalid));
      assert.equal((await db.query('select * from public.climate_assessments')).rows.length, 1);
      assert.equal((await db.query('select * from public.climate_assessment_citations')).rows.length, 1);
    }
  });
  await t.test('RLS and invoker grants exclude client roles despite permissive default grants', async () => {
    for (const role of ['anon', 'authenticated']) {
      for (const table of ['climate_assessments', 'climate_assessment_citations', 'climate_assessment_failures']) {
        assert.equal((await db.query<{ allowed: boolean }>('select has_table_privilege($1,$2,\'SELECT\') allowed', [role, table])).rows[0].allowed, false);
      }
      for (const fn of ['climate_assessment_snapshot()', 'climate_assessment_latest(text)', 'climate_assessment_save(jsonb)', 'climate_assessment_failed(text)'])
        assert.equal((await db.query<{ allowed: boolean }>('select has_function_privilege($1,$2,\'EXECUTE\') allowed', [role, fn])).rows[0].allowed, false);
    }
    for (const table of ['climate_assessments', 'climate_assessment_citations'])
      assert.equal((await db.query<{ relrowsecurity: boolean }>('select relrowsecurity from pg_class where relname=$1', [table])).rows[0].relrowsecurity, true);
    await assert.rejects(db.exec('update public.climate_assessments set summary=\'edited\''));
  });
  await t.test('source corrections flag saved result stale but preserve original passages', async () => {
    const chunkId = assessment.claims[0].citations[0].chunkId;
    await store({ ...original, normalizedText: `${original.normalizedText} Correction: the estimate is uncertain.` });
    assert.equal((await repository.latest(event.id))!.stale, true);
    assert.equal((await catalog.feed()).indicators[0].stale,true);
    const read = await service.read(event.id); assert.ok(read.kind === 'available' && read.stale);
    assert.equal((await evidence.findByChunkId(chunkId))!.content, original.normalizedText);
    const stale = { ...assessment, id: crypto.randomUUID() }; await assert.rejects(repository.save(stale));
    assert.equal((await db.query('select * from public.climate_assessments')).rows.length, 1);
  });
  await t.test('new assessment after correction is retained alongside prior valid result', async () => {
    const updated = await service.assess(event, { force: true }); assert.notEqual(updated.id, assessment.id);
    assert.equal((await repository.latest(event.id))!.stale, false);
    assert.equal((await db.query('select * from public.climate_assessments')).rows.length, 2);
  });
  await t.test('failed generation status preserves prior scientific results and describes empty failures', async () => {
    await repository.recordFailure(event.id);
    const read = await service.read(event.id); assert.ok(read.kind === 'available' && read.generationFailed);
    await repository.recordFailure('eonet:failed-fixture');
    assert.deepEqual(await service.read('eonet:failed-fixture'), { kind: 'generation_failed' });
    await service.assess(event, { force: true });
    assert.equal((await repository.latest(event.id))!.generationFailed, false);
  });
});
