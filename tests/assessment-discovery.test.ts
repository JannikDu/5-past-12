import assert from 'node:assert/strict';
import test from 'node:test';
import { BudgetedAssessmentModel, discoverAssessmentConnections, discoveryPriority, discoveryResumeIds, type DiscoveryService } from '../src/services/assessment-discovery.ts';
import { AssessmentError, assessmentVersion, type ClimateAssessment } from '../src/domain/climate-assessment.ts';
import type { ClimateEvent } from '../src/domain/climate-event.ts';
import { resolveClaims } from '../src/services/assessment-validation.ts';
import { citation, draft, event, id, review } from './helpers/assessment-fixtures.ts';

const now = new Date('2026-10-09T12:00:00Z');
const candidate = (n: number): ClimateEvent => ({ ...event, id: `eonet:EONET_${n}`, title: `Named event ${n}` });
async function* events(values: ClimateEvent[]) { yield* values; }
function assessment(e: ClimateEvent, connection = true): ClimateAssessment {
  const d = draft(); d.humanInfluence = 'none'; d.evidenceStrength = 'low'; d.claims[0].type = 'general_mechanism';
  d.claims[0].limitations = ['The mechanism has not been established during this event.'];
  const r = review(); r.claims[0].citations[0].relation = 'general_context';
  const verified = resolveClaims(d, r, e, [citation()]);
  return { ...verified, id: id(500), eventId: e.id, summary: d.claims[0].statement, immediateCause: null,
    climateConnection: d.claims[0].statement, uncertainties: ['Event-specific influence is not established.'],
    status: 'completed', assessedAt: now.toISOString(), model: 'fixture', assessmentVersion,
    eventFingerprint: 'a'.repeat(64), corpusFingerprint: 'b'.repeat(64),
    ...(!connection ? { claims: [], status: 'insufficient_evidence' as const, humanInfluence: 'none' as const,
      evidenceStrength: 'none' as const, summary: 'Insufficient evidence.', climateConnection: null } : {}) };
}

test('progressive discovery continues after insufficient evidence, counts indirect findings with influence none and stops at target', async () => {
  const calls: string[] = []; const progress: string[] = []; let remaining = 6; let active = 0;
  const service: DiscoveryService = { read: async () => ({ kind: 'unavailable' }), assess: async e => {
    assert.equal(++active, 1); await Promise.resolve(); active--; remaining -= 2; calls.push(e.id);
    return assessment(e, e.id !== candidate(1).id);
  } };
  const report = await discoverAssessmentConnections(events([candidate(1), candidate(2), candidate(3)]), service,
    { model: 'fixture', now, remainingCalls: () => remaining, onResult: result => { progress.push(result.kind); } });
  assert.deepEqual(progress, ['insufficient_evidence', 'connection']); assert.equal(calls.length, 2);
  assert.equal(report.stopReason, 'target'); assert.equal(report.outcomes[1].assessment!.humanInfluence, 'none');
  assert.equal(report.outcomes[1].assessment!.claims[0].citations[0].relation, 'general_context');
});

test('scientific rejection is reported once and discovery proceeds to a different event', async () => {
  const calls: string[] = [];
  const service: DiscoveryService = { read: async () => ({ kind: 'unavailable' }), assess: async e => {
    calls.push(e.id); if (e.id === candidate(1).id) throw new AssessmentError('support', 'Unsupported draft'); return assessment(e);
  } };
  const report = await discoverAssessmentConnections(events([candidate(1), candidate(2)]), service,
    { model: 'fixture', now, remainingCalls: () => 6 });
  assert.deepEqual(calls, [candidate(1).id, candidate(2).id]); assert.equal(report.outcomes[0].errorCode, 'support');
  assert.equal(report.outcomes[0].validationFailure, 'Unsupported draft'); assert.equal(report.stopReason, 'target');
});

test('compatible saved findings remain reusable without any model-call budget', async () => {
  const service: DiscoveryService = { read: async eventId => ({ kind: 'available', assessment: assessment({ ...candidate(1), id: eventId }, eventId === candidate(2).id), stale: false }),
    assess: async () => { throw new Error('No generation expected'); } };
  const report = await discoverAssessmentConnections(events([candidate(1), candidate(2)]), service,
    { model: 'fixture', now, remainingCalls: () => 0 });
  assert.equal(report.stopReason, 'target'); assert.equal(report.outcomes.length, 2); assert.ok(report.outcomes.every(o => o.reused));
});

