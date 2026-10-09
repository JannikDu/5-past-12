# Climate assessments

The `ai-climate-assessment` OpenSpec change adds a server-only assessment pipeline
and a static frontend panel. It reuses the evidence Worker's scheduled ingestion
and adds `/api/climate-assessments` and `/api/climate-events`. No production SQL or Worker deployment is
performed by the commands that generate assessments.

## Setup and demonstration

Review `supabase/migrations/20261008130000_climate_assessments.sql`, run the existing
Supabase migration dry-run workflow, and apply it to the intended database. Keep
the prior evidence migrations and ingestion profile. Ingest evidence first.
Configure `.env` from `.env.example`. Backend secrets must never use `PUBLIC_`.

```sh
pnpm exec supabase db push --dry-run
# Apply reviewed migration through your established Supabase deployment workflow.
pnpm evidence:check-embeddings
pnpm evidence:ingest
pnpm climate:assess eonet:<actual-event-id>
pnpm climate:assess eonet:<actual-event-id> --force
pnpm climate:discover --preview --max-model-calls=2 --target=1
pnpm climate:discover --max-model-calls=6 --target=1 --category=storm
pnpm climate:update --refresh-only
pnpm climate:update
```

Select real namespaced IDs from the globe. The command resolves the actual EONET
record, searches stored evidence, calls Featherless for a draft and a separate
review, then atomically saves the validated assessment. Without `--force`, current
compatible saved assessments are reused. A report including the event is written
under ignored `.devswarm-temp/assessments/`; review its claims, passages, limitations
and levels before using it in a demonstration. Demo fixtures are never published
as real assessed events.

`climate:discover` checks events sequentially and prints each candidate/result
immediately. It searches non-overlapping historical windows across the last three
calendar years (UTC days), prioritizing named-event publication-title overlap.
This overlap orders candidates only: the assessment still analyzes actual source
passages. Named storms are the default; `--category=wildfire`, `flood`,
`temperature`, or `drought` selects another supported category. The provider query
is capped at 100 events per window, so this is bounded discovery rather than an
exhaustive historical catalog.

A connection is a validated completed assessment with cited findings, including
qualified indirect findings with Human Influence none. The default target is one
connection, with at most 30 examined candidates and **six actual model calls**.
`--max-model-calls` caps draft, review, missing-field repair, and failed HTTP
requests together. New generation requires room for a normal two-call pair; a
repair can exhaust the remaining budget, in which case the partial result is
rejected. Compatible saved results can be reused without model calls. Scientific
rejection is reported once; searching a different event is not a retry of that
rejected response. Insufficient and failed outcomes remain in the local report.
This selected collection does not estimate attribution frequency across all events.

Continue incrementally with `--resume=<previous-discovery-report.json>`. The next
run excludes all cumulatively attempted event IDs, including rejected candidates,
so continuing the search does not regenerate the same failed answer. The target
and model-call budget apply to the new run. Reports retain these exclusion IDs
and a reference to the preceding report; earlier insufficient/failed outcomes stay
in that report. Omit resume when you intentionally want to consider events again
after their data or scientific evidence changes.

`--preview` saves new validated assessments only in the ignored local report;
it does not insert assessments or failure markers in Supabase. Omit it to persist
validated results through the existing repository. Inspect the quoted passages
before using selected findings in a demonstration. `--max-candidates` and
`--target` provide additional explicit stop conditions.

New individual assessments and discovery exclude events whose first reported
observation is outside the inclusive three-year UTC-day window, including old
ongoing events. The current globe feed also applies this policy. Scientific
publications older than three years remain eligible evidence. The assessment
policy version is now `climate-assessment-v3`, flagging older saved results stale
without deleting their history.

For the public website, deploy the **existing** evidence Worker using
`wrangler.evidence.jsonc`, which enables its existing workers.dev endpoint. Set backend bindings
`SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `FEATHERLESS_API_KEY`, the existing embedding
model/profile, and an operator-only `CLIMATE_ASSESSMENT_ADMIN_TOKEN` using Wrangler
secret commands with `--config wrangler.evidence.jsonc`. Set
`CLIMATE_ASSESSMENT_ALLOWED_ORIGINS` to exact frontend origins separated by commas.
Local development uses `http://localhost:4321` and ignored `.dev.vars`.

