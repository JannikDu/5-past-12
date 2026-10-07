import { EventCategory } from '../../src/domain/climate-event.ts';
import type { NormalizedEvidenceSource, ProcessingProfile } from '../../src/domain/evidence.ts';
import { EvidenceChunker } from '../../src/services/evidence-chunker.ts';
import { FeatherlessEmbeddingProvider } from '../../src/data/embeddings/featherless.ts';

export function vector(a = 1, b = 0): number[] { const v = Array<number>(1536).fill(0); v[0] = a; v[1] = b; return v; }
export const chunker = new EvidenceChunker();
export const profile: ProcessingProfile = { embedding: new FeatherlessEmbeddingProvider({ apiKey: 'fake', model: 'Qwen/Qwen3-Embedding-4B' }).profile, chunking: chunker.profile };
export function source(name = 'Spain wildfire', text = 'Wildfire conditions in Spain and the Mediterranean. Uncertainty remains.'): NormalizedEvidenceSource {
  return { title: name, publisher: 'Fixture publisher', url: `https://example.org/${encodeURIComponent(name)}`,
    evidenceType: 'analogue_attribution', sourceType: 'attribution_study', eventTypes: [EventCategory.Wildfire],
    region: 'Spain', eventStart: '2020-07-01T00:00:00Z', eventEnd: '2020-07-31T00:00:00Z',
    publishedAt: '2020-08-02T00:00:00Z', sourceUpdatedAt: null, normalizationProfile: 'fixture-v1', normalizedText: text };
}
export function csiHtml(text = 'Wildfire conditions in Spain and the Mediterranean may be amplified by heat. Uncertainty remains.') {
  return `<html><nav>Donate to navigation</nav><div class="styles_card__fixture"><div class="styles_card_date__fixture">Oct 6, 2026</div>
    <div id="alert-spain"><h4>Spain fire weather<button>Copy URL</button></h4><p class="styles_card_header_excerpt__fixture">Forecast context.</p>
    <span class="styles_label__fixture">Spain</span><span class="styles_tags_element__fixture">Wildfire</span>
    <div class="styles_card_description__fixture"><section><p>${text}</p><p>These are conditions, not a finding about any application event.</p></section></div></div></div></html>`;
}
export const wwaUrl = 'https://www.worldweatherattribution.org/mediterranean-heat-study/';
export const wwaBody = `<p>We analysed historical Mediterranean heat and drought. This attribution study finds increased fire weather risk, with substantial uncertainty.</p>
  <p>${'Hot dry conditions can influence wildfire conditions in Spain and the Mediterranean. A historical analogue does not attribute a current fire. '.repeat(8)}</p>`;
export function wwaFeed(items = [{ url: wwaUrl, title: 'Mediterranean heat and drought attribution study', body: wwaBody, date: 'Mon, 03 Aug 2020 12:00:00 GMT', category: 'Extreme heat' }]) {
  return `<?xml version="1.0"?><rss xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>World Weather Attribution</title>${items.map(item =>
    `<item><title>${item.title}</title><link>${item.url}</link><guid>${item.url}</guid><pubDate>${item.date}</pubDate><category>${item.category}</category><content:encoded><![CDATA[${item.body}]]></content:encoded></item>`).join('')}</channel></rss>`;
}
export function wwaArticle(text = wwaBody, url = wwaUrl) {
  return `<html><head><link rel="canonical" href="${url}"><meta property="article:published_time" content="2020-08-03T12:00:00Z"></head><body>
    <nav>Do not index menu</nav><article><h1 class="entry-title">Mediterranean heat and drought attribution study</h1>
    <h5><a rel="category tag" href="https://www.worldweatherattribution.org/analysis/heatwave/">Extreme heat</a></h5><div class="entry-content">${text}</div></article></body></html>`;
}
