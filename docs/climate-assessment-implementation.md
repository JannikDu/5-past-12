# Climate assessment implementation report

Verified on 2026-10-08. Configuration and operating commands are in
[the assessment guide](climate-assessment.md). OpenSpec artifacts are in
`openspec/changes/ai-climate-assessment/`. Repository documentation remains English.

## Architecture delivered

The service separates assessments from provider `ClimateEvent` data. It builds
event context, searches four scientific perspectives, selects diverse immutable
passages, generates a Featherless draft, independently reviews scientific support,
checks references and conservative levels, and saves the result atomically.
The existing evidence Worker exposes saved reads and protected explicit generation;
the static Astro frontend never receives backend credentials or generates on load.
No additional Worker, queue, geocoder, validation framework, or agent system was
introduced. Native runtime validation follows the existing project conventions.

Full-context experiments justified stricter JSON Schema constraints in addition to
the initially tested JSON-object mode. The draft selects server-defined passage
IDs rather than authoring quotations. The server resolves exact contiguous text,
source identity, immutable version, title, publisher, date, and URL. Schema and
reference checks cannot guarantee semantic correctness: review is model-assisted,
and human inspection remains necessary for the few demonstration assessments.

Normally there are two generation calls. Only missing required JSON fields permit
repair, with exact feedback and at most three attempts per phase. Additional fields
are stripped; invalid values, malformed JSON, scientific rejection, HTTP failures,
and timeouts do not trigger another generation call.

## Executed checks

| Check | Result |
| --- | --- |
| Full automated suite, including existing ingestion/retrieval | 145 tests passed |
| ESLint | Passed with zero warnings |
| Astro type checks | Zero errors, warnings, and hints |
| Astro frontend build | Passed |
| Existing evidence Worker dry-run bundle | Passed; no deployment |
| OpenSpec strict validation | Passed |
| Linked Supabase migration history | Local and remote assessment migration match |
| Local workerd HTTP read | HTTP 200, authoritative saved result, not stale |
| Origin and operator checks | Allowed origin accepted; foreign origin 403; unauthenticated generation 401 |
| Authenticated local Worker POST | Unchanged real event reused the saved assessment ID |
| Actual browser, development and built frontend | Both indicators and explicit no-direct message visible; zero runtime exceptions |
| Built frontend credential scan | No configured backend secrets found in nine text assets |

Offline cases exercise event-specific attribution, relevant indirect evidence,
and absent evidence. They also check contradiction caps, unknown references,
version mismatches, unsupported direct labels and numbers, missing fields, retry
cost bounds, immutable persistence, rollback, stale detection, and publication
deduplication. Fixtures are explicitly synthetic and are not published as evidence.

The actual workerd runtime rejected `redirect: 'error'`, despite successful Node
tests. The shared HTTP client now uses manual redirects and rejects redirect
statuses explicitly, preserving the existing credential boundary. A regression
test verifies that credentialed redirects are neither followed nor retried.
The final browser test also required resetting a stale local Vite dependency cache;
no React component workaround was needed.

## Applied migration and real data

The configured Supabase host was checked against the linked project before writes.
A linked dry run showed only `20261008130000_climate_assessments.sql` pending. The
user-authorized linked migration push applied this additive migration successfully;
the two original evidence migrations were already present and were not changed.

The new schema contains `climate_assessments`, immutable
`climate_assessment_citations`, and timestamp-only `climate_assessment_failures`.
RLS and grants keep these records server-only. Snapshot/read/save/failure RPCs
support history, atomic writes, unchanged-event reuse, and corpus-change detection.

Two real NASA EONET events were assessed with the stored corpus and Featherless,
reviewed, and saved in the linked database:

| Event | Result | Human Influence | Evidence Strength |
| --- | --- | --- | --- |
| `eonet:EONET_25096` — Wildfire in Australia 1032616 | `insufficient_evidence`, no claims | `none` | `none` |
| `eonet:EONET_25046` — Typhoon Koguma | `insufficient_evidence`, no claims | `none` | `none` |

Each saved assessment was read back and reused through the service with zero new
model calls, retaining its assessment ID. The live local Worker and actual browser,
including the production frontend build, display the saved Australian-event result.
None means no contribution established
from the available evidence, not a physical absence of climate influence.

