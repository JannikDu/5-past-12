import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDraft, parseReview, resolveClaims, sameEvent } from '../src/services/assessment-validation.ts';
import { assessmentQueries, eventFingerprint, selectAssessmentPassages } from '../src/services/assessment-context.ts';
import { DefaultClimateAssessmentService } from '../src/services/climate-assessment.ts';
import { FeatherlessAssessmentModel } from '../src/data/assessment/featherless.ts';
import { assessmentModelConfig } from '../src/server/config.ts';
import { draftOutputSchema, reviewOutputSchema } from '../src/services/assessment-output-schema.ts';
import { assessmentPassages, parseSelectedDraft } from '../src/services/assessment-passages.ts';
import { citation, draft, event, id, review } from './helpers/assessment-fixtures.ts';
import type { ClimateAssessment } from '../src/domain/climate-assessment.ts';
import { assessmentHistoryWindows, assessmentWindow, withinAssessmentWindow } from '../src/services/assessment-window.ts';
import { BudgetedAssessmentModel } from '../src/services/assessment-discovery.ts';

test('direct evidence uses actual same-event text despite stored general label', () => {
  const result = resolveClaims(parseDraft(draft()), parseReview(review()), event, [citation()]);
  assert.equal(result.humanInfluence, 'high'); assert.equal(result.evidenceStrength, 'high');
  assert.equal(result.claims[0].citations[0].sourceVersionId, citation().sourceVersionId);
  assert.equal(result.claims[0].citations[0].relation, 'direct_attribution');
});
test('malformed fields, unknown IDs, mismatched review and unsupported passages fail closed', () => {
  for (const bad of [{}, { ...draft(), summaryClaimIndex: 99 }, { ...draft(), humanInfluence: 'certain' }]) assert.throws(() => parseDraft(bad));
  const c = citation(); const d = draft(); d.claims[0].citations[0].chunkId = id(99);
  assert.throws(() => resolveClaims(d, review(), event, [c]));
  const fabricated = draft(); fabricated.claims[0].citations[0].passage = 'Warming doubled the probability.';
  assert.throws(() => resolveClaims(fabricated, review(), event, [c]));
  const r = review(); r.claims[0].supported = false;
  assert.throws(() => resolveClaims(draft(), r, event, [c]));
  assert.throws(() => resolveClaims(draft(), { ...review(), claims: [] }, event, [c]));
  assert.throws(() => parseReview({ ...review(), narrativeSupported: 'yes' }));
});
test('historical analogue and metadata labels cannot satisfy direct event gate', () => {
  const c = citation(1, { content: citation().content.replace('Cedar Ridge', 'Elsewhere'), evidenceType: 'direct_attribution' });
  assert.equal(sameEvent(event, c, review().claims[0].citations[0]), false);
  assert.throws(() => resolveClaims(draft(c), review(c), event, [c]));
  const old = citation(1, { content: citation().content.replace(/20\d\d/, '1999') });
  assert.equal(sameEvent(event, old, review().claims[0].citations[0]), false);
  const labelOnly = citation(1, { content: `The Cedar Ridge Wildfire in ${review().claims[0].citations[0].eventTime} was reported in the news.`, evidenceType: 'direct_attribution' });
  assert.equal(sameEvent(event, labelOnly, review().claims[0].citations[0]), false);
  const unnamed = { ...event, title: 'Wildfire in Australia 1032616' };
  const regional = citation(1, { content: citation().content.replace('Cedar Ridge Wildfire', 'Australia Wildfire') });
  assert.equal(sameEvent(unnamed, regional, { ...review().claims[0].citations[0], eventName: 'Australia Wildfire' }), false);
});
test('invented statistics are rejected even if a reviewer incorrectly approves them', () => {
  const d = draft(); d.claims[0].statement = 'Climate change increased event probability by 99%.';
  assert.throws(() => resolveClaims(d, review(), event, [citation()]));
});

