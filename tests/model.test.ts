/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DataKind, EventCategory, EventStatus, EvidenceStatus, Severity, SourceKind,
  isClimateEvent, parseEventId, type ClimateEvent, type EventGeometry,
} from '../src/domain/climate-event.ts';
import { demoEvents } from '../src/data/demo-events.ts';
import { eventDetailUrl, eventProviders, findEvent } from '../src/data/events.ts';

function fixture(): ClimateEvent {
  return structuredClone(demoEvents[0]);
}

function withGeometry(geometry: EventGeometry): ClimateEvent {
  const event = fixture();
  event.observations = [{ time: event.time.firstObservedAt, geometry, magnitude: null }];
  event.location.geometry = geometry;
  event.location.marker = geometry.type === 'Point' ? geometry.coordinates : geometry.coordinates[0][0];
  return event;
}

test('eight fictional fixtures have unique namespaced IDs and no claimed reports or attribution', async () => {
  assert.equal(demoEvents.length, 8);
  assert.equal(new Set(demoEvents.map((event) => event.id)).size, 8);
  for (const event of demoEvents) {
    assert.ok(isClimateEvent(event), event.id);
    assert.match(event.title, /fictional demo/i);
    assert.match(event.summary!, /fictional.*not a report/i);
    assert.equal(event.provenance.dataKind, DataKind.Demo);
    assert.equal(event.provenance.provider, 'demo');
    assert.equal(event.status, EventStatus.Unknown);
    assert.equal(event.severity, Severity.Unknown);
    assert.equal(event.evidence.status, EvidenceStatus.Missing);
    assert.deepEqual(event.sources, []);
    assert.deepEqual(event.evidence.references, []);
    assert.equal(await findEvent(event.id), event);
  }
});

test('namespaced IDs preserve opaque external IDs and reject malformed or unencodable IDs', () => {
  assert.deepEqual(parseEventId('eonet:EONET_123'), { provider: 'eonet', externalId: 'EONET_123' });
  assert.deepEqual(parseEventId('custom-provider:region:123'), { provider: 'custom-provider', externalId: 'region:123' });
  for (const id of ['', 'demo', ':x', 'demo:', 'demo: ', 'Demo:x', 'demo: x', 'demo:x ', 'demo:x\n', 'demo:\ud800']) {
    assert.equal(parseEventId(id), null, JSON.stringify(id));
  }
});

test('detail URLs keep reserved characters inside a single encoded id parameter', () => {
  const event = fixture();
  event.id = 'custom:place/ä?x=1&next=https://example.test/#section:2%';
  const detail = eventDetailUrl(event);
  const url = new URL(detail, 'https://example.test');
  assert.equal(url.pathname, '/events/detail');
  assert.equal(url.searchParams.get('id'), event.id);
  assert.equal([...url.searchParams].length, 1);
  assert.equal(url.hash, '');
  event.id = 'demo:';
  assert.throws(() => eventDetailUrl(event), TypeError);
});

test('normalized data accepts boundary coordinates and closed polygons with holes', () => {
  assert.ok(isClimateEvent(withGeometry({ type: 'Point', coordinates: [-180, 90] })));
  assert.ok(isClimateEvent(withGeometry({ type: 'Point', coordinates: [180, -90] })));
  assert.ok(isClimateEvent(withGeometry({
    type: 'Polygon', coordinates: [
      [[0, 0], [5, 0], [5, 5], [0, 0]],
      [[1, 1], [2, 1], [2, 2], [1, 1]],
    ],
  })));
});

test('normalized data rejects invalid shapes, enum values, magnitudes and provenance', () => {
  const invalidChanges: Array<[string, (event: ClimateEvent) => void]> = [
    ['empty categories', (event) => { event.categories = []; }],
    ['duplicate categories', (event) => { event.categories = [EventCategory.Flood, EventCategory.Flood]; }],
    ['unknown category', (event) => { event.categories = ['tornado' as EventCategory]; }],
    ['unknown severity', (event) => { event.severity = 'catastrophic' as Severity; }],
    ['unknown status', (event) => { event.status = 'active' as EventStatus; }],
    ['blank title', (event) => { event.title = ' '; }],
    ['empty observations', (event) => { event.observations = []; }],
    ['sparse observations', (event) => { event.observations = new Array(2); }],
    ['sparse categories', (event) => { event.categories = new Array(1); }],
    ['sparse sources', (event) => { event.sources = new Array(1); }],
    ['marker mismatch', (event) => { event.location.marker = [0, 0]; }],
    ['geometry mismatch', (event) => { event.location.geometry = { type: 'Point', coordinates: [0, 0] }; }],
    ['out of range', (event) => { event.location.marker = [181, 0]; }],
    ['nonfinite latitude', (event) => { event.location.marker = [0, NaN]; }],
    ['nonfinite magnitude', (event) => {
      event.observations = [{ ...event.observations[0], magnitude: { value: Infinity, unit: 'unit', description: null } }];
    }],
    ['missing magnitude unit', (event) => {
      event.observations = [{ ...event.observations[0], magnitude: { value: 3, unit: '', description: null } }];
    }],
    ['provider mismatch', (event) => { event.provenance.provider = 'other'; }],
    ['external ID mismatch', (event) => { event.provenance.externalId = 'other'; }],
    ['unknown data kind', (event) => { event.provenance.dataKind = 'live' as DataKind; }],
    ['invalid fetchedAt', (event) => { event.provenance.fetchedAt = 'yesterday'; }],
  ];
  for (const [label, mutate] of invalidChanges) {
    const event = fixture();
    mutate(event);
    assert.equal(isClimateEvent(event), false, label);
  }
  for (const coordinates of [[], [[]], [[[0, 0], [1, 1], [0, 0]]], [[[0, 0], [1, 0], [1, 1], [0, 1]]],
    [[[0, 0], [0, 0], [0, 0], [0, 0]]], [[[0, 0], [1, 0], [190, 1], [0, 0]]]]) {
    const event = fixture();
    event.location.geometry = { type: 'Polygon', coordinates } as unknown as EventGeometry;
    assert.equal(isClimateEvent(event), false, JSON.stringify(coordinates));
  }
  const sparsePolygon = fixture();
  sparsePolygon.location.geometry = { type: 'Polygon', coordinates: [new Array(4)] };
  assert.equal(isClimateEvent(sparsePolygon), false);
  for (const raw of [null, undefined, [], {}, 'event', 1]) assert.equal(isClimateEvent(raw), false);
});

