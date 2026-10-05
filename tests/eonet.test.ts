/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { EonetProvider, normalizeEonetEvent } from '../src/data/providers/eonet.ts';
import {
  DataKind, EventCategory, EventStatus, EvidenceStatus, Severity, SourceKind, isClimateEvent,
} from '../src/domain/climate-event.ts';

const fetchedAt = '2026-01-10T12:00:00.000Z';
const point = (date = '2026-01-05T00:00:00Z', coordinates: unknown = [-120, 45]) => ({
  date, type: 'Point', coordinates, magnitudeValue: null, magnitudeUnit: null,
});
const fixture = (overrides: Record<string, unknown> = {}) => ({
  id: 'EONET_12345', title: ' Example wildfire ', description: null, closed: null,
  categories: [{ id: 'wildfires', title: 'Wildfires' }],
  sources: [{ id: 'InciWeb', url: 'https://example.org/report' }],
  geometry: [point()], ...overrides,
});
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'Content-Type': 'application/json' },
});
const mockFetch = (handler: (url: URL, init: RequestInit) => Response | Promise<Response>): typeof fetch =>
  async (input, init) => handler(new URL(String(input)), init ?? {});

test('feed normalization obeys the same domain contract as direct detail lookup', () => {
  const event = normalizeEonetEvent(fixture({ closed: '2026-01-04T00:00:00Z' }), fetchedAt);
  assert.ok(event);
  assert.ok(isClimateEvent(event));
  // Closure is provider metadata and may precede a later reported observation.
  assert.equal(event.status, EventStatus.Closed);
  const degenerate = fixture({ geometry: [{
    date: '2026-01-05T00:00:00Z', type: 'Polygon',
    coordinates: [[[10, 20], [10, 20], [10, 20], [10, 20]]],
  }] });
  assert.equal(normalizeEonetEvent(degenerate, fetchedAt), null);
});

test('temperature extremes are not classified as exclusively extreme heat', () => {
  const event = normalizeEonetEvent(fixture({ categories: [{ id: 'tempExtremes' }] }), fetchedAt);
  assert.ok(event);
  assert.deepEqual(event.categories, [EventCategory.Temperature]);
});

test('normalizes provider identity and keeps event reports separate from attribution', () => {
  const raw = fixture({ description: ' A reported fire. ', severity: 'Extreme',
    evidence: { status: 'Supported', references: ['invented study'] },
    geometry: [{ ...point(), magnitudeValue: 999999, magnitudeUnit: ' acres ', magnitudeDescription: ' Burned area ' }],
  });
  const event = normalizeEonetEvent(raw, fetchedAt);
  assert.ok(event);
  assert.equal(event.id, 'eonet:EONET_12345');
  assert.equal(event.title, 'Example wildfire');
  assert.equal(event.summary, 'A reported fire.');
  assert.deepEqual(event.categories, [EventCategory.Wildfire]);
  assert.equal(event.status, EventStatus.Open);
  assert.deepEqual(event.location, { label: null, geometry: { type: 'Point', coordinates: [-120, 45] }, marker: [-120, 45] });
  assert.deepEqual(event.time, { firstObservedAt: '2026-01-05T00:00:00.000Z', lastObservedAt: '2026-01-05T00:00:00.000Z', closedAt: null });
  assert.deepEqual(event.provenance, { provider: 'eonet', externalId: 'EONET_12345', fetchedAt, dataKind: DataKind.Reported });
  assert.equal(event.severity, Severity.Unknown);
  assert.deepEqual(event.evidence, { status: EvidenceStatus.Unverified, references: [] });
  assert.ok(event.sources.every((source) => source.kind === SourceKind.EventReport));
  assert.equal(event.sources[0].url, 'https://eonet.gsfc.nasa.gov/api/v3/events/EONET_12345');
  assert.deepEqual(event.observations[0].magnitude, { value: 999999, unit: 'acres', description: 'Burned area' });
});

