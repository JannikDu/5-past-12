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
import { EventRequestBudget } from '../src/services/event-request-budget.ts';
import type { StudyDiscoveryRepository, StudyLookup } from '../src/data/repositories/study-discovery.ts';
import { source } from './helpers/evidence-fixtures.ts';
const fixture=(n=1):ClimateEvent=>({...event,id:`eonet:EONET_TEST${n}`,provenance:{...event.provenance,provider:'eonet',externalId:`EONET_TEST${n}`,dataKind:DataKind.Reported}});
function setup(canStartAssessment=()=>true) {
  const events=[fixture(1),fixture(2),fixture(3)];let acquired=true;let released=false;const items:CatalogItem[]=[];const finished:{id:string;status:string}[]=[];const attempted=new Set<string>();
  const catalog:ClimateEventCatalog={acquire:async()=>acquired?{leaseId:crypto.randomUUID(),historyEnd:null}:null,
    upsert:async(_lease,batch)=>{items.push(...batch);},checkpoint:async()=>{},pending:async()=>events.filter(e=>!attempted.has(e.id)),
    begin:async(_lease,id)=>{attempted.add(id);},finish:async(_lease,id,_fingerprint,_model,a,error)=>{finished.push({id,status:a?.status??error!});},
    release:async()=>{released=true;},feed:async()=>{throw new Error('Public feed must not be read by job');}};
  const provider:EventSourceProvider={id:'eonet',name:'Fixture EONET',fetchEvents:async()=>({events,skipped:0}),fetchEvent:async()=>null};
  const budget=new BudgetedAssessmentModel({model:'fixture',complete:async()=>({})},6);
  const service={assess:async(e:ClimateEvent)=>{await budget.complete('',{});await budget.complete('',{});
    if(e.id===events[0].id)throw new AssessmentError('support','Unsupported claim');
    return {id:crypto.randomUUID(),eventId:e.id,status:e.id===events[1].id?'completed':'insufficient_evidence'} as ClimateAssessment;}};
  const lookups:StudyLookup[]=[];
  const studies:StudyDiscoveryRepository={next:async()=>[{id:crypto.randomUUID(),sourceId:crypto.randomUUID(),
    source:{...source(event.title,event.title),eventStart:event.time.firstObservedAt,eventEnd:event.time.lastObservedAt}}],
    record:async(_lease,lookup)=>{lookups.push(lookup);},pending:catalog.pending};
  const job=new ClimateEventJob(catalog,provider,service,budget,studies,()=>new Date('2026-10-09T12:00:00Z'),()=>Date.now(),canStartAssessment);
  return {job,catalog,provider,studies,lookups,budget,items,finished,events,attempted,get released(){return released;},busy:()=>{acquired=false;}};
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
  const app=setup();app.provider.fetchEvents=async()=>{throw new Error('Provider down');};const summary=await app.job.run();assert.equal(summary.discoveryError,'provider_unavailable');assert.equal(app.lookups[0].outcome,'incomplete');assert.equal(summary.attempted,3);assert.equal(app.released,true);
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
test('request budget preserves final database writes and refuses unstarted candidates',async()=>{
  const redirects:RequestRedirect[]=[];
  const requests=new EventRequestBudget(async(_input,init)=>{redirects.push(init!.redirect!);return Response.json({});});
  const app=setup(()=>requests.canStartAssessment);
  for(let i=0;i<21;i++)await requests.fetch('https://fixture.test');
  const summary=await app.job.run();assert.equal(summary.attempted,0);assert.equal(app.attempted.size,0);assert.equal(app.released,true);
  for(let i=21;i<45;i++)await requests.fetch('https://fixture.test');
  assert.throws(()=>requests.fetch('https://fixture.test'),/request budget/);
  for(let i=0;i<3;i++)await requests.controlFetch('https://fixture.test');
  assert.equal(requests.used,48);assert.throws(()=>requests.controlFetch('https://fixture.test'),/request budget/);
  assert.ok(redirects.every(r=>r==='manual'));
});
test('study lookup is checkpointed before generation, even when the generation process interrupts',async()=>{
  const app=setup();let checkpointed=false;
  app.studies.record=async(_lease,lookup)=>{assert.equal(app.attempted.size,0);assert.equal(lookup.outcome,'matched');checkpointed=true;};
  app.catalog.checkpoint=async()=>{throw new Error('Study-first discovery must not change the chronological cursor');};
  app.catalog.begin=async()=>{assert.equal(checkpointed,true);throw new Error('Simulated process interruption');};
  await assert.rejects(app.job.run(),/interruption/);assert.equal(checkpointed,true);assert.equal(app.released,true);
});

test('cron selects studies before provider lookup and never falls back to unrelated catalog events',async()=>{
  const app=setup();const order:string[]=[];const next=app.studies.next;const fetchEvents=app.provider.fetchEvents;
  app.studies.next=async lease=>{order.push('study');return next(lease);};
  app.provider.fetchEvents=async query=>{order.push('provider');assert.equal(query?.category,event.categories[0]);return fetchEvents(query);};
  app.catalog.pending=async()=>{throw new Error('Chronological pending selection is forbidden');};
  const summary=await app.job.run({refreshOnly:true});assert.deepEqual(order,['study','provider']);assert.equal(summary.selection,'study-first');
  app.studies.next=async()=>[];app.studies.pending=async()=>[];
  app.provider.fetchEvents=async()=>{throw new Error('No study means no provider fallback');};
  assert.equal((await app.job.run()).attempted,0);
});

test('an incomplete study does not starve later studies or checkpoint unreturned events',async()=>{
  const app=setup();const next=app.studies.next;
  app.studies.next=async lease=>[...(await next(lease)),...(await next(lease))];
  let calls=0;app.provider.fetchEvents=async()=>++calls===1?{events:[],skipped:200}:{events:app.events,skipped:0};
  const summary=await app.job.run({refreshOnly:true});
  assert.equal(summary.studyLookups?.[0].outcome,'incomplete');
  assert.equal(summary.studyLookups?.[1].outcome,'matched');
  assert.equal(summary.discovered,3);assert.equal(summary.discoveryError,'budget');assert.equal(app.budget.used,0);
});
