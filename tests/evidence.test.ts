import test from 'node:test';
import assert from 'node:assert/strict';
import { EvidenceChunker } from '../src/services/evidence-chunker.ts';
import { EvidenceRebuildService } from '../src/services/evidence-rebuild.ts';
import { EvidenceIngestionJob } from '../src/services/evidence-job.ts';
import { FeatherlessEmbeddingProvider } from '../src/data/embeddings/featherless.ts';
import { EvidenceHttpClient } from '../src/data/http.ts';
import { canonicalUrl, sourceHash, fingerprint } from '../src/services/evidence-identity.ts';
import { validateQuery, DefaultEvidenceRetrievalService } from '../src/services/evidence-retrieval.ts';
import { mapEvidenceSearchResult, SupabaseEvidenceRepository } from '../src/data/repositories/supabase-evidence.ts';
import { ClimateCentralEvidenceProvider, parseClimateCentral } from '../src/data/providers/climate-central-evidence.ts';
import { WorldWeatherAttributionEvidenceProvider, parseWwaFeed, parseWwaArticle } from '../src/data/providers/world-weather-attribution-evidence.ts';
import { ClimateCentralEvidenceNormalizer } from '../src/data/normalizers/climate-central-evidence.ts';
import { WorldWeatherAttributionEvidenceNormalizer } from '../src/data/normalizers/world-weather-attribution-evidence.ts';
import { evidenceConfig } from '../src/server/config.ts';
import { EventCategory } from '../src/domain/climate-event.ts';
import { validateVector, type ProviderProgress, type RebuildStatus } from '../src/domain/evidence.ts';
import { consoleEvidenceLogger } from '../src/server/logging.ts';
import { htmlText } from '../src/data/normalizers/evidence-text.ts';
import type { EvidenceRepository } from '../src/data/repositories/evidence-repository.ts';
import { csiHtml, wwaFeed, wwaArticle, vector, profile, source, wwaUrl } from './helpers/evidence-fixtures.ts';

