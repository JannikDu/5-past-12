import type { ClimateEventFeed } from '../domain/climate-event-feed.ts';
export default function ClimateConnectionProgress({feed}:{feed:ClimateEventFeed}) {
  return <p className="feed-notice" role="status">{feed.counts.total} events discovered · {feed.counts.pending} catalog records without a current assessment · {feed.counts.insufficient} with insufficient evidence · {feed.counts.failed} assessments failed. Scientific studies guide discovery of matching reported events from the last three years. Direct and indirect findings are included. Levels are not probabilities; these selected events do not represent attribution frequency.</p>;
}
