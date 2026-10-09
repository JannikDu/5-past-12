import type { ClimateEventFeed } from '../domain/climate-event-feed.ts';
import { assessmentWindow } from '../services/assessment-window.ts';
export default function ClimateConnectionProgress({feed}:{feed:ClimateEventFeed}) {
  return <p className="feed-notice" role="status">{feed.counts.total} events discovered · {feed.counts.pending} awaiting assessment · {feed.counts.insufficient} with insufficient evidence · {feed.counts.failed} assessments failed. {feed.historyEnd?(feed.historyEnd<assessmentWindow().start?'Historical discovery is complete.':'Historical discovery is continuing.'):'Historical discovery has not started.'} Direct and indirect findings are included. Levels are not probabilities; these selected events do not represent attribution frequency.</p>;
}