test('named-event anchors ignore administrative numbers, punctuation, accents and abbreviated months', () => {
  const named = { ...event, title: 'Cédar-Ridge Wildfire 1032616' };
  assert.equal(sameEvent(named, citation(), review().claims[0].citations[0]), true);
  const short = new Date(event.time.firstObservedAt).toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  const c = citation(1, { content: citation().content.replace(review().claims[0].citations[0].eventTime!, short) });
  const r = review(c); r.claims[0].citations[0].eventTime = short;
  assert.equal(sameEvent(named, c, r.claims[0].citations[0]), true);
  const different = { ...named, title: 'Cedar Valley Wildfire 1032616' };
  assert.equal(sameEvent(different, c, r.claims[0].citations[0]), false);
});

test('dropping record numbers never promotes country-only event identity', () => {
  for (const country of ['Australia', 'Canada', 'Republic of Korea', 'Algeria']) {
    const unnamed = { ...event, title: `Wildfire in ${country} 1032616` };
    const c = citation(1, { content: citation().content.replace('Cedar Ridge', country) });
    const r = review(c); r.claims[0].citations[0].eventName = `${country} Wildfire`;
    assert.equal(sameEvent(unnamed, c, r.claims[0].citations[0]), false);
  }
});

test('three calendar years use an inclusive UTC-day boundary, clamp leap days and exclude old ongoing events', () => {
  const now = new Date('2026-10-09T12:00:00Z');
  assert.deepEqual(assessmentWindow(now), { start: '2023-10-09', end: '2026-10-09' });
  assert.deepEqual(assessmentWindow(new Date('2024-02-29T12:00:00Z')), { start: '2021-02-28', end: '2024-02-29' });
  const dated = (day: string) => ({ ...event, time: { ...event.time, firstObservedAt: `${day}T00:00:00Z` } });
  assert.equal(withinAssessmentWindow(dated('2023-10-09'), now), true);
  assert.equal(withinAssessmentWindow(dated('2023-10-08'), now), false);
  assert.equal(withinAssessmentWindow(dated('2026-10-10'), now), false);
  const windows = [...assessmentHistoryWindows(now)];
  assert.equal(windows[0].end, '2026-10-09'); assert.equal(windows.at(-1)!.start, '2023-10-09');
  for (let i = 1; i < windows.length; i++) assert.equal(Date.parse(windows[i - 1].start) - Date.parse(windows[i].end), 86400000);
});
test('general mechanisms cap evidence at low and cannot establish influence', () => {
  const d = draft(); d.claims[0].type = 'general_mechanism'; d.claims[0].limitations = ['This does not establish conditions during the event.'];
  const r = review(); r.claims[0].citations[0].relation = 'general_context';
  const result = resolveClaims(d, r, event, [citation()]);
  assert.equal(result.humanInfluence, 'none'); assert.equal(result.evidenceStrength, 'low');
});
test('a reported finding about a comparable event is indirect and cannot transfer influence', () => {
  const d = draft(); d.claims[0].limitations = ['The cited study concerns a different event; its result cannot be transferred.'];
  const r = review(); r.claims[0].citations[0].relation = 'analogue_attribution';
  const result = resolveClaims(d, r, event, [citation()]);
  assert.equal(result.humanInfluence, 'none'); assert.equal(result.evidenceStrength, 'medium');
  assert.equal(result.claims[0].citations[0].relation, 'analogue_attribution');
});
test('qualified multi-source synthesis supports indirect connections but never high', () => {
  const d = draft(); d.claims[0].type = 'supported_synthesis'; d.claims[0].limitations = ['Ignition remains unknown.'];
  d.claims[0].citations.push({ chunkId: id(2), passage: citation(2).content });
  const r = review(); r.claims[0].citations[0].relation = 'event_context';
  r.claims[0].citations.push({ chunkId: id(2), relation: 'general_context', eventName: null, eventTime: null });
  const result = resolveClaims(d, r, event, [citation(), citation(2)]);
  assert.equal(result.humanInfluence, 'medium'); assert.equal(result.evidenceStrength, 'medium');
  assert.throws(() => resolveClaims(d, r, event, [citation(), citation(2, { sourceId: citation().sourceId })]));
});
test('contradictory evidence limits levels and requires acknowledged limitations', () => {
  const r = review(); r.claims[0].contradiction = true;
  assert.throws(() => resolveClaims(draft(), r, event, [citation()]));
  const d = draft(); d.claims[0].limitations = ['The reviewed studies disagree on the effect.'];
  const result = resolveClaims(d, r, event, [citation()]);
  assert.equal(result.humanInfluence, 'low'); assert.equal(result.evidenceStrength, 'medium');
  assert.throws(() => resolveClaims(d, { ...r, narrativeSupported: false }, event, [citation()]));
});
test('four queries preserve context without requiring named regions; fingerprint ignores fetch time', async () => {
  const queries = assessmentQueries({ ...event, location: { ...event.location, label: null } });
  assert.equal(queries.length, 4); assert.ok(queries.every(q => q.limit === 12 && !q.region));
  assert.ok(queries[0].text.includes(event.time.firstObservedAt.slice(0, 10)));
  assert.equal(await eventFingerprint(event), await eventFingerprint({ ...event, provenance: { ...event.provenance, fetchedAt: '2026-10-09T00:00:00.000Z' } }));
  assert.notEqual(await eventFingerprint(event), await eventFingerprint({ ...event, title: 'Changed' }));
});
test('passage selection deduplicates chunks/content and prioritizes source diversity', () => {
  const results = Array.from({ length: 30 }, (_, n) => ({ ...citation(n + 1, { content: `Passage ${n}`, sourceId: id(100 + Math.floor(n / 3)) }), similarity: 0.99, score: 1 }));
  const selected = selectAssessmentPassages([results, results]);
  assert.equal(selected.length, 20); assert.equal(new Set(selected.map(c => c.chunkId)).size, 20);
  assert.equal(new Set(selected.slice(0, 10).map(c => c.sourceId)).size, 10);
});

