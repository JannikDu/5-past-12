# Design

## Context

See [proposal.md](proposal.md) for motivation and scope. This document records the reviewed design. The [implementation report](../../../docs/evidence-implementation.md) records delivered code, executed verification, and pending authenticated acceptance; the baseline inspection below describes the pre-implementation repository.

### Inspected repository and schema

| Area | Observed state | Consequence |
| --- | --- | --- |
| Application | Static Astro with React islands; TypeScript ESM and explicit `.ts` imports | Add a separate backend entry point without converting the website to SSR |
| Domain | `src/domain/climate-event.ts` exports `EventCategory`, not `EventType` | Use `eventType?: EventCategory` and `eventTypes: EventCategory[]`; preserve existing literals |
| External clients | `src/data/providers/eonet.ts` uses injected native `fetch`, unknown-response validation, cancellation, and a 15-second timeout | Follow that adapter pattern for new clients; leave EONET behavior unchanged |
| Composition | `src/data/events.ts` registers event providers | Introduce a separate server-only evidence registry with the same explicit registration approach |
| Backend infrastructure | No Worker, Wrangler configuration, server config module, logger, or scheduled handler in this checkout | Add small backend modules and one Worker; no scheduling framework |
| Environment | `.env` names include `SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY`; no configured URL name was found | Reuse the secret-key name; add `SUPABASE_URL` and Featherless settings; do not read keys into artifacts |
| Tests and CI | `node:test`, strict assertions, injected HTTP fakes, `tests/*.test.ts`; CI runs pnpm lint/check/test/build on Node 24 | Extend these tests and checks; no new unit-test framework |
| OpenSpec | `spec-driven` schema, no existing capabilities | Three new delta specs; no main-spec edits |

The active checkout is now `add-evidence-database`. Its existing migration, Supabase config, and README are present and have been inspected read-only; the earlier baseline inspection used `git show 065e65a:<path>`. The reviewed OpenSpec change was moved here from `add-skills`. No production connection, authenticated embedding request, or SQL execution is part of this planning update.

The inspected migration defines:

- `evidence_sources`: UUID identity; required title/publisher/URL/source/evidence classifications; `event_types text[] NOT NULL DEFAULT '{}'`; nullable region, event interval, and publication date; database creation/update timestamps; unique canonical `url`.
- `evidence_chunks`: UUID identity; source foreign key with cascade; content; nullable `vector(1536)` embedding; contiguous positions enforced by ingestion and unique `(source_id, chunk_index)`; nonzero embedding constraint and cosine HNSW index.
- `match_evidence_chunks(query_embedding, match_count, match_threshold, filter_evidence_type, filter_source_type, filter_event_type, filter_region)`: cosine results with provenance; scalar classification filters, exact category membership, trimmed case-insensitive exact region matching; limits 1–100 and cosine thresholds -1–1.
- Server-only access: RLS enabled, no client read policies, table/function privileges granted to `service_role`, and invoker RPCs with explicit pgvector-schema resolution.

It has no content hash, external revision date, retained full normalized text, immutable source versions/citations, full-text index, ingestion progress, atomic multi-table write RPC, or processing-generation/maintenance state. Database `updated_at` records database updates, not an external publication revision. `ARCHITECTURE.md` predates the deployed extension; the user's production `vector(1536)` requirement takes precedence over its earlier undecided-extension language.

## Goals / Non-Goals

**Goals:** separate raw fetching, normalization, processing, and database transport; retain immutable evidence and citations; atomically activate complete source versions; replay failed and historical work across restarts; retrieve broadly with bounded metadata preferences and passage diversity; and support an explicit maintenance rebuild without a migration framework.

**Non-Goals:** see the proposal's explicit exclusions. There is no monorepo restructuring, browser-side privileged access, public ingestion HTTP route, vector-dimension migration, automatic model migration, zero-downtime rebuild, or distributed queue. Retaining normalized text is not a raw HTML/PDF archive. This slice does not calculate attribution, relevance judgments, or evidence confidence.

The completed design review confirmed daily CSI publication refresh, historical WWA backfill, no hard relevance exclusions, immutable versions/text/citations, weekly older-publication rechecks, passage diversity, query/document embedding purposes, maintenance rebuilds, and real-evidence retrieval acceptance. Remaining implementation defaults below follow project conventions.

## Decisions

### 1. Contracts and placement follow the existing project

Proposed locations:

| Location | Responsibility |
| --- | --- |
| `src/domain/evidence.ts` | EvidenceType/SourceType values matching the deployed SQL enums; normalized sources, query/result and profile types; import the existing EventCategory |
| `src/data/providers/evidence-source.ts` | Generic raw provider/fetch-batch contract with stable provider ID |
| `src/data/providers/climate-central-evidence.ts` | `ClimateCentralEvidenceProvider` and its raw alert type |
| `src/data/providers/world-weather-attribution-evidence.ts` | `WorldWeatherAttributionEvidenceProvider` and its raw publication type |
| `src/data/normalizers/evidence-normalizer.ts` | Generic normalizer contract |
| `src/data/normalizers/climate-central-evidence.ts` | `ClimateCentralEvidenceNormalizer` |
| `src/data/normalizers/world-weather-attribution-evidence.ts` | `WorldWeatherAttributionEvidenceNormalizer` |
| `src/data/embeddings/embedding-provider.ts` and `featherless.ts` | Embedding contract and `FeatherlessEmbeddingProvider` |
| `src/data/repositories/evidence-repository.ts` and `supabase-evidence.ts` | Persistence/search/progress contracts and concrete privileged Supabase data access |
| `src/services/evidence-chunker.ts`, `evidence-ingestion.ts`, `evidence-retrieval.ts`, `evidence-rebuild.ts`, `evidence-job.ts` | Chunking, ingestion, retrieval/citation contracts, manual rebuild, and scheduler-independent job |
| `src/server/evidence.ts`, `config.ts`, `logging.ts` | Concrete registration/composition, env validation, structured console logger |
| `workers/evidence-ingestion.ts`, `wrangler.evidence.jsonc`, `scripts/ingest-evidence.ts`, `scripts/rebuild-evidence.ts` | Thin scheduled Worker, ingestion runner, and explicit maintenance runner |