test('stale results and mismatched models require budget; an incomplete pair never starts', async () => {
  let calls = 0;
  for (const stale of [false, true]) {
    const service: DiscoveryService = { read: async () => ({ kind: 'available', assessment: { ...assessment(candidate(1)), model: 'old-model' }, stale }),
      assess: async e => { calls++; return assessment(e); } };
    const report = await discoverAssessmentConnections(events([candidate(1)]), service, { model: 'fixture', now, remainingCalls: () => 1 });
    assert.equal(report.stopReason, 'model_budget'); assert.equal(report.outcomes.length, 0);
  }
  assert.equal(calls, 0);
});

test('duplicates and out-of-window events are skipped and candidate limits bound failed reads', async () => {
  let generated = 0;
  const old = { ...candidate(99), time: { ...event.time, firstObservedAt: '2020-01-01T00:00:00Z' } };
  const future = { ...candidate(100), time: { ...event.time, firstObservedAt: '2099-01-01T00:00:00Z' } };
  const service: DiscoveryService = { read: async () => ({ kind: 'unavailable' }), assess: async e => { generated++; return assessment(e, false); } };
  const report = await discoverAssessmentConnections(events([old, candidate(1), candidate(1), future, candidate(2)]), service,
    { model: 'fixture', now, remainingCalls: () => 6, maxCandidates: 2 });
  assert.equal(generated, 2); assert.equal(report.skipped, 3); assert.equal(report.stopReason, 'candidate_limit');
  let reads = 0;
  const failing: DiscoveryService = { read: async () => { reads++; throw new Error('Database unavailable'); }, assess: service.assess };
  const bounded = await discoverAssessmentConnections(events([candidate(1), candidate(2), candidate(3)]), failing,
    { model: 'fixture', now, remainingCalls: () => 6, maxCandidates: 2 });
  assert.equal(reads, 2); assert.equal(bounded.outcomes.length, 2); assert.equal(bounded.stopReason, 'candidate_limit');
});

test('hard completion budgets include failed provider requests and prevent further calls', async () => {
  let calls = 0;
  const budget = new BudgetedAssessmentModel({ model: 'fixture', complete: async () => { calls++; throw new AssessmentError('provider', 'Unavailable'); } }, 2);
  await assert.rejects(budget.complete('draft', {}), { code: 'provider' });
  await assert.rejects(budget.complete('draft', {}), { code: 'provider' });
  await assert.rejects(budget.complete('draft', {}), { code: 'budget' });
  assert.equal(calls, 2); assert.equal(budget.used, 2); assert.equal(budget.remaining, 0);
});

test('invalid discovery limits are rejected before candidate processing', async () => {
  const service: DiscoveryService = { read: async () => ({ kind: 'unavailable' }), assess: async e => assessment(e) };
  for (const target of [0, 1.5, 21]) await assert.rejects(discoverAssessmentConnections(events([]), service, { model: 'fixture', now, target, remainingCalls: () => 0 }));
  for (const limit of [-1, 0.5, 61]) assert.throws(() => new BudgetedAssessmentModel({ model: 'fixture', complete: async () => ({}) }, limit));
});

test('publication metadata only orders candidates; it does not produce an assessment or influence level', () => {
  const named = { ...candidate(1), title: 'Hurricane Helene 12345' };
  assert.equal(discoveryPriority(named, ['Climate change influenced rainfall during Hurricane Helene']), 1);
  assert.equal(discoveryPriority(named, ['Climate change influenced Hurricane Milton']), 0);
  assert.equal(discoveryPriority({ ...named, title: 'Unnamed storm 12345' }, ['A scientific report']), 0);
});

test('resume reports retain cumulative attempted IDs and reject malformed records before searching', () => {
  assert.deepEqual(discoveryResumeIds({ mode: 'preview', outcomes: [{ eventId: candidate(1).id }] }), [candidate(1).id]);
  assert.deepEqual(discoveryResumeIds({ mode: 'persisted', processedEventIds: [candidate(1).id, candidate(1).id, candidate(2).id] }), [candidate(1).id, candidate(2).id]);
  for (const bad of [null, {}, { mode: 'preview', outcomes: [{}] }, { mode: 'preview', processedEventIds: ['invalid'] },
    { mode: 'preview', outcomes: 'invalid' }, { mode: 'other', processedEventIds: [] }]) assert.throws(() => discoveryResumeIds(bad));
});
