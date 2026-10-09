import type { ClimateEvent } from '../domain/climate-event.ts';

/** Calendar-year policy; UTC days avoid host-local timezone differences. */
export function assessmentWindow(now = new Date()): { start: string; end: string } {
  if (!Number.isFinite(now.getTime())) throw new TypeError('Invalid assessment clock');
  const year = now.getUTCFullYear() - 3; const month = now.getUTCMonth();
  const day = Math.min(now.getUTCDate(), new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
  return { start: new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10), end: now.toISOString().slice(0, 10) };
}
export function withinAssessmentWindow(event: ClimateEvent, now = new Date()): boolean {
  const { start, end } = assessmentWindow(now);
  const first = event.time.firstObservedAt.slice(0, 10);
  return first >= start && first <= end;
}

/** Non-overlapping three-month windows prevent a busy recent feed hiding history. */
export function* assessmentHistoryWindows(now = new Date()): Generator<{ start: string; end: string }> {
  const range = assessmentWindow(now); let end = range.end;
  while (end >= range.start) {
    const boundary = new Date(`${end}T00:00:00Z`); boundary.setUTCMonth(boundary.getUTCMonth() - 3);
    let start = boundary.toISOString().slice(0, 10);
    if (start < range.start) start = range.start;
    yield { start, end };
    end = new Date(Date.parse(`${start}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  }
}
