# Tasks

Implementation and offline verification are complete. Requirements remain in the three delta specs; the reviewed design is in `design.md`. See [implementation report](../../../docs/evidence-implementation.md) and [operating guide](../../../docs/evidence.md). Authenticated real-evidence acceptance in 10.3 remains pending.

## 1. Existing database baseline and portable contracts

- [x] 1.1 Verify the existing checked-out Supabase migration/config/docs on `add-evidence-database` against baseline commit `065e65a`, including EventCategory comments, vector(1536), original RPC signature, uniqueness, and grants; compare deployed metadata read-only when available and record drift without editing applied migration history.
- [x] 1.2 Add evidence domain types and provider, normalizer, role-aware embedding, repository, retrieval/citation, fetch-envelope/replay, generation, and job contracts in existing-style locations; verify TypeScript and contract tests reuse EventCategory and deployed classifications, and query metadata is preferences rather than strict filters.
- [x] 1.3 Add server-only validated config, injected structured logging, and secret-free `.env.example`; document Featherless/Supabase settings, discovery overlap, weekly rechecks, budgets, and publication caps; verify invalid config and log redaction without exposing credentials.
- [x] 1.4 Pin Worker-compatible XML/HTML parsers and add a shared injected HTTP helper with cancellation, whole-response timeouts, body caps, bounded transient retries, and Retry-After; verify successful, transient, permanent, oversized, and cancelled HTTP fakes.

## 2. Immutable persistence, current projections, and durable control state

- [x] 2.1 Draft new additive SQL for normalized source versions, immutable passage journal, current version/generation references, processing generations/maintenance, and provider progress; preserve current URL/chunk-position uniqueness, vector(1536), enums, indexes, and server-only grants/RLS; verify catalog/constraint/access checks and explicit legacy-ID/text/profile adoption without inventing originals.
- [x] 2.2 Add atomic retain-and-activate source persistence with complete text/vector validation, unchanged short circuit, expected version/profile checks, and fenced ownership; verify first insert, exact replay, concurrent/stale corrections, shorter revisions, reused retained content, rollback, and previous chunk IDs remaining resolvable after leaving current search.
- [x] 2.3 Add lease/checkpoint operations for independent discovery, historical, revision-recheck, and pending-item progress; verify server-time expiry, fenced overlaps, restart replay, conditional-fetch safety, and incomplete background work not blocking completed new discovery.
- [x] 2.4 Add privileged maintenance start/status/progress/resume/abort and complete-generation activation operations; verify frozen latest-version manifests, staging idempotency, stale ordinary writes/searches, expired rebuild owners, failed final activation, compatible abort, and atomic ready/profile transition.
- [x] 2.5 Implement SupabaseEvidenceRepository lookup, atomic activation, generation checks, citation reads, progress, and rebuild operations behind portable contracts using injected fetch and the modern secret-key apikey header; verify HTTP mapping, null legacy metadata, idempotent retries, original citation metadata, and useful error categories.

## 3. Climate Central provider and normalizer

- [x] 3.1 Implement ClimateCentralEvidenceProvider against the official server-rendered CSI alert log, preserving stable alert identities/anchored URLs, dates, titles, location labels, and raw findings; verify multiple-alert, structure-change, empty/unchanged-day, conditional, and unavailable-old-anchor HTTP fixtures without unrelated crawling.
- [x] 3.2 Implement ClimateCentralEvidenceNormalizer with conservative context/source classifications, existing category mappings, qualified findings, complete normalized text, nullable uncertain metadata, and fragment-preserving canonicalization; verify non-heat alerts, invalid identities/intervals, and no invented direct attribution.
- [x] 3.3 Document the official endpoint, sampled coverage, date precision, anchor turnover, correction behavior, and daily publication refresh via four-hour checks; verify documentation distinguishes this from numerical daily CSI datasets and PDF/report archive ingestion.

## 4. WWA discovery, historical backfill, and older corrections

- [x] 4.1 Implement WorldWeatherAttributionEvidenceProvider with official RSS pagination, eligible publication selection, complete feed content or canonical HTML fallback, stable GUID/URL identity, and no fixed historical-age exclusion; verify excerpts, unrelated news, duplicate entries, distinct/repeated/shifted pages, verified terminal pages, and studies older than one year.
- [x] 4.2 Implement WorldWeatherAttributionEvidenceNormalizer with study-versus-observation classification, original publication metadata, EventCategory tags, nullable uncertain fields, and qualified complete text; verify analogue attribution, event/general context, missing dates, and tracking variants.
- [x] 4.3 Implement generic identity envelopes/replay for both initial providers with provider-owned opaque HTTP/cursor state; verify downstream normalization/embedding/database failures can refetch identified items without concrete provider fields in the orchestrator, including pending items outside recent overlap and 304-after-failure.
- [x] 4.4 Add independent gradual historical traversal and weekly known-publication recheck cycles with durable cursors, due state, fair bounded work, and feed-head priority; verify new publications proceed during backfill, corrected older HTML is detected despite unchanged RSS dates, interrupted cycles resume, and unavailable content leaves retained evidence intact.
- [x] 4.5 Document accessible WWA HTML history, recent discovery overlap, weekly rechecks, periodic bounded archive rescans, cycle lag, and publication/PDF limitations; verify examples report unfinished or failed coverage without claiming a complete archive.

