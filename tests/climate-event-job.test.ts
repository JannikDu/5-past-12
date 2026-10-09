import assert from 'node:assert/strict';
import test from 'node:test';
import { ClimateEventJob, fetchCompleteEventWindow } from '../src/services/climate-event-job.ts';
import { BudgetedAssessmentModel } from '../src/services/assessment-discovery.ts';
import { AssessmentError, validateCitedText, type ClimateAssessment } from '../src/domain/climate-assessment.ts';
import { DataKind, type ClimateEvent } from '../src/domain/climate-event.ts';
import { parseClimateEventFeed } from '../src/domain/climate-event-feed.ts';
import type { ClimateEventCatalog, CatalogItem } from '../src/data/repositories/climate-event-catalog.ts';
import type { EventSourceProvider } from '../src/data/providers/event-source.ts';
import { event } from './helpers/assessment-fixtures.ts';
const fixture=(n=1):ClimateEvent=>({...event,id:`eonet:EONET_TEST${n}`,provenance:{...event.provenance,provider:'eonet',externalId:`EONET_TEST${n}`,dataKind:DataKind.Reported}});
function setup() {
  const events=[fixture(1),fixture(2),fixture(3)];let acquired=true;let released=false;const items:CatalogItem[]=[];const finished:{id:string;status:string}[]=[];const attempted=new Set<string>();
  const catalog:ClimateEventCatalog={acquire:async()=>acquired?{leaseId:crypto.randomUUID(),historyEnd:null}:null,
    upsert:async(_lease,batch)=>{items.push(...batch);},pending:async()=>events.filter(e=>!attempted.has(e.id)),
    begin:async(_lease,id)=>{attempted.add(id);},finish:async(_lease,id,_fingerprint,_model,a,error)=>{finished.push({id,status:a?.status??error!});},
    release:async()=>{released=true;},feed:async()=>{throw new Error('Public feed must not be read by job');}};
  const provider:EventSourceProvider={id:'eonet',name:'Fixture EONET',fetchEvents:async()=>({events,skipped:0}),fetchEvent:async()=>null};
  const budget=new BudgetedAssessmentModel({model:'fixture',complete:async()=>({})},6);
  const service={assess:async(e:ClimateEvent)=>{await budget.complete('',{});await budget.complete('',{});
    if(e.id===events[0].id)throw new AssessmentError('support','Unsupported claim');
    return {id:crypto.randomUUID(),eventId:e.id,status:e.id===events[1].id?'completed':'insufficient_evidence'} as ClimateAssessment;}};
  const job=new ClimateEventJob(catalog,provider,service,budget,async()=>[],()=>new Date('2026-10-09T12:00:00Z'));
  return {job,catalog,provider,budget,items,finished,events,attempted,get released(){return released;},busy:()=>{acquired=false;}};
}
test('scheduled processing continues after failure and retains direct/indirect and insufficient outcomes without retry',async()=>{
  const app=setup();const summary=await app.job.run();assert.equal(summary.attempted,3);assert.equal(summary.failed,1);assert.equal(summary.completed,1);assert.equal(summary.insufficient,1);assert.equal(summary.modelCalls,6);
  assert.equal(app.items.length,3);assert.equal(app.released,true);assert.deepEqual(app.finished.map(f=>f.status),['support','completed','insufficient_evidence']);
  await app.job.run();assert.equal(app.finished.length,3);assert.equal(app.budget.used,6);
});
test('busy lease excludes provider and generation; refresh-only records snapshots without completions',async()=>{
  const busy=setup();busy.busy();assert.equal((await busy.job.run()).status,'busy');assert.equal(busy.items.length,0);assert.equal(busy.budget.used,0);
  const preview=setup();await preview.job.run({refreshOnly:true});assert.equal(preview.items.length,3);assert.equal(preview.budget.used,0);assert.equal(preview.finished.length,0);
});
test('model budget leaves untouched candidates pending and an interrupted begin remains an attempted failure',async()=>{
  const app=setup();for(let i=0;i<4;i++)await app.budget.complete('',{});const summary=await app.job.run();assert.equal(summary.attempted,1);assert.equal(app.attempted.size,1);assert.equal(app.released,true);
});
test('saturated windows are bisected, deduplicated, and single-day saturation is explicitly incomplete',async()=>{
  const app=setup();let calls=0;const provider={...app.provider,fetchEvents:async()=>{calls++;return calls===1?{events:Array.from({length:200},()=>fixture()),skipped:0}:{events:[fixture()],skipped:0};}};
  assert.equal((await fetchCompleteEventWindow(provider,'2026-10-01','2026-10-08')).length,1);assert.equal(calls,3);
  await assert.rejects(fetchCompleteEventWindow({...provider,fetchEvents:async()=>({events:[],skipped:200})},'2026-10-01','2026-10-01'),/single EONET day/);
});
test('discovery failure preserves cursor and does not prevent previously pending assessments',async()=>{
  const app=setup();app.provider.fetchEvents=async()=>{throw new Error('Provider down');};const summary=await app.job.run();assert.equal(summary.discoveryError,'provider_unavailable');assert.equal(summary.historyEnd,undefined);assert.equal(summary.attempted,3);assert.equal(app.released,true);
});
test('public feed validation rejects invented levels, duplicates and mismatched indicators',()=>{
  const base={events:[fixture()],indicators:[{eventId:fixture().id,humanInfluence:'none',evidenceStrength:'low',stale:false}],updatedAt:null,historyEnd:null,counts:{total:1,pending:0,failed:0,insufficient:0,connections:1}};
  assert.equal(parseClimateEventFeed(base).indicators[0].humanInfluence,'none');
  assert.throws(()=>parseClimateEventFeed({...base,indicators:[{...base.indicators[0],humanInfluence:'certain'}]}));
  assert.throws(()=>parseClimateEventFeed({...base,events:[fixture(),fixture()]}));
  assert.throws(()=>parseClimateEventFeed({...base,indicators:[{...base.indicators[0],eventId:fixture(2).id}]}));
});
test('job skips future/outdated events before assessment',async()=>{
  const app=setup();app.events[0]={...app.events[0],time:{...event.time,firstObservedAt:'2020-01-01T00:00:00.000Z'}};
  await app.job.run();assert.equal(app.finished.length,2);assert.ok(app.items.every(i=>i.event.time.firstObservedAt!=='2020-01-01T00:00:00.000Z'));
});
test('runtime refusal never charges a completion request that was not sent',async()=>{
  let requests=0;const budget=new BudgetedAssessmentModel({model:'fixture',complete:async()=>{requests++;return {};}},6,()=>false);
  await assert.rejects(budget.complete('',{}),/runtime budget/);assert.equal(requests,0);assert.equal(budget.used,0);
});
test('written ratios and incomplete sentences cannot use publication titles as support',()=>{
  assert.throws(()=>validateCitedText(['Climate change doubled the likelihood.'],['More than 48,000 hectares burned.']),/ratio absent/);
  assert.doesNotThrow(()=>validateCitedText(['The likelihood doubled.'],['The study reported a factor of about 2 increase in likelihood.']));
  assert.throws(()=>validateCitedText(['These findings do not establish conditions in '],['Regional conditions were warmer.']),/Incomplete/);
});
