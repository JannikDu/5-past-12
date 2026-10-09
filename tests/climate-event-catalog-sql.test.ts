import assert from 'node:assert/strict';
import test from 'node:test';
import { evidenceDatabase } from './helpers/evidence-database.ts';
import { SupabaseClimateEventCatalog } from '../src/data/repositories/climate-event-catalog.ts';
import { DataKind } from '../src/domain/climate-event.ts';
import { event } from './helpers/assessment-fixtures.ts';
import { eventFingerprint } from '../src/services/assessment-context.ts';
import { assessmentVersion } from '../src/domain/climate-assessment.ts';
test('catalog SQL excludes overlap, retains attempts, reopens changed events, resumes cursor and protects client roles',async t=>{
  const local=await evidenceDatabase(undefined,'extensions',true);t.after(()=>local.db.close());
  const catalog=new SupabaseClimateEventCatalog({url:'https://database.test',secretKey:'fake'},{fetch:local.fetch,retries:0});
  const reported={...event,id:'eonet:EONET_TEST',provenance:{...event.provenance,provider:'eonet',externalId:'EONET_TEST',dataKind:DataKind.Reported}};
  const fingerprint=await eventFingerprint(reported);const lease=(await catalog.acquire())!;assert.equal(await catalog.acquire(),null);
  await catalog.upsert(lease,[{event:reported,fingerprint,priority:1}]);assert.equal((await catalog.pending(lease,'fixture')).length,1);
  await catalog.begin(lease,reported.id,fingerprint,'fixture');await catalog.finish(lease,reported.id,fingerprint,'fixture',undefined,'support');
  assert.equal((await catalog.pending(lease,'fixture')).length,0);assert.equal((await catalog.pending(lease,'different-model')).length,1);
  await catalog.upsert(lease,[{event:reported,fingerprint,priority:1}]);assert.equal((await catalog.pending(lease,'fixture')).length,0);
  const feed=await catalog.feed();assert.equal(feed.events.length,0);assert.equal(feed.counts.failed,1);assert.equal(feed.counts.connections,0);
  const changed={...reported,title:'Cedar Ridge Wildfire updated'};await catalog.upsert(lease,[{event:changed,fingerprint:await eventFingerprint(changed),priority:1}]);
  assert.equal((await catalog.pending(lease,'fixture')).length,1);
  await catalog.release(lease,{attempted:1},'2026-10-01',true);const next=(await catalog.acquire())!;assert.equal(next.historyEnd,'2026-10-01');
  await assert.rejects(catalog.begin(lease,reported.id,fingerprint,'fixture'));
  for(const role of ['anon','authenticated']) {
    assert.equal((await local.db.query<{allowed:boolean}>('select has_function_privilege($1,\'climate_event_control(text,jsonb)\',\'EXECUTE\') allowed',[role])).rows[0].allowed,false);
    for(const table of ['climate_event_catalog','climate_event_job_state'])assert.equal((await local.db.query<{allowed:boolean}>('select has_table_privilege($1,$2,\'SELECT\') allowed',[role,table])).rows[0].allowed,false);
  }
  await local.db.query('update public.climate_event_catalog set attempted_version=$1,state=\'failed\'',[assessmentVersion]);
  await catalog.release(next,{},undefined,false);
});
