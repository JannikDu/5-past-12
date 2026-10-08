import { assessmentLevels, claimTypes } from '../domain/climate-assessment.ts';
import { evidenceTypes } from '../domain/evidence.ts';

type Schema = Record<string, unknown>;
const string: Schema = { type: 'string', minLength: 1, maxLength: 1800 };
const nullableString: Schema = { anyOf: [string, { type: 'null' }] };
const boolean: Schema = { type: 'boolean' };
const index: Schema = { type: 'integer', minimum: 0, maximum: 3 };
const selector: Schema = { anyOf: [index, { type: 'null' }] };
const array = (items: Schema, maxItems: number, minItems = 0): Schema => ({ type: 'array', items, minItems, maxItems });
const object = (properties: Record<string, Schema>): Schema => ({ type: 'object', properties,
  required: Object.keys(properties), additionalProperties: false });
const level: Schema = { type: 'string', enum: [...assessmentLevels] };

/** Provider constraints improve formatting; runtime/scientific checks remain authoritative. */
export function draftOutputSchema(passageIds: string[]): Schema {
  const citation = object({ passageId: { type: 'string', enum: passageIds } });
  const concise = { ...string, maxLength: 350 };
  const claim = object({ type: { type: 'string', enum: [...claimTypes] }, statement: concise, explanation: { ...string, maxLength: 650 },
    citations: array(citation, 4, 1), limitations: array(concise, 6) });
  return object({ humanInfluence: level, evidenceStrength: level, summaryClaimIndex: selector,
    immediateCauseClaimIndex: selector, climateConnectionClaimIndex: selector, claims: array(claim, 4), uncertainties: array(concise, 6, 1) });
}
export function reviewOutputSchema(chunkIds: string[]): Schema {
  const citation = object({ chunkId: { type: 'string', enum: chunkIds }, relation: { type: 'string', enum: [...evidenceTypes] },
    eventName: nullableString, eventTime: nullableString });
  const claim = object({ claimIndex: index, supported: boolean, applicable: boolean, contradiction: boolean,
    contribution: { type: 'string', enum: ['none', 'possible', 'plausible', 'strong'] }, strongEvidence: boolean, citations: array(citation, 4, 1) });
  return object({ narrativeSupported: boolean, claims: array(claim, 4) });
}
