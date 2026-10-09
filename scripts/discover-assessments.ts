import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { EventCategory, type ClimateEvent } from '../src/domain/climate-event.ts';
import { EonetProvider } from '../src/data/providers/eonet.ts';
import { createAssessmentServices } from '../src/server/assessment.ts';
import { DefaultClimateAssessmentService } from '../src/services/climate-assessment.ts';
import { BudgetedAssessmentModel, discoverAssessmentConnections, discoveryPriority, discoveryResumeIds } from '../src/services/assessment-discovery.ts';
import { assessmentHistoryWindows, assessmentWindow, withinAssessmentWindow } from '../src/services/assessment-window.ts';
import { AssessmentError } from '../src/domain/climate-assessment.ts';
import { EvidenceError } from '../src/domain/evidence.ts';

try {
  const defaults = { target: 1, 'max-model-calls': 6, 'max-candidates': 30, category: 'storm' };
  const options: Record<string, string> = {}; let preview = false;
  for (const argument of process.argv.slice(2)) {
    if (argument === '--preview' && !preview) { preview = true; continue; }
    const match = /^--(target|max-model-calls|max-candidates|category|resume)=(.+)$/.exec(argument);
    if (!match || options[match[1]] !== undefined) throw new Error('Usage: pnpm climate:discover [--preview] [--resume=<report.json>] [--target=1] [--max-model-calls=6] [--max-candidates=30] [--category=storm|wildfire|flood|temperature|drought]');
    options[match[1]] = match[2];
  }
  const integer = (name: 'target' | 'max-model-calls' | 'max-candidates', minimum: number, maximum: number) => {
    const raw = options[name] ?? String(defaults[name]); const value = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`Invalid --${name}`);
    return value;
  };
  const target = integer('target', 1, 20); const maxModelCalls = integer('max-model-calls', 0, 60); const maxCandidates = integer('max-candidates', 1, 200);
  const categories: Record<string, EventCategory> = { storm: EventCategory.Storm, wildfire: EventCategory.Wildfire,
    flood: EventCategory.Flood, temperature: EventCategory.Temperature, drought: EventCategory.Drought };
  const category = categories[options.category ?? defaults.category]; if (!category) throw new Error('Unsupported discovery category');
  let previousEventIds: string[] = [];
  if (options.resume) {
    previousEventIds = discoveryResumeIds(JSON.parse(await readFile(options.resume, 'utf8')));
  }
  const now = new Date(); const startedAt = now.toISOString(); const started = performance.now();
  const services = createAssessmentServices(process.env);
  const budget = new BudgetedAssessmentModel(services.model, maxModelCalls);
  const repository = preview ? { snapshot: () => services.repository.snapshot(), latest: (eventId: string) => services.repository.latest(eventId),
    save: async () => { /* Validated results are retained only in the local report. */ } } : services.repository;
  const service = new DefaultClimateAssessmentService(repository, services.retrieval, budget);
  const titles = await services.evidenceRepository.discoveryPublicationTitles(); const provider = new EonetProvider();
  console.info(JSON.stringify({ phase: 'discovery-start', mode: preview ? 'preview' : 'persisted', window: assessmentWindow(now), category, target, maxModelCalls, maxCandidates,
    previousCandidatesExcluded: previousEventIds.length,
    selection: 'publication title overlap prioritizes candidates; scientific support is validated from passages' }));
  async function* candidates(): AsyncGenerator<ClimateEvent> {
    const fallback: ClimateEvent[] = []; const seen = new Set<string>(previousEventIds);
    for (const window of assessmentHistoryWindows(now)) {
      const batch = await provider.fetchEvents({ ...window, category, limit: 100 });
      console.info(JSON.stringify({ phase: 'candidate-window', ...window, records: batch.events.length, excludedMalformed: batch.skipped }));
      for (const event of batch.events) {
        if (seen.has(event.id) || !withinAssessmentWindow(event, now)) continue; seen.add(event.id);
        if (discoveryPriority(event, titles)) yield event;
        else if (fallback.length < maxCandidates) fallback.push(event);
      }
    }
    for (const event of fallback) yield event;
  }
  const report = await discoverAssessmentConnections(candidates(), service, { model: budget.model, target, maxCandidates,
    onCandidate: event => { console.info(JSON.stringify({ phase: 'candidate-check', eventId: event.id, title: event.title, modelCallsRemaining: budget.remaining })); },
    now, remainingCalls: () => budget.remaining, onResult: outcome => {
      console.info(JSON.stringify({ phase: 'candidate-result', eventId: outcome.eventId, title: outcome.title, kind: outcome.kind,
        reused: outcome.reused, elapsedMs: outcome.elapsedMs, modelCallsUsed: budget.used, modelCallsRemaining: budget.remaining,
        humanInfluence: outcome.assessment?.humanInfluence, evidenceStrength: outcome.assessment?.evidenceStrength,
        claims: outcome.assessment?.claims.length, errorCode: outcome.errorCode, validationFailure: outcome.validationFailure,
        detailUrl: `/events/detail?id=${encodeURIComponent(outcome.eventId)}` }));
    } });
  await mkdir('.devswarm-temp/assessments', { recursive: true });
  const path = `.devswarm-temp/assessments/discovery-${startedAt.replace(/[:.]/g, '-')}.json`;
  const matches = report.outcomes.filter(r => r.kind === 'connection').map(r => ({ eventId: r.eventId,
    assessmentId: r.assessment!.id, detailUrl: `/events/detail?id=${encodeURIComponent(r.eventId)}`, humanReview: 'pending' }));
  await writeFile(path, JSON.stringify({ ...report, mode: preview ? 'preview' : 'persisted', category, startedAt, finishedAt: new Date().toISOString(), elapsedMs: Math.round(performance.now() - started),
    modelCallsUsed: budget.used, modelCallBudget: budget.limit, matches,
    processedEventIds: [...new Set([...previousEventIds, ...report.outcomes.map(o => o.eventId)])], resumeReport: options.resume ?? null,
    selectionNotice: 'This is a selected collection of cited connections, not an estimate of attribution frequency. Insufficient and failed outcomes are retained.' }, null, 2));
  console.info(JSON.stringify({ phase: 'discovery-complete', stopReason: report.stopReason, matches, examined: report.examined,
    modelCallsUsed: budget.used, elapsedMs: Math.round(performance.now() - started), report: path }));
} catch (error) {
  console.error(error instanceof AssessmentError || error instanceof EvidenceError ? `${error.code}: ${error.message}` : (error as Error).message);
  process.exitCode = 1;
}
