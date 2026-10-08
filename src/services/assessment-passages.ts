import { AssessmentError, object } from '../domain/climate-assessment.ts';
import type { EvidenceCitation } from '../domain/evidence.ts';
import { parseDraft } from './assessment-validation.ts';

export interface SelectedPassage { chunkId: string; passage: string }
/** Exact contiguous spans: no paraphrasing, reordering or whitespace normalization. */
export function assessmentPassages(chunks: EvidenceCitation[]) {
  const selections = new Map<string, SelectedPassage>();
  const passages = chunks.map(({ content, ...metadata }) => {
    const segments: { passageId: string; text: string }[] = [];
    let start = 0;
    while (start < content.length) {
      let end = Math.min(start + 1200, content.length);
      if (end < content.length) {
        const slice = content.slice(start, end);
        const sentenceEnds = [...slice.matchAll(/[.!?](?=\s+[A-Z“"‘])/gu)];
        const last = sentenceEnds.at(-1)?.index;
        if (last !== undefined && last > 400) end = start + last + 1;
        else { const space = content.lastIndexOf(' ', end); if (space > start) end = space; }
      }
      const passage = content.slice(start, end).trim();
      if (passage) {
        const passageId = `${metadata.chunkId}#${segments.length}`;
        selections.set(passageId, { chunkId: metadata.chunkId, passage });
        segments.push({ passageId, text: passage });
      }
      start = end;
    }
    return { ...metadata, segments };
  });
  return { passages, selections };
}

export function parseSelectedDraft(value: unknown, selections: Map<string, SelectedPassage>) {
  const row = object(value);
  if (!Array.isArray(row.claims)) return parseDraft(row);
  if (!row.claims.length) {
    // No claim exists to select. Canonicalize an unused numeric default without
    // filling missing required fields; independent empty-evidence review follows.
    const normalized = { ...row };
    for (const key of ['summaryClaimIndex', 'immediateCauseClaimIndex', 'climateConnectionClaimIndex'])
      if (normalized[key] === 0) normalized[key] = null;
    return parseDraft(normalized);
  }
  const claims = row.claims.map(value => {
    const claim = object(value);
    if (!Array.isArray(claim.citations)) return claim;
    const citations = claim.citations.map(value => {
      const citation = object(value);
      // Canonical drafts remain usable by injected providers and offline fixtures.
      // Real provider schemas only permit passageId, never model-authored quotes.
      if (!('passageId' in citation)) return citation;
      if (typeof citation.passageId !== 'string') throw new AssessmentError('validation', 'Invalid passage identifier');
      const selected = selections.get(citation.passageId);
      if (!selected) throw new AssessmentError('support', 'Unknown selected passage');
      return selected;
    });
    return { ...claim, citations };
  });
  return parseDraft({ ...row, claims });
}