function application(results = [citation()]) {
  let stored: ClimateAssessment | null = null; let calls = 0; let searches = 0; const fingerprint = 'a'.repeat(64);
  const repository = { snapshot: async () => ({ fingerprint, generationId: id(500), maintenance: false }),
    latest: async () => stored ? { assessment: structuredClone(stored), stale: false } : null,
    save: async (a: ClimateAssessment) => { stored = a; } };
  const retrieval = { search: async () => { searches++; return results.map(c => ({ ...c, score: 1, similarity: 1 })); },
    findByChunkId: async (chunkId: string) => results.find(c => c.chunkId === chunkId) ?? null };
  const llm = { model: 'fixture-model', complete: async (): Promise<unknown> => { calls++; return calls % 2 ? draft(results[0]) : review(results[0]); } };
  return { service: new DefaultClimateAssessmentService(repository, retrieval, llm, () => new Date('2026-10-09T12:00:00Z')), repository, retrieval, llm,
    metrics: () => ({ calls, searches, stored }) };
}

test('events outside the three-year window fail before retrieval, persistence or model calls', async () => {
  for (const day of ['2020-01-01', '2099-01-01']) {
    const app = application(); const time = `${day}T00:00:00.000Z`;
    const old = { ...event, observations: [{ ...event.observations[0], time }],
      time: { firstObservedAt: time, lastObservedAt: time, closedAt: null } };
    await assert.rejects(app.service.assess(old), { code: 'event_window' });
    assert.equal(app.metrics().calls, 0); assert.equal(app.metrics().searches, 0); assert.equal(app.metrics().stored, null);
  }
});