Local reports, final model JSON, and the browser screenshot are under ignored
`.devswarm-temp/assessments/`, `.devswarm-temp/assessment-responses/`, and
`.devswarm-temp/assessment-detail-live.png`. They exclude API credentials and
private model reasoning. Earlier scientifically questionable previews remained
local and were never saved as validated scientific findings in Supabase.

## Remaining acceptance and deployment work

- Rich live scientific synthesis is not yet established as reliably demonstrable.
  Qwen3-32B produced overbroad conclusions, selected methods passages for findings,
  or misclassified regional evidence. Independent model review caught some errors
  but missed others. Deterministic guards rejected unsafe responses, and manual
  inspection prevented questionable local previews from publication. A final
  historical Korean-fire test (`eonet:EONET_13108`) was rejected for unsupported
  same-event attribution without an automatic retry. The two saved examples
  demonstrate the full conservative pipeline and fallback, not a successful rich
  synthesis or a live direct-attribution case. A better verified event/corpus/model
  combination and reviewed cited examples remain necessary for that demo goal.
- Worker and frontend production deployment were not performed. Configure a route
  for the existing evidence Worker, its backend secret bindings and operator token,
  exact allowed frontend origins, and the frontend's public assessment API URL.
  The current Wrangler configuration disables `workers_dev`; a public backend
  endpoint is not supplied automatically. The migration is already applied.
- Generic EONET titles, unnamed individual fires, and sparse event dates can fail
  the strict same-event gate even when regional studies exist. Indirect findings
  remain eligible; weakening the gate to force a direct demo would be incorrect.

Tracked implementation/check tasks can be complete while these live scientific
and production acceptance limitations remain explicit. No OpenSpec archive or Git
commit was created automatically.

## Incremental discovery follow-up, 2026-10-09

The user selected validated direct or indirect findings as discovery matches;
Human Influence does not need to reach medium. Events must be first reported
within the last three calendar years. New generation and the current globe feed
apply this inclusive UTC-day policy; supporting publications have no age cutoff.
Policy version v2 preserves old assessments but flags them stale.

Named-event identity now ignores administrative numbers, folds punctuation and
accents, and recognizes abbreviated source months. Country-only unnamed events
remain insufficiently identified for direct attribution. This changes matching,
not evidence-strength ceilings or scientific support requirements.

`pnpm climate:discover` uses bounded historical date/category queries, publication
title overlap for candidate ordering only, progressive outcomes, saved-result
reuse, a target count, and a hard count of actual completion requests. Defaults
are one connection, 30 examined candidates, six calls, and named storms. The CLI
supports a local preview and an explicit resume report, so failed earlier candidates
can be skipped across runs without retrying their scientific answers. No scheduler,
job queue, public costly endpoint, or new migration was required.

Eight earlier full two-call Qwen runs took 29–121 seconds, median 64.5 seconds,
from local report timestamps; a saved local HTTP read took 559 milliseconds.
These are local observations, not latency guarantees. Two bounded live previews
then verified actual historical candidate discovery and continuation:

| Preview | Event | Assessment time | Calls | Outcome |
| --- | --- | --- | --- | --- |
| First search | `eonet:EONET_24721`, Hurricane Polo | 55.3 seconds | 2 | Scientific support rejected; no publication |
| Resumed search | `eonet:EONET_15819`, Tropical Storm Melissa | 48.6 seconds | 2 | Scientific support rejected; no publication |

The first report ended at its hard call budget after 60.8 seconds overall. The
resumed report excluded Polo and ended at its own budget after 65.3 seconds.
Both contain no matches and are under ignored `.devswarm-temp/assessments/`.
These runs establish runtime, bounded cost, historical access, and resumption;
they do not establish a reliable rich live scientific assessment. The existing
two remotely saved insufficient-evidence assessments remain unchanged.

Final follow-up checks passed: **163 tests**, ESLint, Astro checks with zero errors,
warnings and hints, static build, existing Worker dry-run bundle, and strict
OpenSpec validation. Actual local workerd reads returned HTTP 200 and flagged
saved policy-v1 content stale; an authenticated request for a 2022 event returned
HTTP 400 before generation. No additional migration or production deployment was
performed.