test('time bounds describe ordered observations and provider-reported closure', () => {
  const event = fixture();
  const later = '2026-10-02T00:00:00.000Z';
  const first = event.observations[0];
  event.observations = [first, { ...first, time: later }];
  event.time.lastObservedAt = later;
  assert.ok(isClimateEvent(event));
  event.status = EventStatus.Closed;
  event.time.closedAt = later;
  assert.ok(isClimateEvent(event));
  event.time.closedAt = first.time;
  // Closure is curation metadata: later observations can revise a closed record.
  assert.ok(isClimateEvent(event));
  event.time.closedAt = null;
  assert.equal(isClimateEvent(event), false);
  event.status = EventStatus.Open;
  event.time.closedAt = later;
  assert.equal(isClimateEvent(event), false);
  event.time.closedAt = null;
  event.observations = [event.observations[1], first];
  assert.equal(isClimateEvent(event), false);

  for (const time of ['2026-02-30T00:00:00.000Z', '2026-10-01', '2026-10-01T00:00:00.000+00:00']) {
    const malformed = fixture();
    malformed.time.firstObservedAt = time;
    malformed.time.lastObservedAt = time;
    malformed.observations = [{ ...malformed.observations[0], time }];
    assert.equal(isClimateEvent(malformed), false, time);
  }
});

test('attribution requires a resolvable scientific source rather than an event report', () => {
  const event = fixture();
  event.sources = [{ id: 'study:fixture', name: 'Fictional validation fixture', url: 'https://example.test/study', kind: SourceKind.ScientificStudy }];
  event.evidence = {
    status: EvidenceStatus.Supported,
    references: [{ sourceId: 'study:fixture', finding: 'Fictional finding used only by this validation test.', passage: null }],
  };
  assert.ok(isClimateEvent(event));
  event.sources = [{ ...event.sources[0], kind: SourceKind.EventReport }];
  assert.equal(isClimateEvent(event), false);
  event.sources = [];
  assert.equal(isClimateEvent(event), false);
  event.evidence.references = [];
  assert.equal(isClimateEvent(event), false);
  event.evidence.status = EvidenceStatus.Missing;
  assert.ok(isClimateEvent(event));
});

test('source URLs reject credentials, script/data schemes, controls, and duplicate source IDs', () => {
  const event = fixture();
  const source = { id: 'report', name: 'Fictional test report', url: 'https://example.test/event', kind: SourceKind.EventReport };
  event.sources = [source];
  assert.ok(isClimateEvent(event));
  for (const url of ['javascript:alert(1)', 'data:text/html,example', 'https://user:pass@example.test',
    'https://example.test/\npath', ' https://example.test', '//example.test', 'https://']) {
    event.sources = [{ ...source, url }];
    assert.equal(isClimateEvent(event), false, url);
  }
  event.sources = [source, { ...source, url: 'https://example.test/other' }];
  assert.equal(isClimateEvent(event), false);
});

test('registry resolves direct provider IDs, forwards cancellation, and rejects mismatched results', async (t) => {
  const provider = eventProviders.get('eonet');
  assert.ok(provider);
  assert.equal(provider.id, 'eonet');
  const event = fixture();
  event.id = 'eonet:EONET_fixture';
  event.provenance.provider = 'eonet';
  event.provenance.externalId = 'EONET_fixture';
  event.provenance.dataKind = DataKind.Reported;
  const controller = new AbortController();
  const lookup = t.mock.method(provider, 'fetchEvent', async (externalId: string, signal?: AbortSignal) => {
    assert.equal(externalId, 'EONET_fixture');
    assert.equal(signal, controller.signal);
    return event;
  });
  assert.equal(await findEvent(event.id, controller.signal), event);
  assert.equal(lookup.mock.callCount(), 1);
  for (const id of ['', 'missing', ':x', 'demo:', 'eonet:', 'unknown:x', 'demo:absent', 'eonet:x\n']) {
    assert.equal(await findEvent(id), null);
  }
  assert.equal(lookup.mock.callCount(), 1);

  lookup.mock.mockImplementation(async () => null);
  assert.equal(await findEvent(event.id), null);
  lookup.mock.mockImplementation(async () => demoEvents[0]);
  await assert.rejects(findEvent(event.id), /invalid or mismatched/);
  lookup.mock.mockImplementation(async () => ({ ...event, observations: [] }));
  await assert.rejects(findEvent(event.id), /invalid or mismatched/);
  const failure = new Error('Provider unavailable');
  lookup.mock.mockImplementation(async () => { throw failure; });
  await assert.rejects(findEvent(event.id), (error: unknown) => error === failure);
});
