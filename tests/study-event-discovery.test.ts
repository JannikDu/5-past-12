import assert from 'node:assert/strict';
import test from 'node:test';
import { EventCategory, DataKind } from '../src/domain/climate-event.ts';
import { studyEventQuery, studyMatchesEvent } from '../src/services/study-event-discovery.ts';
import { SupabaseStudyDiscoveryRepository, type DiscoveryStudy } from '../src/data/repositories/study-discovery.ts';
import { SupabaseClimateEventCatalog } from '../src/data/repositories/climate-event-catalog.ts';
import { eventFingerprint } from '../src/services/assessment-context.ts';
import { evidenceDatabase } from './helpers/evidence-database.ts';
import { event } from './helpers/assessment-fixtures.ts';
import { source } from './helpers/evidence-fixtures.ts';

const now = new Date('2026-10-09T12:00:00Z');
const study = (changes: Partial<DiscoveryStudy['source']> = {}): DiscoveryStudy => ({ id: crypto.randomUUID(), sourceId: crypto.randomUUID(),
  source: { ...source('Hurricane Helene attribution', 'On September 26th, Hurricane Helene made landfall.'), eventTypes: [EventCategory.Storm],
    eventStart: null, eventEnd: null, publishedAt: '2024-10-09T00:00:00Z', ...changes } });

test('study dates guide provider queries, while event age and publication age stay separate', () => {
  assert.deepEqual(studyEventQuery(study(), now), { start: '2024-08-18', end: '2024-09-30', category: EventCategory.Storm });
  assert.equal(studyEventQuery(study({ eventStart: '2020-01-01T00:00:00Z', eventEnd: '2020-01-31T00:00:00Z' }), now), null);
  assert.deepEqual(studyEventQuery(study({ publishedAt: '2019-01-01T00:00:00Z', normalizedText: 'September 2024: Hurricane Helene.' }), now),
    { start: '2024-08-18', end: '2024-09-30', category: EventCategory.Storm });
  assert.equal(studyEventQuery(study({ eventTypes: [EventCategory.Ice] }), now), null);
  assert.equal(studyEventQuery(study({ publishedAt: null, normalizedText: 'No dates supplied.' }), now), null);
  assert.equal(studyEventQuery(study({ eventStart: '2027-01-01T00:00:00Z' }), now), null);
  assert.equal(studyEventQuery(study({ eventTypes: [EventCategory.Heat] }), now)?.category, EventCategory.Temperature);
});

test('candidate identity tolerates numeric IDs and super-typhoon labels, without accepting unrelated names', () => {
  const gaemi = study({ normalizedText: 'Super Typhoon Gaemi affected the region in July 2024.' });
  assert.equal(studyMatchesEvent(gaemi, { ...event, title: 'Super Typhoon Gaemi 12345' }), true);
  assert.equal(studyMatchesEvent(gaemi, { ...event, title: 'Typhoon Yagi' }), false);
  assert.equal(studyMatchesEvent(gaemi, { ...event, title: 'Tropical Storm' }), false);
  assert.equal(studyMatchesEvent(study({ normalizedText: 'The Eaton fire in Los Angeles, California.' }),
    { ...event, title: 'EATON Wildfire, Los Angeles, California' }), true);
  const nigeria = study({ title: 'Flooding in Nigeria', normalizedText: 'Floods struck Nigeria.\n\nResearchers from the Netherlands analysed the event.' });
  assert.equal(studyMatchesEvent(nigeria, { ...event, title: 'Flood in Netherlands 1234' }), false);
  assert.equal(studyMatchesEvent(nigeria, { ...event, title: 'Flood in Nigeria 1234' }), true);
});