test('chunking covers Unicode code points deterministically within bounds', () => {
  const chunker = new EvidenceChunker({ size: 40, overlap: 8, minSize: 10 });
  for (const text of ['😀'.repeat(131), 'Paragraph one.\n\n' + 'Long sentence with words. '.repeat(10), 'x'.repeat(85), 'short']) {
    const chunks = chunker.chunk(text);
    assert.deepEqual(chunks, chunker.chunk(text));
    assert.equal(chunks[0].start, 0); assert.equal(chunks.at(-1)!.end, Array.from(text).length);
    chunks.forEach((chunk, i) => {
      assert.equal(chunk.chunkIndex, i); assert.ok(Array.from(chunk.content).length <= 40);
      assert.equal(chunk.content, Array.from(text).slice(chunk.start, chunk.end).join(''));
      if (i) { assert.ok(chunk.start <= chunks[i - 1].end); assert.ok(chunk.end > chunks[i - 1].end); }
    });
  }
  assert.deepEqual(chunker.chunk(' \n '), []);
  assert.throws(() => new EvidenceChunker({ size: 20, overlap: 20, minSize: 1 }));
});
test('content identity canonicalizes tracking and fingerprints meaningful metadata separately from processing', async () => {
  assert.equal(canonicalUrl('https://EXAMPLE.org:443/a/?utm_source=mail&id=3#fragment'), 'https://example.org/a/?id=3');
  assert.equal(canonicalUrl('https://example.org/#alert-1', true), 'https://example.org/#alert-1');
  assert.throws(() => canonicalUrl('https://user:pass@example.org'));
  assert.equal(await sourceHash(source()), await sourceHash({ ...source(), eventTypes: [...source().eventTypes] }));
  assert.notEqual(await sourceHash(source()), await sourceHash({ ...source(), title: 'Corrected finding' }));
  assert.notEqual(await fingerprint(profile), await fingerprint({ ...profile, embedding: { ...profile.embedding, queryPolicy: 'new' } }));
});
test('HTML normalization preserves mixed and nested scientific qualifiers while removing boilerplate', () => {
  const text = htmlText('<nav>Donate menu</nav><p>Observed <b>heat</b>.</p>Uncertainty remains.<ul><li>No detectable change.<p>Confidence interval includes zero.</p></li></ul>');
  assert.match(text, /Observed heat/); assert.match(text, /Uncertainty remains/); assert.match(text, /No detectable change/);
  assert.match(text, /Confidence interval includes zero/); assert.doesNotMatch(text, /Donate menu/);
});
test('Featherless role formatting, batching and indexed order', async () => {
  const requests: Record<string, unknown>[] = [];
  const fetcher: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)); requests.push(body);
    return Response.json({ data: body.input.map((_text: string, index: number) => ({ index, embedding: vector(index + 1) })).reverse() });
  };
  const provider = new FeatherlessEmbeddingProvider({ apiKey: 'secret-test', model: 'Qwen/Qwen3-Embedding-4B', batchSize: 2 }, { fetch: fetcher });
  const vectors = await provider.embed(['a', 'b', 'c'], 'document');
  assert.deepEqual(vectors.map(v => v[0]), [1, 2, 1]);
  assert.deepEqual(requests[0].input, ['a', 'b']); assert.equal(requests[0].dimensions, 1536);
  await provider.embed(['Spain fire weather'], 'query');
  assert.match(String((requests.at(-1)!.input as string[])[0]), /^Instruct: .+\nQuery: Spain fire weather$/);
  const count = requests.length; assert.deepEqual(await provider.embed([], 'query'), []); assert.equal(requests.length, count);
});
test('embedding rejects wrong dimensions, zero/nonfinite vectors and invalid cardinality/indices', async () => {
  for (const value of [Array(1024).fill(1), Array(1536).fill(0), [...vector().slice(1), Infinity]]) assert.throws(() => validateVector(value));
  const sparse = new Array(1536); sparse[0] = 1; assert.throws(() => validateVector(sparse), { code: 'embedding' });
  for (const data of [[{ index: 0, embedding: vector() }, { index: 0, embedding: vector() }], [{ index: 2, embedding: vector() }], [], [{ index: 0, embedding: Array(2560).fill(1) }]]) {
    const provider = new FeatherlessEmbeddingProvider({ apiKey: 'fake', model: 'embedding' }, { fetch: async () => Response.json({ data }) });
    await assert.rejects(provider.embed(['a'], 'document'));
  }
});
test('HTTP transient retries, Retry-After, permanent statuses, caps and cancellation', async () => {
  let calls = 0; const sleeps: number[] = [];
  const http = new EvidenceHttpClient({ fetch: async () => ++calls === 1 ? new Response('', { status: 429, headers: { 'Retry-After': '2' } }) : Response.json({ ok: true }), sleep: async ms => { sleeps.push(ms); } });
  assert.deepEqual(await http.json('https://example.org'), { ok: true }); assert.deepEqual(sleeps, [2000]);
  calls = 0;
  await assert.rejects(new EvidenceHttpClient({ fetch: async () => { calls++; return new Response('', { status: 401 }); } }).json('https://example.org'), { code: 'authentication' }); assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(new EvidenceHttpClient({ fetch: async () => { calls++; return new Response('', { status: 503 }); }, sleep: async () => {} }).json('https://example.org'), { code: 'http' });
  assert.equal(calls, 3);
  await assert.rejects(new EvidenceHttpClient({ maxBytes: 2, fetch: async () => new Response('large') }).json('https://example.org'), { code: 'contract' });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(http.request('https://example.org', { signal: controller.signal }), { code: 'cancelled' });
  const streamed = new EvidenceHttpClient({ timeoutMs: 10, retries: 0, fetch: async (_url, init) => new Response(new ReadableStream({ start(controller) {
    init?.signal?.addEventListener('abort', () => controller.error(new Error('aborted')));
  } })) });
  await assert.rejects(streamed.json('https://example.org'), { code: 'timeout' });
});
test('CSI extraction preserves anchors, qualifiers and independent hazard metadata', async () => {
  const raw = parseClimateCentral(csiHtml())[0];
  assert.equal(raw.anchor, 'alert-spain'); assert.doesNotMatch(raw.text, /Donate|Copy URL/);
  const source = (await new ClimateCentralEvidenceNormalizer().normalize(raw))!;
  assert.equal(source.evidenceType, 'event_context'); assert.deepEqual(source.eventTypes, [EventCategory.Wildfire]);
  assert.equal(source.eventStart, null); assert.equal(source.publishedAt, '2026-10-06T00:00:00.000Z');
  assert.match(source.normalizedText, /Uncertainty remains/);
  assert.throws(() => parseClimateCentral('<html>new layout</html>'));
  const ocean = (await new ClimateCentralEvidenceNormalizer().normalize({ ...raw, hazards: ['Ocean heat'] }))!;
  assert.deepEqual(ocean.eventTypes, [EventCategory.Temperature]);
});
test('CSI conditional state cannot hide pending downstream failures', async () => {
  const requests: Headers[] = [];
  const provider = new ClimateCentralEvidenceProvider({ fetch: async (_url, init) => {
    const headers = new Headers(init?.headers); requests.push(headers);
    return headers.has('If-None-Match') ? new Response(null, { status: 304 }) : new Response(csiHtml(), { headers: { etag: 'etag' } });
  } });
  const first = await provider.fetchNew(); const clean = await provider.fetchNew({ state: first.state }); assert.equal(clean.items.length, 0);
  const retry = await provider.fetchNew({ state: first.state, replay: ['alert-spain'] }); assert.equal(retry.items.length, 1);
  assert.equal(requests[2].has('If-None-Match'), false);
  const missing = await provider.fetchNew({ state: first.state, recheck: ['alert-missing'] }); assert.equal(missing.failures[0].code, 'unavailable-anchor');
});
test('CSI bounded continuation handles all distinct alerts without cycling over unchanged cards', async () => {
  const html = csiHtml() + csiHtml().replaceAll('alert-spain', 'alert-second');
  const provider = new ClimateCentralEvidenceProvider({ fetch: async () => new Response(html) });
  const first = await provider.fetchNew({ maxItems: 1 }); assert.equal(first.items.length, 1); assert.equal(first.complete.discovery, false);
  const second = await provider.fetchNew({ maxItems: 1, state: first.state });
  assert.equal(second.items.length, 1); assert.notEqual(second.items[0].itemId, first.items[0].itemId); assert.equal(second.complete.discovery, true);
  const third = await provider.fetchNew({ state: second.state }); assert.equal(third.items.length, 0);
});

