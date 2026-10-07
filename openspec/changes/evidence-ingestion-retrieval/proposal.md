# Proposal

## Why

The climate evidence database exists in production, but the application cannot yet collect, embed, or retrieve scientific source passages. A repeatable ingestion and hybrid retrieval pipeline will provide traceable evidence for a later Climate Assessment feature.

## What Changes

- Add replaceable Climate Central and World Weather Attribution source providers, each with a separate normalizer. Use official CSI alert publications and WWA RSS/full HTML articles; gradually backfill older eligible WWA publications without a one-year cutoff.
- Add a provider-agnostic `EvidenceIngestionService`, deterministic configurable chunking, and canonical-URL/content-hash deduplication. Retain immutable source versions, complete normalized text, and stable passage citations when findings change.
- Add `FeatherlessEmbeddingProvider` with batching, bounded transient retries, stable ordering, and mandatory nonzero, finite 1536-dimensional vectors. Propose `Qwen/Qwen3-Embedding-4B` with explicit `dimensions: 1536`, subject to an authenticated capability check; distinguish query/document embedding purposes and fingerprint both preprocessing policies.
- Persist complete versions and current searchable chunks atomically through a server-only Supabase repository. Add narrowly scoped migration support for immutable citation records, processing profiles, durable provider progress, and atomic writes.
- Add provider-agnostic hybrid retrieval combining semantic and full-text candidates with reciprocal rank fusion. Use region, event category/date, and evidence/source classifications as bounded ranking hints, with no strict relevance filters or cosine cutoff. Search latest versions, reduce redundant passages, and limit dominance by one publication.
- Add a scheduler-independent ingestion job, manual runner, and thin Cloudflare Worker checking both providers every four hours. This satisfies daily CSI publication refresh; weekly bounded rechecks detect corrections to older publications. Isolate failures and preserve backfill/recheck progress across runs.
- Add an explicit manual rebuild from retained normalized text for embedding/chunking profile changes. Pause ingestion and retrieval during maintenance, preserve existing citations, and resume only with a complete compatible corpus.
- Add offline unit/orchestration tests and local SQL contract checks, plus a small human-reviewed retrieval evaluation using real evidence. Document configuration, operation, retrieval usage, and limitations.

**Explicitly out of scope:** ClimateAssessment AI; Human Influence classification; none/low/medium/high evidence judgments; generated explanations; EONET-to-evidence assessment or links; Climate Assessment UI; autonomous LLM agents; additional providers; PDF/OCR extraction; numerical daily CSI raster/KML ingestion; a guarantee of complete historical coverage beyond publicly discoverable WWA HTML publications; automatic model migration or zero-downtime rebuilds; and automatic production deployment.

Daily CSI updates mean checking the available alert publications for new or changed content, not creating a numerical dataset record for every day. The later assessment AI decides the relevance of returned evidence; it is outside this change.

## Capabilities

### New Capabilities

- `evidence-sources`: Official Climate Central/WWA discovery, historical publication coverage, revision rechecks, raw fetching, provider-specific normalization, classification, and provenance.
- `evidence-ingestion`: Provider registration, orchestration, chunking, role-aware embeddings, versioned atomic persistence, manual rebuilds, resilience, scheduling, and reporting.
- `evidence-retrieval`: Provider-independent query/result contracts, hybrid ranking with metadata hints, passage diversity, durable citations, result mapping, and retrieval-quality acceptance.

### Modified Capabilities

None. The OpenSpec capability inventory is currently empty.

## Impact

- Extend the existing TypeScript `src/domain` and `src/data/providers` conventions with small evidence services/repositories. Add server-only composition and Worker/manual entry points; keep the static Astro frontend and event-provider behavior unchanged.
- Reuse `EventCategory` from `src/domain/climate-event.ts`: this is the existing event vocabulary referred to as `EventType` in the request. Do not create a competing event enum.
- The active branch is `add-evidence-database`; its existing migration, Supabase config, and README are present. Reuse `supabase/migrations/20261006164800_create_climate_evidence_knowledge_base.sql` from baseline commit `065e65a`; verify the deployed contract during implementation without recreating or editing applied migration history.
- Preserve the production `vector(1536)` column, canonical URL uniqueness, current per-source chunk-position uniqueness, cosine HNSW index, existing `match_evidence_chunks` contract, and server-only RLS/grants. Add immutable version/citation storage alongside the current tables through new migrations.
- Add environment validation and a lightweight structured console logger because no backend config/logging/scheduler implementation exists yet. Reuse the existing `SUPABASE_SECRET_KEY` naming; credentials stay server-side.
- Expected dependency additions: small XML/HTML parsers compatible with Workers and pinned Wrangler tooling. Use existing injected `fetch`, `node:test`, `.test.ts`, and pnpm/CI conventions; avoid a new application framework or test framework.
- The architecture document's statement that PostgreSQL extensions remain undecided predates the evidence migration. Align only the evidence/backend sections with the already deployed pgvector decision during implementation.

This change currently contains planning artifacts only. Production state and authenticated Featherless output have not been verified or modified.
