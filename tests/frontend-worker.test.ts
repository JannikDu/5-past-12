import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../workers/frontend.ts';
test('same-origin frontend proxy only forwards public reads and keeps operator generation private',async()=>{
  let forwarded=0;let assets=0;
  const env={ASSETS:{fetch:async()=>{assets++;return new Response('website');}},EVIDENCE:{fetch:async(request:Request)=>{forwarded++;assert.equal(request.headers.get('Authorization'),null);return Response.json({events:[]});}}};
  assert.equal((await worker.fetch(new Request('https://frontend.test/'),env)).status,200);assert.equal(assets,1);
  assert.equal((await worker.fetch(new Request('https://frontend.test/api/climate-events',{headers:{Authorization:'private-token'}}),env)).status,200);assert.equal(forwarded,1);
  assert.equal((await worker.fetch(new Request('https://frontend.test/api/climate-assessments',{method:'POST'}),env)).status,405);
  assert.equal((await worker.fetch(new Request('https://frontend.test/api/climate-event-jobs?action=run'),env)).status,404);assert.equal(forwarded,1);
});
