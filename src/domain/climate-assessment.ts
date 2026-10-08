import { parseEventId } from './climate-event.ts';
import { evidenceTypes, type EvidenceType } from './evidence.ts';

export const assessmentLevels = ['none', 'low', 'medium', 'high'] as const;
export const claimTypes = ['direct_finding', 'supported_synthesis', 'general_mechanism'] as const;
export type AssessmentLevel = typeof assessmentLevels[number];
export type ClaimType = typeof claimTypes[number];
export const assessmentVersion = 'climate-assessment-v2';
export interface AssessmentCitation {
  chunkId: string; sourceId: string; sourceVersionId: string; relation: EvidenceType; passage: string;
  sourceTitle: string; publisher: string; publishedAt: string | null; sourceUrl: string;
}
export interface ClimateClaim {
  type: ClaimType; statement: string; explanation: string;
  citations: AssessmentCitation[]; limitations: string[];
}
export interface ClimateAssessment {
  id: string; eventId: string; summary: string; immediateCause: string | null; climateConnection: string | null;
  humanInfluence: AssessmentLevel; evidenceStrength: AssessmentLevel; claims: ClimateClaim[]; uncertainties: string[];
  status: 'completed' | 'insufficient_evidence'; assessedAt: string; model: string;
  assessmentVersion: string; eventFingerprint: string; corpusFingerprint: string;
}
export type AssessmentRead =
  | { kind: 'available'; assessment: ClimateAssessment; stale: boolean; generationFailed?: boolean }
  | { kind: 'unavailable' | 'invalid_citations' | 'generation_failed' };

export class AssessmentError extends Error {
  constructor(public readonly code: 'validation' | 'support' | 'provider' | 'database' | 'conflict' | 'event_window' | 'budget', message: string) {
    super(message); this.name = 'AssessmentError';
  }
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AssessmentError('validation', 'Expected JSON object');
  return value as Record<string, unknown>;
}
export function text(value: unknown, max = 1800): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new AssessmentError('validation', 'Expected bounded nonempty text');
  return value;
}
export function array(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max || value.includes(undefined)) throw new AssessmentError('validation', 'Expected bounded array');
  return value;
}
export function strings(value: unknown, max = 12): string[] { return array(value, max).map(v => text(v)); }
export function choice<T extends string>(value: unknown, choices: readonly T[]): T {
  if (typeof value !== 'string' || !choices.includes(value as T)) throw new AssessmentError('validation', 'Unsupported value');
  return value as T;
}
export function uuid(value: unknown): string {
  const id = text(value, 36);
  if (!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)) throw new AssessmentError('validation', 'Invalid citation identifier');
  return id;
}
export function hash(value: unknown): string {
  const result = text(value, 64);
  if (!/^[a-f0-9]{64}$/.test(result)) throw new AssessmentError('validation', 'Invalid fingerprint');
  return result;
}
export function keys(row: Record<string, unknown>, allowed: string[]): void {
  const missing = allowed.filter(k => !(k in row));
  if (missing.length) throw new AssessmentError('validation', `Missing required JSON fields: ${missing.join(', ')}`);
  // Validators explicitly construct the allowed output shape. Unknown fields
  // are discarded, including model-supplied metadata and private reasoning.
}
export function parseAssessment(value: unknown): ClimateAssessment {
  const row = object(value);
  const eventId = text(row.eventId, 240); if (!parseEventId(eventId)) throw new AssessmentError('validation', 'Invalid event ID');
  const assessedAt = text(row.assessedAt, 40);
  if (!Number.isFinite(Date.parse(assessedAt))) throw new AssessmentError('validation', 'Invalid assessment date');
  const claims = array(row.claims, 8).map(item => {
    const c = object(item);
    const citations = array(c.citations, 8).map(item => {
      const r = object(item); const sourceUrl = text(r.sourceUrl, 2000);
      const url = new URL(sourceUrl);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new AssessmentError('validation', 'Invalid source URL');
      if (r.publishedAt !== null && (typeof r.publishedAt !== 'string' || !Number.isFinite(Date.parse(r.publishedAt)))) throw new AssessmentError('validation', 'Invalid publication date');
      return { chunkId: uuid(r.chunkId), sourceId: uuid(r.sourceId), sourceVersionId: uuid(r.sourceVersionId),
        relation: choice(r.relation, evidenceTypes), passage: text(r.passage, 2400), sourceTitle: text(r.sourceTitle),
        publisher: text(r.publisher), publishedAt: r.publishedAt as string | null, sourceUrl };
    });
    if (!citations.length) throw new AssessmentError('support', 'Claim has no citations');
    return { type: choice(c.type, claimTypes), statement: text(c.statement), explanation: text(c.explanation), citations, limitations: strings(c.limitations) };
  });
  const result: ClimateAssessment = { id: uuid(row.id), eventId, assessedAt, claims,
    summary: text(row.summary), immediateCause: row.immediateCause === null ? null : text(row.immediateCause),
    climateConnection: row.climateConnection === null ? null : text(row.climateConnection),
    humanInfluence: choice(row.humanInfluence, assessmentLevels), evidenceStrength: choice(row.evidenceStrength, assessmentLevels),
    uncertainties: strings(row.uncertainties), status: choice(row.status, ['completed', 'insufficient_evidence']),
    model: text(row.model, 200), assessmentVersion: text(row.assessmentVersion, 100),
    eventFingerprint: hash(row.eventFingerprint), corpusFingerprint: hash(row.corpusFingerprint) };
  if ((result.status === 'completed' && !claims.length) || (result.status === 'insufficient_evidence' &&
    (claims.length || result.humanInfluence !== 'none' || result.evidenceStrength !== 'none'))) throw new AssessmentError('validation', 'Inconsistent assessment status');
  if (claims.length && (![result.summary, result.immediateCause, result.climateConnection].every(v => v === null || claims.some(c => c.statement === v)))) throw new AssessmentError('support', 'Uncited assessment narrative');
  if (!result.uncertainties.length) throw new AssessmentError('validation', 'Missing uncertainty');
  const direct = claims.some(c => c.citations.some(s => s.relation === 'direct_attribution'));
  if ((result.humanInfluence === 'high' || result.evidenceStrength === 'high') && !direct) throw new AssessmentError('support', 'High level without direct evidence');
  if (claims.length && claims.every(c => c.type === 'general_mechanism') && (result.humanInfluence !== 'none' || !['none', 'low'].includes(result.evidenceStrength)))
    throw new AssessmentError('support', 'Mechanisms alone cannot establish strong attribution');
  return result;
}