test('missing-field repairs respect the hard discovery completion limit and cannot persist partial results', async () => {
  const app = application(); let calls = 0;
  const budget = new BudgetedAssessmentModel({ model: 'fixture', complete: async () => { calls++; return {}; } }, 2);
  const service = new DefaultClimateAssessmentService(app.repository, app.retrieval, budget, () => new Date('2026-10-09T12:00:00Z'));
  await assert.rejects(service.assess(event), { code: 'budget' });
  assert.equal(calls, 2); assert.equal(budget.used, 2); assert.equal(app.metrics().stored, null);
});
test('complete pipeline persists and reuses direct assessments without repeat generation', async () => {
  const app = application(); const assessed = await app.service.assess(event);
  assert.equal(assessed.status, 'completed'); assert.equal(app.metrics().calls, 2); assert.equal(app.metrics().searches, 4);
  assert.equal((await app.service.assess(event)).id, assessed.id); assert.equal(app.metrics().calls, 2);
  await app.service.assess(event, { force: true }); assert.equal(app.metrics().calls, 4);
});
test('no relevant evidence saves honest insufficient result without generation', async () => {
  const app = application([]); const assessed = await app.service.assess(event);
  assert.equal(assessed.status, 'insufficient_evidence'); assert.equal(assessed.humanInfluence, 'none');
  assert.equal(assessed.evidenceStrength, 'none'); assert.deepEqual(assessed.claims, []); assert.equal(app.metrics().calls, 0);
});
test('missing required JSON fields allow at most three attempts and cannot publish partial content', async () => {
  const app = application(); let attempts = 0;
  app.llm.complete = async () => { attempts++; return {}; };
  await assert.rejects(app.service.assess(event)); assert.equal(attempts, 3); assert.equal(app.metrics().stored, null);
});
test('a rejected scientific review stops without regenerating or publishing', async () => {
  const app = application(); let calls = 0;
  app.llm.complete = async (_system?: string, data?: unknown) => {
    calls++;
    assert.ok(data); return calls === 1 ? draft() : { ...review(), narrativeSupported: false };
  };
  await assert.rejects(app.service.assess(event), /unsupported evidence review/);
  assert.equal(calls, 2); assert.equal(app.metrics().stored, null);
});
test('malformed review retries the same validated draft with explicit missing-field feedback', async () => {
  const app = application(); let calls = 0;
  app.llm.complete = async (_system?: string, data?: unknown) => {
    calls++;
    if (calls === 1) return draft();
    if (calls === 2) return { narrativeSupported: true };
    const input = data as { draft: unknown; previousResponse: unknown; previousValidationFailure: string };
    assert.deepEqual(input.draft, draft()); assert.match(input.previousValidationFailure, /Missing required JSON fields: claims/);
    assert.deepEqual(input.previousResponse, { narrativeSupported: true });
    return review();
  };
  assert.equal((await app.service.assess(event)).status, 'completed'); assert.equal(calls, 3);
});
test('wrong values and malformed JSON never trigger another model call', async () => {
  for (const output of [{ ...draft(), humanInfluence: 'certain' }, 'not JSON']) {
    const app = application(); let calls = 0;
    app.llm.complete = async () => { calls++; return output; };
    await assert.rejects(app.service.assess(event)); assert.equal(calls, 1); assert.equal(app.metrics().stored, null);
  }
});
test('extra JSON fields are discarded at every level without model retries or reasoning publication', async () => {
  const d = draft(); const r = review();
  const extraDraft = { ...d, reasoning: 'private', claims: d.claims.map(c => ({ ...c, extra: true,
    citations: c.citations.map(s => ({ ...s, sourceId: 'model-invented', extra: true })) })) };
  const extraReview = { ...r, extra: true, claims: r.claims.map(c => ({ ...c, confidence: 1,
    citations: c.citations.map(s => ({ ...s, extra: true })) })) };
  assert.deepEqual(parseDraft(extraDraft), d); assert.deepEqual(parseReview(extraReview), r);
  const app = application(); let calls = 0;
  app.llm.complete = async () => ++calls === 1 ? extraDraft : extraReview;
  const assessed = await app.service.assess(event); assert.equal(calls, 2);
  assert.ok(!JSON.stringify(assessed).includes('private')); assert.ok(!JSON.stringify(assessed).includes('model-invented'));
});
test('missing draft fields receive exact repair feedback and allow a successful third attempt', async () => {
  const app = application(); let calls = 0;
  app.llm.complete = async (_system?: string, data?: unknown) => {
    calls++; if (calls <= 2) return {};
    if (calls === 3) {
      const input = data as { previousResponse: unknown; previousValidationFailure: string };
      assert.deepEqual(input.previousResponse, {}); assert.match(input.previousValidationFailure, /humanInfluence.*evidenceStrength/);
      return draft();
    }
    return review();
  };
  assert.equal((await app.service.assess(event)).status, 'completed'); assert.equal(calls, 4);
});
test('indirect-only and inapplicable corpora complete the pipeline conservatively', async () => {
  const app = application(); let calls = 0;
  app.llm.complete = async () => {
    calls++; const d = draft(); d.claims[0].type = 'general_mechanism'; d.claims[0].limitations = ['Local conditions are not established.'];
    const r = review(); r.claims[0].citations[0].relation = 'general_context';
    return calls % 2 ? d : r;
  };
  const assessed = await app.service.assess(event);
  assert.equal(assessed.humanInfluence, 'none'); assert.equal(assessed.evidenceStrength, 'low');
  assert.ok(assessed.claims.every(c => c.citations.every(c => c.relation !== 'direct_attribution')));
  const irrelevant = application(); irrelevant.llm.complete = async () => {
    return { humanInfluence: 'none', evidenceStrength: 'none', claims: [], uncertainties: ['Retrieved passages do not establish applicable evidence.'],
      summaryClaimIndex: null, immediateCauseClaimIndex: null, climateConnectionClaimIndex: null };
  };
  let turns = 0; irrelevant.llm.complete = async () => ++turns % 2 ?
    { humanInfluence: 'none', evidenceStrength: 'none', claims: [], uncertainties: ['No applicable research retrieved.'], summaryClaimIndex: null, immediateCauseClaimIndex: null, climateConnectionClaimIndex: null }
    : { narrativeSupported: true, claims: [] };
  assert.equal((await irrelevant.service.assess(event)).status, 'insufficient_evidence');
});
test('immutable identity mismatches and mid-generation corpus changes fail before save', async () => {
  const app = application(); app.retrieval.findByChunkId = async () => citation(1, { sourceVersionId: id(999) });
  await assert.rejects(app.service.assess(event)); assert.equal(app.metrics().calls, 0);
  const changed = application(); let snapshots = 0;
  changed.repository.snapshot = async () => ({ fingerprint: (++snapshots === 1 ? 'a' : 'b').repeat(64), generationId: id(500), maintenance: false });
  await assert.rejects(changed.service.assess(event)); assert.equal(changed.metrics().stored, null);
});
test('missing citations suppress saved assessment and outdated event hashes mark it stale', async () => {
  const app = application(); await app.service.assess(event);
  assert.equal((await app.service.read(event.id, 'b'.repeat(64))).kind, 'available');
  const read = await app.service.read(event.id, 'b'.repeat(64)); assert.ok(read.kind === 'available' && read.stale);
  app.retrieval.findByChunkId = async () => null;
  assert.deepEqual(await app.service.read(event.id), { kind: 'invalid_citations' });
});
test('Featherless requests JSON/non-thinking mode and rejects incomplete/missing/non-JSON responses', async () => {
  for (const response of [ { choices: [] }, { choices: [{ finish_reason: 'length', message: { content: '{}' } }] },
    { choices: [{ finish_reason: 'stop', message: { content: 'not JSON' } }] } ]) {
    const model = new FeatherlessAssessmentModel({ apiKey: 'fake', model: 'Qwen/test', baseUrl: 'https://featherless.test/v1', temperature: 0.1, maxTokens: 4000 },
      { fetch: async (_url, init) => { const body = JSON.parse(String(init?.body)); assert.equal(body.temperature, 0.1);
        assert.deepEqual(body.response_format, { type: 'json_object' }); assert.deepEqual(body.chat_template_kwargs, { enable_thinking: false }); return Response.json(response); }, retries: 0 });
    await assert.rejects(model.complete('Return JSON', {}));
  }
});
test('generation HTTP errors do not trigger hidden transport retries or expose private reasoning', async () => {
  const config = { apiKey: 'fake', model: 'Qwen/test', baseUrl: 'https://featherless.test/v1', temperature: 0.1, maxTokens: 4000 };
  let calls = 0;
  const failing = new FeatherlessAssessmentModel(config, { retries: 3, fetch: async () => { calls++; return new Response('busy', { status: 503 }); } });
  await assert.rejects(failing.complete('Return JSON', {})); assert.equal(calls, 1);
  const valid = new FeatherlessAssessmentModel(config, { fetch: async () => Response.json({ choices: [{ finish_reason: 'stop',
    message: { content: '{"ok":true}', reasoning: 'private', reasoning_content: 'private' } }] }) });
  assert.deepEqual(await valid.complete('Return JSON', {}), { ok: true });
});
test('structured generation declares bounded claim/citation arrays and only retrieved IDs', async () => {
  const ids = [citation().chunkId, citation(2).chunkId];
  for (const schema of [draftOutputSchema(ids), reviewOutputSchema(ids)]) {
    const model = new FeatherlessAssessmentModel({ apiKey: 'fake', model: 'Qwen/test', baseUrl: 'https://featherless.test/v1', temperature: 0.1, maxTokens: 4000 },
      { fetch: async (_url, init) => {
        const format = JSON.parse(String(init?.body)).response_format;
        assert.equal(format.type, 'json_schema'); assert.equal(format.json_schema.strict, true);
        assert.deepEqual(format.json_schema.schema, schema);
        const claims = format.json_schema.schema.properties.claims;
        assert.equal(claims.maxItems, 4); assert.equal(claims.items.additionalProperties, false);
        assert.equal(claims.items.properties.citations.maxItems, 4);
        const properties = claims.items.properties.citations.items.properties;
        assert.deepEqual((properties.passageId ?? properties.chunkId).enum, ids);
        return Response.json({ choices: [{ finish_reason: 'stop', message: { content: '{}' } }] });
      } });
    assert.deepEqual(await model.complete('Return JSON', {}, schema), {});
  }
});
test('model-selected passage IDs resolve to exact source text and cannot inject quotations or source identity', () => {
  const c = citation(); const selected = assessmentPassages([c]); const passageId = [...selected.selections.keys()][0];
  const input = { ...draft(), claims: draft().claims.map(claim => ({ ...claim,
    citations: [{ passageId, passage: 'invented quotation', sourceId: id(999) }] })) };
  const parsed = parseSelectedDraft(input, selected.selections);
  assert.equal(parsed.claims[0].citations[0].chunkId, c.chunkId);
  assert.equal(parsed.claims[0].citations[0].passage, c.content);
  assert.ok(!JSON.stringify(parsed).includes('invented'));
  const bad = structuredClone(input); bad.claims[0].citations[0].passageId = `${id(999)}#0`;
  assert.throws(() => parseSelectedDraft(bad, selected.selections), /Unknown selected passage/);
  const long = citation(2, { content: Array.from({ length: 40 }, (_, i) => `Reported finding ${i} remains limited to the studied region.`).join(' ') });
  const spans = assessmentPassages([long]); assert.ok(spans.selections.size > 1);
  for (const span of spans.selections.values()) { assert.ok(long.content.includes(span.passage)); assert.ok(span.passage.length <= 1200); }
  const empty = { ...draft(), claims: [], summaryClaimIndex: 0, climateConnectionClaimIndex: 0 };
  assert.equal(parseSelectedDraft(empty, selected.selections).summaryClaimIndex, null);
  const missing = { ...empty } as Partial<typeof empty>; delete missing.summaryClaimIndex;
  assert.throws(() => parseSelectedDraft(missing, selected.selections), /Missing required JSON fields/);
});
test('assessment model configuration validates token, temperature and full-passage review deadlines', () => {
  const env = { FEATHERLESS_API_KEY: 'fake' };
  const config = assessmentModelConfig(env); assert.equal(config.temperature, 0.1); assert.equal(config.maxTokens, 4000); assert.equal(config.timeoutMs, 180000);
  assert.throws(() => assessmentModelConfig({ ...env, CLIMATE_ASSESSMENT_TEMPERATURE: 'not-a-number' }));
  assert.throws(() => assessmentModelConfig({ ...env, CLIMATE_ASSESSMENT_MAX_TOKENS: '0' }));
  assert.throws(() => assessmentModelConfig({ ...env, CLIMATE_ASSESSMENT_TIMEOUT_MS: '300001' }));
  assert.equal(assessmentModelConfig({ ...env, CLIMATE_ASSESSMENT_MODEL: 'Qwen/test', CLIMATE_ASSESSMENT_TIMEOUT_MS: '240000' }).model, 'Qwen/test');
});
