import type { ClimateCentralAlert } from '../providers/climate-central-evidence.ts';
import type { EvidenceNormalizer } from './evidence-normalizer.ts';
import { validateSource, type NormalizedEvidenceSource } from '../../domain/evidence.ts';
import { canonicalUrl } from '../../services/evidence-identity.ts';
import { eventTags, normalizeText } from './evidence-text.ts';

export class ClimateCentralEvidenceNormalizer implements EvidenceNormalizer<ClimateCentralAlert> {
  async normalize(raw: ClimateCentralAlert): Promise<NormalizedEvidenceSource | null> {
    if (!raw.title.trim() || !raw.text.trim()) return null;
    let url: URL;
    try { url = new URL(raw.url); } catch { return null; }
    if (url.hostname !== 'www.climatecentral.org' || url.pathname !== '/climate-shift-index-alert' || url.hash !== `#${raw.anchor}` || url.username || url.password || !/^alert-[A-Za-z0-9_-]+$/.test(raw.anchor)) return null;
    const source: NormalizedEvidenceSource = { title: normalizeText(raw.title), publisher: 'Climate Central',
      url: canonicalUrl(raw.url, true), evidenceType: 'event_context', sourceType: 'article', eventTypes: eventTags(raw.hazards),
      region: raw.location?.trim() || null, eventStart: raw.eventStart ?? null, eventEnd: raw.eventEnd ?? null,
      publishedAt: raw.publishedAt, sourceUpdatedAt: null, normalizedText: normalizeText(raw.text), normalizationProfile: 'csi-html-v1' };
    validateSource(source); return source;
  }
}
