import { useEffect, useState } from 'react';
import ClimateAssessmentPanel from './ClimateAssessmentPanel.tsx';
import { eventProviders, findEvent } from '../data/events.ts';
import {
  DataKind, SourceKind, parseEventId,
  type ClimateEvent, type EventObservation, type EventSource,
} from '../domain/climate-event.ts';

type DetailState =
  | { kind: 'loading' }
  | { kind: 'missing' | 'invalid' | 'notfound' | 'error' }
  | { kind: 'ready'; event: ClimateEvent };

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC',
});

function Timestamp({ value }: { value: string }) {
  return <time dateTime={value}>{dateFormat.format(new Date(value))} UTC</time>;
}

function safeUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      ? url.href : null;
  } catch { return null; }
}

function SourceLink({ source }: { source: EventSource }) {
  const url = safeUrl(source.url);
  return url
    ? <a href={url} target="_blank" rel="noopener noreferrer">{source.name}<span className="ed-sr-only"> (opens in a new tab)</span><span aria-hidden="true"> ↗</span></a>
    : <span>{source.name} (link unavailable)</span>;
}

async function resolveDetail(signal: AbortSignal): Promise<DetailState> {
  const ids = new URLSearchParams(window.location.search).getAll('id');
  if (!ids.length || (ids.length === 1 && !ids[0].trim())) return { kind: 'missing' };
  const id = ids[0];
  const parsed = parseEventId(id);
  if (ids.length !== 1 || !parsed
    || (parsed.provider !== 'demo' && !eventProviders.has(parsed.provider))) {
    return { kind: 'invalid' };
  }
  const event = await findEvent(id, signal);
  return event ? { kind: 'ready', event } : { kind: 'notfound' };
}

function Report({ event, assessmentApiUrl }: { event: ClimateEvent; assessmentApiUrl: string }) {
  const isDemo = event.provenance.dataKind === DataKind.Demo;
  const reports = event.sources.filter((source) => source.kind === SourceKind.EventReport);
  const studies = event.sources.filter((source) => source.kind === SourceKind.ScientificStudy);
  const references = event.evidence.references.flatMap((reference) => {
    const source = studies.find((study) => study.id === reference.sourceId && safeUrl(study.url));
    return source ? [{ reference, source }] : [];
  });
  const maximumObservation = event.observations.reduce<EventObservation | null>((maximum, observation) => {
    if (!observation.magnitude) return maximum;
    return !maximum?.magnitude || observation.magnitude.value > maximum.magnitude.value
      ? observation : maximum;
  }, null);
  const [longitude, latitude] = event.location.marker;

  return (
    <article className="ed-report" aria-labelledby="event-title">
      {isDemo && (
        <div className="ed-demo">
          <strong>Fictional demo event</strong>
          <p>This event and its climate connection are fictional. Influence and evidence levels are simulated for exploring the prototype, not scientific findings about this location.</p>
        </div>
      )}
      <header className="ed-header">
        <p className="ed-eyebrow">{isDemo ? 'Prototype fixture' : 'Event report'} · {event.provenance.provider === 'eonet' ? 'NASA EONET' : event.provenance.provider}</p>
        <h1 id="event-title">{event.title}</h1>
        <div className="ed-badges">
          {event.categories.map((category) => <span className="ed-badge" key={category}>{category}</span>)}
          <span className="ed-badge ed-badge-muted">Status: {event.status}</span>
        </div>
        <p className="ed-deck">Explore the record, what is known, and where evidence is still missing.</p>
      </header>

      <div className="ed-sections">
        <section className="ed-section" aria-labelledby="summary-title">
          <div className="ed-section-heading"><span aria-hidden="true">01</span><h2 id="summary-title">Summary</h2></div>
          <p className={event.summary ? 'ed-summary' : 'ed-empty'}>{event.summary || 'No summary is available in this event record.'}</p>
          <dl className="ed-metadata">
            <div><dt>Category</dt><dd>{event.categories.join(', ') || 'Unknown'}</dd></div>
            <div><dt>Location</dt><dd>{event.location.label || 'No place name provided'}</dd></div>
            <div><dt>Coordinates · longitude, latitude</dt><dd>{longitude}°, {latitude}°<span className="ed-note">{event.location.geometry.type === 'Polygon' ? 'First boundary vertex of the latest reported polygon; not its centre.' : 'Latest reported point.'}</span></dd></div>
            <div><dt>First observation</dt><dd><Timestamp value={event.time.firstObservedAt} /></dd></div>
            <div><dt>Latest observation</dt><dd><Timestamp value={event.time.lastObservedAt} /></dd></div>
            <div><dt>Record status</dt><dd>{event.status}{event.time.closedAt && <span className="ed-note">Provider closure: <Timestamp value={event.time.closedAt} /></span>}</dd></div>
            <div><dt>Severity</dt><dd>{event.severity}<span className="ed-note">No severity is inferred from category or magnitude.</span></dd></div>
            <div className="ed-metadata-wide"><dt>Maximum reported magnitude · raw</dt><dd>
              {maximumObservation?.magnitude ? <>
                <strong>{maximumObservation.magnitude.value}{maximumObservation.magnitude.unit ? ` ${maximumObservation.magnitude.unit}` : ''}</strong>
                {maximumObservation.magnitude.description && <span> · {maximumObservation.magnitude.description}</span>}
                <span className="ed-note"><Timestamp value={maximumObservation.time} /></span>
              </> : 'No magnitude reported.'}
            </dd></div>
          </dl>
          <p className="ed-footnote">Observation times describe the record, not necessarily the event’s onset or end.</p>
        </section>

        <ClimateAssessmentPanel event={event} apiUrl={assessmentApiUrl} />

        <section className="ed-section" aria-labelledby="evidence-title">
          <div className="ed-section-heading"><span aria-hidden="true">03</span><h2 id="evidence-title">Provider evidence</h2></div>
          <p className="ed-evidence-status"><span className="ed-status-dot" aria-hidden="true" />Provider record: {event.evidence.status}</p>
          {references.length ? <ul className="ed-findings">{references.map(({ reference, source }) => (
            <li key={`${reference.sourceId}:${reference.finding}`}>
              <p>{reference.finding}</p>
              {reference.passage && <blockquote>{reference.passage}</blockquote>}
              <SourceLink source={source} />
            </li>
          ))}</ul> : <p className="ed-empty">No scientific attribution references are attached to this provider record. The Climate Assessment above shows evidence retrieved independently.</p>}
          <p>Source report links below document the record. They are separate from scientific studies and do not serve as climate attribution evidence.</p>
        </section>

        <section className="ed-section" aria-labelledby="sources-title">
          <div className="ed-section-heading"><span aria-hidden="true">04</span><h2 id="sources-title">Sources</h2></div>
          <div className="ed-source-groups">
            <div><h3>Event reports</h3>{reports.length ? <ul className="ed-source-list">{reports.map((source) => <li key={source.id}><SourceLink source={source} /></li>)}</ul> : <p className="ed-empty">{isDemo ? 'No actual reports: this event is fictional.' : 'No event report links available.'}</p>}</div>
            <div><h3>Scientific studies</h3>{studies.length ? <ul className="ed-source-list">{studies.map((source) => <li key={source.id}><SourceLink source={source} /></li>)}</ul> : <p className="ed-empty">No scientific studies linked.</p>}</div>
          </div>
          <dl className="ed-provenance">
            <div><dt>Data provenance</dt><dd>{isDemo ? 'Fictional demo fixture' : 'Reported event'} · {event.provenance.provider}</dd></div>
            <div><dt>Provider record ID</dt><dd>{event.provenance.externalId}</dd></div>
            <div><dt>{isDemo ? 'Fixture timestamp · not a live fetch' : 'Fetched at'}</dt><dd><Timestamp value={event.provenance.fetchedAt} /></dd></div>
          </dl>
        </section>
      </div>
    </article>
  );
}

