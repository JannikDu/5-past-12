import { EvidenceError } from '../domain/evidence.ts';
export interface HttpOptions {
  fetch?: typeof fetch; timeoutMs?: number; maxBytes?: number; retries?: number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}
export interface HttpResponse { status: number; headers: Headers; text: string }
export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const abort = () => { clearTimeout(timer); reject(new EvidenceError('cancelled', 'Request cancelled')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}
export class EvidenceHttpClient {
  constructor(private readonly options: HttpOptions = {}) {}
  async request(url: string, init: RequestInit = {}): Promise<HttpResponse> {
    const { fetch: fetcher = fetch, timeoutMs = 15000, maxBytes = 2 * 1024 * 1024, retries = 2, sleep = delay } = this.options;
    const backoff = (attempt: number) => Math.round(250 * 2 ** attempt * (0.8 + Math.random() * 0.4));
    for (let attempt = 0; ; attempt++) {
      if (init.signal?.aborted) throw new EvidenceError('cancelled', 'Request cancelled');
      const timeout = AbortSignal.timeout(timeoutMs);
      const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
      try {
        // workerd rejects redirect: 'error'. Manual mode plus an explicit guard
        // preserves the same policy without forwarding credentials to redirects.
        const rejectRedirects = init.redirect === 'error';
        const response = await fetcher(url, { ...init, ...(rejectRedirects ? { redirect: 'manual' as const } : {}), signal });
        if (rejectRedirects && [301, 302, 303, 307, 308].includes(response.status)) {
          await response.body?.cancel(); throw new EvidenceError('http', 'HTTP redirect blocked');
        }
        if ([408, 429, 500, 502, 503, 504].includes(response.status) && attempt < retries) {
          await response.body?.cancel();
          const retry = response.headers.get('retry-after');
          const ms = retry ? (/^\d+$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - Date.now()) : backoff(attempt);
          await sleep(Math.min(10000, Math.max(0, Number.isFinite(ms) ? ms : 250)), init.signal ?? undefined); continue;
        }
        let text = '';
        if (Number(response.headers.get('content-length')) > maxBytes) {
          await response.body?.cancel(); throw new EvidenceError('contract', 'HTTP response exceeds body cap');
        }
        const reader = response.body?.getReader();
        const decoder = new TextDecoder(); let bytes = 0;
        try {
          if (reader) while (true) {
            const part = await reader.read(); signal.throwIfAborted();
            if (part.done) break;
            bytes += part.value.byteLength;
            if (bytes > maxBytes) { await reader.cancel(); throw new EvidenceError('contract', 'HTTP response exceeds body cap'); }
            text += decoder.decode(part.value, { stream: true });
          }
          text += decoder.decode();
        } finally { reader?.releaseLock(); }
        return { status: response.status, headers: response.headers, text };
      } catch (error) {
        if (init.signal?.aborted) throw new EvidenceError('cancelled', 'Request cancelled');
        if (timeout.aborted) {
          if (attempt >= retries) throw new EvidenceError('timeout', 'HTTP operation timed out');
        } else if (error instanceof EvidenceError) throw error;
        else if (attempt >= retries) throw new EvidenceError('http', 'HTTP transport failed');
        await sleep(backoff(attempt), init.signal ?? undefined);
      }
    }
  }
  async json(url: string, init: RequestInit = {}): Promise<unknown> {
    const result = await this.request(url, init);
    if (result.status < 200 || result.status >= 300) throw new EvidenceError([401, 403].includes(result.status) ? 'authentication' : 'http', `HTTP request failed (${result.status})`);
    try { return JSON.parse(result.text); } catch { throw new EvidenceError('contract', 'Invalid JSON response'); }
  }
}