Build Astro with `PUBLIC_CLIMATE_ASSESSMENT_API_URL` equal to the website origin
when using the existing frontend Worker in `wrangler.jsonc`. Its EVIDENCE service
binding forwards read-only `/api/climate-assessments` and `/api/climate-events`
internally to the existing evidence Worker, preserving Cloudflare Access and
avoiding a separate browser login for the backend. Generation and job endpoints
are not forwarded publicly. A directly accessible backend origin remains usable
for local development with its configured exact allowed origins.
This is the only assessment setting passed to React; it contains no credentials.
For local development, use `pnpm exec wrangler dev --config wrangler.evidence.jsonc`
and `pnpm dev`. Missing configuration shows an unavailable assessment.

GET `/api/climate-assessments?eventId=eonet%3A...&eventFingerprint=<hash>` reads only
saved content and immutable citations. It requires only database configuration,
does not fetch EONET, embed queries or call a model, and flags changed event/corpus
or policy snapshots. POST uses an operator bearer token and JSON
`{"eventId":"eonet:...","force":true}`. It resolves provider data on the server;
clients cannot submit fabricated events. Keep the token out of the frontend.

## Automatic event processing

The evidence Worker now has two independent schedules: source ingestion every
four hours and event processing every ten minutes. Event processing refreshes
recent EONET reports and one historical week across all categories in the
three-year window. It splits provider windows that fill the 200-record limit;
a saturated single day or exhausted request budget is reported incomplete and
does not advance the historical cursor. Invalid provider records retain the
provider's existing skip behavior. A service-only catalog stores real normalized
events separately from scientific assessments. It is not an attribution source.

Every discovered eligible event is attempted progressively, not only positive
matches. Each invocation allows at most six actual model requests by default,
including missing-field repairs. It refuses later calls when its twelve-minute
runtime budget cannot accommodate the ninety-second scheduled model timeout.
It stops starting events after nine minutes, leaving untouched candidates pending.
A fifteen-minute singleton lease excludes overlapping runs, including manual
`climate:update` calls. Failed/interrupted attempts persist their fingerprint,
policy and model before generation and are not regenerated automatically for
unchanged inputs. Event or policy/model changes can reopen records. Corpus updates
flag saved content stale but do not repeatedly regenerate the whole catalog.

The default globe reads `/api/climate-events`, refreshing saved data every minute.
It displays up to 200 latest validated completed connections with cited findings,
including indirect findings with Human Influence none. The separate Live reports
view retains the last-30-days NASA feed. Aggregate discovered/pending/insufficient/
failed counts explain progress; the selected connections are not a population
estimate of attribution frequency. Empty states never invent scientific findings.

`pnpm climate:update` runs the same bounded job against the configured database.
`--refresh-only` discovers and saves event snapshots without generation. Protected
backend POST `/api/climate-event-jobs?action=refresh` or `action=run` requires the
operator token; it is not available through the public frontend proxy. Existing
explicit per-event reassessment remains available when an operator elects to
retry a failed scientific response or refresh evidence.

## Scientific checks and limitations

Four deterministic queries investigate direct attribution, regional observations,
physical mechanisms and analogues. Each requests twelve chunks; selection enforces
two per publication per query, deduplicates IDs/content, prioritizes publication
diversity and retains up to twenty-four passages. Ranking similarity is never used
as confidence. Missing location labels retain coordinates without geocoding or
inventing region names. Broad-region results remain eligible.

The model sees actual immutable passages split into contiguous, server-defined
segments of at most 1200 characters. It emits claim text and selected passage IDs,
requested levels, qualifiers, and claim indices for narrative fields. It does not
write quotation text. The server resolves each selected ID to its unchanged source
substring and chunk ID; all title, publisher, URL, date, source and version metadata
is also resolved server-side. The second call independently checks semantic support, every essential
synthesis step, event applicability, comparability, projections and contradictory
evidence against the whole retrieved set. This is model-assisted review; it cannot
prove entailment or scientific correctness. Human review remains appropriate for
the few hackathon examples.
`direct_finding` means an explicitly reported scientific finding; the separate
citation relationship determines whether it directly attributes this event.
Findings about historical analogues remain indirect and cannot transfer influence.

