# Evidence implementation report

Implemented OpenSpec change: `evidence-ingestion-retrieval`.

- Separate typed Climate Central/WWA fetchers and normalizers; generic ingestion,
  chunking, query retrieval, citation lookup, job and rebuild services.
- Purpose-aware Featherless batches, strict nonzero finite vector(1536) validation,
  role/chunking/profile compatibility and explicit authenticated capability runner.
- Additive Supabase migration with immutable versions/passages, atomic current
  projections, server-time leases, durable replay/history/recheck state, staging
  maintenance rebuild and complete activation. Applied migration history is intact.
- Semantic + full-text RRF retrieval with bounded metadata/date bonuses,
  overlap suppression/publication caps and original version-specific citations.
- Four-hour UTC Worker, manual ingest/rebuild/evaluation commands, validated
  configuration, secret-free examples, structured logs and offline SQL tests.

The static frontend and EONET behavior are unchanged. No assessment AI, generated
claims, new event links, third provider, or public write route was introduced.

## Executed read-only external checks (7 October 2026)

The checked-out baseline migration/config/docs match commit `065e65a` without
drift. Production Data API metadata exposes the expected source/chunk columns and
original seven-parameter semantic RPC. An invalid 1024-dimensional query is rejected
by the deployed 1536 guard. Publishable-key metadata does not expose evidence
tables/RPC. Production `evidence_sources` count was **0**; no production data,
migration, deployment or scheduler state was modified. Data API inspection does
not substitute for a complete hosted SQL catalog/HNSW/grant audit.

Official public HTTP checks returned eight CSI alerts with full bodies/dates and
ten WWA feed publications with full bodies. A real older WWA HTML article was
used to verify body/category/location/displayed-date extraction. These checks do
not establish complete historical coverage or embedding quality.

## Verification and pending acceptance

Offline unit and local pgvector tests verify the ingestion/retrieval/rebuild
contracts, including both providers ingested twice without new embeddings or
current/archive records. The Worker dry-run bundles without deployment.
Final checks passed: lint, type checking (zero diagnostics), **75 tests**,
frontend build, Worker dry-run bundle, and strict OpenSpec validation. The public
build contains no privileged client or secret-variable references. The original
baseline migration and Supabase configuration remain unchanged.

**Authenticated embedding output passed on 7 October 2026.** The updated local
configuration supplied the required settings. The capability runner received two
finite, nonzero, exactly 1536-dimensional vectors for each of the `document` and
`query` purposes from `Qwen/Qwen3-Embedding-4B`. No credentials or vectors were
printed. A repository scan against actual configured credential values found no
matches in project source, configuration, tests or documentation.

**Human-reviewed real-evidence retrieval acceptance remains pending.** The real
evaluation cases/runner are prepared; they still need an indexed corpus and human
review of ranks, passages and citations. Fake vectors and the live embedding
capability check do not establish retrieval quality.

## Review against the accepted OpenSpec

The review fixed these implementation defects without adding providers or
assessment/UI scope:

- WWA classification formerly treated generic analysis language and references
  to previous attribution studies as new attribution. It now requires current
  methods/analysis, retains negative findings, and distinguishes observation-only
  articles and scientific syntheses. Explicit headline hazards supplement tags.
- A normalizer imported a concrete provider at runtime. WWA's shared raw contract
  and eligibility policy now live in `src/data/wwa-publication.ts`; transport and
  normalization remain separate, and shared services import only contracts.
- RSS and HTML metadata could create false revisions of unchanged publications.
  Selected WWA publications now consistently use official article content and
  metadata. This is an implementation adjustment within the spec's official-HTML
  boundary; the original feed-text optimization caused unstable version identity.
- Discovery and backfill could request the same page twice and mistake it for
  broken pagination. A run-local page cache prevents that, while actual repeated
  distinct pages still fail. Duplicate replay/recheck IDs no longer consume slots.
- Weekly cursors required the entire requested batch to succeed simultaneously.
  They now advance over a represented prefix; failed IDs are durably replayable,
  and explicitly skipped items cannot stall the cycle.
- One malformed CSI card stopped its entire provider. Item-level diagnostics
  isolate it. Persistent missing anchors no longer consume all discovery budget.
- WWA canonical links could silently switch publication identity, and source
  HTTP could follow offsite redirects. Conflicting identities are rejected and
  source requests do not follow redirects; missing result URLs fail validation.
- Rebuilds lacked adapter/profile validation and could reuse a replacement owner's
  refreshed fence at activation. Both mismatched adapters and ownership changes
  now fail before publishing a generation.
- Sparse arrays could pass the finite-vector check because `Array.every` skips
  holes. Every one of the 1536 positions is now checked explicitly.

Nine additional regression cases and strengthened existing tests cover these
failures, missing/unsafe citation URLs, exhausted retries, and SQL rollback for
1024/1537-dimensional vectors. The integrated database tests still verify zero
new embeddings/records on repeated ingestion and unchanged weekly rechecks,
including article modification metadata absent from RSS. Retrieval hints remain
nonexcluding, without a cosine cutoff. Credentials are runtime configuration;
official source URLs and the required schedule/dimension are intentional constants.

Next operator steps: review/apply the additive migration, configure runtime
bindings, run `evidence:check-embeddings` for the target environment, run/repeat bounded ingestion until
needed history is present, rehearse maintenance recovery in isolation, run
`evidence:evaluate` and review real ranks/citations, then manually enable cron.

Detailed commands, configuration, ranking rules, limitations and rollback:
[operating guide](evidence.md). Do not archive the OpenSpec change until a separate
explicit archive request.
