import { isClimateEvent, type ClimateEvent } from '../domain/climate-event.ts';
import { AssessmentError, assessmentVersion, parseAssessment, type AssessmentRead, type ClimateAssessment } from '../domain/climate-assessment.ts';
import type { AssessmentModel } from '../data/assessment/featherless.ts';
import type { AssessmentRepository } from '../data/repositories/assessment-repository.ts';
import type { EvidenceCitationReader, EvidenceRetrievalService } from './evidence-retrieval.ts';
import { assessmentEventContext, assessmentQueries, eventFingerprint, selectAssessmentPassages } from './assessment-context.ts';
import { parseReview, resolveClaims } from './assessment-validation.ts';
import { draftPrompt, reviewPrompt } from './assessment-prompts.ts';
import { draftOutputSchema, reviewOutputSchema } from './assessment-output-schema.ts';
import { assessmentPassages, parseSelectedDraft } from './assessment-passages.ts';
import { withinAssessmentWindow } from './assessment-window.ts';

export interface ClimateAssessmentService { assess(event: ClimateEvent, options?: { force?: boolean }): Promise<ClimateAssessment> }
export class DefaultClimateAssessmentService implements ClimateAssessmentService {
  constructor(private readonly repository: AssessmentRepository, private readonly retrieval: EvidenceRetrievalService & EvidenceCitationReader,
    private readonly llm: AssessmentModel, private readonly now = () => new Date()) {}

  async read(eventId: string, currentEventFingerprint?: string): Promise<AssessmentRead> {
    const stored = await this.repository.latest(eventId);
    if (!stored) return { kind: 'unavailable' };
    if (!stored.assessment) return { kind: stored.generationFailed ? 'generation_failed' : 'unavailable' };
    const assessment = parseAssessment(stored.assessment);
    if (assessment.eventId !== eventId) throw new AssessmentError('database', 'Assessment event mismatch');
    const citations = assessment.claims.flatMap(c => c.citations);
    const ids = [...new Set(citations.map(c => c.chunkId))];
    const resolved = new Map(await Promise.all(ids.map(async id => [id, await this.retrieval.findByChunkId(id)] as const)));
    for (const citation of citations) {
      const original = resolved.get(citation.chunkId);
      if (!original || original.sourceId !== citation.sourceId || original.sourceVersionId !== citation.sourceVersionId ||
        !original.content.includes(citation.passage)) return { kind: 'invalid_citations' };
      citation.sourceTitle = original.sourceTitle; citation.publisher = original.publisher;
      citation.sourceUrl = original.sourceUrl; citation.publishedAt = original.publishedAt;
    }
    return { kind: 'available', assessment, generationFailed: stored.generationFailed, stale: stored.stale || assessment.assessmentVersion !== assessmentVersion ||
      (!!currentEventFingerprint && assessment.eventFingerprint !== currentEventFingerprint) };
  }

  async assess(event: ClimateEvent, options: { force?: boolean } = {}): Promise<ClimateAssessment> {
    if (!isClimateEvent(event)) throw new AssessmentError('validation', 'Invalid normalized event');
    if (!withinAssessmentWindow(event, this.now())) throw new AssessmentError('event_window', 'Select an event first reported within the last three calendar years');
    try { return await this.generate(event, options); }
    catch (error) {
      // Retain only a generic timestamped failure marker; no model text or secrets.
      try { await this.repository.recordFailure?.(event.id); } catch { /* Preserve the original failure if the database is unavailable. */ }
      throw error;
    }
  }
  private async generate(event: ClimateEvent, options: { force?: boolean }): Promise<ClimateAssessment> {
    const eventHash = await eventFingerprint(event);
    if (!options.force) {
      const existing = await this.read(event.id, eventHash);
      if (existing.kind === 'available' && !existing.stale && existing.assessment.model === this.llm.model) return existing.assessment;
    }
    const snapshot = await this.repository.snapshot();
    if (snapshot.maintenance) throw new AssessmentError('conflict', 'Evidence corpus is in maintenance');
    const searches = await Promise.all(assessmentQueries(event).map(q => this.retrieval.search(q)));
    const passages = selectAssessmentPassages(searches);
    // Resolve immutable identities before the LLM sees any source material.
    const authoritative = await Promise.all(passages.map(async p => {
      const original = await this.retrieval.findByChunkId(p.chunkId);
      if (!original || original.sourceId !== p.sourceId || original.sourceVersionId !== p.sourceVersionId || original.content !== p.content)
        throw new AssessmentError('support', 'Retrieved citation identity mismatch');
      return original;
    }));
    const base = { id: crypto.randomUUID(), eventId: event.id, assessedAt: this.now().toISOString(), model: this.llm.model,
      assessmentVersion, eventFingerprint: eventHash, corpusFingerprint: snapshot.fingerprint };
    let assessment: ClimateAssessment = { ...base, summary: 'No applicable scientific evidence was established from the available knowledge base.',
      immediateCause: null, climateConnection: null, claims: [], humanInfluence: 'none', evidenceStrength: 'none', status: 'insufficient_evidence',
      uncertainties: ['The available knowledge base and bounded searches may omit relevant research. Missing attribution evidence does not establish an absence of climate influence.'] };
    if (authoritative.length) {
      const input = { event: assessmentEventContext(event), passages: authoritative };
      const chunkIds = authoritative.map(p => p.chunkId);
      const selected = assessmentPassages(authoritative);
      const draft = await this.generateJson(draftPrompt, { ...input, passages: selected.passages },
        value => parseSelectedDraft(value, selected.selections), draftOutputSchema([...selected.selections.keys()]));
      const review = await this.generateJson(reviewPrompt, { ...input, draft }, parseReview, reviewOutputSchema(chunkIds));
      const verified = resolveClaims(draft, review, event, authoritative);
      if (verified.claims.length) {
        const select = (i: number | null) => i === null ? null : verified.claims[i].statement;
        assessment = { ...base, ...verified, summary: select(draft.summaryClaimIndex)!, immediateCause: select(draft.immediateCauseClaimIndex),
          climateConnection: select(draft.climateConnectionClaimIndex), status: 'completed',
          uncertainties: [...draft.uncertainties, ...(verified.conflicting ? ['Conflicting findings limit attribution strength; see claim limitations.'] : []),
            'Missing event-specific attribution does not establish an absence of climate influence.'] };
      }
    }
    const current = await this.repository.snapshot();
    if (current.fingerprint !== snapshot.fingerprint || current.maintenance) throw new AssessmentError('conflict', 'Evidence changed during assessment; rerun explicitly');
    assessment = parseAssessment(assessment);
    await this.repository.save(assessment);
    return assessment;
  }

  private async generateJson<T>(prompt: string, input: object, validate: (value: unknown) => T, schema: Record<string, unknown>): Promise<T> {
    let previousResponse: unknown; let previousValidationFailure: string | undefined;
    for (let attempt = 0; ; attempt++) {
      // Only JSON content is returned by the adapter; private reasoning is excluded.
      previousResponse = await this.llm.complete(prompt, { ...input, previousResponse, previousValidationFailure }, schema);
      try { return validate(previousResponse); }
      catch (error) {
        const missingFields = error instanceof AssessmentError && error.code === 'validation'
          && error.message.startsWith('Missing required JSON fields:');
        if (!missingFields || attempt >= 2) throw error;
        previousValidationFailure = error.message;
      }
    }
  }
}