Deterministic guards reject missing or unknown IDs, fabricated quotations, version
mismatches, incomplete review coverage, unsupported claims and invalid output.
Direct attribution requires a study and event name/date quotations compatible
with the event record. Generic names, absent date anchors or missing specificity
may conservatively prevent a direct classification even for relevant research.
Named-event comparison now ignores administrative numeric suffixes, folds accents
and punctuation, and recognizes abbreviated source months. It retains distinctive
event-name and date anchors: matching only a country and hazard category still
cannot establish same-event attribution. Regional findings remain eligible as
qualified indirect evidence.
Mechanisms alone cap evidence at low and influence at none. Multi-source synthesis
with actual event context may reach medium; high requires reviewed explicit
same-event findings. Contradiction caps evidence at medium and influence at low
and requires qualified findings. None means no contribution established from
available evidence, never proof of zero influence.

Generation requests `response_format: { type: 'json_schema', json_schema: ... }`
with strict draft/review schemas, and
`chat_template_kwargs: { enable_thinking: false }`. The default model is the
live-tested `Qwen/Qwen3-32B`; the model remains configurable. Separate format
probes verified both JSON-object and JSON-schema behavior for this model. Schema
constraints bound output to four claims and four citations per claim, restrict
IDs to supplied passage segments/chunks and prevent unknown keys. Runtime validation and
scientific review remain authoritative; structured output cannot prove that a
claim is supported. Direct adapter calls without a schema use `json_object`. See
[the small diagnostic](featherless-json-check.md),
[chat completions](https://featherless.ai/docs/completions), and
[chat template kwargs](https://featherless.ai/docs/chat-template-kwargs).

Temperature defaults to 0.1 and maximum output tokens to 4000.
`CLIMATE_ASSESSMENT_TIMEOUT_MS` defaults to 180000 milliseconds (allowed
10000–300000). There are no automatic generation transport retries. Each phase
normally uses one completion. Only missing required JSON fields permit repair,
with the exact missing-field message and previous final JSON, up to three total
attempts per phase. A missing-field review repair reuses the validated draft.
Unknown additional JSON fields are discarded while constructing the validated
domain shape, including model-supplied source metadata and private reasoning.
They do not trigger retries. Invalid values/JSON, unsupported claims, HTTP errors
and timeouts fail immediately without another model call. Draft and review together
use two calls normally and at most six if both repeatedly omit required fields.
No partial result or private model reasoning is retained.

Assessment and citation history is immutable, RLS-enabled and service-only. Writes
lock the corpus snapshot and insert claims/citations atomically. Corpus fingerprints
cover the active generation and all current source versions; additions and
corrections flag old results stale. Stale passages remain traceable to their
original versions. Failed generation never replaces a prior valid assessment;
a service-only timestamped failure marker lets the page distinguish generation
failure from an assessment that has never been attempted.
Publication entries appear once across both evidence groups. A study with a
verified same-event attribution finding appears in Direct Evidence; any contextual
findings from that study retain explicit indirect labels and qualifications.

## Verification

`pnpm test` covers direct attribution, indirect synthesis/mechanisms, no relevant
evidence, contradictory evidence, malformed responses, unsafe citations, retry
limits, reuse, stale detection, SQL rollback/grants, protected HTTP and rendered
source grouping. Also run `pnpm lint`, `pnpm check`, `pnpm build`,
`pnpm evidence:worker:check`, and `openspec validate ai-climate-assessment --strict`.
Fixture-based model outputs are explicitly separate from authenticated scientific
acceptance. A live demonstration must use the real corpus and model and review the
result, which may appropriately be insufficient evidence.

Observed runtime for eight earlier two-call Qwen3-32B runs was approximately
29–121 seconds (median 64.5 seconds), measured from local report timestamps and
including retrieval. A local saved-result read took 559 milliseconds. These are
development observations, not production latency guarantees. Normally a new
event uses two generative calls; saved reads use none.

See [the implementation report](climate-assessment-implementation.md) for the
applied linked migration, actual live results, executed checks, and remaining
scientific/demo and production-deployment limitations.
