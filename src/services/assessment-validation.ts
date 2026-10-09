import type { ClimateEvent } from '../domain/climate-event.ts';
import { array, assessmentLevels, AssessmentError, choice, claimTypes, keys, object, strings, text, uuid, validateCitedText,
  type AssessmentLevel, type ClimateClaim } from '../domain/climate-assessment.ts';
import { evidenceTypes, type EvidenceCitation, type EvidenceType } from '../domain/evidence.ts';

export interface DraftCitation { chunkId: string; passage: string }
export interface DraftClaim { type: ClimateClaim['type']; statement: string; explanation: string; citations: DraftCitation[]; limitations: string[] }
export interface AssessmentDraft {
  humanInfluence: AssessmentLevel; evidenceStrength: AssessmentLevel; claims: DraftClaim[]; uncertainties: string[];
  summaryClaimIndex: number | null; immediateCauseClaimIndex: number | null; climateConnectionClaimIndex: number | null;
}
export interface CitationReview {
  chunkId: string; relation: EvidenceType; eventName: string | null; eventTime: string | null;
}
export interface ClaimReview {
  claimIndex: number; supported: boolean; applicable: boolean; contradiction: boolean;
  contribution: 'none' | 'possible' | 'plausible' | 'strong'; strongEvidence: boolean; citations: CitationReview[];
}
export interface AssessmentReview { narrativeSupported: boolean; claims: ClaimReview[] }
function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new AssessmentError('validation', 'Expected boolean'); return value;
}
export function parseDraft(value: unknown): AssessmentDraft {
  const r = object(value);
  keys(r, ['humanInfluence', 'evidenceStrength', 'claims', 'uncertainties', 'summaryClaimIndex', 'immediateCauseClaimIndex', 'climateConnectionClaimIndex']);
  const claims = array(r.claims, 8).map(value => {
    const c = object(value); keys(c, ['type', 'statement', 'explanation', 'citations', 'limitations']);
    const citations = array(c.citations, 8).map(value => {
      const s = object(value); keys(s, ['chunkId', 'passage']); return { chunkId: uuid(s.chunkId), passage: text(s.passage, 2400) };
    });
    if (!citations.length || new Set(citations.map(c => c.chunkId)).size !== citations.length) throw new AssessmentError('support', 'Missing or duplicate claim citations');
    return { type: choice(c.type, claimTypes), statement: text(c.statement), explanation: text(c.explanation), citations, limitations: strings(c.limitations) };
  });
  const index = (v: unknown): number | null => {
    if (v === null) return null;
    if (!Number.isInteger(v) || Number(v) < 0 || Number(v) >= claims.length) throw new AssessmentError('validation', 'Invalid claim selector');
    return v as number;
  };
  const draft = { humanInfluence: choice(r.humanInfluence, assessmentLevels), evidenceStrength: choice(r.evidenceStrength, assessmentLevels),
    claims, uncertainties: strings(r.uncertainties), summaryClaimIndex: index(r.summaryClaimIndex),
    immediateCauseClaimIndex: index(r.immediateCauseClaimIndex), climateConnectionClaimIndex: index(r.climateConnectionClaimIndex) };
  if (!draft.uncertainties.length || (claims.length && draft.summaryClaimIndex === null)) throw new AssessmentError('validation', 'Missing summary or uncertainties');
  return draft;
}
export function parseReview(value: unknown): AssessmentReview {
  const r = object(value); keys(r, ['narrativeSupported', 'claims']);
  return { narrativeSupported: boolean(r.narrativeSupported), claims: array(r.claims, 8).map(value => {
    const c = object(value); keys(c, ['claimIndex', 'supported', 'applicable', 'contradiction', 'contribution', 'strongEvidence', 'citations']);
    if (!Number.isInteger(c.claimIndex) || Number(c.claimIndex) < 0) throw new AssessmentError('validation', 'Invalid review index');
    return { claimIndex: c.claimIndex as number, supported: boolean(c.supported), applicable: boolean(c.applicable),
      contradiction: boolean(c.contradiction), strongEvidence: boolean(c.strongEvidence),
      contribution: choice(c.contribution, ['none', 'possible', 'plausible', 'strong']),
      citations: array(c.citations, 8).map(value => {
        const s = object(value); keys(s, ['chunkId', 'relation', 'eventName', 'eventTime']);
        return { chunkId: uuid(s.chunkId), relation: choice(s.relation, evidenceTypes),
          eventName: s.eventName === null ? null : text(s.eventName), eventTime: s.eventTime === null ? null : text(s.eventTime) };
      }) };
  }) };
}
const identityWords = (value: string): string[] => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
const genericIdentity = new Set('fire wildfire wildfires flood floods storm tropical cyclone hurricane typhoon heat heatwave drought earthquake event extreme temperature unnamed unknown reported eonet in at the of and a an'.split(' '));
const distinctiveWords = (value: string) => identityWords(value).filter(w => w.length > 2 && !genericIdentity.has(w) && !/^\d+$/.test(w));
const countryNames = new Set(['Republic of Korea', 'Republic of the Congo', 'Democratic Republic of the Congo', 'United States of America', 'Congo'].map(v => distinctiveWords(v).join(' ')));
const regionNames = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });
for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) {
  const name = regionNames.of(String.fromCharCode(a, b)); if (name) countryNames.add(distinctiveWords(name).join(' '));
}
/** Identity anchors are a prerequisite, not a test of scientific truth. */
export function sameEvent(event: ClimateEvent, citation: EvidenceCitation, review: CitationReview): boolean {
  if (citation.sourceType !== 'attribution_study' || !review.eventName || !review.eventTime ||
    !citation.content.includes(review.eventName) || !citation.content.includes(review.eventTime) || !attributionPassage(citation.content)) return false;
  // Administrative record numbers are not scientific identity. Removing one
  // must not turn an otherwise country-only record into a named event.
  const distinctive = distinctiveWords(event.title);
  const anchor = identityWords(review.eventName);
  if (!distinctive.length || countryNames.has(distinctive.join(' ')) || !distinctive.every(w => anchor.includes(w))) return false;
  const dates = event.observations.map(o => o.time.slice(0, 10));
  return dates.some(date => {
    const observation = new Date(date);
    const months = ['long', 'short'].map(month => observation.toLocaleString('en-US', { month: month as 'long' | 'short', timeZone: 'UTC' }).toLowerCase());
    return review.eventTime!.includes(date) || (review.eventTime!.includes(date.slice(0, 4)) && months.some(month => identityWords(review.eventTime!).includes(month)));
  });
}
function attributionPassage(content: string): boolean {
  return /anthropogenic|human[- ](?:caused|induced|warming)|greenhouse|climate change/i.test(content)
    && /attribut|counterfactual|without human/i.test(content)
    && /increas|decreas|likelihood|intensit|probab|no (?:detectable|significant)|not (?:detect|establish)/i.test(content);
}
export function resolveClaims(draft: AssessmentDraft, review: AssessmentReview, event: ClimateEvent, retrieved: EvidenceCitation[]) {
  const passages = new Map(retrieved.map(c => [c.chunkId, c]));
  if (!review.narrativeSupported || review.claims.length !== draft.claims.length ||
    new Set(review.claims.map(c => c.claimIndex)).size !== draft.claims.length) throw new AssessmentError('support', 'Incomplete or unsupported evidence review');
  let influenceCap: AssessmentLevel = 'none'; let evidenceCap: AssessmentLevel = 'none';
  const levels = assessmentLevels;
  const raise = (a: AssessmentLevel, b: AssessmentLevel) => levels[Math.max(levels.indexOf(a), levels.indexOf(b))];
  let conflicting = false;
  const claims: ClimateClaim[] = draft.claims.map((claim, index) => {
    const check = review.claims.find(c => c.claimIndex === index);
    if (!check?.supported || !check.applicable || check.citations.length !== claim.citations.length ||
      new Set(check.citations.map(c => c.chunkId)).size !== check.citations.length) throw new AssessmentError('support', 'Unsupported or inapplicable claim');
    const citations = claim.citations.map(selected => {
      const original = passages.get(selected.chunkId); const relationship = check.citations.find(c => c.chunkId === selected.chunkId);
      if (!original || !relationship || !original.content.includes(selected.passage)) throw new AssessmentError('support', 'Unknown citation or fabricated passage');
      if (relationship.relation === 'direct_attribution' && !sameEvent(event, original, relationship)) throw new AssessmentError('support', 'Direct attribution lacks same-event study anchors');
      return { chunkId: original.chunkId, sourceId: original.sourceId, sourceVersionId: original.sourceVersionId,
        sourceTitle: original.sourceTitle, publisher: original.publisher, sourceUrl: original.sourceUrl,
        publishedAt: original.publishedAt, relation: relationship.relation, passage: selected.passage };
    });
    validateCitedText([claim.statement,claim.explanation,...claim.limitations],claim.citations.map(c=>c.passage));
    const direct = citations.some(c => c.relation === 'direct_attribution');
    const context = citations.some(c => c.relation === 'event_context');
    const analogue = citations.some(c => c.relation === 'analogue_attribution');
    if (claim.type === 'general_mechanism' && direct) throw new AssessmentError('support', 'General mechanism cannot establish direct attribution');
    if (claim.type === 'supported_synthesis' && new Set(citations.map(c => c.sourceId)).size < 2) throw new AssessmentError('support', 'Synthesis requires multiple publications');
    if ((check.contradiction || analogue || !direct) && !claim.limitations.length) throw new AssessmentError('support', 'Missing scientific limitations');
    conflicting ||= check.contradiction;
    evidenceCap = raise(evidenceCap, direct ? (check.strongEvidence && !check.contradiction ? 'high' : 'medium') :
      ((context && claim.type === 'supported_synthesis') || (analogue && claim.type !== 'general_mechanism')) ? 'medium' : 'low');
    if (claim.type !== 'general_mechanism' && (direct || (context && claim.type === 'supported_synthesis'))) {
      influenceCap = raise(influenceCap, check.contribution === 'strong' && direct && check.strongEvidence && !check.contradiction ? 'high' :
        ['plausible', 'strong'].includes(check.contribution) ? 'medium' : check.contribution === 'possible' ? 'low' : 'none');
    }
    return { ...claim, citations };
  });
  if (conflicting) {
    evidenceCap = levels[Math.min(levels.indexOf(evidenceCap), 2)];
    influenceCap = levels[Math.min(levels.indexOf(influenceCap), 1)];
  }
  const cap = (level: AssessmentLevel, upper: AssessmentLevel) => levels[Math.min(levels.indexOf(level), levels.indexOf(upper))];
  return { claims, humanInfluence: cap(draft.humanInfluence, influenceCap), evidenceStrength: cap(draft.evidenceStrength, evidenceCap), conflicting };
}