test('sorts observations by UTC instant and selects the latest geometry without mutating input', () => {
  const raw = fixture({ closed: '2026-01-08T03:00:00+02:00', geometry: [
    point('2026-01-06T00:00:00Z', [20, 30]),
    point('2026-01-05T23:30:00-02:00', [40, 50]),
    point('2026-01-05T03:00:00+03:00', [-120, 45]),
  ] });
  const before = structuredClone(raw);
  const event = normalizeEonetEvent(raw, '2026-01-10T13:00:00+01:00');
  assert.ok(event);
  assert.deepEqual(event.observations.map((item) => item.time), [
    '2026-01-05T00:00:00.000Z', '2026-01-06T00:00:00.000Z', '2026-01-06T01:30:00.000Z',
  ]);
  assert.deepEqual(event.location.marker, [40, 50]);
  assert.equal(event.time.firstObservedAt, event.observations[0].time);
  assert.equal(event.time.lastObservedAt, event.observations[2].time);
  assert.equal(event.time.closedAt, '2026-01-08T01:00:00.000Z');
  assert.equal(event.status, EventStatus.Closed);
  assert.equal(event.provenance.fetchedAt, fetchedAt);
  assert.deepEqual(raw, before);
});

test('supports polygon boundaries and holes, using the first boundary vertex as marker', () => {
  const coordinates = [
    [[10, 20], [12, 20], [12, 22], [10, 20]],
    [[10.5, 20.5], [11, 20.5], [11, 21], [10.5, 20.5]],
  ];
  const event = normalizeEonetEvent(fixture({ geometry: [{ date: '2026-01-05T00:00:00Z', type: 'Polygon', coordinates }] }), fetchedAt);
  assert.ok(event);
  assert.deepEqual(event.location.geometry, { type: 'Polygon', coordinates });
  assert.deepEqual(event.location.marker, [10, 20]);
  coordinates[0][0][0] = 100;
  assert.deepEqual(event.location.marker, [10, 20], 'normalized positions must not alias raw JSON');
});

test('validates coordinate ranges and optional GeoJSON altitude without reversing lng/lat', () => {
  for (const coordinates of [[-180, -90], [180, 90], [0, 0], [-120, 45, 100]]) {
    const event = normalizeEonetEvent(fixture({ geometry: [point(undefined, coordinates)] }), fetchedAt);
    assert.ok(event);
    assert.deepEqual(event.location.marker, coordinates.slice(0, 2));
  }
  for (const coordinates of [null, [], [1], [1, 2, 3, 4], ['120', 45], [181, 0], [0, -91], [NaN, 1], [1, Infinity], [1, 2, 'bad'], [1, 2, NaN], [17, 97]]) {
    assert.equal(normalizeEonetEvent(fixture({ geometry: [point(undefined, coordinates)] }), fetchedAt), null);
  }
});

test('rejects malformed geometries rather than hiding a bad latest observation', () => {
  const invalid = [null, {}, { ...point(), type: 'LineString' },
    { ...point(), type: 'Polygon', coordinates: [] },
    { ...point(), type: 'Polygon', coordinates: [[[0, 0], [1, 0], [0, 0]]] },
    { ...point(), type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1]]] },
    { ...point(), type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 100], [0, 0]]] },
  ];
  assert.equal(normalizeEonetEvent(fixture({ geometry: [] }), fetchedAt), null);
  for (const item of invalid) {
    assert.equal(normalizeEonetEvent(fixture({ geometry: [point(), item] }), fetchedAt), null);
  }
});

test('rejects locale dates, impossible calendar dates and invalid times at every timestamp boundary', () => {
  const invalidDates = ['2026-01-05', '2026-01-05T00:00:00', 'January 5, 2026',
    '2026-02-29T00:00:00Z', '2024-02-30T00:00:00Z', '1900-02-29T00:00:00Z',
    '2026-04-31T00:00:00Z', '2026-13-01T00:00:00Z', '2026-01-00T00:00:00Z',
    '2026-01-05T24:00:00Z', '2026-01-05T00:60:00Z', '2026-01-05T00:00:60Z',
    '2026-01-05T00:00:00+24:00', '2026-01-05T00:00:00+01:60', '2026-01-05T00:00:00Z\n',
    '0000-01-01T00:00:00+01:00', '9999-12-31T23:59:59-01:00',
  ];
  for (const date of invalidDates) {
    assert.equal(normalizeEonetEvent(fixture({ geometry: [point(date)] }), fetchedAt), null, `observation ${date}`);
    assert.equal(normalizeEonetEvent(fixture({ closed: date }), fetchedAt), null, `closure ${date}`);
    assert.equal(normalizeEonetEvent(fixture(), date), null, `fetch ${date}`);
  }
  for (const date of ['2024-02-29T00:00:00Z', '2000-02-29T00:00:00Z', '2026-01-05T00:00:00.123Z']) {
    assert.ok(normalizeEonetEvent(fixture({ geometry: [point(date)] }), fetchedAt));
  }
});