test('one malformed CSI card is reported while usable alerts still cross the provider boundary', async () => {
  const malformed = csiHtml().replaceAll('alert-spain', 'alert-invalid').replace(/<h4>.*?<\/h4>/, '');
  const provider = new ClimateCentralEvidenceProvider({ fetch: async () => new Response(malformed + csiHtml()) });
  const result = await provider.fetchNew({ recheck: ['alert-invalid'] });
  assert.equal(result.items.length, 1); assert.equal(result.items[0].raw.url.endsWith('#alert-spain'), true);
  assert.equal(result.skipped, 1);
  assert.deepEqual(result.skippedItems, [{ itemId: 'alert-invalid', lane: 'recheck', code: 'contract' }]);
  assert.deepEqual(result.failures, []);
});

test('unavailable old CSI anchors cannot starve newly discovered alerts', async () => {
  const provider = new ClimateCentralEvidenceProvider({ fetch: async () => new Response(csiHtml()) });
  const result = await provider.fetchNew({ maxItems: 3, replay: ['alert-old-a', 'alert-old-b', 'alert-old-c'] });
  assert.equal(result.items[0].itemId, 'alert-spain');
  assert.equal(result.complete.discovery, true); assert.equal(result.complete.pending, false);
  assert.ok(result.failures.every(failure => failure.lane === 'pending'));
});
test('WWA historical feed, HTML fallback, unrelated content and observational classification', async () => {
  const raw = parseWwaFeed(wwaFeed())[0];
  assert.equal(raw.publishedAt, '2020-08-03T12:00:00.000Z');
  const normalizer = new WorldWeatherAttributionEvidenceNormalizer(); const s = (await normalizer.normalize(raw))!;
  assert.equal(s.evidenceType, 'analogue_attribution'); assert.equal(s.sourceType, 'attribution_study');
  assert.equal(s.region, null); assert.equal(s.eventStart, null); assert.deepEqual(s.eventTypes, [EventCategory.Heat, EventCategory.Drought]);
  assert.equal(await normalizer.normalize({ ...raw, title: 'Recruitment: job opportunity' }), null);
  const observations = (await normalizer.normalize({ ...raw, html: '<p>Observations show extreme heat during this climate event, with no new analysis.</p>' }))!;
  assert.equal(observations.sourceType, 'observation');
  assert.doesNotMatch(parseWwaArticle(wwaArticle(), wwaUrl).html, /Do not index menu/);
  assert.throws(() => parseWwaFeed('<rss>broken'));
  assert.throws(() => parseWwaArticle('<h1>Missing body</h1>', wwaUrl));
});

