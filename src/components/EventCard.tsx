import { DataKind, type ClimateEvent } from '../domain/climate-event.ts';
import { eventDetailUrl } from '../data/events.ts';
import { getDemoAssessment } from '../data/demo-assessments.ts';
import Icon from './Icon.tsx';

interface Props { event: ClimateEvent; onClose: () => void }

export function observationDate(time: string): string {
  return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(time));
}

export default function EventCard({ event, onClose }: Props) {
  const isDemo = event.provenance.dataKind === DataKind.Demo;
  const demoAssessment = getDemoAssessment(event);
  return <article className="event-card" aria-labelledby="selected-event-title">
    <div className="card-topline">
      <span className="eyebrow">{isDemo ? 'Fictional demo event' : 'Reported natural event'}</span>
      <button className="icon-button close-card" aria-label="Close event summary" onClick={onClose}><Icon name="close" /></button>
    </div>
    <div className="category-chips">{event.categories.map((category) => <span className="badge" key={category}>
      {category}
    </span>)}</div>
    <h3 id="selected-event-title">{event.title}</h3>
    <p className="muted event-location">{event.location.label ?? `${event.location.marker[1].toFixed(1)}° latitude, ${event.location.marker[0].toFixed(1)}° longitude`}</p>
    <dl className="facts compact-facts">
      <div><dt>Last observed</dt><dd>{observationDate(event.time.lastObservedAt)} <small>UTC</small></dd></div>
      <div><dt>Severity</dt><dd>{event.severity}</dd></div>
    </dl>
    {demoAssessment
      ? <p className="evidence-note">Simulated Human Influence: {demoAssessment.humanInfluence} · Evidence Strength: {demoAssessment.evidenceStrength}.</p>
      : <p className="evidence-note">Climate attribution: {event.evidence.status.toLowerCase()}.</p>}
    {isDemo && <p className="demo-note">Fictional event and simulated climate connection for exploring the prototype.</p>}
    <a className="event-detail-link inline-link" href={eventDetailUrl(event)}>Explore event <Icon name="arrow-up-right" /></a>
  </article>;
}
