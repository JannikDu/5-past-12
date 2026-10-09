import { demoEvents } from '../../src/data/demo-events.ts';
import type { ClimateEvent } from '../../src/domain/climate-event.ts';
import type { EvidenceCitation } from '../../src/domain/evidence.ts';
import type { AssessmentDraft, AssessmentReview } from '../../src/services/assessment-validation.ts';

export const event: ClimateEvent = { ...demoEvents[0], title: 'Cedar Ridge Wildfire', summary: 'A reported fire.',
  location: { ...demoEvents[0].location, label: 'Cedar Ridge' } };
export const monthYear = new Date(event.time.firstObservedAt).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
export const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export function citation(n = 1, overrides: Partial<EvidenceCitation> = {}): EvidenceCitation {
  return { chunkId: id(n), sourceId: id(n + 100), sourceVersionId: id(n + 200),
    content: `The Cedar Ridge Wildfire in ${monthYear} was investigated using attribution models comparing actual and counterfactual climates. Anthropogenic warming increased its fire weather intensity.`,
    sourceTitle: 'Fixture attribution study', publisher: 'Fixture scientific publisher', sourceUrl: 'https://example.org/study',
    evidenceType: 'general_context', sourceType: 'attribution_study', publishedAt: null, ...overrides };
}
export function draft(c = citation(), overrides: Partial<AssessmentDraft> = {}): AssessmentDraft {
  return { humanInfluence: 'high', evidenceStrength: 'high', summaryClaimIndex: 0, climateConnectionClaimIndex: 0, immediateCauseClaimIndex: null,
    claims: [{ type: 'direct_finding', statement: 'The study found stronger fire weather due to anthropogenic warming.',
      explanation: 'The study compared climates with and without human warming for this event.', citations: [{ chunkId: c.chunkId, passage: c.content }], limitations: [] }],
    uncertainties: ['Fire weather attribution does not establish the ignition source.'], ...overrides };
}
export function review(c = citation(), overrides: Partial<AssessmentReview> = {}): AssessmentReview {
  return { narrativeSupported: true, claims: [{ claimIndex: 0, supported: true, applicable: true, contradiction: false,
    contribution: 'strong', strongEvidence: true, citations: [{ chunkId: c.chunkId, relation: 'direct_attribution', eventName: 'Cedar Ridge Wildfire', eventTime: monthYear }] }], ...overrides };
}