test('WWA distinguishes current attribution from observations and references to earlier studies', async () => {
  const raw = parseWwaFeed(wwaFeed())[0];
  const normalizer = new WorldWeatherAttributionEvidenceNormalizer();
  for (const html of [
    '<p>We analysed observations of this heat event. Previous attribution studies found that climate change made heat more likely.</p>',
    '<p>This rapid analysis uses observations only. An earlier attribution study provides climate context.</p>',
    '<p>Climate change makes heat more likely. This article explains an earlier attribution analysis.</p>',
  ]) {
    const result = (await normalizer.normalize({ ...raw, html }))!;
    assert.notEqual(result.evidenceType, 'analogue_attribution');
    assert.notEqual(result.sourceType, 'attribution_study');
  }
  const study = (await normalizer.normalize({ ...raw, html: '<p>In this attribution study we compare climate models with and without human-induced warming. We find no detectable change in heat likelihood.</p>' }))!;
  assert.equal(study.evidenceType, 'analogue_attribution');
  const negative = (await normalizer.normalize({ ...raw, html: '<p>To assess human-induced climate change, we combine observations with climate models. Neither method finds a detectable change in this heat event.</p>' }))!;
  assert.equal(negative.sourceType, 'attribution_study');
  const heatwaves = (await normalizer.normalize({ ...raw, title: 'Fossil fuel emissions have worsened European heatwaves', categories: ['Heatwave'] }))!;
  assert.equal(heatwaves.sourceType, 'attribution_study');
  const wildfire = (await normalizer.normalize({ ...raw, title: 'Extreme fire weather in Spain', categories: [] }))!;
  assert.deepEqual(wildfire.eventTypes, [EventCategory.Wildfire]);
  const ocean = (await normalizer.normalize({ ...raw, title: 'European ocean temperatures', categories: ['Heatwave'] }))!;
  assert.deepEqual(ocean.eventTypes, [EventCategory.Temperature]);
});

test('WWA discovery and article rechecks normalize to the same source identity and metadata', async () => {
  const article = wwaArticle().replace('</head>', '<meta property="article:modified_time" content="2020-08-04T12:00:00Z"></head>');
  const provider = new WorldWeatherAttributionEvidenceProvider({ fetch: async input => new Response(String(input) === wwaUrl ? article : String(input).includes('paged=') ? wwaFeed([]) : wwaFeed()) });
  const discovery = await provider.fetchNew();
  const recheck = await provider.fetchNew({ state: discovery.state, recheck: [wwaUrl], publicationDates: { [wwaUrl]: '2020-08-03T12:00:00.000Z' } });
  const normalizer = new WorldWeatherAttributionEvidenceNormalizer();
  assert.equal(await sourceHash((await normalizer.normalize(discovery.items[0].raw))!), await sourceHash((await normalizer.normalize(recheck.items[0].raw))!));
});

test('WWA shared discovery/backfill page is fetched once without a false pagination error', async () => {
  const oldUrl = 'https://www.worldweatherattribution.org/old-drought/';
  const old = wwaFeed([{ url: oldUrl, title: 'Historical drought attribution', body: '<p>This attribution study analyses climate drought.</p>'.repeat(30), date: 'Mon, 01 Jan 2018 12:00:00 GMT', category: 'Drought' }]);
  const head = wwaFeed([{ url: wwaUrl, title: 'Current heat attribution', body: '<p>This attribution study analyses climate heat.</p>'.repeat(30), date: 'Wed, 07 Oct 2026 12:00:00 GMT', category: 'Extreme heat' }]);
  const calls: string[] = [];
  const provider = new WorldWeatherAttributionEvidenceProvider({ fetch: async input => {
    const url = String(input); calls.push(url);
    return new Response(url === wwaUrl ? wwaArticle() : url === oldUrl ? wwaArticle(undefined, oldUrl) : url.includes('paged=2') ? old : url.includes('paged=') ? wwaFeed([]) : head);
  } });
  const result = await provider.fetchNew({ since: '2026-10-01T00:00:00Z', maxItems: 9, maxPages: 9, state: { headHashes: { [wwaUrl]: await fingerprint(parseWwaFeed(head)[0]) } } });
  assert.equal(calls.filter(url => url.includes('paged=2')).length, 1);
  assert.equal(result.complete.backfill, true);
  assert.deepEqual(result.failures, []);
});