## 5. Deterministic chunking and purpose-aware Featherless embeddings

- [x] 5.1 Implement provider-independent EvidenceChunker with code-point size/overlap/minimum settings, paragraph/sentence boundaries, bounded long segments/tails, zero-based ordering, and passage spans against retained text; verify deterministic Unicode, overlap, text coverage, short/empty text, and invalid config behavior.
- [x] 5.2 Implement FeatherlessEmbeddingProvider with configured model/base URL, document/query purposes, adapter-owned Qwen retrieval formatting, explicit dimensions 1536, batching, and indexed reconstruction; verify role formatting, cardinality/order, wrong dimensions, nonfinite/zero vectors, transient retries, cancellation, and absence of local reshaping.
- [x] 5.3 Separate normalization/content identity from chunking/embedding generation fingerprints, including both embedding-role policies; verify unknown/mixed profiles and ordinary model/policy/chunking changes fail before unsafe writes/searches while historical representations remain available only for citation lookup.
- [x] 5.4 Add `pnpm evidence:check-embeddings` with a two-text batch and secret-free dimensionality report; document proposed Qwen/Qwen3-Embedding-4B and actual authenticated capability acceptance; verify command success/failure with HTTP fakes without claiming live output from unit tests.

## 6. Provider-independent ingestion and reporting

- [x] 6.1 Implement EvidenceIngestionService and typed provider/normalizer registration through interfaces only, with stable normalized hashes, pre-embedding duplicate checks, document-purpose embeddings, and atomic version/current activation; verify fake-based new/unchanged/corrected/failed publications and generic replay on optimistic conflicts.
- [x] 6.2 Add item/provider isolation, safe per-lane progress, durable pending identities, budgets, and required reporting; verify empty successes, other providers proceeding after failure, incomplete background work, maintenance deferral, and crash/304 recovery without lost evidence.
- [x] 6.3 Add an offline orchestration scenario with both provider fixtures, fake embeddings, and a fake repository; verify repeated ingestion creates no current/archive duplicates or embeddings, corrections remove obsolete passages only from current search, and earlier citation IDs retain original text/metadata.
- [x] 6.4 Document stages, provider-independent replay, immutable versus current records, classifications, processing restrictions, and structured discovery/backfill/recheck counts; verify examples agree with fake-based outcomes.

## 7. Explicit manual rebuild and recovery

- [x] 7.1 Implement a small scheduler-independent rebuild service using retained latest normalized texts, the generic chunker/embedding contracts, a frozen manifest, and staged complete per-version representations; verify external publications need not be fetched and original document versions/citations remain stable.
- [x] 7.2 Add `pnpm evidence:rebuild` start/status/resume/abort composition with target-config validation, fenced ownership, and progress reporting; verify interruption, idempotent resume, dimension/profile failure, expiry, and explicit return to the previous complete compatible generation.
- [x] 7.3 Integrate maintenance/generation checks with ordinary ingestion and retrieval, then complete activation; verify no stale operation writes or compares mismatched vectors, no partial corpus becomes searchable, and citation lookup works throughout and after successful activation.
- [x] 7.4 Document maintenance downtime, capability precheck, changed role/chunking/model profiles, missing legacy-original handling, resume/abort, required matching runtime configuration, and preserved citation IDs; verify commands against local/fake integrations.

## 8. Broad hybrid retrieval, diversity, and citation mapping