Contract sketches, not implementation:

```ts
interface EvidenceSourceProvider<TRaw> {
  readonly id: string;
  readonly name: string;
  fetchNew(options?: EvidenceFetchOptions): Promise<EvidenceFetchBatch<TRaw>>;
}

interface EvidenceNormalizer<TRaw> {
  normalize(raw: TRaw): Promise<NormalizedEvidenceSource | null>;
}

interface EmbeddingProvider {
  readonly profile: EmbeddingProfile;
  embed(texts: string[], purpose: 'document' | 'query', signal?: AbortSignal): Promise<number[][]>;
}

interface EvidenceRetrievalService {
  search(query: EvidenceQuery): Promise<EvidenceSearchResult[]>;
}

interface EvidenceCitationReader {
  findByChunkId(chunkId: string): Promise<EvidenceCitation | null>;
}
```

`EvidenceFetchOptions` extends `since` with cancellation, bounded work, an explicit list of item identities to replay/recheck, and opaque provider-owned checkpoint/HTTP state. Every raw item is wrapped in a generic envelope with stable provider item identity and work kind; failures identify the same item where possible. The normalizer still receives only its provider-specific raw payload. `EvidenceFetchBatch` reports discovery/backfill/recheck completeness, diagnostics, and proposed opaque continuation state. Only providers interpret their own state or turn identities into fetch requests.

The shared workflow records stored/unchanged/invalid/failed outcomes against envelope identities. The job atomically persists pending identities and safe progress, and passes those identities back through the provider contract on later runs or optimistic conflicts. This closes the downstream-failure feedback path without requiring the job to inspect WWA GUIDs, CSI anchors, or raw fields. Normalized persistence also retains provider/item provenance so the repository can enumerate known publications for rechecks. This provenance does not replace canonical URL identity.

Pair each generic provider with its own normalizer through a typed registration factory. The factory exposes a bound registration to the job, avoiding unsafe casts between Climate Central and WWA raw types. `EvidenceIngestionService` imports only contracts. `src/server/evidence.ts` is the only composition layer constructing concrete implementations.

Use native `fetch` for Featherless and Supabase Data API calls. For parsing, select small XML/HTML packages such as `fast-xml-parser` and `linkedom` after checking their Worker compatibility; do not use regular expressions as the article parser or add a headless browser. An HTTP helper can share new-client timeouts/retries without refactoring the existing EONET adapter.

**Alternative:** a new packages/apps architecture or a broad RAG framework would add unnecessary structure to the current small codebase. A single provider that both fetches and assigns domain classifications would prevent the independent normalizer tests required here.

### 2. Climate Central uses the official server-rendered CSI alert log

