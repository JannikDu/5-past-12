# Evidence ingestion and retrieval

The backend collects published Climate Central and World Weather Attribution
passages for later evidence discovery. It does not assess application events,
generate explanations, assign evidence strength, or change the static frontend.

## Setup and first run

Use Node 24 and the pinned pnpm version. Copy `.env.example` settings into your
ignored `.env`; keep the existing `SUPABASE_SECRET_KEY`. Supply `SUPABASE_URL`,
`FEATHERLESS_API_KEY`, and `FEATHERLESS_EMBEDDING_MODEL`. The publishable Supabase
key is unnecessary for this backend. Worker bindings use the same names.

The proposed model is `Qwen/Qwen3-Embedding-4B`. Every request explicitly asks
for **1536** dimensions; every returned vector must have that length, contain
finite numbers, and have nonzero norm. No padding/truncation is performed.
[Featherless documents the dimensions option](https://featherless.ai/docs/embeddings),
and the [Qwen model card](https://huggingface.co/Qwen/Qwen3-Embedding-4B) documents
variable dimensions and instructed queries. The authenticated capability command
verifies account access and actual output for the configured environment.

```sh
pnpm install --frozen-lockfile
pnpm evidence:check-embeddings
```

The capability command validates two distinct inputs for each purpose, reporting
only model, purpose, count, dimensions, and nonzero status. It needs Featherless
configuration only. Do this before starting maintenance or enabling cron.

Review and apply the new migration manually using the existing Supabase workflow:

```sh
pnpm exec supabase migration list
pnpm exec supabase db push --dry-run
# After reviewing the new SQL and pending migrations:
pnpm exec supabase db push
pnpm evidence:ingest
pnpm evidence:ingest
```

The dry run lists migrations; local SQL tests execute them. Backend commands do
not apply migrations. No SQL, Worker, or cron was deployed by this implementation.
The second ingestion should create no versions or embeddings for unchanged
content. `incomplete` means bounded work remains; run again or let cron continue.
The manual command exits nonzero for unresolved failures or maintenance.

## Configuration

| Setting | Default / constraint |
| --- | --- |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | Required, backend only |
| `FEATHERLESS_API_KEY`, `FEATHERLESS_EMBEDDING_MODEL` | Required, backend only |
| `FEATHERLESS_BASE_URL` | `https://api.featherless.ai/v1` |
| `FEATHERLESS_EMBEDDING_BATCH_SIZE` | 32; 1–128 |
| `EVIDENCE_CHUNK_SIZE` | 2400 Unicode code points; maximum 10000 |
| `EVIDENCE_CHUNK_OVERLAP` | 300 code points |
| `EVIDENCE_CHUNK_MIN_SIZE` | 400; useful tail target, not a minimum document length |
| `EVIDENCE_DISCOVERY_OVERLAP_DAYS` | 7; a recent-discovery hint, never a historical cutoff |
| `EVIDENCE_RECHECK_INTERVAL_DAYS` | 7 |
| `EVIDENCE_MAX_ITEMS_PER_PROVIDER` | 20; 3–100 |
| `EVIDENCE_MAX_PAGES_PER_PROVIDER` | 10; 2–100 |
| `EVIDENCE_RETRIEVAL_MAX_CHUNKS_PER_SOURCE` | 2; 1–10 |

Overlap plus minimum must not exceed chunk size. Source requests have 15-second
whole-response timeouts and 2 MiB body caps; embeddings use 30 seconds. Supabase
responses have an 8 MiB cap. Transient failures get at most three attempts with
jittered backoff and bounded Retry-After. Authentication, invalid content/vector
responses, and caller cancellation do not trigger blind retries. Provider/job
deadlines default to two/five minutes, and provider leases last ten minutes using
database time. Providers share finite item/page budgets across their work lanes.

## Architecture and persistence

`src/server/evidence.ts` constructs typed provider/normalizer pairs, Featherless,
Supabase, and generic services. Fetchers return raw envelopes with stable item
identities. Normalizers independently produce conservative domain records.
Ingestion validates and hashes the complete normalized publication, checks the
current hash before embedding, chunks it deterministically, embeds documents,
then atomically retains and activates one complete version.

Content identity includes metadata and a normalization policy. Processing identity
includes the model/endpoint, both embedding-purpose policies, and chunker version
and settings. Qwen documents remain plain; queries get the adapter's task
instruction with an actual newline. Equal dimensions do not imply compatibility.
Ordinary ingestion/retrieval rejects changed or unknown profiles.

`evidence_source_versions` retains normalized text and version-specific metadata.
`evidence_version_chunks` is the immutable passage journal. Current
`evidence_sources`/`evidence_chunks` are replaceable search projections with their
original URL and source/chunk-position uniqueness, HNSW index, and vector(1536).
A shorter correction removes obsolete current chunks while old UUIDs still
resolve through the journal. Identical replay and reversion reuse retained records.
Failed publication transactions leave the prior complete state intact.

Provider checkpoints retain opaque discovery/history state, failed identities,
and weekly recheck cursors. Downstream failures replay through the generic provider
contract; the job never interprets CSI anchors or WWA fields. Checkpoint/source
writes require an unexpired owner token. A crash before checkpointing safely
replays hashes, and unresolved items force unconditional fetches. Discovery,
historical traversal, and rechecks have separate progress. New feed-head content
gets first access to the budget, with background work sharing the remainder.

RPCs and tables use service-only invoker grants and RLS. The modern secret key
is sent in `apikey`, without assuming it is a bearer JWT. The public application
does not import the server registry. Logs include run/provider/item identities,
lane counts, normalized/skipped/unchanged/stored/failed outcomes, chunks, duration,
inserted/updated source and retained-version counts, and typed error codes. Logs
exclude credentials, full source texts and vectors.

## Source coverage

- [Climate Central CSI alert log](https://www.climatecentral.org/climate-shift-index-alert):
  stable `#alert-<CMS-id>` URLs distinguish cards. Full scientific text, excerpts,
  qualifiers, location labels, and displayed dates are retained. Dates displayed
  without times use midnight UTC; unknown editorial update/event dates remain null.
  Alerts are context articles; exact hazard labels supply existing EventCategory
  tags. The page is a sampling, and older anchors may disappear. Unavailable
  alerts are reported while their retained text/citations survive. Four-hour
  checks refresh publications daily; they do not create daily numeric CSI data.
- [WWA RSS](https://www.worldweatherattribution.org/feed/): feed head is checked
  first; distinct `?paged=N` pages gradually backfill eligible HTML publications
  with no one-year age cutoff. Feed content establishes eligibility; selected
  publications use canonical official article HTML for both discovery and rechecks.
  Consistent article metadata prevents false versions caused by alternating RSS
  and HTML representations. RSS timestamp precision is retained when article dates
  agree. This adds one bounded article request per selected publication.
  Unrelated recruitment/fundraising posts are skipped before fetching articles.
  Unchanged feed dates do not hide older corrections. Classification requires a
  current attribution analysis or explicit study methods; observation-only analysis
  and references to earlier studies remain context. Scientific syntheses retain
  report format. Explicit headline subjects supplement category tags; marine
  temperatures and cold do not automatically receive extreme-heat tags.
  Publisher identity alone never creates attribution. The WWA normalization policy
  is `wwa-html-v2`; changing it deliberately changes normalized version identity.

Malformed individual CSI cards are reported without blocking usable cards.
New discoveries and rechecks receive budget before persistent missing anchors
can monopolize replay. Source requests do not follow redirects; conflicting WWA
canonical identities are rejected. Publication URLs and CSI fragments remain
required provenance fields. Within a run, discovery and backfill reuse a fetched
feed page instead of fetching it again or reporting a false repetition error.

Weekly cycles enumerate known publications through a frozen time boundary and
recheck article bodies directly. A failed identity remains pending; the cursor
advances over processed or durably pending identities so later publications can
still be checked. Explicit skipped-item identities also advance the cursor.
An unfinished cycle resumes alongside new content. Historical offsets are reconciled with stable
URLs, and repeated/failed/malformed pages are not terminal. A verified empty RSS
page ends a traversal; another bounded archive scan becomes due after 28 days.
Moving feeds can still cause lag until a later rescan. Providers report failures
and incomplete coverage. PDFs/OCR, linked scientific report archives, raster/KML
datasets and guaranteed complete historical coverage are outside this pipeline.
Unknown regions/event intervals remain null; publication time is not event onset.

## Retrieval and citations

Call from a backend entry point:

```ts
import { EventCategory } from '../src/domain/climate-event.ts';
import { createEvidenceServices } from '../src/server/evidence.ts';

const { retrieval } = createEvidenceServices(process.env);
const results = await retrieval.search({
  text: 'wildfire conditions in Spain and the Mediterranean',
  eventType: EventCategory.Wildfire,
  region: 'Spain',
  limit: 10,
});
const original = results[0]
  ? await retrieval.findByChunkId(results[0].chunkId)
  : null;
```

Text must be nonblank; dates/enums/regions must be valid; limit is 1–100 (default
10). Empty preference arrays add no preference. The service embeds the ordinary
query with purpose `query` and searches the current compatible generation.

The database combines cosine semantic candidates and English PostgreSQL full-text
candidates (`websearch_to_tsquery`, `ts_rank_cd`) with equal-weight reciprocal rank
fusion: `1/(60+semanticRank) + 1/(60+lexicalRank)`, omitting absent branches.
Candidates per branch are `min(500, max(50, 8*limit, 4*publicationCap*limit))`.
The original semantic RPC is reused for pools up to 100; larger pools use a
compatible cosine-ordered branch. HNSW is approximate and lexical search is English.

Each exact category, trimmed case-insensitive region, preferred evidence/source
classification, and explicit UTC-day event-interval overlap adds **0.001** (maximum
total 0.005). Publication date does not supply the overlap bonus. Metadata/date
mismatches and low cosine scores never exclude candidates. Ties use chunk UUIDs.
Identical content is suppressed globally; same-version spans overlapping by at
least 70% of the shorter passage are suppressed. The publication cap defaults to
two. A bounded pool can return fewer results; it does not prove evidence absence.

Results expose immutable chunk/source/version IDs, content, original URL/title/
publisher, classifications, nullable publication date, **cosine similarity**, and
separate **ranking score**. Neither score is confidence or attribution strength.
Citation lookup resolves original journal text/metadata after corrections and
rebuilds, including during maintenance. Successful empty search returns `[]`;
authentication/database/embedding/maintenance/profile/contract failures throw typed
`EvidenceError`s. No lexical-only fallback hides an embedding failure.

## Manual rebuild and recovery

Changing model, either role policy, or chunking settings requires a complete
maintenance rebuild. First run the capability command with target configuration.
Keep the old configuration available for an explicit abort.

```sh
pnpm evidence:rebuild start
pnpm evidence:rebuild status
# Reuse the printed owner UUID while its lease is valid:
pnpm evidence:rebuild resume <owner-uuid> 20
# A new owner may resume after the previous ten-minute lease expires.
```

Start freezes the latest-version manifest and pauses ingestion/vector retrieval.
The runner stages up to 20 verified retained documents per pass without fetching
providers. Resume skips completed versions and renews ownership; each stage is
idempotent. Complete activation replaces all projections and the active profile
atomically. A failed stage/activation leaves maintenance and prior data intact;
status reports manifest/completed IDs, target profile, owner, and expiry.

To abort, restore the **previous active** runtime settings and run:

```sh
pnpm evidence:rebuild abort <owner-uuid>
```

Abort accepts the current owner (or a new owner after expiry) and only returns
to the previous complete compatible generation. Maintenance never expires into
automatic partial search. New searches after activation require target settings;
old citations still resolve. Rehearse start/interruption/resume/abort locally
before a production maintenance window.

Legacy rows retain original UUIDs in marked journal records with unknown full
text/profile left null. Unknown originals block ordinary initialization/rebuild.
The privileged `evidence_adopt_legacy(profile, publications)` RPC explicitly
reconciles **every** existing publication in one transaction using reviewed,
verified normalized originals and complete target-profile embeddings. Each entry
supplies `source`, `providerId`, `itemId`, `contentHash`, and `chunks` in the store
contract. Reconstructed overlapping chunks are not verified original documents.
The old journal IDs and known metadata survive adoption. The observed production
baseline was empty, so no legacy adoption was needed during read-only inspection.

## Scheduling and deployment

The manual runner and thin scheduled Worker invoke the same job. Dedicated
`wrangler.evidence.jsonc` uses `0 */4 * * *` **UTC**, checks both providers, and
starts/resumes weekly rechecks. There is no public ingestion HTTP handler.

```sh
pnpm evidence:worker:check
pnpm exec wrangler dev --config wrangler.evidence.jsonc --test-scheduled
# In a second terminal, trigger the local scheduled handler:
curl 'http://localhost:8787/__scheduled?cron=0+*/4+*+*+*'
```

For local runs, use ignored `.dev.vars` with backend bindings. Configure the three
secret bindings through `wrangler secret put SUPABASE_SECRET_KEY`,
`FEATHERLESS_API_KEY`, and `SUPABASE_URL`, each with `--config wrangler.evidence.jsonc`.
Only after manual SQL application, capability checks, repeated ingestion, and
human retrieval review, manually deploy with
`pnpm exec wrangler deploy --config wrangler.evidence.jsonc`.
Check the selected Cloudflare plan's runtime/subrequest/CPU limits against observed
work before enabling cron. Scheduled unresolved failures fail the invocation;
incomplete work continues next tick. Maintenance is reported as deferred.

Rollback: disable the Worker cron/write entry points and revert backend runtime
configuration while retaining journal, generation and current data. During an
unfinished rebuild, use compatible abort. Do not drop citation storage or edit
the applied baseline migration. The original semantic RPC contract is preserved.

## Validation and real evidence review

`pnpm test` includes offline injected-HTTP tests and isolated PGlite/pgvector SQL
contracts: atomic rollback, uniqueness, current/latest search, immutable citation
retention, leases/checkpoints, replay, legacy adoption, maintenance/resume/abort,
privileged grants, ranking/diversity, and two-provider repeated ingestion. Run
`pnpm lint`, `pnpm check`, `pnpm test`, `pnpm build`, and the Worker bundle check.
CI runs these without credentials and never deploys.

`docs/evidence-evaluation.json` lists real official wildfire, drought, heat and
historical-context cases with expected useful passages and metadata mismatches.
After indexing those publications, run `pnpm evidence:evaluate`. The ignored report
at `.devswarm-temp/evidence/retrieval-evaluation.json` records actual ranks,
publication diversity, original passages/citation checks, generation/profile
fingerprint and settings. Fill in its human-review fields for useful passages,
historical-context recall, diversity and shortcomings. Update CSI expectations if
an anchor turns over; retain the old citation and record the coverage limitation.
Automated URL recall and fake vector tests are not human retrieval-quality approval.

See [implementation report](evidence-implementation.md) for executed checks and
explicitly pending acceptance/deployment work.
