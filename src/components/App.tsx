import { useEffect, useState } from 'react';
import type { ClimateEvent } from '../domain/climate-event.ts';
import { demoEvents } from '../data/demo-events.ts';
import { demoAssessments } from '../data/demo-assessments.ts';
import { eventDetailUrl, eventProviders } from '../data/events.ts';
import { constrainView, INITIAL_VIEW } from '../lib/globe.ts';
import EventCard, { observationDate } from './EventCard.tsx';
import EventCounter from './EventCounter.tsx';
import EventTypeFilter from './EventTypeFilter.tsx';
import Globe from './Globe.tsx';
import Icon from './Icon.tsx';
import { withinAssessmentWindow } from '../services/assessment-window.ts';
import { parseClimateEventFeed, type ClimateEventFeed } from '../domain/climate-event-feed.ts';
import ClimateConnectionProgress from './ClimateConnectionProgress.tsx';

type Feed =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; events: ClimateEvent[]; skipped: number; outsideWindow: number; connections?: ClimateEventFeed };

function coordinates(event: ClimateEvent) {
  const [longitude, latitude] = event.location.marker;
  return `${Math.abs(latitude).toFixed(1)}° ${latitude < 0 ? 'S' : 'N'} / ${Math.abs(longitude).toFixed(1)}° ${longitude < 0 ? 'W' : 'E'}`;
}