- [x] 8.1 Add current-chunk full-text/GIN support and a privileged hybrid RPC with latest-version/active-generation checks; preserve the original semantic RPC contract, reuse it with null relevance filters/threshold where its count limit permits, and add compatible larger-pool support; verify local SQL and client-role denial.
- [x] 8.2 Implement bounded semantic/lexical candidates, equal-weight RRF, bounded positive metadata/date bonuses, separate cosine similarity, deterministic ties, chunk-ID deduplication, substantial-overlap suppression, and publication caps; verify missing/mismatched metadata, older intervals, low-similarity lexical hits, single/dual branches, source diversity, and exhausted candidate pools.
- [x] 8.3 Implement validated camelCase search results and provider-independent retained-citation mapping with sourceVersionId, original URLs, and version-specific metadata; verify nullable dates, malformed rows/classifications/scores, archived IDs after corrections/rebuilds, and typed database errors.
- [x] 8.4 Implement EvidenceRetrievalService validation, active-profile query-purpose embedding, and broad hint-based search with no strict-filter or similarity-cutoff option; verify empty preference arrays, unknown metadata, historical dates, wrong dimensions, maintenance/generation races, and empty versus integration failures.
- [x] 8.5 Document the Spain/Mediterranean wildfire example, latest-version search, UTC date hints, bounded bonuses/candidates, per-publication caps, redundancy, separate cosine/ranking scores, and citation lookup; verify the examples make no attribution, confidence, or independent-study claims.

## 9. Manual ingestion and periodic operation

- [x] 9.1 Add server-only composition and EvidenceIngestionJob with all-provider outcomes, fenced leases, safe independent progress, fair background budgets, weekly due-cycle checks, and maintenance deferral; verify fake-clock/repository tests for both providers, overlaps, expiry, backfill/recheck continuation, and failed-provider isolation.
- [x] 9.2 Add `pnpm evidence:ingest` and thin Worker scheduled handling with `0 */4 * * *` in dedicated Wrangler config; verify both use the same job, daily CSI publication refresh is satisfied, and no public write endpoint is introduced.
- [x] 9.3 Add pinned Worker type/bundle checks and document manual/local scheduled commands, secret bindings, UTC schedule, weekly recheck initiation/resume, budgets, failure/incomplete/maintenance outcomes, and manual deployment; verify local/fake entry points preserve frontend behavior.
- [x] 9.4 Align only relevant ARCHITECTURE.md evidence/backend/extension sections and the Supabase/evidence operating guide with the final implementation; verify environment names, model-output caveats, version/rebuild operations, source/history limitations, and rollback instructions.

## 10. Complete-pipeline and retrieval-quality acceptance

- [x] 10.1 Run offline end-to-end ingestion for both providers, repeat with zero duplicate current/archive records or embeddings, and retrieve Spain/Mediterranean wildfire fixture passages plus useful context/older analogues with different or missing metadata; verify source-version IDs, original citations, classifications, dates, cosine/ranking scores, and diversity.
- [x] 10.2 Run local SQL contracts and existing `pnpm lint`, `pnpm check`, `pnpm test`, `pnpm build`, plus Worker checks; verify immutable/current atomicity, citation/rebuild recovery, original RPC behavior, frontend privileged-import boundaries, and absence of out-of-scope AI/UI/provider changes.
- [ ] 10.3 Prepare and execute a small human-reviewed real-evidence retrieval evaluation with wildfire, heat/drought, and historical/context cases; record expected passages/URLs, actual top-result ranks, metadata-mismatch recall, publication diversity, corpus/profile/settings, and citation correctness; address or report shortcomings and keep authenticated checks pending if unavailable.
- [x] 10.4 Deliver the implementation report covering architecture/files, both retrieval mechanisms, actual selected Featherless model and 1536-output evidence, environment variables, ingestion/rebuild commands, four-hour/weekly scheduling, retrieval/citation examples, and coverage/quality limitations; distinguish offline guarantees from executed live checks.

## Workflow follow-up

- Apply reviewed new SQL through the existing manual Supabase workflow; production deployment is not automatic.
- Reconcile unknown legacy originals/profiles before adopting populated data, retaining existing citation IDs.
- Configure runtime secrets, verify authenticated Featherless batch output, perform/repeat bounded live ingestion, and complete real-evidence retrieval acceptance before enabling cron.
- Exercise maintenance rebuild/resume/abort in an isolated environment before using a production maintenance window.
- Keep unavailable authenticated checks explicitly pending; do not claim verified model output or retrieval quality from fakes.
- Archive only after a separate explicit archive request following implementation/review.

## Apply verification (2026-10-07)

41 of 42 tasks are complete. Lint, type checks, all 75 tests (including isolated pgvector SQL contracts), frontend build, Worker dry-run bundle, and strict OpenSpec validation passed. Production baseline metadata was checked read-only and the corpus was empty; no migration or Worker was deployed. The implementation review fixed classification, metadata/deduplication, pagination/recheck progress, item isolation, canonical identity and rebuild fencing defects; see `docs/evidence-implementation.md`. With the updated local configuration, the authenticated capability command verified two finite nonzero 1536-dimensional document vectors and two query vectors from Qwen/Qwen3-Embedding-4B. Task 10.3 has prepared official-source cases and an evaluation runner, but human retrieval review with a real indexed corpus remains pending. The change remains unarchived.
