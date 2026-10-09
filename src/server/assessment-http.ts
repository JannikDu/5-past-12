import { findEvent } from '../data/events.ts';
import { parseEventId, DataKind, type ClimateEvent } from '../domain/climate-event.ts';
import { AssessmentError, hash, type AssessmentRead, type ClimateAssessment } from '../domain/climate-assessment.ts';
import { EvidenceError } from '../domain/evidence.ts';
import { createAssessmentReader, createAssessmentServices } from './assessment.ts';
import { createEventCatalog, createEventJob } from './climate-events.ts';
import type { ClimateEventFeed } from '../domain/climate-event-feed.ts';
import type { EventJobSummary } from '../services/climate-event-job.ts';

type Env = Record<string, string | undefined>;
export interface AssessmentHttpDependencies {
  read(env: Env, eventId: string, fingerprint?: string): Promise<AssessmentRead>;
  assess(env: Env, event: ClimateEvent, force: boolean): Promise<ClimateAssessment>;
  findEvent(id: string): Promise<ClimateEvent | null>;
  feed?(env:Env):Promise<ClimateEventFeed>;
  runJob?(env:Env,options:{refreshOnly:boolean}):Promise<EventJobSummary>;
}
const defaults: AssessmentHttpDependencies = {
  read: (env, id, fingerprint) => createAssessmentReader(env).read(id, fingerprint),
  assess: (env, event, force) => createAssessmentServices(env).service.assess(event, { force }), findEvent,
};
export async function assessmentHttp(request: Request, env: Env, deps = defaults): Promise<Response> {
  const url = new URL(request.url);
  if (!['/api/climate-assessments','/api/climate-events','/api/climate-event-jobs'].includes(url.pathname)) return Response.json({ error: 'Not found' }, { status: 404 });
  const origin = request.headers.get('Origin');
  const allowed = (env.CLIMATE_ASSESSMENT_ALLOWED_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const headers = new Headers({ 'Cache-Control': 'no-store', Vary: 'Origin' });
  if (origin) {
    if (!allowed.includes(origin) && origin !== url.origin) return Response.json({ error: 'Origin unavailable' }, { status: 403, headers });
    headers.set('Access-Control-Allow-Origin', origin);
  }
  const respond = (data: unknown, status = 200) => Response.json(data, { status, headers });
  if (request.method === 'OPTIONS') {
    headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    return new Response(null, { status: 204, headers });
  }
  if (!['GET', 'POST'].includes(request.method)) { headers.set('Allow', 'GET, POST, OPTIONS'); return respond({ error: 'Method unavailable' }, 405); }
  try {
    if (request.method === 'GET') {
      if(url.pathname==='/api/climate-events')return respond(await (deps.feed?deps.feed(env):createEventCatalog(env).feed()));
      if(url.pathname==='/api/climate-event-jobs')return respond({error:'Operator POST required'},405);
      const ids = url.searchParams.getAll('eventId'); const hashes = url.searchParams.getAll('eventFingerprint');
      if (ids.length !== 1 || ids[0].length > 240 || !parseEventId(ids[0]) || hashes.length > 1) return respond({ error: 'Invalid event ID or fingerprint' }, 400);
      const fingerprint = hashes.length ? hash(hashes[0]) : undefined;
      return respond(await deps.read(env, ids[0], fingerprint));
    }
    const token = env.CLIMATE_ASSESSMENT_ADMIN_TOKEN?.trim();
    if (!token) return respond({ error: 'Assessment generation is not configured' }, 503);
    const authorization = request.headers.get('Authorization') ?? '';
    // Hash both tokens for a fixed-length comparison; never log credentials.
    const digest = async (v: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v)));
    const [expected, supplied] = await Promise.all([digest(`Bearer ${token}`), digest(authorization)]);
    if (expected.reduce((difference, byte, i) => difference | (byte ^ supplied[i]), 0) !== 0) return respond({ error: 'Operator authorization required' }, 401);
    if(url.pathname==='/api/climate-events')return respond({error:'Read-only event feed'},405);
    if(url.pathname==='/api/climate-event-jobs') {
      if(!['refresh','run'].includes(url.searchParams.get('action')??''))return respond({error:'Specify action=refresh or action=run'},400);
      const options={refreshOnly:url.searchParams.get('action')==='refresh'};
      return respond(await (deps.runJob?deps.runJob(env,options):createEventJob(env).run(options)));
    }
    if (!request.headers.get('Content-Type')?.startsWith('application/json')) return respond({ error: 'JSON required' }, 415);
    // Cap actual streamed bytes as well as the optional Content-Length header.
    if (Number(request.headers.get('Content-Length')) > 2048) return respond({ error: 'Request too large' }, 413);
    const reader = request.body?.getReader(); const decoder = new TextDecoder(); let body = ''; let bytes = 0;
    if (reader) try { while (true) {
      const part = await reader.read(); if (part.done) break;
      bytes += part.value.byteLength; if (bytes > 2048) { await reader.cancel(); return respond({ error: 'Request too large' }, 413); }
      body += decoder.decode(part.value, { stream: true });
    } } finally { reader.releaseLock(); }
    body += decoder.decode();
    let input: Record<string, unknown>;
    try { const value: unknown = JSON.parse(body); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); input = value as Record<string, unknown>; }
    catch { return respond({ error: 'Invalid JSON' }, 400); }
    if (Object.keys(input).some(k => !['eventId', 'force'].includes(k)) || typeof input.eventId !== 'string' || input.eventId.length > 240 ||
      !parseEventId(input.eventId) || (input.force !== undefined && typeof input.force !== 'boolean')) return respond({ error: 'Invalid generation request' }, 400);
    const event = await deps.findEvent(input.eventId);
    if (!event) return respond({ error: 'Event not found' }, 404);
    if (event.provenance.dataKind === DataKind.Demo) return respond({ error: 'Fictional events cannot receive published scientific assessments' }, 400);
    return respond({ kind: 'available', assessment: await deps.assess(env, event, input.force === true), stale: false });
  } catch (error) {
    const conflict = error instanceof AssessmentError && error.code === 'conflict';
    const outsideWindow = error instanceof AssessmentError && error.code === 'event_window';
    const validation = outsideWindow || (error instanceof AssessmentError && error.code === 'validation' && request.method === 'GET');
    const status = validation ? 400 : conflict ? 409 : 503;
    console.error(JSON.stringify({ operation: 'climate-assessment', status,
      code: error instanceof AssessmentError || error instanceof EvidenceError ? error.code : 'unavailable' }));
    return respond({ error: conflict ? 'Evidence changed. Retry explicit assessment.' : outsideWindow ? 'Select an event from the last three calendar years.' : validation ? 'Invalid fingerprint' : 'Assessment is unavailable. No unverified result was published.' }, status);
  }
}
