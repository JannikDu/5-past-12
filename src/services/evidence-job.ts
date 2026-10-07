import { EvidenceError, type ProcessingProfile, type ProviderProgress, type WorkLane } from '../domain/evidence.ts';
import type { EvidenceRepository } from '../data/repositories/evidence-repository.ts';
import type { EvidenceLogger } from '../server/logging.ts';
import type { RegisteredEvidenceProvider } from './evidence-ingestion.ts';

export interface ProviderRunSummary {
  providerId: string; status: 'complete' | 'incomplete' | 'failed' | 'already-running' | 'maintenance';
  fetched: number; normalized: number; skipped: number; stored: number; unchanged: number; invalid: number; failed: number; chunks: number;
  insertedSources: number; updatedSources: number; retainedVersions: number;
  lanes: Record<WorkLane, number>; errors: { itemId?: string; code: string }[]; durationMs: number;
}
export interface JobOptions { maxItems?: number; maxPages?: number; overlapDays?: number; recheckDays?: number; providerTimeoutMs?: number; jobTimeoutMs?: number; now?: () => Date }
export class EvidenceIngestionJob {
  constructor(private readonly providers: RegisteredEvidenceProvider[], private readonly repository: EvidenceRepository,
    private readonly profile: ProcessingProfile, private readonly logger: EvidenceLogger, private readonly options: JobOptions = {}) {}
  async run(signal?: AbortSignal): Promise<{ runId: string; providers: ProviderRunSummary[] }> {
    const runId = crypto.randomUUID(); const providers: ProviderRunSummary[] = [];
    const now = this.options.now ?? (() => new Date());
    const deadline = AbortSignal.timeout(this.options.jobTimeoutMs ?? 300000);
    for (const provider of this.providers) {
      const started = Date.now(); const owner = crypto.randomUUID();
      const summary: ProviderRunSummary = { providerId: provider.id, status: 'complete', fetched: 0, normalized: 0, skipped: 0, stored: 0, unchanged: 0, invalid: 0, failed: 0, chunks: 0,
        insertedSources: 0, updatedSources: 0, retainedVersions: 0,
        lanes: { discovery: 0, backfill: 0, recheck: 0, pending: 0 }, errors: [], durationMs: 0 };
      this.logger.info('provider-start', { runId, providerId: provider.id });
      let lease: Awaited<ReturnType<EvidenceRepository['acquireLease']>> = null;
      try {
        const generation = await this.repository.ensureGeneration(this.profile);
        lease = await this.repository.acquireLease(provider.id, owner, 600);
        if (!lease) { summary.status = 'already-running'; continue; }
        const progress: ProviderProgress = structuredClone(lease.progress);
        const date = now();
        if (!progress.recheckThrough && (!progress.recheckAfter || date.toISOString() >= progress.recheckAfter)) {
          progress.recheckThrough = date.toISOString(); progress.recheckCursor = null;
        }
        const maxItems = this.options.maxItems ?? 20;
        const known = progress.recheckThrough ? await this.repository.knownItems(provider.id, progress.recheckCursor, progress.recheckThrough, Math.max(1, Math.floor(maxItems / 3))) : [];
        const recheck = known.map(item => item.itemId);
        const timeout = AbortSignal.timeout(this.options.providerTimeoutMs ?? 120000);
        const combined = AbortSignal.any([deadline, timeout, ...(signal ? [signal] : [])]);
        const pass = await provider.run({ since: progress.since, state: progress.state, replay: progress.pending, recheck,
          publicationDates: Object.fromEntries(known.map(item => [item.itemId, item.publishedAt])),
          maxItems, maxPages: this.options.maxPages ?? 10, overlapDays: this.options.overlapDays ?? 7, signal: combined }, generation, lease);
        summary.fetched = pass.fetched; summary.skipped = pass.batch.skipped; summary.unchanged += pass.batch.unchanged ?? 0;
        const pending = new Set(progress.pending);
        for (const outcome of pass.outcomes) {
          summary[outcome.status]++; summary.chunks += outcome.chunks; summary.lanes[outcome.lane]++;
          if (outcome.normalized) summary.normalized++;
          if (outcome.status === 'stored') { if (outcome.sourceCreated) summary.insertedSources++; else summary.updatedSources++; }
          if (outcome.versionCreated) summary.retainedVersions++;
          this.logger.info('item-outcome', { runId, providerId: provider.id, itemId: outcome.itemId, lane: outcome.lane, status: outcome.status, error: outcome.error, chunks: outcome.chunks });
          if (outcome.status === 'failed') { pending.add(outcome.itemId); summary.errors.push({ itemId: outcome.itemId, code: outcome.error ?? 'processing' }); }
          else pending.delete(outcome.itemId);
        }
        for (const failure of pass.batch.failures) {
          summary.failed++; summary.errors.push({ itemId: failure.itemId, code: failure.code });
          this.logger.info('fetch-failure', { runId, providerId: provider.id, itemId: failure.itemId, lane: failure.lane, error: failure.code });
          if (failure.itemId) pending.add(failure.itemId);
        }
        for (const skipped of pass.batch.skippedItems ?? []) {
          if (skipped.itemId) pending.delete(skipped.itemId);
          this.logger.info('item-skipped', { runId, providerId: provider.id, itemId: skipped.itemId, lane: skipped.lane, error: skipped.code });
        }
        progress.pending = [...pending]; progress.state = pass.batch.state;
        if (pass.batch.complete.discovery && !pass.outcomes.some(o => o.lane === 'discovery' && o.status === 'failed') && !pass.batch.failures.some(f => f.lane === 'discovery')) progress.since = date.toISOString();
        // Advance only the represented prefix. Failed identities remain in the
        // durable replay set and must not block rechecks of every later article.
        const resolved = new Set(pass.outcomes.filter(o => o.status !== 'failed').map(o => o.itemId));
        for (const skipped of pass.batch.skippedItems ?? []) if (skipped.itemId) resolved.add(skipped.itemId);
        if (progress.recheckThrough) {
          for (const id of recheck) {
            if (!resolved.has(id) && !pending.has(id)) break;
            progress.recheckCursor = id;
          }
          if (!recheck.length && pass.batch.complete.recheck) { progress.recheckThrough = null; progress.recheckCursor = null; progress.recheckAfter = new Date(date.getTime() + (this.options.recheckDays ?? 7) * 86400000).toISOString(); }
        }
        await this.repository.checkpoint(lease, progress); lease = null;
        summary.status = summary.failed || pending.size ? 'failed' : Object.values(pass.batch.complete).every(Boolean) ? 'complete' : 'incomplete';
      } catch (error) {
        const code = error instanceof EvidenceError ? error.code : 'job';
        summary.status = code === 'maintenance' ? 'maintenance' : 'failed';
        if (summary.status === 'failed') { summary.failed++; summary.errors.push({ code }); }
      } finally {
        // A failed pass keeps its previous durable checkpoint; expiry permits safe replay.
        if (lease) { try { await this.repository.checkpoint(lease, lease.progress); } catch { /* fencing/expiry requires next owner to replay */ } }
        summary.durationMs = Date.now() - started; providers.push(summary);
        this.logger.info('provider-finish', { runId, ...summary });
      }
    }
    return { runId, providers };
  }
}
