import { XMLParser } from 'fast-xml-parser';
import { SyntaxValidator } from 'fast-xml-validator';
import { parseHTML } from 'linkedom';
import { EvidenceError, type WorkLane } from '../../domain/evidence.ts';
import { EvidenceHttpClient, type HttpOptions } from '../http.ts';
import { canonicalUrl, fingerprint } from '../../services/evidence-identity.ts';
import { dateOrNull, htmlText, normalizeText } from '../normalizers/evidence-text.ts';
import type { EvidenceSourceProvider, EvidenceFetchOptions, EvidenceFetchBatch } from './evidence-source.ts';
import { eligibleWwa, type WwaPublication } from '../wwa-publication.ts';

export const wwaFeedUrl = 'https://www.worldweatherattribution.org/feed/';
function officialUrl(input: string): string {
  const url = canonicalUrl(input);
  if (new URL(url).hostname !== 'www.worldweatherattribution.org' || new URL(url).protocol !== 'https:') throw new EvidenceError('contract', 'WWA publication URL must belong to the official HTTPS site');
  return url;
}
export function parseWwaFeed(xml: string, onInvalid: () => void = () => {}): WwaPublication[] {
  try { SyntaxValidator.validate(xml, { docType: { maxEntityCount: 0, maxEntitySize: 0 } }); }
  catch { throw new EvidenceError('contract', 'Invalid WWA RSS XML'); }
  const parsed = new XMLParser({ ignoreAttributes: false, trimValues: true, parseTagValue: false, processEntities: false }).parse(xml);
  if (!parsed.rss?.channel) throw new EvidenceError('contract', 'WWA RSS channel is missing');
  const items = parsed.rss.channel.item ?? [];
  return (Array.isArray(items) ? items : [items]).flatMap((row: Record<string, unknown>) => {
    if (typeof row.link !== 'string' || typeof row.title !== 'string') { onInvalid(); return []; }
    let url: string;
    try { url = officialUrl(row.link); } catch { onInvalid(); return []; }
    const categories = Array.isArray(row.category) ? row.category.map(String) : row.category ? [String(row.category)] : [];
    return [{ guid: typeof row.guid === 'string' ? row.guid : String((row.guid as Record<string, unknown>)?.['#text'] ?? row.link),
      url, title: htmlText(row.title), html: String(row['content:encoded'] ?? row.description ?? ''),
      publishedAt: dateOrNull(typeof row.pubDate === 'string' ? row.pubDate : null), updatedAt: null,
      categories, region: categories.filter(label => ['Africa', 'Asia', 'Europe', 'North America', 'South America', 'Oceania', 'Caribbean', 'Spain', 'Mediterranean'].includes(label)).join(', ') || null }];
  });
}
export function parseWwaArticle(html: string, url: string): WwaPublication {
  const { document } = parseHTML(html);
  const body = document.querySelector('article .entry-content,.post .entry-content,.entry-content');
  const title = document.querySelector('h1.entry-title,article h1,h1');
  if (!body || !title || !htmlText(body.innerHTML)) throw new EvidenceError('contract', 'WWA article body or title is missing');
  const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute('href');
  const articleUrl = officialUrl(canonical || url);
  const requested = new URL(officialUrl(url)); const declared = new URL(articleUrl);
  if (requested.pathname.replace(/\/$/, '') !== declared.pathname.replace(/\/$/, '') || requested.search !== declared.search) throw new EvidenceError('contract', 'WWA canonical URL conflicts with publication identity');
  // WWA places the event's name/date in a separate lead paragraph on some posts.
  // Scope it to this article so related-post summaries cannot become evidence.
  const summary = body.closest('article,.post')?.querySelector('.entry-summary');
  const lead = summary && !summary.contains(body) ? htmlText(summary.innerHTML) : '';
  const articleHtml = lead && !htmlText(body.innerHTML).startsWith(lead) ? `${summary!.innerHTML}\n${body.innerHTML}` : body.innerHTML;
  return { guid: url, url: articleUrl, title: normalizeText(title.textContent ?? ''), html: articleHtml, fullArticle: true,
    publishedAt: dateOrNull(document.querySelector('meta[property="article:published_time"]')?.getAttribute('content') ?? document.querySelector('time[datetime]')?.getAttribute('datetime') ??
      (document.querySelector('article h4')?.textContent ? `${document.querySelector('article h4')!.textContent} UTC` : null)),
    updatedAt: dateOrNull(document.querySelector('meta[property="article:modified_time"]')?.getAttribute('content')),
    categories: [...document.querySelectorAll('article a[rel="category tag"],.post a[rel="category tag"]')].map(node => normalizeText(node.textContent ?? '')),
    region: [...document.querySelectorAll('article h6 a[href*="/location/"],.post h6 a[href*="/location/"]')].map(node => normalizeText(node.textContent ?? '')).join(', ') || null };
}
export class WorldWeatherAttributionEvidenceProvider implements EvidenceSourceProvider<WwaPublication> {
  readonly id = 'world-weather-attribution'; readonly name = 'World Weather Attribution';
  private readonly http: EvidenceHttpClient;
  constructor(options: HttpOptions = {}) { this.http = new EvidenceHttpClient(options); }
  async fetchNew(options: EvidenceFetchOptions = {}): Promise<EvidenceFetchBatch<WwaPublication>> {
    const state = { ...(options.state ?? {}) };
    const maxItems = options.maxItems ?? 20; const maxPages = options.maxPages ?? 10;
    const result: EvidenceFetchBatch<WwaPublication> = { items: [], failures: [], skipped: 0, skippedItems: [], state,
      complete: { discovery: true, backfill: false, recheck: true, pending: true } };
    const seen = new Set<string>(); const pageHashes = new Set<string>();
    const pageCache = new Map<number, WwaPublication[]>();
    const deferred: { id: string; lane: WorkLane }[] = [];
    const oldDeferred = Array.isArray(state.deferred) ? state.deferred as { id: string; lane: WorkLane }[] : [];
    const headHashes = typeof state.headHashes === 'object' && state.headHashes ? state.headHashes as Record<string, string> : {};
    const nextHeadHashes: Record<string, string> = {};
    const add = async (publication: WwaPublication, lane: WorkLane, itemId = publication.url) => {
      if (seen.has(itemId)) return;
      seen.add(itemId);
      if (!eligibleWwa(publication.title, publication.categories, publication.html)) {
        result.skipped++; result.skippedItems!.push({ itemId, lane, code: 'ineligible' }); return;
      }
      if (result.items.length >= maxItems) { deferred.push({ id: itemId, lane }); result.complete[lane] = false; return; }
      try {
        // The canonical article is authoritative for both discovery and rechecks.
        // Mixing RSS/HTML metadata otherwise creates false revisions on every scan.
        if (!publication.fullArticle) {
          const response = await this.http.request(publication.url, { redirect: 'manual', signal: options.signal });
          if (response.status !== 200) throw new EvidenceError('http', 'WWA article unavailable');
          const article = parseWwaArticle(response.text, publication.url);
          const rssDate = publication.publishedAt;
          publication = { ...article, publishedAt: rssDate && (!article.publishedAt || article.publishedAt.slice(0, 10) === rssDate.slice(0, 10)) ? rssDate : article.publishedAt };
        }
        result.items.push({ itemId, lane, raw: publication });
      } catch (error) { result.failures.push({ itemId, lane, code: error instanceof EvidenceError ? error.code : 'fetch' }); result.complete[lane] = false; }
    };
    // Head always gets first access to the budget; failures/history never hide new publications.
    let pages = 0;
    const readPage = async (page: number, conditional = false) => {
      if (pageCache.has(page)) return pageCache.get(page)!;
      if (++pages > maxPages) throw new EvidenceError('validation', 'WWA page budget exhausted');
      const headers: Record<string, string> = {};
      if (conditional && !(options.replay?.length || oldDeferred.length)) {
        if (typeof state.etag === 'string') headers['If-None-Match'] = state.etag;
        if (typeof state.lastModified === 'string') headers['If-Modified-Since'] = state.lastModified;
      }
      const response = await this.http.request(page === 1 ? wwaFeedUrl : `${wwaFeedUrl}?paged=${page}`, { headers, redirect: 'manual', signal: options.signal });
      if (response.status === 304 && conditional) return null;
      if (response.status !== 200) throw new EvidenceError('http', `WWA feed page unavailable (${response.status})`);
      let invalid = 0;
      const items = parseWwaFeed(response.text, () => {
        result.skipped++; invalid++;
        result.skippedItems!.push({ lane: page === 1 ? 'discovery' : 'backfill', code: 'contract' });
      });
      if (!items.length && invalid) throw new EvidenceError('contract', 'Malformed feed items do not establish an exhausted archive');
      const hash = await fingerprint(items.map(item => item.url));
      if (items.length && (pageHashes.has(hash) || (page > 1 && state.lastPageHash === hash && state.lastPage !== page))) throw new EvidenceError('contract', 'WWA pagination repeated an earlier page');
      pageHashes.add(hash);
      pageCache.set(page, items);
      if (page === 1) { state.etag = response.headers.get('etag'); state.lastModified = response.headers.get('last-modified'); }
      else { state.lastPageHash = hash; state.lastPage = page; }
      return items;
    };
    try {
      const head = await readPage(1, true);
      // Split item budget between current discovery and replay/history/rechecks.
      const headAllowance = Math.max(1, Math.ceil(maxItems / 3));
      for (const publication of head ?? []) {
        const hash = await fingerprint(publication); nextHeadHashes[publication.url] = hash;
        if (headHashes[publication.url] === hash && !options.replay?.includes(publication.url)) { result.unchanged = (result.unchanged ?? 0) + 1; continue; }
        if (result.items.length >= headAllowance && eligibleWwa(publication.title, publication.categories, publication.html)) { deferred.push({ id: publication.url, lane: 'discovery' }); result.complete.discovery = false; }
        else await add(publication, 'discovery');
      }
      if (head) state.headHashes = nextHeadHashes;
      // Recent overlap is a discovery hint only; older work continues separately.
      const cutoff = options.since ? Date.parse(options.since) - (options.overlapDays ?? 7) * 86400000 : NaN;
      if (head?.length && Number.isFinite(cutoff) && head.every(p => p.publishedAt && Date.parse(p.publishedAt) >= cutoff)) {
        let recentPage = Number.isInteger(state.discoveryPage) ? Math.max(2, Number(state.discoveryPage)) : 2;
        let reachedBoundary = false;
        while (pages < Math.max(1, Math.floor(maxPages / 3)) && result.items.length < headAllowance) {
          const recent = await readPage(recentPage);
          for (const publication of recent ?? []) await add(publication, 'discovery');
          if (!recent?.length || recent.some(p => p.publishedAt && Date.parse(p.publishedAt) < cutoff)) { reachedBoundary = true; recentPage = 2; break; }
          recentPage++;
        }
        state.discoveryPage = recentPage; result.complete.discovery &&= reachedBoundary;
      }
    } catch (error) { result.complete.discovery = false; result.failures.push({ lane: 'discovery', code: error instanceof EvidenceError ? error.code : 'fetch' }); }
    const replay = [...new Set([...(options.replay ?? []), ...oldDeferred.map(item => item.id)])];
    const checks = options.recheck ?? [];
    // Round-robin replay, historical pages and recheck items across successive bounded runs.
    const background: { id: string; lane: WorkLane }[] = [];
    for (let i = 0; i < Math.max(replay.length, checks.length); i++) {
      if (replay[i]) background.push({ id: replay[i], lane: oldDeferred.find(item => item.id === replay[i])?.lane ?? 'pending' });
      if (checks[i]) background.push({ id: checks[i], lane: 'recheck' });
    }
    const replayAllowance = Math.max(1, Math.floor(maxItems / 3));
    let backgroundFetched = 0;
    const backgroundSeen = new Set<string>();
    for (let i = 0; i < background.length; i++) {
      const item = background[i];
      if (seen.has(item.id) || backgroundSeen.has(item.id)) continue;
      backgroundSeen.add(item.id);
      if (backgroundFetched >= replayAllowance || result.items.length >= maxItems) { deferred.push(item); result.complete[item.lane] = false; continue; }
      backgroundFetched++;
      try {
        const response = await this.http.request(officialUrl(item.id), { redirect: 'manual', signal: options.signal });
        if (response.status !== 200) throw new EvidenceError('http', 'WWA replay/recheck unavailable');
        const publication = parseWwaArticle(response.text, item.id);
        const knownDate = options.publicationDates?.[item.id];
        // Retain a previously observed RSS timestamp when HTML only supplies
        // the same calendar day; preserve an explicitly corrected article day.
        if (knownDate && (!publication.publishedAt || publication.publishedAt.slice(0, 10) === knownDate.slice(0, 10))) publication.publishedAt = knownDate;
        await add(publication, item.lane, item.id);
      } catch (error) { result.failures.push({ itemId: item.id, lane: item.lane, code: error instanceof EvidenceError ? error.code : 'fetch' }); result.complete[item.lane] = false; }
    }
    const archiveDue = typeof state.archiveDoneAt !== 'string' || Date.now() - Date.parse(state.archiveDoneAt) >= 28 * 86400000;
    let page = Number.isInteger(state.backfillPage) ? Number(state.backfillPage) : 2;
    if (!archiveDue) result.complete.backfill = true;
    else while (pages < maxPages && result.items.length < maxItems) {
      try {
        const items = await readPage(page);
        if (!items?.length) { result.complete.backfill = true; state.archiveDoneAt = new Date().toISOString(); page = 2; break; }
        for (const publication of items) await add(publication, 'backfill');
        page++; state.backfillPage = page;
        if (deferred.length) break;
      } catch (error) { result.failures.push({ lane: 'backfill', code: error instanceof EvidenceError ? error.code : 'fetch' }); break; }
    }
    state.backfillPage = page;
    state.deferred = [...new Map(deferred.map(item => [item.id, item])).values()];
    if (deferred.some(item => item.lane === 'backfill')) result.complete.backfill = false;
    return result;
  }
}
