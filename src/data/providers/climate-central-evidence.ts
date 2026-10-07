import { parseHTML } from 'linkedom';
import { EvidenceError, type WorkLane } from '../../domain/evidence.ts';
import { EvidenceHttpClient, type HttpOptions } from '../http.ts';
import { htmlText, normalizeText, dateOrNull } from '../normalizers/evidence-text.ts';
import type { EvidenceSourceProvider, EvidenceFetchOptions, EvidenceFetchBatch, FetchDiagnostic } from './evidence-source.ts';
import { fingerprint } from '../../services/evidence-identity.ts';

export const climateCentralUrl = 'https://www.climatecentral.org/climate-shift-index-alert';
export interface ClimateCentralAlert {
  anchor: string; url: string; title: string; text: string; publishedAt: string | null;
  location: string | null; hazards: string[]; eventStart?: string | null; eventEnd?: string | null;
}
export function parseClimateCentral(html: string, onInvalid?: (itemId: string, code: string) => void): ClimateCentralAlert[] {
  const { document } = parseHTML(html);
  const containers = [...document.querySelectorAll('[id^="alert-"]')];
  if (!containers.length && !document.querySelector('[data-alerts-empty]')) throw new EvidenceError('contract', 'CSI alert structure changed: stable alert containers are missing');
  return containers.flatMap(container => {
    const anchor = container.id;
    try {
      if (!/^alert-[A-Za-z0-9_-]+$/.test(anchor)) throw new EvidenceError('contract', 'CSI alert has an invalid identity');
      const heading = container.querySelector('h4,h3,h2');
      heading?.querySelector('button')?.remove();
      const description = container.querySelector('[class*="card_description"] section,[data-alert-body]');
      const excerpt = container.querySelector('[class*="card_header_excerpt"],[data-alert-excerpt]');
      if (!description || !heading) throw new EvidenceError('contract', 'CSI alert title or full findings are missing');
      const body = htmlText(description.innerHTML);
      const intro = normalizeText(excerpt?.textContent ?? '');
      const title = normalizeText(heading.textContent ?? '');
      const date = container.parentElement?.querySelector('[class*="card_date"],time');
      if (!title || !body) throw new EvidenceError('contract', 'CSI alert has no title or substantive findings');
      return [{ anchor, url: `${climateCentralUrl}#${anchor}`, title,
        text: intro && !body.includes(intro) ? `${intro}\n\n${body}` : body,
        publishedAt: dateOrNull(date?.getAttribute('datetime') ?? (date?.textContent ? `${date.textContent} UTC` : null)),
        location: normalizeText(container.querySelector('[class*="label"],[data-alert-location]')?.textContent ?? '') || null,
        hazards: [...container.querySelectorAll('[class*="tags_element"],[data-alert-hazard]')].map(node => normalizeText(node.textContent ?? '')),
      }];
    } catch (error) {
      if (!onInvalid) throw error;
      onInvalid(anchor, error instanceof EvidenceError ? error.code : 'contract');
      return [];
    }
  });
}
export class ClimateCentralEvidenceProvider implements EvidenceSourceProvider<ClimateCentralAlert> {
  readonly id = 'climate-central'; readonly name = 'Climate Central';
  private readonly http: EvidenceHttpClient;
  constructor(options: HttpOptions = {}) { this.http = new EvidenceHttpClient(options); }
  async fetchNew(options: EvidenceFetchOptions = {}): Promise<EvidenceFetchBatch<ClimateCentralAlert>> {
    const state = options.state ?? {};
    const outstanding = [...(options.replay ?? []), ...(options.recheck ?? []), ...(Array.isArray(state.deferred) ? state.deferred.filter((v): v is string => typeof v === 'string') : [])];
    const headers: Record<string, string> = {};
    if (!outstanding.length) {
      if (typeof state.etag === 'string') headers['If-None-Match'] = state.etag;
      if (typeof state.lastModified === 'string') headers['If-Modified-Since'] = state.lastModified;
    }
    const response = await this.http.request(climateCentralUrl, { headers, redirect: 'manual', signal: options.signal });
    if (response.status === 304) return { items: [], failures: [], skipped: 0, state,
      complete: { discovery: true, backfill: true, recheck: true, pending: true } };
    if (response.status !== 200) throw new EvidenceError('http', `CSI log unavailable (${response.status})`);
    const lane = (itemId: string): WorkLane => options.replay?.includes(itemId) ? 'pending' : options.recheck?.includes(itemId) ? 'recheck' : 'discovery';
    const skippedItems: FetchDiagnostic[] = [];
    const alerts = parseClimateCentral(response.text, (itemId, code) => skippedItems.push({ itemId, code, lane: lane(itemId) }));
    const byId = new Map(alerts.map(alert => [alert.anchor, alert]));
    const hashes = typeof state.hashes === 'object' && state.hashes ? { ...state.hashes } as Record<string, string> : {};
    const fetchedHashes = new Map<string, string>();
    for (const alert of alerts) fetchedHashes.set(alert.anchor, await fingerprint(alert));
    const changed = alerts.filter(alert => hashes[alert.anchor] !== fetchedHashes.get(alert.anchor)).map(alert => alert.anchor);
    const malformed = new Set(skippedItems.map(item => item.itemId));
    const ids = [...new Set([...changed, ...outstanding])].filter(id => !malformed.has(id));
    const maxItems = options.maxItems ?? 20;
    // Missing old anchors must not monopolize the next run's discovery budget.
    const selected = [...new Set([
      ...changed.slice(0, Math.max(1, Math.ceil(maxItems / 3))),
      ...(options.recheck ?? []).filter(id => !malformed.has(id)).slice(0, Math.floor(maxItems / 3)),
      ...outstanding.filter(id => !malformed.has(id)).slice(0, Math.floor(maxItems / 3)),
      ...ids,
    ])].slice(0, maxItems);
    const failures = selected.filter(id => !byId.has(id)).map(itemId => ({ itemId, lane: lane(itemId), code: 'unavailable-anchor' }));
    const deferred = ids.filter(id => !selected.includes(id));
    for (const id of selected) if (fetchedHashes.has(id)) hashes[id] = fetchedHashes.get(id)!;
    return {
      items: selected.filter(id => byId.has(id)).map(itemId => ({ itemId, lane: lane(itemId), raw: byId.get(itemId)! })),
      failures, skippedItems, skipped: skippedItems.length, unchanged: alerts.length - changed.length,
      complete: { discovery: !changed.some(id => deferred.includes(id)), backfill: true, recheck: !(options.recheck ?? []).some(id => deferred.includes(id)), pending: !(options.replay ?? []).some(id => deferred.includes(id)) },
      state: { etag: response.headers.get('etag'), lastModified: response.headers.get('last-modified'), deferred, hashes },
    };
  }
}