test('study SQL selects current versions progressively, scopes pending events, and protects leases/client roles', async t => {
  const local = await evidenceDatabase(undefined, 'extensions', true); t.after(() => local.db.close());
  const config = { url: 'https://database.test', secretKey: 'fake' }; const http = { fetch: local.fetch, retries: 0 };
  const catalog = new SupabaseClimateEventCatalog(config, http); const studies = new SupabaseStudyDiscoveryRepository(config, http);
  const lease = (await catalog.acquire())!;
  async function insertStudy(s: DiscoveryStudy) {
    await local.db.query(`insert into public.evidence_sources(id,title,publisher,url,source_type,evidence_type,event_types,published_at)
      values($1,$2,$3,$4,'attribution_study','analogue_attribution',$5,$6)`,
    [s.sourceId, s.source.title, s.source.publisher, s.source.url + '/' + s.sourceId, s.source.eventTypes, s.source.publishedAt]);
    await local.db.query(`insert into public.evidence_source_versions(id,source_id,metadata,normalized_text,content_hash,normalization_profile,provider_id,item_id)
      values($1,$2,$3,$4,$5,'fixture','fixture',$6)`, [s.id, s.sourceId, JSON.stringify(s.source), s.source.normalizedText, 'a'.repeat(64), s.id]);
    await local.db.query('update public.evidence_sources set current_version_id=$1 where id=$2', [s.id, s.sourceId]);
  }
  const first = study(); const second = study({ title: 'Typhoon Gaemi attribution' }); const third = study({ title: 'Regional wildfire attribution' });
  for (const s of [first, second, third]) await insertStudy(s);
  const selected = await studies.next(lease); assert.equal(selected.length, 2);
  assert.ok(selected.every(s => s.id !== third.id));
  const matched = { ...event, id: 'eonet:EONET_MATCHED', provenance: { ...event.provenance, provider: 'eonet', externalId: 'EONET_MATCHED', dataKind: DataKind.Reported } };
  const unrelated = { ...matched, id: 'eonet:EONET_UNRELATED', provenance: { ...matched.provenance, externalId: 'EONET_UNRELATED' } };
  await catalog.upsert(lease, await Promise.all([matched, unrelated].map(async e => ({ event: e, fingerprint: await eventFingerprint(e), priority: 1 }))));
  assert.equal((await studies.pending(lease, 'fixture')).length, 0);
  await studies.record(lease, { studyVersionId: first.id, outcome: 'matched', eventIds: [matched.id], query: {} });
  await studies.record(lease, { studyVersionId: second.id, outcome: 'no_match', eventIds: [], query: {} });
  assert.deepEqual((await studies.next(lease)).map(s => s.id), [third.id]);
  assert.deepEqual((await studies.pending(lease, 'fixture')).map(e => e.id), [matched.id]);
  await studies.record(lease, { studyVersionId: first.id, outcome: 'incomplete', eventIds: [], query: {}, errorCode: 'budget' });
  assert.deepEqual((await studies.pending(lease, 'fixture')).map(e => e.id), [matched.id]);
  assert.deepEqual((await studies.next(lease)).map(s => s.id), [third.id]);
  const hash = await eventFingerprint(matched); await catalog.begin(lease, matched.id, hash, 'fixture');
  await catalog.finish(lease, matched.id, hash, 'fixture', undefined, 'support');
  assert.equal((await studies.pending(lease, 'fixture')).length, 0);
  assert.equal((await studies.pending(lease, 'different-model')).length, 1);
  await local.db.exec("update public.climate_study_lookups set checked_at=clock_timestamp()-interval '8 days'");
  assert.equal((await studies.next(lease)).length, 2);
  const corrected = { ...first, id: crypto.randomUUID() };
  await local.db.query(`insert into public.evidence_source_versions(id,source_id,metadata,normalized_text,content_hash,normalization_profile,provider_id,item_id)
    values($1::uuid,$2,$3,$4,$5,'fixture','fixture',$1::text)`, [corrected.id, corrected.sourceId, JSON.stringify(corrected.source), corrected.source.normalizedText, 'b'.repeat(64)]);
  await local.db.query('update public.evidence_sources set current_version_id=$1 where id=$2', [corrected.id, corrected.sourceId]);
  assert.ok((await studies.next(lease)).some(s => s.id === corrected.id));
  assert.equal((await studies.pending(lease, 'different-model')).length, 0);
  await assert.rejects(studies.record(lease, { studyVersionId: first.id, outcome: 'no_match', eventIds: [], query: null }));
  for (const role of ['anon', 'authenticated']) {
    assert.equal((await local.db.query<{ allowed: boolean }>("select has_function_privilege($1,'climate_study_control(text,jsonb)','EXECUTE') allowed", [role])).rows[0].allowed, false);
    assert.equal((await local.db.query<{ allowed: boolean }>("select has_table_privilege($1,'climate_study_lookups','SELECT') allowed", [role])).rows[0].allowed, false);
  }
  await catalog.release(lease, {}, '2026-09-24');
  await assert.rejects(studies.next(lease));
  assert.equal((await catalog.acquire())!.historyEnd, '2026-09-24');
});