test('validates unknown JSON and required event fields', () => {
  for (const raw of [null, undefined, true, 12, 'event', [], {},
    fixture({ id: 'other_123' }), fixture({ id: 'EONET_123\n' }), fixture({ id: 'EONET_../123' }),
    fixture({ title: ' ' }), fixture({ closed: undefined }), fixture({ closed: 123 }),
    fixture({ categories: null }), fixture({ categories: [] }), fixture({ categories: [null] }),
    fixture({ categories: [{ id: 8 }] }), fixture({ categories: [{ id: ' ' }] }),
    fixture({ sources: null }), fixture({ geometry: {} }),
  ]) assert.equal(normalizeEonetEvent(raw, fetchedAt), null);
});

test('maps v3 category IDs, deduplicates categories and handles unknown IDs safely', () => {
  const mappings: [string, EventCategory][] = [
    ['wildfires', EventCategory.Wildfire], ['severeStorms', EventCategory.Storm],
    ['floods', EventCategory.Flood], ['drought', EventCategory.Drought], ['tempExtremes', EventCategory.Temperature],
    ['seaLakeIce', EventCategory.Ice], ['volcanoes', EventCategory.Volcano], ['earthquakes', EventCategory.Earthquake],
    ['landslides', EventCategory.Landslide], ['dustHaze', EventCategory.Dust], ['snow', EventCategory.Snow],
    ['manmade', EventCategory.Other], ['waterColor', EventCategory.Other], ['futureCategory', EventCategory.Other],
    ['toString', EventCategory.Other], ['__proto__', EventCategory.Other], ['constructor', EventCategory.Other],
  ];
  for (const [id, expected] of mappings) {
    const event = normalizeEonetEvent(fixture({ categories: [{ id }, { id }] }), fetchedAt);
    assert.deepEqual(event?.categories, [expected], id);
  }
});

test('keeps only safe HTTP(S) report sources and deduplicates canonical URLs', () => {
  const event = normalizeEonetEvent(fixture({ link: 'javascript:alert(1)', sources: [
    { id: ' A ', url: 'https://example.org/report' }, { id: 'duplicate', url: 'https://example.org:443/report' },
    { id: 'B', url: 'http://example.org/other' },
    ...['javascript:alert(1)', 'data:text/html,test', 'file:///tmp/file', '//example.org/',
      'https://user:secret@example.org/', 'https://user@example.org/', 'not a URL'].map((url) => ({ id: 'unsafe', url })),
    null, { id: '', url: 'https://example.org/' }, { id: 'no url' },
    { id: 'NASA', url: 'https://eonet.gsfc.nasa.gov/api/v3/events/EONET_12345' },
  ] }), fetchedAt);
  assert.ok(event);
  assert.deepEqual(event.sources.map((source) => source.url), [
    'https://eonet.gsfc.nasa.gov/api/v3/events/EONET_12345', 'https://example.org/report', 'http://example.org/other',
  ]);
  assert.equal(event.sources[1].name, 'A');
  assert.equal(new Set(event.sources.map((source) => source.id)).size, event.sources.length);
});

test('missing or malformed optional magnitudes do not become severity or study evidence', () => {
  for (const magnitude of [{}, { magnitudeValue: 1 }, { magnitudeValue: '1', magnitudeUnit: 'kts' },
    { magnitudeValue: Infinity, magnitudeUnit: 'kts' }, { magnitudeValue: 1, magnitudeUnit: ' ' }]) {
    const event = normalizeEonetEvent(fixture({ description: 5, geometry: [{ ...point(), ...magnitude }] }), fetchedAt);
    assert.ok(event);
    assert.equal(event.observations[0].magnitude, null);
    assert.equal(event.severity, Severity.Unknown);
    assert.deepEqual(event.evidence, { status: EvidenceStatus.Unverified, references: [] });
    assert.equal(event.summary, null);
  }
});