const messages = {
  missing: ['Choose an event', 'This link has no event ID. Open an event from the globe to see its details.'],
  invalid: ['Invalid event link', 'The event ID is invalid or uses an unsupported provider. Open an event from the globe to get a valid link.'],
  notfound: ['Event not found', 'No record was found for this ID. It may no longer be available from the provider.'],
  error: ['Unable to load this event', 'The event provider could not be reached or returned an unreadable record. Please try again.'],
} as const;

export default function EventDetail({ assessmentApiUrl = '' }: { assessmentApiUrl?: string }) {
  const [state, setState] = useState<DetailState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    resolveDetail(controller.signal).then((next) => {
      if (!controller.signal.aborted) setState(next);
    }).catch(() => {
      if (!controller.signal.aborted) setState({ kind: 'error' });
    });
    return () => controller.abort();
  }, [attempt]);

  return (
    <div className="event-detail">
      <nav className="ed-nav" aria-label="Event navigation"><a href="/"><span aria-hidden="true">← </span>Back to globe</a><span className="ed-nav-label">5 PAST 12 / EVENT DETAIL</span></nav>
      <div aria-live="polite" aria-busy={state.kind === 'loading'}>
        {state.kind === 'ready' ? <Report event={state.event} assessmentApiUrl={assessmentApiUrl} /> : (
          <div className="ed-state">
            {state.kind === 'loading' ? <>
              <span className="ed-loading-mark" aria-hidden="true" />
              <h1>Event detail</h1><p role="status">Loading event report…</p>
            </> : <>
              <p className="ed-eyebrow">Event detail</p>
              <h1>{messages[state.kind][0]}</h1><p>{messages[state.kind][1]}</p>
              {state.kind === 'error' && <button type="button" className="ed-retry" onClick={() => { setState({ kind: 'loading' }); setAttempt((current) => current + 1); }}>Retry loading event</button>}
              <a className="ed-state-back" href="/">Explore events on the globe <span aria-hidden="true">↗</span></a>
            </>}
          </div>
        )}
      </div>
    </div>
  );
}
