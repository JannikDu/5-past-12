import { eligibleWwa, type WwaPublication } from '../wwa-publication.ts';
import type { EvidenceNormalizer } from './evidence-normalizer.ts';
import { validateSource, type NormalizedEvidenceSource } from '../../domain/evidence.ts';
import { canonicalUrl } from '../../services/evidence-identity.ts';
import { eventTags, headlineEventTags, htmlText, normalizeText } from './evidence-text.ts';
import { EventCategory } from '../../domain/climate-event.ts';

export class WorldWeatherAttributionEvidenceNormalizer implements EvidenceNormalizer<WwaPublication> {
  async normalize(raw: WwaPublication): Promise<NormalizedEvidenceSource | null> {
    let url: URL;
    try { url = new URL(raw.url); } catch { return null; }
    if (url.hostname !== 'www.worldweatherattribution.org' || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || !raw.title.trim()) return null;
    if (!eligibleWwa(raw.title, raw.categories, raw.html)) return null;
    const text = htmlText(raw.html);
    if (!text) return null;
    // Require a current attribution analysis; observations and cited earlier
    // studies do not establish a new counterfactual attribution study.
    const observationsOnly = /\b(observations only|only observations|(?:based|relying) (?:solely|only) on observations|without (?:a |any |new )?attribution analysis|no (?:new )?attribution analysis)\b/i.test(text);
    const currentAttribution = /\b(?:this|our|the present|the current)\s+(?:rapid\s+|event\s+)?attribution\s+(?:study|analysis)\b/i.test(text) ||
      /\battribution analysis[^.!?]{0,40}\bwe (?:assess|analyse|analyze|estimate)\b/i.test(text) ||
      /\b(?:we|scientists|researchers|the WWA team)\b[^.!?]{0,100}\b(?:analysed|analyzed|conducted|performed|carried out)\b[^.!?]{0,160}\b(?:attribution (?:study|analysis)|climate models|counterfactual)\b/i.test(text);
    const modelAnalysis = /\b(?:we (?:also |first )?(?:combine|combined|compare|compared|analyse|analyze|assess|assessed|use|used)|repeating the analysis)[^.!?]{0,180}\bclimate models\b/i.test(text);
    const publishedMethods = /\b(?:scientists|researchers)\b[^.!?]{0,500}\b(?:collaborated|used|undertook)\b[^.!?]{0,150}\b(?:assess|attribution study|peer-reviewed methods)\b/i.test(text) && /\b(?:human.induced )?climate change\b/i.test(text);
    const synthesis = /\brather than conducting (?:a )?(?:conventional )?attribution study\b/i.test(text);
    const study = !observationsOnly && !synthesis && (currentAttribution || modelAnalysis || publishedMethods);
    const observation = !study && /\b(observations|observed|measurements)\b/i.test(text);
    const headlineTags = headlineEventTags(raw.title);
    const tags = [...new Set([...eventTags(raw.categories), ...headlineTags])];
    const eventTypes = headlineTags.includes(EventCategory.Temperature) ? tags.filter(tag => tag !== EventCategory.Heat) : tags;
    const source: NormalizedEvidenceSource = { title: normalizeText(raw.title), publisher: 'World Weather Attribution', url: canonicalUrl(raw.url),
      evidenceType: study ? 'analogue_attribution' : observation ? 'event_context' : 'general_context',
      sourceType: study ? 'attribution_study' : synthesis ? 'scientific_report' : observation ? 'observation' : 'article',
      eventTypes, region: raw.region?.trim() || null, eventStart: raw.eventStart ?? null, eventEnd: raw.eventEnd ?? null,
      publishedAt: raw.publishedAt, sourceUpdatedAt: raw.updatedAt, normalizedText: text, normalizationProfile: 'wwa-html-v2' };
    validateSource(source); return source;
  }
}
