import { useEffect, useState } from 'react';
import type { ClimateEvent } from '../domain/climate-event.ts';
import { demoEvents } from '../data/demo-events.ts';
import { eventDetailUrl, eventProviders } from '../data/events.ts';
import { categoryColor, constrainView, INITIAL_VIEW } from '../lib/globe.ts';
import EventCard, { observationDate } from './EventCard.tsx';
import Globe from './Globe.tsx';

type Feed =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; events: ClimateEvent[]; skipped: number };

export default function App() {
  const [mode, setMode] = useState<'live' | 'demo'>('live');
  const [feed, setFeed] = useState<Feed>({ status: 'loading' });
  const [request, setRequest] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState(INITIAL_VIEW);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (mode !== 'live') return;
    const controller = new AbortController();
    const provider = eventProviders.get('eonet');
    async function load() {
      try {
        if (!provider) throw new Error('The NASA EONET provider is unavailable.');
        const batch = await provider.fetchEvents({ days: 30, limit: 60, signal: controller.signal });
        if (!controller.signal.aborted) setFeed({ status: 'ready', ...batch });
      } catch (error) {
        if (!controller.signal.aborted) setFeed({ status: 'error',
          message: error instanceof Error ? error.message : 'The event feed could not be loaded.' });
      }
    }
    void load();
    return () => controller.abort();
  }, [mode, request]);

  const events = mode === 'demo' ? demoEvents : feed.status === 'ready' ? feed.events : [];
  const query = search.trim().toLowerCase();
  const filteredEvents = events.filter((event) =>
    `${event.title} ${event.location.label ?? ''} ${event.categories.join(' ')}`.toLowerCase().includes(query));
  const selected = filteredEvents.find((event) => event.id === selectedId);
  const categories = [...new Set(events.flatMap((event) => event.categories))];
  const isLoading = mode === 'live' && feed.status === 'loading';
  const failed = mode === 'live' && feed.status === 'error';

  function changeMode(next: 'live' | 'demo') {
    if (mode === next) return;
    setMode(next); setSelectedId(null); setSearch('');
    if (next === 'live') setFeed({ status: 'loading' });
  }

  function retry() {
    setFeed({ status: 'loading' }); setSelectedId(null); setRequest((value) => value + 1);
  }

  function focusEvent(event: ClimateEvent) {
    setSelectedId(event.id);
    setView(constrainView({ longitude: event.location.marker[0], latitude: event.location.marker[1] }));
  }

  return <div className="dashboard">
    <section className="intro" aria-labelledby="page-title">
      <div>
        <p className="eyebrow"><span className="signal-dot" /> A planet in perspective</p>
        <h1 id="page-title">One planet.<br /><span>See what’s happening.</span></h1>
        <p className="intro-description">Explore recent natural events around the world.<br className="desktop-break" /> Follow the reports. Look for the evidence.</p>
      </div>
      <div className="feed-options">
        <div className="mode-switch" role="group" aria-label="Event data source">
          <button aria-pressed={mode === 'live'} onClick={() => changeMode('live')}><span className="signal-dot" />Live reports</button>
          <button aria-pressed={mode === 'demo'} onClick={() => changeMode('demo')}>Demo</button>
        </div>
        <p className="muted">{mode === 'live' ? 'NASA EONET · Last 30 days · Up to 60 events' : '8 fictional events · For exploring the prototype'}</p>
      </div>
    </section>

    <div className={`feed-status${mode === 'demo' ? ' demo-status' : ''}`} role="status" aria-live="polite">
      {mode === 'demo' ? <><strong>Demo mode</strong><span>These events are fictional and have no attribution evidence.</span></>
        : isLoading ? <><span className="loading-dot" /><span>Loading recent reports from NASA EONET…</span></>
        : failed ? <><span className="status-icon">!</span><span>Live reports unavailable. Retry below or select Demo to explore fictional events.</span></>
        : <><span className="signal-dot" /><span>{events.length} reports loaded · {feed.status === 'ready' ? feed.skipped : 0} invalid or duplicate records skipped</span></>}
    </div>

    <div className="dashboard-grid">
      <section className="globe-panel panel" aria-labelledby="globe-heading" aria-busy={isLoading}>
        <div className="panel-heading">
          <div><p className="eyebrow">Global perspective</p><h2 id="globe-heading">The event explorer</h2></div>
          <span className="badge">{mode === 'demo' ? 'Demo data' : 'Natural events'}</span>
        </div>
        <Globe events={filteredEvents} selectedId={selected?.id ?? null} view={view} onRotate={setView}
          onSelect={(event) => setSelectedId(event?.id ?? null)} />
        <div className="category-legend" aria-label="Event categories; colors do not indicate severity">
          {categories.length > 0 ? categories.map((category) => <span key={category}>
            <span className="category-dot" style={{ backgroundColor: categoryColor(category) }} />{category}
          </span>) : <span>Markers will appear here when events are loaded.</span>}
        </div>
        <p className="map-note muted">Approximate geography · Markers show the latest reported location · Colors indicate event type</p>
      </section>

      <aside className="event-sidebar" aria-label="Explore event reports">
        {selected ? <EventCard event={selected} onClose={() => setSelectedId(null)} />
          : <div className="selection-hint panel"><span className="selection-symbol" aria-hidden="true">◎</span>
            <div><h2>Start with a place.</h2><p className="muted">Hover, focus, or tap a marker. Select an event below to bring it into view.</p></div>
          </div>}
        <section className="event-list-panel panel" aria-labelledby="events-heading" aria-busy={isLoading}>
          <div className="panel-heading"><div><p className="eyebrow">Both hemispheres</p><h2 id="events-heading">All events <span className="event-count">{events.length}</span></h2></div>
            {mode === 'live' && feed.status === 'ready' && <button className="text-button" onClick={retry}>Refresh</button>}
          </div>
          <label className="search-label" htmlFor="event-search">Search by event, place, or type</label>
          <div className="search-field"><span aria-hidden="true">⌕</span><input id="event-search" type="search"
            placeholder="Find an event…" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
          {isLoading ? <div className="status"><span className="loading-dot" /><h3>Connecting to NASA EONET</h3><p>Recent reports will appear here.</p></div>
            : failed ? <div className="status status-error" role="alert"><h3>Couldn’t load live reports</h3>
              <p>{feed.status === 'error' ? feed.message : ''}</p><button className="button" onClick={retry}>Retry live feed</button></div>
            : events.length === 0 ? <div className="status status-empty"><h3>No recent events returned</h3><p>NASA EONET returned no events for this 30-day window.</p><button className="button button-secondary" onClick={retry}>Check again</button></div>
            : filteredEvents.length === 0 ? <div className="status status-empty" role="status"><h3>No matching events</h3><p>Try another place or event type.</p><button className="text-button" onClick={() => setSearch('')}>Clear search</button></div>
            : <><p className="list-summary muted" role="status">{filteredEvents.length} {filteredEvents.length === 1 ? 'event' : 'events'}{query ? ' matching your search' : ' · Latest observations first'}</p>
              <ul className="event-list">{filteredEvents.map((event) => <li key={event.id} className={event.id === selected?.id ? 'selected-row' : ''}>
                <button className="event-select" onClick={() => focusEvent(event)} aria-pressed={event.id === selected?.id}>
                  <span className="list-marker" style={{ backgroundColor: categoryColor(event.categories[0]) }} />
                  <span className="event-row-content"><span className="event-row-title">{event.title}</span>
                    <span className="event-row-meta">{event.categories[0]} · {observationDate(event.time.lastObservedAt)}</span></span>
                </button><a className="row-detail-link" href={eventDetailUrl(event)} aria-label={`Open details for ${event.title}`}>↗</a>
              </li>)}</ul></>}
        </section>
      </aside>
    </div>

    <section className="evidence-banner panel" aria-labelledby="evidence-heading">
      <span className="evidence-symbol" aria-hidden="true">↳</span><div><h2 id="evidence-heading">A report is the beginning. Evidence is the next step.</h2>
        <p>Natural event reports do not establish a connection to climate change. This prototype shows event records and their sources; climate attribution has not been assessed.</p></div>
      <a href="https://eonet.gsfc.nasa.gov/" target="_blank" rel="noreferrer">About NASA EONET <span aria-hidden="true">↗</span><span className="sr-only"> (opens in a new tab)</span></a>
    </section>
  </div>;
}