Primary endpoint: [Climate Shift Index Alerts](https://www.climatecentral.org/climate-shift-index-alert). Read-only HTTP inspection on 2026-10-07 confirmed complete alert bodies in server-rendered HTML, displayed dates/location/hazard labels, and stable `id="alert-<CMS-id>"` anchors. Preserve each actual anchor in `https://www.climatecentral.org/climate-shift-index-alert#alert-<CMS-id>`; an external CMS ID is raw provenance, not a database column invented by the provider.

Parse only alert containers. Exclude headers, navigation, donation prompts, image descriptions, button labels, duplicated excerpt/full-body content, and unrelated outbound content. Preserve paragraphs, scientific qualifiers, observation/forecast distinctions, title, publisher, displayed publication date, and explicitly supplied regions/event intervals. An absent editorial update date is null; HTTP Last-Modified belongs to fetch state.

The normalizer initially assigns CSI alert summaries `event_context` with `article` source type. If an eligible source representation is explicitly an observation, its type can be `observation`. Exact supported hazard labels and explicit study subjects can map to existing categories; CSI publisher identity alone never maps every item to extreme heat. A statement about hot ocean water near a storm is not a new finding about that storm's cause.

Fetch the small log at most once per provider pass, using ETag/Last-Modified only when there is no unresolved content. Reinspect all available alert cards for revisions and compare normalized hashes before embedding. Keep anchors even though generic canonicalization usually drops incidental fragments; they distinguish actual publications under the existing unique URL constraint.

**Limits:** the log identifies itself as a sampling of alerts. It is not a complete daily CSI archive, gridded observation API, or full research-report index. An anchor may disappear if the public log stops exposing an old alert. Store its original URL and text; document this provenance limitation. If the page's stable IDs or content structure disappear, fail discovery observably rather than generating identities from mutable titles or content hashes.

Daily update means refreshing this available publication log at least daily; the four-hour schedule meets that requirement. New or corrected text enters ingestion, while an unchanged log creates no embeddings or duplicate versions. There need not be a new alert every day. Numerical daily CSI KML/map snapshots remain outside this MVP, as confirmed in the review.

**Alternatives considered:** the official [CSI map](https://csi.climatecentral.org/climate-shift-index) exposes daily KML links, but converting grids into textual findings is a separate scope. The official sitemap also responds with publication URLs, while the general resource listing requires client-side loading in the inspected response. Neither is needed to deliver the first CSI publication pipeline. A larger report/PDF collector remains a later extension.

### 3. WWA uses RSS discovery with official article content

Primary endpoint: [WWA RSS](https://www.worldweatherattribution.org/feed/), with `?paged=2` and subsequent distinct pages as necessary. Read-only HTTP inspection confirmed HTTP 200 RSS, ten items on each of the first two pages, categories, UTC publication timestamps, canonical publication links, and `content:encoded` full content. The official [analyses index](https://www.worldweatherattribution.org/analyses/) and hazard categories establish publication scope; no conventional REST API is assumed.

Use feed categories to identify eligible analyses and then inspect substantive content. Do not classify solely from a WWA hostname or a broad category: some posts contextualize events through observations and previous studies. Use full feed text when usable; otherwise fetch the corresponding official article and its main body. Validate a canonical link against the official publication identity; do not follow arbitrary redirects into unrelated hosts.

The raw type preserves GUID, URL, feed categories, title, pubDate, optional explicit modification date, and article/feed markup. The normalizer removes boilerplate and maps a genuine event attribution analysis to `analogue_attribution` / `attribution_study`. Observational findings use `event_context` / `observation` or `article`; methodology/background explanations use `general_context` and the actual source format. Explicit scientific reports can use `scientific_report`, but no PDF content is inferred from a download link.

No event matching is attempted. Neither initial normalizer emits `direct_attribution` for a future/current EONET event. Existing schema values remain valid for other reviewed workflows; ingestion does not rewrite existing source classifications.

**Alternative:** scraping every category/news page creates more work and duplicate links than the verified paginated publication feed. Feed-only excerpt ingestion would lose findings where the feed is incomplete.

### 4. New discovery, historical backfill, and revision rechecks have durable progress

WWA routine discovery revisits a seven-day publication overlap and checks the feed head before background work. Initial discovery prioritizes recent material, then walks the accessible official feed into older eligible HTML publications without a 365-day cutoff. Backfill has its own durable cursor/completion state and continues across four-hour runs. Reserve bounded work for background lanes so neither historical coverage nor corrections starve during ongoing discovery. No one-run exhaustive import is required.

Initiate a weekly recheck cycle over all previously ingested publications, including studies older than the discovery overlap. Enumerate known WWA article identities and revisit official article content even if RSS timestamps/validators are unchanged. Climate Central reinspects its currently exposed alert cards on each pass; report unavailable old anchors while retaining their evidence. A weekly cycle can span multiple bounded runs and must report its actual progress/lag. Once historical traversal finishes, bounded periodic feed rescans can discover newly exposed/backdated older publications; accessible feed coverage is not a completeness guarantee.

`evidence_ingestion_state` contains provider discovery boundaries, opaque fetch/HTTP state, independent backfill/recheck continuations, pending stable item identities, due-cycle information, and lease owner/expiry. Publication text belongs to version storage, never this control table. Generic pending identities can be replayed regardless of age. Each lane reports its own completion so unfinished historical/recheck work does not block successful new-publication discovery.

Advance a successful discovery boundary only after that range is complete and all its eligible items are stored/unchanged or intentionally invalid. Persist budget continuations and pending failures together under the lease token. On unresolved items, refetch unconditionally or use retained pending content; a 304 is not proof that failed content was stored. Clean conditional fetches may avoid repeated content transport, while direct older-article rechecks proceed independently of feed validators.

Moving RSS page offsets are reconciled by stable GUID/canonical URL, never offset alone. An empty verified terminal page ends accessible backfill; a repeated page, parse failure, or timeout does not. A crash after source writes but before progress commits is safe because replay compares the stored hashes. Report disappeared content without deleting prior versions or interpreting an HTTP error as a scientific correction.

Default budgets remain ten feed pages and twenty eligible source items per provider pass, a two-minute provider deadline, a five-minute job deadline, and 2 MiB response-body caps. Share these budgets fairly across discovery, retries, backfill, and rechecks. Persist excess work and report `incomplete`. Provider leases default to ten minutes with server-time expiry; every checkpoint/source write verifies ownership. The manual maintenance rebuild has separate resumable work budgets and fencing.

**Alternatives:** a one-year eligibility cutoff misses historical analogues; a seven-day-only refresh misses older corrections. An in-memory watermark or blind timestamp advance can permanently lose failed items. Independent durable lanes provide the required coverage without a distributed queue.

### 5. Immutable version/citation storage sits alongside the current search tables

Use the existing canonical `url` as database identity. Providers retain their external IDs for diagnostics and discovery state; no second required source-ID model is necessary. Normalize URLs through `URL`: validate HTTP(S), reject embedded credentials, normalize hostname/default ports, remove an explicit tracking-parameter allowlist, and preserve identity query parameters and CSI anchors. Do not blindly strip trailing slashes or rewrite path case without provider rules.

Compute SHA-256 over stable normalized title, publisher, canonical URL, classifications, sorted tags, nullable region/dates, and complete normalized text. Meaningful metadata changes are revisions; fetched timestamps, database timestamps, validators, and secrets are not. Separate a normalization profile from the processing profile (chunker/version/settings plus embedding profile), so re-embedding does not invent a new document revision.

Add immutable `evidence_source_versions` for normalized metadata, complete text, content hash, normalization profile, and provider/item provenance. Add `evidence_version_chunks` as a durable passage journal with immutable chunk UUIDs, source-version/processing-generation references, content, position, text spans where available, and validated embeddings. Unique version/generation positions prevent repeated writes. Source metadata resides on the version, not on every chunk. Normal revisions and rebuilds never delete or alter earlier passage records.

Keep `evidence_sources` and `evidence_chunks` as the current searchable projection, preserving unique canonical URL and `(source_id, chunk_index)`. Add current version/generation references rather than weakening those constraints. Each current chunk uses the same UUID as its durable journal record. New searches join current versions; citation lookup reads the journal and version metadata by chunk ID. Future citation references must point to the durable journal, since a current projection row can leave search after a correction.

Per item:

```text
fetch envelope -> normalize raw -> lookup canonical URL/hash/profiles
  unchanged -> count skip
  new/revised -> chunk -> embed(document) -> validate every vector
              -> atomic retain version/passages + activate current projection
```

`store_evidence_source` is a service-only invoker RPC. Validate metadata, application-validated event tags, complete text, contiguous nonempty chunks, and nonzero finite 1536-dimensional vectors. Check provider fencing, expected active generation, and absence of maintenance under the same transaction locks used for rebuild transitions. Reread the source and compare the expected current version/hash/profile. Identical desired state returns unchanged; stale revisions produce optimistic conflicts and replay through the generic provider identity contract.

For a revision, create or reuse its immutable normalized version and complete passage representation, then update current source metadata/references and replace only current projection chunks in the same transaction. Preserve source ID/creation time and every prior journal ID. A shorter correction removes obsolete chunks from search but not citation lookup. Rollback leaves the previous complete projection and no incomplete retained publication. Replay uncertain responses by idempotent desired version/generation, without compensating deletion. Repeated or reverted content can reuse an existing complete retained representation.

**Alternative:** deleting all old passage records breaks citations; changing the deployed chunk uniqueness to fit every revision would also complicate existing RPC behavior. An immutable journal plus current projection preserves the baseline and permits reconstruction from complete retained text.

**Alternative:** separate source/chunk REST writes allow partial sources and prematurely advanced hashes. Nullable embeddings remain valid for the existing schema, but this pipeline commits only complete embedded sets. Immutable ingestion would miss corrected scientific findings.

### 6. Generic chunking uses explicit character units

Default maximum: 2400 Unicode code points; target overlap: 300; minimum useful tail target: 400. These are character units, not purported model tokens. Validate positive integer sizes, `0 <= overlap < size`, and feasible minimum settings. Keep model input comfortably below its published context size and bound total source/chunk request sizes.

Normalize line endings/spacing consistently while preserving paragraph boundaries. Pack paragraphs, then split oversized paragraphs at sentence/whitespace boundaries; use code-point slices for an oversized unbroken segment. Carry bounded overlap, guarantee forward progress, and merge/rebalance a tiny tail only when the maximum permits it. A naturally short source can yield one short chunk; never drop meaningful findings just to meet a target. Empty text yields no chunks. Record passage spans against retained normalized text where available for redundancy checks. Store content, embedding, position, spans, and version/generation relations rather than repeated title/region metadata.

**Alternative:** provider-specific chunking or a heavyweight tokenizer/splitting framework would obscure deterministic behavior. Character sizing is less exact than token budgeting, which is documented as a limitation.

### 7. Featherless uses explicit server-supported 1536 output

The [official Featherless embedding documentation](https://featherless.ai/docs/embeddings) confirms `POST https://api.featherless.ai/v1/embeddings`, batch inputs, indexed outputs, and the optional `dimensions` parameter for supporting models.

Proposed model: [Qwen/Qwen3-Embedding-4B on Featherless](https://featherless.ai/models/Qwen/Qwen3-Embedding-4B). Its [official Qwen model card](https://huggingface.co/Qwen/Qwen3-Embedding-4B) specifies default maximum dimensions of 2560 and supported output dimensions from 32 to 2560. Request `dimensions: 1536` explicitly and `encoding_format: 'float'` in every document/query call. This uses declared server/model support; it does not claim the model's native default is 1536.

The implementation must not truncate, pad, project, or reshape a returned vector. A server that ignores/rejects the requested dimension causes a clear configuration error. The 0.6B Qwen model's 1024-value maximum is incompatible; a chat model is not an embedding fallback. The proposed model is documentation-supported but **not authenticated-output verified** in this planning phase.

Use a configured base URL defaulting to `https://api.featherless.ai/v1`, bearer API key, required model env value, and default batch size 32. Reassemble batches by validated `data[].index`; require exactly one vector per input with indices 0 through n-1, 1536 finite values, and nonzero norm. Handle an empty text array locally. Request and body-parsing cancellation remain active through the whole operation.

The embedding contract carries a generic document/query purpose. Ingestion passes normalized passage text with `document`; retrieval passes ordinary query text with `query`. Model-specific formatting stays inside `FeatherlessEmbeddingProvider`. Follow the [official Qwen retrieval setup](https://huggingface.co/Qwen/Qwen3-Embedding-4B): leave documents unprefixed and format queries with an explicit task instruction, for example `Instruct: Given a climate-event query, retrieve relevant scientific climate evidence.\nQuery: <query>`. The separator is an actual newline. This instruction guides retrieval and does not perform Climate Assessment.

Fingerprint integration identity, endpoint/model, dimensions, and both role-specific policy versions/instruction contents in `EmbeddingProfile`. One active processing generation binds that embedding profile and deterministic chunking configuration. Historical generations may use other profiles, but only current compatible chunks participate in vector search. Source writes and searches validate the generation under database fencing. Equal dimensions never establish compatibility; changed model or role/chunking policy requires the explicit operator rebuild below, with no automatic adaptation.

**Pre-deployment check:** an explicit operator smoke command submits at least two distinct strings, checks returned indices/counts and every vector's 1536 values/nonzero norm, and reports success without printing vectors or the key. It is separate from offline CI and must succeed before claiming working production embeddings. If it fails, choose another documented compatible model or report configuration failure; do not change the production dimension to fit a model.

### 8. Supabase persistence uses additive migrations and privileged data access

Use injected native `fetch` against `/rest/v1` and `/rest/v1/rpc/*` behind `SupabaseEvidenceRepository`. Send the configured modern secret key through `apikey`; do not assume `sb_secret_...` is a bearer JWT. [Supabase's key documentation](https://supabase.com/docs/guides/getting-started/api-keys) identifies secret keys as server-only `service_role` credentials and documents this header distinction. No Supabase management token or database password is required at runtime.

Proposed additive SQL:

- Nullable current-version/generation references plus `evidence_sources.content_hash`, `ingestion_profile`, `embedding_profile`, and `source_updated_at`; current chunks gain version/generation references. Nullable adoption fields preserve legacy rows without inventing unknown text or profile provenance.
- Immutable `evidence_source_versions` and `evidence_version_chunks` for complete normalized documents, version-specific metadata/provider identity, and durable passage citations. Preserve current chunk UUIDs in the journal during legacy adoption; new current chunks share their journal UUIDs.
- `evidence_processing_generations` and singleton `evidence_corpus_state` for the active profile, maintenance state, fenced ownership, rebuild manifest, and durable staging progress. Keep this control surface small and operator-driven.
- A generated English `tsvector` of `evidence_chunks.content` and GIN index. This is a derived content index, not duplicated source metadata.
- `evidence_ingestion_state` and short lease/checkpoint RPCs with explicit service-role grants, RLS, invoker security, bounded input, and owner-token fencing.
- Atomic source/version activation, corpus rebuild transition/activation, citation lookup, and broad hybrid search RPCs. Resolve vector types/operators using the installed extension schema and preserve invoker/server-only grants.

Do not change `vector(1536)`, original enums, current-table uniqueness, HNSW index, legacy semantic RPC contract, or client-role denial. SQL validates payloads as well as TypeScript. Restrict archival/control tables and all new functions to privileged server access with RLS and explicit grants. Do not cascade deletion from a replaceable current chunk to its journal record.

Existing populated rows require deliberate reconciliation before adopting the new service. Preserve their existing chunk IDs and known metadata in explicitly marked legacy records; a source assembled from overlapping chunks is not a verified original full document. Unknown original text/profile remains unknown. Refetch/normalize supported legacy publications through a reviewed adoption step when necessary, preserving earlier citations, before claiming a rebuildable corpus. Unrecoverable/unknown profiles block adoption rather than being silently declared compatible. An empty baseline can initialize the first generation directly.

**Alternative:** changing applied migrations or using current rows as the only citation store would undermine the production baseline or historical citations. Version metadata and a small journal are the additions required by the agreed integrity behavior. Native fetch avoids confusing the CLI package named `supabase` with an application SDK.

### 9. Manual rebuild uses maintenance and staged complete activation

Add `pnpm evidence:rebuild` with explicit start/status/resume/abort operations and a target profile derived from validated runtime configuration. An operator invokes it for a changed model, embedding-role policy, or chunking configuration; scheduled ingestion never starts a rebuild automatically. Validate target capability before beginning the maintenance window when possible.

The repository atomically enters maintenance with a fenced owner token and captures a manifest of latest normalized source-version IDs. Coordinate this transition with ingestion/search locks so an in-flight old-generation operation cannot commit or compare after the transition. Ordinary ingestion and vector retrieval return typed maintenance outcomes; citation lookup remains possible because it needs no embedding comparison.

Rechunk and embed the manifest's retained texts in bounded batches under a new staging generation. Persist complete per-version representations and progress idempotently; never refetch external content merely to rebuild a verified normalized document. Renew/fence operator ownership across long runs. Missing original text, invalid vectors, or profile mismatches produce actionable failures without inventing content or modifying the active projection.

After every manifest version has a complete validated representation, atomically replace current projection chunks, update current processing references and active profile, and mark the corpus ready. Keep source-version IDs stable for unchanged normalized content, and preserve all previously returned journal UUIDs. A failed final transaction rolls back completely. The service resumes only with runtime configuration matching the newly active generation.

Failure/interruption leaves maintenance and durable staged progress visible; owner expiry permits controlled resume, not automatic release into a partial corpus. An explicit abort may restore ready state only for the previous complete active generation and matching runtime configuration. Existing citations and the previous corpus are retained throughout. Report status and resume/abort instructions through the manual runner.

**Alternative:** silently accepting changed config mixes vector spaces. A zero-downtime dual-index migration engine is unnecessary for this MVP; the user accepted a maintenance window. Staging plus final atomic activation provides recovery without that framework.

### 10. Broad hybrid retrieval uses metadata bonuses and passage diversity

```ts
interface EvidenceQuery {
  text: string;
  eventType?: EventCategory;
  region?: string;
  eventDate?: Date;
  evidenceTypes?: EvidenceType[];
  sourceTypes?: SourceType[];
  limit?: number;
}
```

`DefaultEvidenceRetrievalService` validates input, obtains the active profile/generation, requests a query-purpose embedding, and invokes repository search with the expected generation. The RPC revalidates ready state/generation before vector comparison. Only the repository knows PostgREST/SQL serialization. Return `chunkId`, `sourceId`, `sourceVersionId`, `content`, `similarity`, `score`, `sourceTitle`, `publisher`, `sourceUrl`, `evidenceType`, `sourceType`, and `publishedAt` (UTC string or null). Scores are ranking aids, not attribution/confidence. Separate citation lookup resolves journal IDs to original version metadata even after they leave current search.

Add service-only `hybrid_match_evidence_chunks`, preserving the existing `match_evidence_chunks` signature/results and its legacy opt-in filtering semantics. The new service never passes relevance metadata filters or a cosine cutoff to that legacy function. Reuse it for semantic candidate counts within its 100-row contract with all filters/threshold null; use a companion semantic helper with the same cosine/HNSW ordering for larger bounded pools. The hybrid RPC owns both branches and latest-version/generation validation; the higher service contains no SQL-specific branching.

Both branches search current, latest-version, compatible nonnull embeddings without event/region/date/classification exclusion. Omitted hints and empty type arrays add no preference. Matching an existing exact event tag, case-insensitive trimmed region, or any preferred type earns a bounded positive bonus; null/missing/disjoint metadata remains eligible without a bonus. Exact region matching is only a boost rule: Mediterranean context can rank through text even without a Spain label. No geographic hierarchy, invented tags, or event links are required.

`eventDate` supplies an overlap bonus for explicit event interval information on its UTC day. Compare known bounds to the day's interval; sources with no explicit event bounds receive no date bonus, and older/disjoint studies remain eligible. Publication dates never stand in for event timing. Historical-analogue relevance is left to semantic/lexical discovery and the later assessment AI.

Full-text candidates use `websearch_to_tsquery('english', query_text)` and `ts_rank_cd`; semantic candidates use cosine-distance ordering. Default bounded candidate count is `min(500, max(50, 8 * limit))` per branch, enlarged from the earlier draft to leave room for diversity. Base score is equal-weight RRF, `1/(60 + semanticRank) + 1/(60 + lexicalRank)`; an absent branch contributes zero. Deduplicate by chunk ID. Apply `score = rrfScore * (1 + metadataBonus)`, with total bonus bounded at 0.25 and equal contributions across supplied hint fields. Stronger text relevance can outweigh metadata matches; no mismatch adds a penalty or predicate. Break ties by cosine similarity descending, then chunk ID ascending.

After fusion/bonuses, select greedily in rank order with a default cap of two passages per canonical publication. Suppress identical text and same-version spans overlapping at least 60% of the shorter passage; ordinary small chunk overlap alone does not trigger suppression. Use normalized-content checks when spans are unavailable. Fill from remaining distinct candidates up to the result limit; return fewer when the bounded pool is exhausted. Document that publication diversity does not establish independent scientific studies.

Return the actual cosine similarity even for lexical-only candidates and keep final ranking score separate. There is no hard similarity threshold or strict metadata mode on the new API; remove `similarityThreshold` from the unimplemented draft contract. Candidate/result budgets and redundancy/source caps limit output, rather than making evidence-relevance judgments. Access, valid vectors, active generation, and latest-version checks remain integrity constraints. Query embedding failures raise errors; no silent lexical-only degraded mode is introduced.

**Alternatives:** pure vector search misses exact vocabulary. Strict Spain/Wildfire/date predicates discard useful Mediterranean heat/drought context and historical analogues; a cosine cutoff can discard exact lexical findings. Unlimited same-source chunks can dominate results. Broad hybrid candidates, bounded bonuses, and diversity implement the agreed discovery behavior while preserving the legacy RPC for existing callers.

### 11. Scheduling, failures, and logging stay thin

`EvidenceIngestionJob.run` handles provider lease acquisition, calls the shared ingestion service for every registered pair, commits safe progress, releases its own leases, and returns summaries. Process providers sequentially with bounded work for the initial hackathon. One provider's failure or active lease does not stop the other. The services depend on injected clock, HTTP, embedding, repository, and logging contracts.

The Worker `scheduled` handler uses `ctx.waitUntil`. Configure `0 */4 * * *` in `wrangler.evidence.jsonc`: both providers run every four hours UTC, meeting daily CSI publication refresh. The same tick starts/resumes due weekly recheck cycles and unfinished historical backfill with fair bounded work; weekly initiation is tracked in durable state, not a second scheduler framework. During rebuild maintenance, ordinary jobs report deferred maintenance and leave provider progress intact.

After both providers have outcomes, unresolved failures produce a failed scheduled invocation plus the complete summary; budget-limited `incomplete` work continues next time. Do not expose an unauthenticated write endpoint. The local runner uses the same composition and exits nonzero for unresolved failures; maintenance/deferred states are explicit. The manual rebuild has its own operator entry point, not a public route or a periodic automatic job.

HTTP retry policy: at most three attempts total for network errors/timeouts, 408, 429, and eligible 5xx; exponential backoff with jitter and bounded Retry-After delay constrained by the operation deadline. Do not retry ordinary 4xx, parse/schema errors, dimensions/profile mismatches, or caller aborts. Use bounded 15-second source/30-second embedding timeouts, covering body reads too. Database transient retries are limited to reads and idempotent atomic RPC/lease operations; optimistic conflicts trigger refetch, not blind stale overwrite.

Log JSON through an injected console logger: run/provider/item identity, work lane, stage, counts, error code/status, elapsed time, generation, and outcome. Required counters include fetched, normalized, invalid, duplicates, inserted/updated sources, retained versions, chunks, backfill/rechecked items, and failures; report cycle lag, incomplete work, and rebuild progress. Avoid keys, headers, documents, and vectors. Typed errors cover configuration, fetch, normalization, embedding, database, profile, maintenance, generation, and optimistic conflicts. Successful empty results remain distinct.

### 12. Configuration, operational examples, and tests

Proposed configuration (examples contain no keys):

| Name | Requirement/default |
| --- | --- |
| `SUPABASE_URL` | Required backend project Data API URL |
| `SUPABASE_SECRET_KEY` | Required; reuse existing server secret-key naming |
| `FEATHERLESS_API_KEY` | Required runtime secret |
| `FEATHERLESS_EMBEDDING_MODEL` | Required; proposed value `Qwen/Qwen3-Embedding-4B` |
| `FEATHERLESS_BASE_URL` | Optional; `https://api.featherless.ai/v1` |
| `FEATHERLESS_EMBEDDING_BATCH_SIZE` | Optional; 32 |
| `EVIDENCE_CHUNK_SIZE`, `EVIDENCE_CHUNK_OVERLAP`, `EVIDENCE_CHUNK_MIN_SIZE` | Optional; 2400 / 300 / 400 code points |
| `EVIDENCE_DISCOVERY_OVERLAP_DAYS`, `EVIDENCE_RECHECK_INTERVAL_DAYS` | Optional; 7 / 7; overlap never limits historical eligibility |
| `EVIDENCE_MAX_ITEMS_PER_PROVIDER`, `EVIDENCE_MAX_PAGES_PER_PROVIDER` | Optional; 20 / 10 |
| `EVIDENCE_RETRIEVAL_MAX_CHUNKS_PER_SOURCE` | Optional; 2 |

Keep deadlines/body caps as typed job/HTTP options initially and document them. Environment parsing accepts explicit Node env or Worker bindings; services never read `process.env`/`import.meta.env` directly. Add `.env.example` and documentation for Cloudflare secret bindings. `SUPABASE_PUBLISHABLE_KEY` is unnecessary for this privileged pipeline. There is no configurable embedding dimension that could silently disagree with production: the request/validation value is fixed at 1536.

Proposed commands: `pnpm evidence:ingest`, `pnpm evidence:check-embeddings`, and `pnpm evidence:rebuild` with start/status/resume/abort usage. Runners use the existing Node TypeScript convention and ignored local environment. Capability checks and human-reviewed real retrieval acceptance are explicit operations outside offline CI. Document Worker local scheduled testing and deployment with pinned Wrangler tooling; CI validates/bundles without deploying.

Example later server-side call:

```ts
const results = await evidenceRetrieval.search({
  text: 'wildfire conditions in Spain and the Mediterranean',
  eventType: EventCategory.Wildfire,
  region: 'Spain',
  limit: 10,
});
```

Test plan:

- Provider fixtures/fake HTTP: CSI anchors, unchanged daily publication refresh, WWA full text/canonical URLs, studies older than one year, historical pagination and shifted/repeated pages, weekly corrections with unchanged feed dates, unavailable old content, conditional/replay safety, and no unrelated crawl.
- Normalizers: null unknown fields, invalid intervals/identity, exact existing category literals, attribution versus observational content, qualifier preservation, and tracking URL equivalence.
- Chunker: determinism, Unicode, paragraphs/long unbroken text, bounds/overlap, tiny tails, complete text coverage, empty input, and invalid settings.
- Embeddings: role-specific adapter policy, profile fingerprints, 1536 finite/nonzero validation, indexed ordering/cardinality, batching, configured dimensions, bounded retries, cancellation, and no local reshaping.
- Repository/retrieval: native credential header, vector/RPC and camelCase mapping, latest/generation integrity, missing or mismatched metadata remaining eligible, UTC date bonuses without historical exclusion, empty preference arrays, low-similarity lexical candidates, fusion/bonuses/diversity, and typed empty/error/maintenance outcomes.
- Fake-based ingestion integration: two providers, repeat run with zero new embeddings/records, immutable corrections and citation lookup, provider isolation, pending/replay/304 safety, independent historical/recheck progress, and fenced overlap.
- Rebuild fakes: archived text as sole input, changed roles/chunking/model, pause, staging resume/idempotency, dimension failure, atomic activation/abort, expired ownership, stale ordinary operations, and citations resolving before/after.
- Isolated SQL checks using PGlite plus pgvector or local Supabase: original uniqueness and RPC behavior, atomic version/current rollback, journal ID preservation, service/client grants, maintenance/generation fencing, compatible activation, fusion/bonuses/diversity, and legacy-adoption handling. Pin harness dependencies; CI stays offline. The engine must support the baseline HNSW/iterative-scan settings.

The offline Spain acceptance corpus includes explicit Spain/Wildfire passages plus useful Mediterranean context, differently tagged heat/drought evidence, unknown metadata, and older analogues. Verify those remain eligible through ranking, not hard matching. Use both provider fixtures and repeated ingestion; validate original citations and distinct-publication diversity without inventing scientific claims.

Real-evidence quality acceptance uses a small human-reviewed set of available official publications and representative wildfire, heat/drought, and historical-analogue queries. Record expected useful URLs/passages, top-result ranks, whether expected evidence appears within the default limit, redundant passages/source dominance, and citation/version correctness. Include a case whose relevant context lacks exact query tags/region/date. Correct or report shortcomings before declaring quality acceptance. Pin the evaluated corpus/profile/settings so results can be compared after changes; this is a small evaluation record, not a benchmark framework or assessment AI.

Keep real authenticated embedding/retrieval checks separate from offline tests. If credentials or indexed real material are unavailable, mark these checks pending and do not claim actual 1536 output or retrieval quality. Later implementation reporting distinguishes tested contracts from executed live acceptance.

## Risks / Trade-offs

- [Production contract differs from local baseline] -> Reuse the migration already present on `add-evidence-database`, compare deployed metadata read-only when available, and reconcile drift through reviewed new migrations.
- [Featherless ignores custom dimensions or model is unavailable on the account] -> Explicit capability smoke check plus strict response validation; block incompatible configuration, never reshape or change the production column.
- [Unknown legacy text/profiles] -> Preserve original chunk IDs/known metadata, explicitly reconcile originals, and block unsafe adoption. The manual rebuild never fabricates full text or profile compatibility.
- [Version/citation storage grows] -> Retain immutable normalized versions and passages for this MVP; avoid raw payload archives and deduplicate unchanged representations. Retention pruning is separate future work.
- [Rebuild interruption or extended downtime] -> Retain the old complete projection, staged progress, and fenced maintenance; require explicit resume/abort and compatible configuration before search resumes.
- [CSI alert sampling/anchor turnover and HTML changes] -> Retain identity/provenance, save fixtures, isolate parser failures, and document limited coverage. Full report/daily-grid ingestion is separate work.
- [Moving/repeated RSS pages or late backdated content] -> Reconcile stable identities, preserve independent cursors/pending items, rescan bounded accessible history, and report actual coverage instead of promising a complete archive.
- [Candidate budgets or metadata bonuses reduce useful recall] -> Use broad pools, bounded positive hints, publication diversity, and representative real-evidence evaluation; no hard metadata/date/cosine relevance predicates.
- [Word-level lexical search is English and semantic search is approximate] -> Document this and test both paths. RRF is ranking, not probability, confidence, or attribution strength.
- [Worker runtime/request budget is exceeded] -> Bound work, persist continuation, fence leases, and validate deployment-plan limits. Introduce queues only if measured volume requires them later.
- [Transient partial commits across publications] -> Each publication remains internally atomic; checkpoint replay and canonical/hash deduplication repair interrupted provider runs.

## Migration Plan

1. Reuse the existing checked-out baseline migration/config/docs without changing applied history. Compare production schema/RPC/grants read-only when available and reconcile genuine drift before deriving additions.
2. Implement/test additive version/journal/generation/state/search support in an isolated database, including original RPC compatibility, current uniqueness, legacy ID/text/profile treatment, citation retention, maintenance, and denied client access.
3. Complete offline tests and existing lint/check/test/build plus Worker type/bundle checks. Inspect public imports for privileged clients.
4. Prepare reviewed SQL and Worker configuration. An operator applies additions through existing Supabase conventions; CI never deploys SQL automatically. Reconcile populated legacy data before adoption.
5. Configure secrets, verify actual Featherless 1536 batch output, perform/repeat bounded ingestion, and inspect immutable/current record counts. Exercise manual rebuild/recovery in an isolated environment before using production maintenance.
6. Run human-reviewed real-evidence retrieval acceptance with expected passages, historical/context cases, diversity, and original citations. Record failures or pending checks honestly.
7. Enable the four-hour trigger and weekly due-cycle logic after validation. Observe new discovery, historical/recheck progress, correction versions, retry/incomplete outcomes, and provider failures.

Rollback: disable cron/manual writes and revert the backend entry point while retaining version/journal/control data and the current complete corpus. During a rebuild, use explicit abort with the prior generation's configuration; never release maintenance onto partial or incompatible vectors. Original semantic RPC/schema remain available. Keep applied migration history, citation IDs, and fixed vector dimensions.

## Open Questions

- The final request/page/item budgets can be tuned after measured publication sizes and the selected Cloudflare plan are known; the bounded-work and continuation contract is fixed.
- No material architecture/scope decision remains open. Source coverage, relevance policy, retention, historical/revision work, and maintenance availability were confirmed in the design review; numerical CSI/PDF expansion requires a later change.
