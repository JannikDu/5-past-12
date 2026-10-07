import { EvidenceError } from '../domain/evidence.ts';
export interface EvidenceConfig {
  supabase: { url: string; secretKey: string };
  featherless: { apiKey: string; model: string; baseUrl: string; batchSize: number };
  chunking: { size: number; overlap: number; minSize: number };
  maxItems: number; maxPages: number; overlapDays: number; recheckDays: number; publicationCap: number;
}
export function embeddingConfig(env: Record<string, string | undefined>): EvidenceConfig['featherless'] {
  return { apiKey: required(env, 'FEATHERLESS_API_KEY'), model: required(env, 'FEATHERLESS_EMBEDDING_MODEL'),
    baseUrl: url(env.FEATHERLESS_BASE_URL ?? 'https://api.featherless.ai/v1', 'FEATHERLESS_BASE_URL'),
    batchSize: integer(env, 'FEATHERLESS_EMBEDDING_BATCH_SIZE', 32, 1, 128) };
}
function required(env: Record<string, string | undefined>, name: string): string {
  const value = env[name]?.trim(); if (!value) throw new EvidenceError('validation', `Missing required environment variable: ${name}`); return value;
}
function url(value: string, name: string): string {
  try { const u = new URL(value); if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password || u.search || u.hash) throw new Error(); return u.href.replace(/\/$/, ''); }
  catch { throw new EvidenceError('validation', `${name} must be an HTTP(S) URL without credentials, query or fragment`); }
}
function integer(env: Record<string, string | undefined>, name: string, fallback: number, min: number, max: number): number {
  const text = env[name]; const value = text === undefined ? fallback : /^\d+$/.test(text) ? Number(text) : NaN;
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new EvidenceError('validation', `${name} must be an integer from ${min} to ${max}`); return value;
}
export function evidenceConfig(env: Record<string, string | undefined>): EvidenceConfig {
  const chunking = { size: integer(env, 'EVIDENCE_CHUNK_SIZE', 2400, 1, 10000), overlap: integer(env, 'EVIDENCE_CHUNK_OVERLAP', 300, 0, 9999), minSize: integer(env, 'EVIDENCE_CHUNK_MIN_SIZE', 400, 1, 10000) };
  if (chunking.overlap + chunking.minSize > chunking.size) throw new EvidenceError('validation', 'Chunk overlap + minimum must not exceed chunk size');
  return { supabase: supabaseConfig(env), featherless: embeddingConfig(env), chunking,
    maxItems: integer(env, 'EVIDENCE_MAX_ITEMS_PER_PROVIDER', 20, 3, 100), maxPages: integer(env, 'EVIDENCE_MAX_PAGES_PER_PROVIDER', 10, 2, 100),
    overlapDays: integer(env, 'EVIDENCE_DISCOVERY_OVERLAP_DAYS', 7, 1, 365), recheckDays: integer(env, 'EVIDENCE_RECHECK_INTERVAL_DAYS', 7, 1, 365),
    publicationCap: integer(env, 'EVIDENCE_RETRIEVAL_MAX_CHUNKS_PER_SOURCE', 2, 1, 10) };
}
export function supabaseConfig(env: Record<string, string | undefined>): EvidenceConfig['supabase'] {
  return { url: url(required(env, 'SUPABASE_URL'), 'SUPABASE_URL'), secretKey: required(env, 'SUPABASE_SECRET_KEY') };
}
