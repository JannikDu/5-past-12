import assert from 'node:assert/strict';
import test from 'node:test';
import { assessmentHttp } from '../src/server/assessment-http.ts';
import { event } from './helpers/assessment-fixtures.ts';
import { DataKind } from '../src/domain/climate-event.ts';
import { AssessmentError } from '../src/domain/climate-assessment.ts';
import type { ClimateAssessment } from '../src/domain/climate-assessment.ts';
import type { ClimateEventFeed } from '../src/domain/climate-event-feed.ts';

function dependencies() {
  let reads = 0; let assessments = 0; let lookups = 0;
  return { deps: { read: async () => { reads++; return { kind: 'unavailable' as const }; },
    assess: async () => { assessments++; return {} as ClimateAssessment; },
    findEvent: async () => { lookups++; return { ...event, provenance: { ...event.provenance, dataKind: DataKind.Reported } }; } },
    counts: () => ({ reads, assessments, lookups }) };
}
const env = { CLIMATE_ASSESSMENT_ADMIN_TOKEN: 'fake-admin', CLIMATE_ASSESSMENT_ALLOWED_ORIGINS: 'https://frontend.test' };
const endpoint = 'https://backend.test/api/climate-assessments';

test('connection feed is read-only and scheduled processing requires operator authorization',async()=>{
  const app=dependencies();let jobs=0;
  const deps={...app.deps,feed:async()=>({events:[],indicators:[],counts:{total:0,pending:0,failed:0,insufficient:0,connections:0},updatedAt:null,historyEnd:null}) as ClimateEventFeed,
    runJob:async()=>{jobs++;return {status:'completed' as const,selection:'study-first' as const,discovered:0,attempted:0,completed:0,insufficient:0,failed:0,modelCalls:0};}};
  assert.equal((await assessmentHttp(new Request('https://backend.test/api/climate-events'),env,deps)).status,200);
  assert.deepEqual(app.counts(),{reads:0,assessments:0,lookups:0});assert.equal(jobs,0);
  const jobUrl='https://backend.test/api/climate-event-jobs?action=refresh';
  assert.equal((await assessmentHttp(new Request(jobUrl,{method:'POST'}),env,deps)).status,401);
  assert.equal((await assessmentHttp(new Request(jobUrl,{method:'POST',headers:{Authorization:'Bearer fake-admin'}}),env,deps)).status,200);assert.equal(jobs,1);
});

test('out-of-window generation is an explicit client error without publishing an assessment', async () => {
  const app = dependencies(); app.deps.assess = async () => { throw new AssessmentError('event_window', 'Outside supported window'); };
  const response = await assessmentHttp(new Request(endpoint, { method: 'POST',
    headers: { Authorization: 'Bearer fake-admin', 'Content-Type': 'application/json' }, body: JSON.stringify({ eventId: event.id }) }), env, app.deps);
  assert.equal(response.status, 400); assert.match(JSON.stringify(await response.json()), /three calendar years/);
});
test('public read never invokes provider lookup, embeddings or assessment generation', async () => {
  const app = dependencies();
  const response = await assessmentHttp(new Request(`${endpoint}?eventId=${event.id}`, { headers: { Origin: 'https://frontend.test' } }), env, app.deps);
  assert.equal(response.status, 200); assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://frontend.test');
  assert.deepEqual(await response.json(), { kind: 'unavailable' }); assert.deepEqual(app.counts(), { reads: 1, assessments: 0, lookups: 0 });
});
test('generation requires operator token and strictly bounded ID-only input', async () => {
  const app = dependencies(); const post = (body: string, token = 'Bearer fake-admin') => new Request(endpoint, { method: 'POST',
    headers: { Authorization: token, 'Content-Type': 'application/json' }, body });
  assert.equal((await assessmentHttp(post('{}', 'wrong'), env, app.deps)).status, 401);
  assert.equal((await assessmentHttp(post(JSON.stringify({ eventId: event.id, event })), env, app.deps)).status, 400);
  assert.equal((await assessmentHttp(post(' '.repeat(2050)), env, app.deps)).status, 413);
  assert.equal((await assessmentHttp(post('not JSON'), env, app.deps)).status, 400);
  assert.deepEqual(app.counts(), { reads: 0, assessments: 0, lookups: 0 });
  assert.equal((await assessmentHttp(post(JSON.stringify({ eventId: event.id, force: true })), env, app.deps)).status, 200);
  assert.deepEqual(app.counts(), { reads: 0, assessments: 1, lookups: 1 });
});
test('unknown origins, invalid IDs and unavailable generation configuration remain explicit', async () => {
  const app = dependencies();
  assert.equal((await assessmentHttp(new Request(`${endpoint}?eventId=${event.id}`, { headers: { Origin: 'https://untrusted.test' } }), env, app.deps)).status, 403);
  assert.equal((await assessmentHttp(new Request(`${endpoint}?eventId=bad`), env, app.deps)).status, 400);
  assert.equal((await assessmentHttp(new Request(`${endpoint}?eventId=${event.id}&eventFingerprint=bad`), env, app.deps)).status, 400);
  assert.equal((await assessmentHttp(new Request(endpoint, { method: 'POST' }), {}, app.deps)).status, 503);
  assert.equal((await assessmentHttp(new Request(endpoint, { method: 'OPTIONS', headers: { Origin: 'https://frontend.test' } }), env, app.deps)).status, 204);
});
