import { AssessmentError } from '../domain/climate-assessment.ts';

/** Count actual outgoing requests, keeping three slots for failure/checkpoint writes. */
export class EventRequestBudget {
  private count = 0;
  constructor(private readonly fetcher: typeof fetch = globalThis.fetch.bind(globalThis)) {}
  get used() { return this.count; }
  // A fresh assessment, six possible completions and final writes need at most 27 slots.
  get canStartAssessment() { return this.count <= 20; }
  readonly fetch: typeof fetch = (input, init) => this.request(input, init, 45);
  readonly controlFetch: typeof fetch = (input, init) => this.request(input, init, 48);
  private request(input: Parameters<typeof fetch>[0], init: RequestInit | undefined, limit: number): Promise<Response> {
    if (this.count >= limit) throw new AssessmentError('budget', 'Scheduled request budget exhausted');
    this.count++;
    // Redirects count as additional platform requests; never follow them implicitly.
    return this.fetcher(input, { ...init, redirect: 'manual' });
  }
}