test('WWA duplicate background identities do not consume another recheck slot', async () => {
  const secondUrl = 'https://www.worldweatherattribution.org/second-heat-study/';
  const provider = new WorldWeatherAttributionEvidenceProvider({ fetch: async input => {
    const url = String(input); return new Response(url.includes('/feed/') ? wwaFeed([]) : wwaArticle(undefined, url));
  } });
  const result = await provider.fetchNew({ maxItems: 6, replay: [wwaUrl], recheck: [wwaUrl, secondUrl] });
  assert.deepEqual(result.items.map(item => item.itemId), [wwaUrl, secondUrl]);
  assert.deepEqual(result.failures, []);
});

test('WWA canonical identity rejects unrelated paths and provider requests cannot follow offsite redirects', async () => {
  assert.throws(() => parseWwaArticle(wwaArticle(undefined, 'https://www.worldweatherattribution.org/unrelated/'), wwaUrl), { code: 'contract' });
  assert.equal(parseWwaArticle(wwaArticle(), wwaUrl.slice(0, -1)).url, wwaUrl);
  const provider = new WorldWeatherAttributionEvidenceProvider({ fetch: async (_input, init) => {
    assert.equal(init?.redirect, 'manual');
    return new Response(null, { status: 302, headers: { location: 'https://unrelated.example/' } });
  } });
  const batch = await provider.fetchNew({ maxPages: 2 });
  assert.equal(batch.items.length, 0); assert.ok(batch.failures.length);
});

test('weekly cursor advances over a processed prefix and durable failed identities', async () => {
  let progress: ProviderProgress = { since: null, state: {}, pending: [], recheckAfter: null, recheckCursor: null, recheckThrough: '2026-10-07T00:00:00Z' };
  const repository = {
    ensureGeneration: async () => ({ id: crypto.randomUUID(), profile }),
    acquireLease: async (providerId: string, owner: string) => ({ providerId, owner, progress }),
    knownItems: async () => progress.recheckCursor ? [{ itemId: 'b', publishedAt: null }] : [{ itemId: 'a', publishedAt: null }, { itemId: 'b', publishedAt: null }],
    checkpoint: async (_lease: unknown, next: ProviderProgress) => { progress = next; },
  } as unknown as EvidenceRepository;
  const job = new EvidenceIngestionJob([{ id: 'fake', async run() { return { fetched: 0, outcomes: [], batch: { failures: progress.recheckCursor ? [] : [{ itemId: 'a', lane: 'recheck' as const, code: 'http' }], skippedItems: progress.recheckCursor ? [{ itemId: 'b', lane: 'recheck' as const, code: 'ineligible' }] : [], skipped: 0, state: {}, complete: { discovery: true, pending: true, recheck: false, backfill: true } } }; } }], repository, profile, { info() {} });
  await job.run();
  assert.deepEqual(progress.pending, ['a']);
  assert.equal(progress.recheckCursor, 'a');
  await job.run(); assert.equal(progress.recheckCursor, 'b'); assert.deepEqual(progress.pending, ['a']);
});

