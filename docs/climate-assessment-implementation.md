# Climate assessment implementation report

Initially verified on 2026-10-08. The production deployment and corrections on
2026-10-09 are recorded below and supersede earlier deployment limitations.
Configuration and operating commands are in
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

## Authorized production deployment and runtime correction, 2026-10-09

The user authorized applying migrations, deploying both existing Workers, and
automatically assessing every discovered eligible event. The following current
status supersedes the earlier local-only deployment notes.

- Website: https://5-past-12.jannik-ea0.workers.dev
- Existing backend: https://five-past-twelve-evidence.jannik-ea0.workers.dev
- Backend version: `ad13b265-6e50-4894-8f14-f6db73874f6b`.
- Frontend version: `e78b2030-f6d7-41ed-ab79-e96e34637ccf`.
- Source ingestion remains scheduled every four hours; event discovery and
  assessment run every ten minutes. No additional Worker or queue was created.
- Production frontend bindings are only ASSETS and EVIDENCE. Supabase, Featherless
  and operator secrets remain backend-only. The frontend forwards saved GET reads
  and excludes generation/job routes. Existing Cloudflare Access protection was
  preserved; verification used an authenticated Wrangler remote preview with its
  service binding connected to the actual production backend.

The catalog and publication-guard migrations `20261009010000` and
`20261009013000` were applied. The additional migration
`20261009090000_event_job_request_budget.sql` adds service-only batch citation
reads and lease-checked discovery checkpoints. A final Supabase dry run reported
the linked database up to date with no pending migrations.