test('feed query defaults, identity, skipped records, duplicate IDs and latest-first order', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(fetchedAt) });
  const provider = new EonetProvider(mockFetch((url, init) => {
    assert.equal(url.origin + url.pathname, 'https://eonet.gsfc.nasa.gov/api/v3/events');
    assert.deepEqual(Object.fromEntries(url.searchParams), { days: '30', limit: '60', status: 'all' });
    assert.equal(new Headers(init.headers).get('Accept'), 'application/json');
    assert.ok(init.signal instanceof AbortSignal);
    return json({ events: [fixture(), null, fixture({ id: 'EONET_67890', geometry: [point('2026-01-09T00:00:00Z')] }),
      fixture(), fixture({ geometry: [point('2026-02-30T00:00:00Z')] }), fixture({ categories: [{}] })] });
  }));
  assert.equal(provider.id, 'eonet');
  assert.equal(provider.name, 'NASA EONET');
  const batch = await provider.fetchEvents();
  assert.deepEqual(batch.events.map((event) => event.id), ['eonet:EONET_67890', 'eonet:EONET_12345']);
  assert.equal(batch.skipped, 4);
  assert.ok(batch.events.every((event) => event.provenance.fetchedAt === fetchedAt));
});

test('custom feed bounds and empty valid feeds', async () => {
  const provider = new EonetProvider(mockFetch((url) => {
    assert.deepEqual(Object.fromEntries(url.searchParams), { days: '365', limit: '200', status: 'all' });
    return json({ events: [] });
  }));
  assert.deepEqual(await provider.fetchEvents({ days: 365, limit: 200 }), { events: [], skipped: 0 });
});

test('default constructor uses browser fetch and accepts the minimum query bounds', async (t) => {
  const fetcher = t.mock.method(globalThis, 'fetch', mockFetch((url) => {
    assert.equal(url.searchParams.get('days'), '1');
    assert.equal(url.searchParams.get('limit'), '1');
    return json({ events: [] });
  }));
  assert.deepEqual(await new EonetProvider().fetchEvents({ days: 1, limit: 1 }), { events: [], skipped: 0 });
  assert.equal(fetcher.mock.callCount(), 1);
});

test('invalid queries reject before fetching', async () => {
  let calls = 0;
  const provider = new EonetProvider(mockFetch(() => { calls++; return json({ events: [] }); }));
  for (const value of [0, -1, 1.5, NaN, Infinity]) {
    await assert.rejects(provider.fetchEvents({ days: value }), /Invalid event query/);
    await assert.rejects(provider.fetchEvents({ limit: value }), /Invalid event query/);
  }
  await assert.rejects(provider.fetchEvents({ days: 366 }), /Invalid event query/);
  await assert.rejects(provider.fetchEvents({ limit: 201 }), /Invalid event query/);
  assert.equal(calls, 0);
});

test('feed shape, HTTP, JSON parsing and network errors remain visible', async () => {
  for (const value of [null, [], {}, { events: null }, { events: {} }]) {
    await assert.rejects(new EonetProvider(mockFetch(() => json(value))).fetchEvents(), /invalid event feed/);
  }
  for (const status of [404, 429, 500]) {
    await assert.rejects(new EonetProvider(mockFetch(() => json({}, status))).fetchEvents(), new RegExp(`HTTP ${status}`));
  }
  await assert.rejects(new EonetProvider(mockFetch(() => new Response('{'))).fetchEvents(), SyntaxError);
  const failure = new TypeError('network offline');
  await assert.rejects(new EonetProvider(mockFetch(() => { throw failure; })).fetchEvents(), (error) => error === failure);
});

test('direct lookup uses external identity and normalizes the returned event', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(fetchedAt) });
  const event = await new EonetProvider(mockFetch((url) => {
    assert.equal(url.href, 'https://eonet.gsfc.nasa.gov/api/v3/events/EONET_12345');
    return json(fixture());
  })).fetchEvent('EONET_12345');
  assert.deepEqual(event, normalizeEonetEvent(fixture(), fetchedAt));
});

