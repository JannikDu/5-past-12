import type { NormalizedEvidenceSource, ProcessingProfile } from '../domain/evidence.ts';

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  return JSON.stringify(value);
}
export async function fingerprint(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stableJson(value)));
  return Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
}
export function sourceHash(source: NormalizedEvidenceSource): Promise<string> {
  return fingerprint({ ...source, eventTypes: [...new Set(source.eventTypes)].sort() });
}
export function sameProfile(a: ProcessingProfile, b: ProcessingProfile): boolean { return stableJson(a) === stableJson(b); }
export function canonicalUrl(input: string, preserveFragment = false): string {
  const url = new URL(input);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Source URL must be HTTP(S) without credentials');
  for (const key of [...url.searchParams.keys()]) if (/^utm_/i.test(key) || ['fbclid', 'gclid', 'mc_cid', 'mc_eid'].includes(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  if (!preserveFragment) url.hash = '';
  return url.href;
}