export default function App({assessmentApiUrl=''}: {assessmentApiUrl?:string}) {
  const [mode, setMode] = useState<'assessed' | 'live' | 'demo'>('assessed');
  const [feed, setFeed] = useState<Feed>({ status: 'loading' });
  const [request, setRequest] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState(INITIAL_VIEW);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');

  useEffect(() => {
    if (mode === 'demo') return;
    const controller = new AbortController();
    const provider = eventProviders.get('eonet');
    async function load() {
      try {
        if(mode==='assessed') {
          const base=new URL(assessmentApiUrl || '/',window.location.origin);if(!['https:','http:'].includes(base.protocol)||base.username||base.password)throw new Error('Invalid connection feed endpoint.');
          const response=await fetch(new URL('/api/climate-events',base),{signal:controller.signal,headers:{Accept:'application/json'}});
          if(!response.ok)throw new Error('The climate connection feed could not be loaded.');
          const connections=parseClimateEventFeed(await response.json());
          if(!controller.signal.aborted)setFeed({status:'ready',events:connections.events.filter(event=>withinAssessmentWindow(event)),skipped:0,outsideWindow:0,connections});
          return;
        }
        if (!provider) throw new Error('The NASA EONET provider is unavailable.');
        const batch = await provider.fetchEvents({ days: 30, limit: 60, signal: controller.signal });
        if (!controller.signal.aborted) {
          const events = batch.events.filter(event => withinAssessmentWindow(event));
          setFeed({ status: 'ready', events, skipped: batch.skipped, outsideWindow: batch.events.length - events.length });
        }
      } catch (error) {
        if (!controller.signal.aborted) setFeed({ status: 'error',
          message: error instanceof Error ? error.message : 'The event feed could not be loaded.' });
      }
    }
    void load();
    const timer=mode==='assessed'?setInterval(()=>{void load();},60000):undefined;
    return () => {controller.abort();clearInterval(timer);};
  }, [mode, request,assessmentApiUrl]);

  const events = mode === 'demo' ? demoEvents : feed.status === 'ready' ? feed.events : [];
  const query = search.trim().toLowerCase();
  const filteredEvents = events.filter((event) =>
    (category === 'all' || event.categories.some((item) => item === category))
    && `${event.title} ${event.location.label ?? ''} ${event.categories.join(' ')}`.toLowerCase().includes(query));
  const selected = filteredEvents.find((event) => event.id === selectedId);
  const categories = [...new Set(events.flatMap((event) => event.categories))].sort();
  const isLoading = mode !== 'demo' && feed.status === 'loading';
  const failed = mode !== 'demo' && feed.status === 'error';
  const connectionFeed=mode==='assessed'&&feed.status==='ready'?feed.connections:undefined;
  const indicators = new Map((mode === 'demo'
    ? demoAssessments.map(({ eventId, humanInfluence, evidenceStrength }) => ({ eventId, humanInfluence, evidenceStrength, stale: false }))
    : connectionFeed?.indicators ?? []).map(indicator => [indicator.eventId, indicator]));

  function changeMode(next: 'assessed' | 'live' | 'demo') {
    if (mode === next) return;
    setMode(next); setSelectedId(null); setSearch(''); setCategory('all');
    if (next !== 'demo') setFeed({ status: 'loading' });
  }

  function retry() {
    setFeed({ status: 'loading' }); setSelectedId(null); setRequest((value) => value + 1);
  }

  function focusEvent(event: ClimateEvent) {
    setSelectedId(event.id);
    setView(constrainView({ longitude: event.location.marker[0], latitude: event.location.marker[1] }));
    document.getElementById('planet')?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start',
    });
  }

  function clearFilters() { setSearch(''); setCategory('all'); }

  return <div className="observatory">
    <section id="planet" className="planet-hero" aria-labelledby="page-title">
      <div className="hero-intro">
        <p className="eyebrow">A planet in perspective</p>
        <h1 id="page-title">5 past <span>12<span className="title-period" aria-hidden="true">.</span></span></h1>
        <p className="hero-slogan">The crisis isn’t coming.<br />It’s happening now.</p>
        <p className="hero-description">Connect real-world climate events with scientific evidence about climate change.</p>
        <a className="explore-link" href="#observations">Explore the events <Icon name="arrow-down" /></a>
      </div>

      <div className="hero-globe" aria-busy={isLoading}>
        <Globe events={filteredEvents} selectedId={selected?.id ?? null} view={view} onRotate={setView}
          onSelect={(event) => setSelectedId(event?.id ?? null)} />
      </div>

      <aside className={`hero-aside${selected ? ' has-selection' : ''}`} aria-label="Event feed and selected report">
        <div className="live-data-block">
          <p className="eyebrow feed-label"><span className={`signal-dot${isLoading ? ' loading-dot' : ''}`} />
            {mode === 'demo' ? 'Demo observations' : failed ? 'Connection interrupted' : mode==='assessed'?'Climate connections':'Live observations'}</p>
          <EventCounter count={events.length} loading={isLoading} unavailable={failed} />
          <p className="feed-source">{mode === 'demo' ? '8 fictional events' : 'NASA EONET'}<br />
            {mode === 'demo' ? 'Simulated climate connections' : mode==='assessed'?'Cited findings · Last three years':'Last 30 days · Up to 60 reports'}</p>
          {failed && <button className="text-button" onClick={retry}>Reconnect <Icon name="reset" /></button>}
        </div>
        {selected && <EventCard event={selected} onClose={() => setSelectedId(null)} />}
      </aside>
    </section>

    <div className="perspective-caption">
      <span><span className="caption-index">01 /</span> A global view. A closer look.</span>
      <span>Natural event reports <span className="caption-separator">/</span> {mode==='assessed'?'Evidence reviewed per event':'Explore the scientific assessment in event details'}</span>
    </div>

    <section id="observations" className="observations" aria-labelledby="events-heading" aria-busy={isLoading}>
      <div className="observations-heading">
        <div><p className="eyebrow">The observation index</p><h2 id="events-heading">Explore what’s happening<span className="heading-period">.</span></h2></div>
        <div className="feed-options">
          <div className="mode-switch" role="group" aria-label="Event data source">
            <button aria-pressed={mode === 'assessed'} onClick={() => changeMode('assessed')}>Climate connections</button>
            <button aria-pressed={mode === 'live'} onClick={() => changeMode('live')}>Live reports</button>
            <button aria-pressed={mode === 'demo'} onClick={() => changeMode('demo')}>Demo</button>
          </div>
          {mode !== 'demo' && feed.status === 'ready' && <button className="icon-button" aria-label="Refresh event feed" onClick={retry}><Icon name="reset" /></button>}
        </div>
      </div>

      <div className="filter-bar">
        <div className="search-field"><Icon name="search" /><label className="sr-only" htmlFor="event-search">Search by event, place, or type</label>
          <input id="event-search" type="search" placeholder="Search an event, place, or type" value={search}
            onChange={(event) => setSearch(event.target.value)} />
        </div>
        <EventTypeFilter value={category} categories={categories} onChange={setCategory} />
        <p className="list-summary" role="status">{isLoading ? 'Connecting to the feed…' : failed ? 'Feed unavailable' : `${filteredEvents.length} ${filteredEvents.length === 1 ? 'event' : 'events'}${query || category !== 'all' ? ' in this view' : ' · Latest observations first'}`}</p>
      </div>

      {mode === 'demo' && <p className="feed-notice" role="status"><span className="signal-dot" />Demo mode. All events and climate connections are fictional. Influence and evidence levels are simulated examples, not scientific assessments.</p>}
      {connectionFeed && <ClimateConnectionProgress feed={connectionFeed} />}
      {mode === 'live' && feed.status === 'ready' && feed.skipped > 0 && <p className="feed-notice" role="status">{feed.skipped} invalid or duplicate records skipped.</p>}
      {mode === 'live' && feed.status === 'ready' && feed.outsideWindow > 0 && <p className="feed-notice">{feed.outsideWindow} reports outside the supported three-year window excluded.</p>}

      {isLoading ? <div className="status"><span className="loading-dot" /><h3>Looking around the world.</h3><p>{mode==='assessed'?'Loading saved scientific connections.':'Connecting to recent reports from NASA EONET.'}</p></div>
        : failed ? <div className="status" role="alert"><p className="eyebrow">Connection interrupted</p><h3>Live reports are temporarily unavailable.</h3>
          <p>{feed.status === 'error' ? feed.message : ''}</p><button className="button" onClick={retry}>Retry live feed <Icon name="reset" /></button></div>
        : events.length === 0 ? <div className="status"><h3>{mode==='assessed'?'No validated connections available yet.':'No recent events returned.'}</h3><p>{mode==='assessed'?'Events are assessed progressively. No scientific connection is shown until its cited findings pass validation. You can explore unassessed records in Live reports.':'NASA EONET returned no events for this 30-day window.'}</p><button className="button button-secondary" onClick={retry}>Check again <Icon name="reset" /></button></div>
        : filteredEvents.length === 0 ? <div className="status" role="status"><h3>No events match this view.</h3><p>Try another place or event type.</p><button className="text-button" onClick={clearFilters}>Clear filters <Icon name="close" /></button></div>
        : <>
          <div className="event-table-heading" aria-hidden="true"><span>Event / Type</span><span>Reported location</span><span>Last observed · UTC</span><span /></div>
          <ul className="event-list">{filteredEvents.map((event) => <li key={event.id} className={event.id === selected?.id ? 'selected-row' : ''}>
            <button className="event-select" onClick={() => focusEvent(event)} aria-pressed={event.id === selected?.id}>
              <span className="event-row-content"><span className="event-row-title"><span className="list-marker" />{event.title}</span>
                <span className="event-row-category">{event.categories.join(' / ')}</span>
                {indicators.has(event.id) && <span className="event-row-category">{mode === 'demo' && 'Simulated · '}Human Influence: {indicators.get(event.id)!.humanInfluence} · Evidence Strength: {indicators.get(event.id)!.evidenceStrength}{indicators.get(event.id)!.stale?' · Evidence updated since assessment':''}</span>}</span>
              <span className="event-row-location">{event.location.label ?? coordinates(event)}</span>
              <time className="event-row-date" dateTime={event.time.lastObservedAt}>{observationDate(event.time.lastObservedAt)}</time>
            </button><a className="row-detail-link" href={eventDetailUrl(event)} aria-label={`Open details for ${event.title}`}><Icon name="arrow-up-right" /></a>
          </li>)}</ul>
        </>}
    </section>

    <section id="evidence" className="evidence-section" aria-labelledby="evidence-heading">
      <p className="eyebrow"><span className="caption-index">02 /</span> Our approach</p>
      <div className="evidence-content"><h2 id="evidence-heading">A report is a starting point.<br /><span>Evidence comes next.</span></h2>
        <div><p>Every event has a story. Understanding its connection to climate change takes scientific evidence. Explore the records, follow their sources, and see what is known.</p>
          <p className="evidence-footnote">Climate connections include evidence-backed direct findings and qualified indirect explanations. Scientific mechanisms do not establish event-specific causation; follow the cited studies and limitations in each assessment.</p>
          <a className="inline-link" href="https://eonet.gsfc.nasa.gov/" target="_blank" rel="noreferrer">About NASA EONET <Icon name="arrow-up-right" /><span className="sr-only"> (opens in a new tab)</span></a>
        </div>
      </div>
    </section>
  </div>;
}