test('only a detail HTTP 404 means not found; invalid IDs avoid network access', async () => {
  const provider = new EonetProvider(mockFetch(() => { assert.fail('invalid ID must not fetch'); }));
  for (const id of ['', 'eonet:EONET_12345', 'EONET_../123', 'EONET_123\n', 'https://example.org/']) {
    assert.equal(await provider.fetchEvent(id), null);
  }
  assert.equal(await new EonetProvider(mockFetch(() => new Response('not JSON', { status: 404 }))).fetchEvent('EONET_12345'), null);
  for (const value of [null, {}, { events: [fixture()] }, fixture({ id: 'EONET_other' }), fixture({ geometry: [] })]) {
    await assert.rejects(new EonetProvider(mockFetch(() => json(value))).fetchEvent('EONET_12345'), /invalid event record/);
  }
  await assert.rejects(new EonetProvider(mockFetch(() => json({}, 503))).fetchEvent('EONET_12345'), /HTTP 503/);
  await assert.rejects(new EonetProvider(mockFetch(() => new Response('{'))).fetchEvent('EONET_12345'), SyntaxError);
});

test('already cancelled calls preserve the abort reason and never fetch', async () => {
  const controller = new AbortController();
  const reason = new DOMException('cancelled by caller', 'AbortError');
  controller.abort(reason);
  const provider = new EonetProvider(mockFetch(() => { assert.fail('already cancelled requests must not fetch'); }));
  await assert.rejects(provider.fetchEvents({ signal: controller.signal }), (error) => error === reason);
  await assert.rejects(provider.fetchEvent('EONET_12345', controller.signal), (error) => error === reason);
});

test('cancellation during fetch reaches the request signal for feed and detail', async () => {
  for (const detail of [false, true]) {
    const controller = new AbortController();
    const reason = new DOMException('user navigated away', 'AbortError');
    let requestSignal: AbortSignal | null = null;
    const provider = new EonetProvider(mockFetch((_url, init) => new Promise((_resolve, reject) => {
      const signal = init.signal;
      assert.ok(signal);
      requestSignal = signal;
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    })));
    const pending = detail ? provider.fetchEvent('EONET_12345', controller.signal) : provider.fetchEvents({ signal: controller.signal });
    const rejected = assert.rejects(pending, (error) => error === reason);
    controller.abort(reason);
    await rejected;
    assert.equal((requestSignal as AbortSignal | null)?.aborted, true);
  }
});

test('timeout covers stalled fetch and body parsing for feed and detail', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const detail of [false, true]) {
    for (const bodyStalls of [false, true]) {
      const provider = new EonetProvider(mockFetch((_url, init) => {
        const signal = init.signal;
        assert.ok(signal);
        const stalled = () => new Promise<Response>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
        if (!bodyStalls) return stalled();
        const response = json(detail ? fixture() : { events: [] });
        t.mock.method(response, 'json', stalled);
        return response;
      }));
      const pending = detail ? provider.fetchEvent('EONET_12345') : provider.fetchEvents();
      const rejected = assert.rejects(pending, { name: 'TimeoutError' });
      await Promise.resolve();
      await Promise.resolve();
      t.mock.timers.tick(15_000);
      await rejected;
    }
  }
});

test('cancellation during body parsing rejects even when a mock body resolves', async () => {
  const controller = new AbortController();
  const reason = new DOMException('stop parsing', 'AbortError');
  let resolveBody: ((value: unknown) => void) | undefined;
  let bodyStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => { bodyStarted = resolve; });
  const provider = new EonetProvider(mockFetch(() => {
    const response = json({});
    response.json = () => new Promise((resolve) => { resolveBody = resolve; bodyStarted?.(); });
    return response;
  }));
  const pending = provider.fetchEvents({ signal: controller.signal });
  const rejected = assert.rejects(pending, (error) => error === reason);
  await started;
  controller.abort(reason);
  resolveBody?.({ events: [] });
  await rejected;
});

test('completed and failed requests release timers and detach caller cancellation', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const fail of [false, true]) {
    const controller = new AbortController();
    let requestSignal: AbortSignal | undefined;
    const removeListener = t.mock.method(controller.signal, 'removeEventListener');
    const provider = new EonetProvider(mockFetch((_url, init) => {
      assert.ok(init.signal);
      requestSignal = init.signal;
      return json({ events: [] }, fail ? 500 : 200);
    }));
    if (fail) await assert.rejects(provider.fetchEvents({ signal: controller.signal }), /HTTP 500/);
    else await provider.fetchEvents({ signal: controller.signal });
    assert.equal(removeListener.mock.callCount(), 1);
    assert.equal(removeListener.mock.calls[0].arguments[0], 'abort');
    controller.abort();
    t.mock.timers.tick(30_000);
    assert.equal(requestSignal?.aborted, false, 'finished request must not retain timeout or caller listener');
  }
});