The initial live catalog produced assessments but left its historical cursor and
last-run summary unchanged. Per-event individual citation requests plus four
hybrid searches made the HTTP fanout too large for a reliable bounded invocation.
The correction batches immutable citation reads, counts actual outgoing requests,
admits an event only with sufficient remaining request capacity, reserves final
writes, and checkpoints discovery before generation. Its 48-request ceiling fits
the [Workers Free external-request limit](https://developers.cloudflare.com/workers/platform/limits/).
Scheduled transport requests do not retry. The six-completion ceiling and
missing-required-field repair policy remain unchanged. A normal fresh assessment
generally occupies one ten-minute invocation; unstarted candidates stay pending.

Live verification captured an actual scheduled invocation of the new backend:

| Observation | Result |
| --- | --- |
| Cron | `*/10 * * * *`, new backend version |
| Runtime outcome | `ok`, no runtime exceptions |
| Wall time | 85.235 seconds |
| Discovery | 131 eligible snapshots observed in the refreshed windows |
| Assessment attempt | One event, two model calls |
| Scientific outcome | `support` rejection; no new publication and no retry |
| Historical cursor | Advanced from `2026-10-01` to `2026-09-24` |
| Last-run summary | Saved successfully at `2026-10-09T08:31:29Z` |
| Lease | Released successfully; an overlapping invocation returned busy |
| Production service-bound reads | Feed and saved assessment HTTP 200 |
| Public job route through frontend | HTTP 404 |

The verified snapshot contained 159 discovered records, 121 pending records,
33 failed attempts, and 11 displayed connections. These counters are not an
exclusive partition: an earlier valid saved connection can coexist with a later
failed/interrupted catalog attempt. All 11 connection indicators were Human
Influence none and Evidence Strength low; two were flagged stale after evidence
updates. Their indirect findings do not establish event-specific attribution.
Two representative saved results were manually checked against their passages.

Manual inspection also found that the first policy-v2 bootstrap assessment
included an unsupported written ratio and an unfinished sentence. Assessment
`0a7ad099-343a-4f02-97ee-04d1e17bd14f` was quarantined through the service-only
rejection RPC; its immutable history remains, while public reads and the feed
exclude it. Policy v3 removes bibliographic titles from scientific model input,
checks written ratios against selected passages, and rejects unfinished sentence
endings. Quarantine does not automatically regenerate the failed assessment.

Final checks passed: **179 tests**, zero-warning ESLint, Astro checks across
94 files with zero errors/warnings/hints, static frontend build, backend dry-run
bundle and strict OpenSpec validation. The nine built text assets contained none
of the configured backend secret values. SQL tests cover batch citation identity,
immutable history, checkpoint lease enforcement, publication quarantine and
client-role exclusion. Job tests cover request reserves and cursor preservation
before an interrupted generation.

Remaining limitations are scientific and operational: the historical catalog is
still backfilling, unchanged failed outputs require explicit operator reassessment,
and the live corpus has not yet demonstrated medium/high event-specific influence.
The first successful cron after the correction rejected its scientific output,
which is expected conservative behavior rather than a runtime failure. General
mechanisms remain eligible indirect explanations with explicit limitations.
Model review cannot prove entailment; curated hackathon examples still benefit
from manual scientific review. No OpenSpec archive or Git commit was created.

## Manual source expansion and targeted events, 2026-10-09

The user requested more scientific sources and targeted major events rather than
waiting for chronological historical discovery. Before the manual import there
were 54 sources and 280 current chunks: eight Climate Central sources and 46 WWA
sources. Only three publications were dated 2024. One existing
`pnpm evidence:ingest` pass finished in approximately 43 seconds without processing
failures, adding 12 sources and retaining 13 new/corrected versions. The resulting
corpus contains **66 sources and 333 current chunks**, including 15 publications
from 2024. Helene and Milton attribution studies are now stored and embedded.

Narrow historical NASA queries found real records for these selected events,
all within the three-year window. They were explicitly inserted into the existing
production catalog without moving the historical cursor:

| Event | EONET ID | Targeted result |
| --- | --- | --- |
| Hurricane Helene | `eonet:EONET_11304` | Support validation rejected after two model calls, 52.2 seconds |
| Tropical Storm Milton | `eonet:EONET_11536` | Support validation rejected after two model calls, 61.1 seconds |
| EATON Wildfire, Los Angeles, California | `eonet:EONET_12349` | Support validation rejected after two model calls, 35.9 seconds |
| Super Typhoon Gaemi | `eonet:EONET_8850` | Queued; not generated by the targeted test |

The entire targeted test used six completions, with no retries or publication of
the rejected outputs. All three failures reported `Direct attribution lacks
same-event study anchors`. Increasing source count alone therefore does not
resolve event-identity validation. The automatic cron continues its existing
historical discovery; this was explicit targeted intake, not a replacement of the
scheduler's selection policy. A study-first shortlist is useful for demonstration
coverage but is not a population-wide attribution sample or a reason to raise levels.

A concrete ingestion defect was also verified against the original Helene HTML:
the opening event/date paragraph is in `.entry-summary`, outside `.entry-content`.
The parser previously omitted it. `parseWwaArticle` now prepends the lead belonging
to the same article, excludes related-post leads, and avoids duplicate lead text.
The four relevant WWA publications were reimported with the corrected parser,
producing four immutable source versions with real embeddings and zero generative
calls. The current Helene version was checked to start with the original
September 26th lead. Earlier citation versions remain available.

After the correction, **180 tests**, ESLint, Astro type checks, frontend build and
Worker bundle checks passed. The parser correction was deployed to the existing
evidence Worker as version `da7519d5-6bc0-4a4f-b9c8-0aa4e0e67533`. No new
migration or automatic reassessment was added. The three
rejected results remain unpublished until an explicit operator reassessment;
the newly corrected sources have not been re-evaluated by the model in this test.

## Study-first automatic discovery and additional demo runs, 2026-10-09

The user's follow-up replaces chronological cron selection. The existing ten-minute
job now selects up to two current stored attribution-study versions first, derives
bounded date/category NASA queries, and checks matching real events against the
inclusive three-calendar-year observation window. It never falls back to unrelated
catalog records. Named events take priority over generic country records. Country
matches use the study headline/opening event paragraph, avoiding researcher
affiliations. A one-time reconciliation removed 13 affiliation-only study/event
links without deleting any events, evidence or saved assessments.

The additive `20261009120000_study_first_event_discovery.sql` migration was applied
to the previously linked production database. A final dry run reported no pending
migrations. Service-only lookup records retain matched, no-match, ineligible and
incomplete outcomes by immutable study version. Completed lookups can be rechecked
after seven days, incomplete lookups after one hour. Failed/saturated provider
lookups do not become completed lookups and do not starve later studies. Earlier
matched links survive an incomplete recheck. The old historical cursor remains
stored but no longer drives discovery or the progress message.

Eight initial refresh-only invocations used no generative calls. Four subsequent
cron-style invocations attempted four events using six completions, saving one
indirect result and rejecting three. An explicitly requested rerun of corrected
Helene, Milton, Eaton and Gaemi sources used eight completions and rejected all
four results: three lacked exact same-chunk name/date anchors and Milton failed
independent scientific review. Rejected outputs were not published.

These real failures motivated clearer model instructions: one segment per chunk
per claim, exact same-chunk attribution anchors, and a `directAttributionEligible`
flag computed using the unchanged `sameEvent` prerequisite guard. False prohibits
a direct relationship; true does not establish support. Regression coverage proves
the final direct-attribution gate still rejects missing anchors. No evidence
ceiling, citation rule or scientific acceptance requirement was weakened.

Six further bounded cron-style invocations used twelve completions, saving five
more indirect assessments and rejecting Senyar. Across these manual assessment
passes: **14 event attempts, 26 actual completions, six saved connections and eight
rejected attempts**. The read-only feed increased from 12 to **18 connections**.

| Additional demo event | EONET ID | Human Influence | Evidence Strength |
| --- | --- | --- | --- |
| Flood in Netherlands 1103978 | `eonet:EONET_20823` | none | low |
| Tropical Cyclone Ditwah | `eonet:EONET_16000` | none | low |
| Tropical Storm Melissa | `eonet:EONET_15819` | none | low |
| Super Typhoon Man-yi | `eonet:EONET_11906` | none | low |
| Super Typhoon Usagi | `eonet:EONET_11932` | none | low |
| Typhoon Toraji | `eonet:EONET_11905` | none | low |

All six were read back with authoritative immutable citations and were not stale.
They contain qualified background findings, not established attribution of these
specific events. Model review remains fallible: in particular, wording about
whether an event has ever been studied or about storm formation probability needs
expert scrutiny. These examples should not be presented as proven event-specific
climate contributions. Selecting a study for discovery does not itself establish
the relationship of a retrieved passage to the event.

Final deployed backend version: `987b9612-9f7b-4158-9db6-4402e8726a08`.
Final deployed frontend version: `e3afb833-6706-4230-995c-c1e8823b7246`.
Existing four-hour ingestion and ten-minute event cron schedules remain active.
Production frontend bindings remain ASSETS and EVIDENCE only. An authenticated
remote frontend preview using an explicitly empty environment file verified the
actual production service binding: feed and all six saved reads returned HTTP 200,
frontend job POST returned 404 and assessment POST returned 405. A scan of ten
built text assets found none of the configured backend secret values.

An actual scheduled invocation of the final backend was observed at 09:30 UTC
(11:30 Europe/Berlin). Cloudflare reported `outcome: ok`, no exceptions, 50 ms CPU
and 80.550 seconds wall time. It selected two study versions first, retained both
no-match lookups and processed the previously study-matched Kong-rey record using
two completions. Scientific support validation rejected that assessment, so no
additional connection was published. The job saved `selection: study-first`,
released its lease, and left the legacy `2026-09-03` history cursor unchanged.

Final checks: **186 passing tests**, zero-warning ESLint, Astro checks across
98 files with no errors/warnings/hints, frontend build, backend dry-run bundle,
strict OpenSpec validation and clean whitespace checks. The final lookup snapshot
after the manual runs contained 36 checked study versions: 13 matched, 19 no-match, one ineligible and
three incomplete; 27 distinct provider events retained current study links.
Legacy catalog counters are retained history, not an exclusive processing partition.
`pnpm climate:update --runs=6` now provides repeatable sequential bounded runs;
`--refresh-only` performs only study/event intake. Local readback, generation and
HTTP reports are under ignored `.devswarm-temp/`, with no credentials or private
model reasoning. Expert scientific review remains pending. No Git commit or
OpenSpec archive was created.