test('rebuild rejects adapter/profile mismatch before external calls and keeps its own fence', async () => {
  const repository = {} as EvidenceRepository;
  assert.throws(() => new EvidenceRebuildService(repository, { profile: { ...profile.embedding, model: 'other' }, embed: async () => [] }, new EvidenceChunker(), profile), { code: 'generation' });
  assert.throws(() => new EvidenceRebuildService(repository, { profile: profile.embedding, embed: async () => [] }, new EvidenceChunker({ size: 500, overlap: 50, minSize: 100 }), profile), { code: 'generation' });
  const owner = crypto.randomUUID();
  const status: RebuildStatus = { generation: { id: crypto.randomUUID(), profile }, previousGenerationId: crypto.randomUUID(), owner, expiresAt: '2026-10-08T00:00:00Z', manifest: [], completed: [] };
  let activations = 0;
  const service = new EvidenceRebuildService({ startRebuild: async () => status, rebuildStatus: async () => ({ ...status, owner: crypto.randomUUID() }), activateRebuild: async () => { activations++; } } as unknown as EvidenceRepository,
    { profile: profile.embedding, embed: async texts => texts.map(() => vector()) }, new EvidenceChunker(), profile);
  await assert.rejects(service.run('start', owner), { code: 'lease' });
  assert.equal(activations, 0);
});
test('WWA bounded distinct pagination and direct old rechecks with unchanged publication dates', async () => {
  const calls: string[] = [];
  const provider = new WorldWeatherAttributionEvidenceProvider({ fetch: async input => {
    const url = String(input); calls.push(url);
    if (url === wwaUrl) return new Response(wwaArticle('<p>We analysed corrected drought attribution findings with substantial uncertainty.</p>'));
    if (url === 'https://www.worldweatherattribution.org/old-drought/') return new Response(wwaArticle(undefined, url).replace('2020-08-03T12:00:00Z', '2018-01-01T12:00:00Z'));
    if (url.includes('paged=2')) return new Response(wwaFeed([{ url: 'https://www.worldweatherattribution.org/old-drought/', title: 'Historical drought attribution', body: '<p>We analysed drought climate attribution findings.</p>'.repeat(30), date: 'Mon, 01 Jan 2018 12:00:00 GMT', category: 'Drought' }]));
    if (url.includes('paged=3')) return new Response(wwaFeed([]));
    return new Response(wwaFeed());
  } });
  const batch = await provider.fetchNew({ maxPages: 3 });
  assert.equal(batch.complete.backfill, true); assert.ok(batch.items.some(i => i.raw.publishedAt?.startsWith('2018')));
  const revision = await provider.fetchNew({ state: batch.state, recheck: [wwaUrl] });
  assert.ok(revision.items.some(i => i.lane === 'recheck' && i.raw.html.includes('corrected'))); assert.ok(calls.includes(wwaUrl));
  const repeated = await new WorldWeatherAttributionEvidenceProvider({ fetch: async () => new Response(wwaFeed()) }).fetchNew({ maxPages: 3 });
  assert.equal(repeated.complete.backfill, false); assert.ok(repeated.failures.some(f => f.code === 'contract'));
});
test('WWA rechecks retain known RSS timestamp precision and malformed pages never claim archive exhaustion', async () => {
  const body = wwaArticle().replace('<article>', '<article><h4>03 August, 2020</h4>').replace('<meta property="article:published_time" content="2020-08-03T12:00:00Z">', '');
  const provider = new WorldWeatherAttributionEvidenceProvider({ fetch: async input => new Response(String(input) === wwaUrl ? body : String(input).includes('paged=') ? wwaFeed([]) : wwaFeed([])) });
  const result = await provider.fetchNew({ recheck: [wwaUrl], publicationDates: { [wwaUrl]: '2020-08-03T12:00:00.000Z' } });
  assert.equal(result.items[0].raw.publishedAt, '2020-08-03T12:00:00.000Z');
  const malformed = await new WorldWeatherAttributionEvidenceProvider({ fetch: async () => new Response('<rss><channel><item><title>missing identity</title></item></channel></rss>') }).fetchNew();
  assert.equal(malformed.complete.backfill, false); assert.ok(malformed.failures.length);
});
test('WWA discovery proceeds while bounded archive work remains unfinished', async () => {
  const provider = new WorldWeatherAttributionEvidenceProvider({ fetch: async input => {
    const url = String(input);
    if (url === wwaUrl || url === 'https://www.worldweatherattribution.org/archive-drought/') return new Response(wwaArticle(undefined, url));
    if (url.includes('paged=7')) return new Response(wwaFeed([{ url: 'https://www.worldweatherattribution.org/archive-drought/', title: 'Historical drought', body: '<p>We analysed climate drought attribution.</p>'.repeat(30), date: 'Mon, 01 Jan 2018 12:00:00 GMT', category: 'Drought' }]));
    return new Response(wwaFeed());
  } });
  const result = await provider.fetchNew({ state: { backfillPage: 7 }, maxPages: 2, maxItems: 6 });
  assert.equal(result.items[0].lane, 'discovery'); assert.ok(result.items.some(i => i.lane === 'backfill'));
  assert.equal(result.complete.backfill, false); assert.equal(result.state.backfillPage, 8);
});
test('query validation precedes integrations and metadata preferences may be empty', async () => {
  for (const input of [{ text: ' ' }, { text: 'a', limit: 0 }, { text: 'a', limit: 1.5 }, { text: 'a', region: ' ' }, { text: 'a', eventDate: new Date('invalid') }]) assert.throws(() => validateQuery(input));
  assert.deepEqual(validateQuery({ text: 'a', evidenceTypes: [], sourceTypes: [] }).evidenceTypes, []);
  let calls = 0;
  const retrieval = new DefaultEvidenceRetrievalService({ ensureGeneration: async () => { calls++; throw new Error(); } } as unknown as EvidenceRepository,
    { profile: profile.embedding, embed: async () => [] }, profile);
  await assert.rejects(retrieval.search({ text: ' ' })); assert.equal(calls, 0);
});
test('database mapping, modern secret header and typed integration failures', async () => {
  const row = { chunk_id: crypto.randomUUID(), source_id: crypto.randomUUID(), source_version_id: crypto.randomUUID(), content: 'passage', source_title: 'title',
    publisher: 'publisher', source_url: 'https://example.org', evidence_type: 'event_context', source_type: 'article', published_at: null, similarity: 0.2, score: 0.02 };
  assert.equal(mapEvidenceSearchResult(row).publishedAt, null); assert.equal(mapEvidenceSearchResult(row).similarity, 0.2);
  assert.throws(() => mapEvidenceSearchResult({ ...row, evidence_type: 'invented' })); assert.throws(() => mapEvidenceSearchResult({ ...row, score: NaN }));
  assert.throws(() => mapEvidenceSearchResult({ ...row, source_url: undefined }), { code: 'contract' });
  assert.throws(() => mapEvidenceSearchResult({ ...row, source_url: 'https://user:secret@example.org' }), { code: 'contract' });
  const repository = new SupabaseEvidenceRepository({ url: 'https://example.org', secretKey: 'sb_secret_fake' }, { fetch: async (_url, init) => {
    const headers = new Headers(init?.headers); assert.equal(headers.get('apikey'), 'sb_secret_fake'); assert.equal(headers.get('authorization'), null);
    return Response.json([row]);
  } });
  assert.equal((await repository.search({ text: 'test' }, vector(), crypto.randomUUID(), 2))[0].sourceVersionId, row.source_version_id);
  const failed = new SupabaseEvidenceRepository({ url: 'https://example.org', secretKey: 'fake' }, { fetch: async () => Response.json({ message: 'evidence:maintenance corpus rebuild' }, { status: 400 }) });
  await assert.rejects(failed.ensureGeneration(profile), { code: 'maintenance' });
});
test('environment errors name variables without disclosing their values', () => {
  assert.throws(() => evidenceConfig({}), /SUPABASE_URL/);
  assert.throws(() => evidenceConfig({ SUPABASE_URL: 'https://example.org', SUPABASE_SECRET_KEY: 'secret', FEATHERLESS_API_KEY: 'secret' }), /FEATHERLESS_EMBEDDING_MODEL/);
  assert.throws(() => evidenceConfig({ SUPABASE_URL: 'credential-value' }), error => !String(error).includes('credential-value'));
});
test('logger drops keys, headers, document text and vectors', t => {
  let output = '';
  t.mock.method(console, 'info', (value: unknown) => { output = String(value); });
  consoleEvidenceLogger.info('test', { providerId: 'fixture', status: 'failed', error: 'embedding', apiKey: 'secret-value', headers: { apikey: 'secret-value' }, normalizedText: 'full-source-text', embedding: vector() });
  assert.doesNotMatch(output, /secret-value|full-source-text|apikey|normalizedText/);
  assert.deepEqual(JSON.parse(output), { event: 'test', providerId: 'fixture', status: 'failed', error: 'embedding' });
});
test('query embedding failures differ from a successful empty search', async () => {
  let searches = 0;
  const repository = { ensureGeneration: async () => ({ id: crypto.randomUUID(), profile }), search: async () => { searches++; return []; } } as unknown as EvidenceRepository;
  const invalid = new DefaultEvidenceRetrievalService(repository, { profile: profile.embedding, embed: async () => [Array(1024).fill(1)] }, profile);
  await assert.rejects(invalid.search({ text: 'valid query' }), { code: 'embedding' }); assert.equal(searches, 0);
  const valid = new DefaultEvidenceRetrievalService(repository, { profile: profile.embedding, embed: async (_texts, purpose) => { assert.equal(purpose, 'query'); return [vector()]; } }, profile);
  assert.deepEqual(await valid.search({ text: 'valid query' }), []); assert.equal(searches, 1);
});
