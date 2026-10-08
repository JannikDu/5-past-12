import { parseEventId, type ClimateEvent } from '../domain/climate-event.ts';
import { AssessmentError, parseAssessment, type AssessmentRead, type ClimateAssessment } from '../domain/climate-assessment.ts';
import type { AssessmentModel } from '../data/assessment/featherless.ts';
import { eventFingerprint } from './assessment-context.ts';
import { assessmentWindow, withinAssessmentWindow } from './assessment-window.ts';

/** Count actual completion requests, including missing-field repairs and errors. */
export class BudgetedAssessmentModel implements AssessmentModel {
  readonly model: string;
  private requests = 0;
  constructor(private readonly inner: AssessmentModel, readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 0 || limit > 60) throw new TypeError('Model-call budget must be an integer from 0 to 60');
    this.model = inner.model;
  }
  get used() { return this.requests; }
  get remaining() { return this.limit - this.requests; }
  async complete(system: string, data: unknown, schema?: Record<string, unknown>): Promise<unknown> {
    if (!this.remaining) throw new AssessmentError('budget', 'Discovery model-call budget exhausted');
    this.requests++;
    return this.inner.complete(system, data, schema);
  }
}
export interface DiscoveryService {
  read(eventId: string, fingerprint?: string): Promise<AssessmentRead>;
  assess(event: ClimateEvent): Promise<ClimateAssessment>;
}
export interface DiscoveryOutcome {
  eventId: string; title: string; kind: 'connection' | 'insufficient_evidence' | 'generation_failed';
  reused: boolean; elapsedMs: number; assessment?: ClimateAssessment; errorCode?: string; validationFailure?: string;
}
export interface DiscoveryReport {
  window: { start: string; end: string }; examined: number; skipped: number;
  stopReason: 'target' | 'model_budget' | 'candidate_limit' | 'exhausted';
  outcomes: DiscoveryOutcome[];
}
/** Resume selection, not scientific evidence or permission to publish claims. */
export function discoveryResumeIds(value: unknown): string[] {
  if (!value || typeof value !== 'object') throw new TypeError('Invalid discovery resume report');
  const report = value as { mode?: unknown; processedEventIds?: unknown; outcomes?: unknown };
  const ids = report.processedEventIds ?? (Array.isArray(report.outcomes)
    ? report.outcomes.map(outcome => outcome && typeof outcome === 'object' && 'eventId' in outcome ? outcome.eventId : null) : null);
  if (!['preview', 'persisted'].includes(String(report.mode)) || !Array.isArray(ids) || ids.length > 10000
    || ids.some(id => typeof id !== 'string' || !parseEventId(id))) throw new TypeError('Invalid discovery resume report');
  return [...new Set(ids as string[])];
}
export async function discoverAssessmentConnections(candidates: AsyncIterable<ClimateEvent>, service: DiscoveryService,
  options: { model: string; target?: number; maxCandidates?: number; remainingCalls: () => number; now?: Date;
    onCandidate?: (event: ClimateEvent) => void | Promise<void>;
    onResult?: (result: DiscoveryOutcome) => void | Promise<void> }): Promise<DiscoveryReport> {
  const target = options.target ?? 1; const maxCandidates = options.maxCandidates ?? 30; const now = options.now ?? new Date();
  if (!Number.isInteger(target) || target < 1 || target > 20 || !Number.isInteger(maxCandidates) || maxCandidates < 1 || maxCandidates > 200)
    throw new TypeError('Invalid discovery target or candidate limit');
  const report: DiscoveryReport = { window: assessmentWindow(now), examined: 0, skipped: 0, stopReason: 'exhausted', outcomes: [] };
  const seen = new Set<string>(); let connections = 0;
  for await (const event of candidates) {
    if (seen.has(event.id) || !withinAssessmentWindow(event, now)) { report.skipped++; continue; }
    seen.add(event.id);
    if (report.examined >= maxCandidates) { report.stopReason = 'candidate_limit'; break; }
    report.examined++;
    await options.onCandidate?.(event);
    const start = performance.now(); let reused = false; let outcome: DiscoveryOutcome;
    try {
      const current = await service.read(event.id, await eventFingerprint(event));
      reused = current.kind === 'available' && !current.stale && current.assessment.model === options.model;
      if (!reused && options.remainingCalls() < 2) { report.stopReason = 'model_budget'; break; }
      const assessment = parseAssessment(reused && current.kind === 'available' ? current.assessment : await service.assess(event));
      if (assessment.eventId !== event.id) throw new AssessmentError('support', 'Discovery assessment event mismatch');
      outcome = { eventId: event.id, title: event.title, reused, elapsedMs: Math.round(performance.now() - start), assessment,
        kind: assessment.status === 'completed' && assessment.claims.length ? 'connection' : 'insufficient_evidence' };
    } catch (error) {
      // No provider bodies or model responses; keep deterministic validator reasons.
      outcome = { eventId: event.id, title: event.title, kind: 'generation_failed', reused, elapsedMs: Math.round(performance.now() - start),
        errorCode: error instanceof AssessmentError ? error.code : 'unavailable',
        validationFailure: error instanceof AssessmentError && ['validation', 'support', 'event_window', 'budget'].includes(error.code) ? error.message : undefined };
    }
    report.outcomes.push(outcome); await options.onResult?.(outcome);
    if (outcome.kind === 'connection' && ++connections >= target) { report.stopReason = 'target'; break; }
    if (report.examined >= maxCandidates) { report.stopReason = 'candidate_limit'; break; }
  }
  return report;
}

/** Publication-title overlap prioritizes candidates; it never grades evidence. */
export function discoveryPriority(event: ClimateEvent, publicationTitles: string[]): number {
  const words = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().match(/[\p{L}]+/gu) ?? [];
  const generic = new Set('wildfire wildfires fire fires flood floods storm storms hurricane typhoon tropical cyclone severe extreme heat temperature drought in the of and republic'.split(' '));
  const identity = words(event.title).filter(w => w.length > 2 && !generic.has(w));
  if (!identity.length) return 0;
  return publicationTitles.some(title => { const supplied = new Set(words(title)); return identity.every(w => supplied.has(w)); }) ? 1 : 0;
}
