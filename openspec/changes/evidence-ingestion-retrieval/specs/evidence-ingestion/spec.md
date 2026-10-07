# Spec Delta

## Purpose

Turn normalized publications into repeatable, embedded evidence records through a replaceable pipeline, with reliable persistence, isolated failures, and scheduled operation.

## ADDED Requirements

### Requirement: Provider-independent ingestion workflow

Ingestion SHALL orchestrate raw fetching, normalization, duplicate detection, chunking, embedding generation, and persistence through replaceable contracts. Adding a provider SHALL require registering its provider/normalizer pair without editing the shared workflow. Manual and scheduled execution SHALL use that same workflow.

#### Scenario: Additional provider is registered in a test
- **WHEN** a fake provider and matching normalizer are registered alongside the initial providers
- **THEN** the unchanged workflow can ingest its normalized results
- **AND** no Climate Central or WWA concrete type is required by the orchestrator

### Requirement: Repeatable source and chunk deduplication

The system SHALL use canonical URL uniqueness and unique chunk positions within each processing representation to prevent duplicates, including concurrent runs. Unchanged normalized sources with unchanged processing configuration SHALL be skipped before embedding. Repeated ingestion SHALL preserve source, version, and chunk IDs and record counts. Existing current-table uniqueness constraints SHALL remain effective.

#### Scenario: Same publications are ingested twice
- **WHEN** two successive runs receive identical normalized publications with unchanged processing configuration
- **THEN** the second run creates no duplicate sources or chunks
- **AND** it makes no embedding requests for those stored publications
- **AND** it creates no redundant retained version or citation record

#### Scenario: Concurrent runs race to store one source
- **WHEN** two runs discover the same canonical publication
- **THEN** persistence creates one source and one complete current chunk set
- **AND** the losing or redundant write is reported as unchanged or a retryable conflict

### Requirement: Intentional content revision handling

The system SHALL detect meaningful source changes through deterministic hashes and processing profiles. A correction SHALL create or reuse an immutable normalized source version and atomically activate a complete validated chunk set. Source identity SHALL stay stable. Earlier versions and cited passages SHALL remain retrievable; failed revisions SHALL leave the last complete searchable version intact.

#### Scenario: A publication is corrected and becomes shorter
- **WHEN** a stored publication receives revised findings or source metadata
- **THEN** its current metadata and complete searchable chunk set change together
- **AND** obsolete trailing chunks leave current search while remaining available through their retained citation IDs
- **AND** ordinary retrieval uses the latest successfully activated version

#### Scenario: An embedding request for a revision fails
- **WHEN** any batch for the replacement fails permanently
- **THEN** the previous source metadata, hash, and complete chunk set remain visible
- **AND** the revised source remains eligible for a later retry

### Requirement: Complete normalized text and immutable citations

Each ingested version SHALL retain complete normalized text, its normalized metadata, and processing provenance independently of current search chunks. Returned chunk IDs SHALL identify immutable passage records that remain resolvable after source revisions or rebuilds. Citation resolution SHALL return the cited version's text and metadata, without substituting newer findings. Rebuilds SHALL not depend on refetching external publications.

#### Scenario: Citation survives a publication correction
- **WHEN** a previously returned chunk ID is resolved after its publication has changed
- **THEN** the original passage and the metadata belonging to its original source version are returned
- **AND** the passage is not replaced by current text merely because the canonical URL is unchanged

#### Scenario: Original publication is no longer accessible
- **WHEN** the external article or alert anchor disappears after ingestion
- **THEN** the retained normalized version remains available for citation resolution and rebuilding
- **AND** the system does not claim it has an original raw HTML or PDF snapshot unless one was actually retained

#### Scenario: Only processing settings change
- **WHEN** unchanged retained source text is rechunked or re-embedded under a new processing generation
- **THEN** its normalized document version is preserved
- **AND** new passage representations do not overwrite or reuse existing citation IDs for different content

### Requirement: Generic deterministic text chunking

Chunking SHALL be provider-independent and deterministic for a fixed normalized text and configuration. It SHALL use configurable maximum size and overlap, preserve paragraphs/sentences where practical, bound every emitted chunk, avoid needless tiny tails, and assign contiguous zero-based positions. It SHALL NOT parse provider HTML or invent missing text.

#### Scenario: Long paragraphs and short tails
- **WHEN** text contains paragraphs larger than the configured maximum and a small trailing fragment
- **THEN** long passages are split at safe text boundaries with configured bounded overlap
- **AND** a tiny tail is merged or rebalanced within the maximum where possible
- **AND** joining non-overlap portions preserves all substantive input text

#### Scenario: Repeated chunking uses the same configuration
- **WHEN** the same text is chunked twice
- **THEN** contents, overlap, ordering, and chunk positions are identical

#### Scenario: Empty text or invalid configuration
- **WHEN** input contains only whitespace, or overlap is greater than or equal to the maximum size
- **THEN** empty text produces no chunks and invalid configuration raises a useful validation error
- **AND** no empty chunk is stored

### Requirement: Featherless embedding integration is replaceable

The initial embedding integration SHALL use Featherless's OpenAI-compatible embeddings endpoint with environment-provided credentials and model configuration. It SHALL support text arrays and a configurable positive batch size. The ingestion and retrieval workflows SHALL depend on an embedding contract rather than Featherless-specific transport details.

#### Scenario: Inputs exceed one embedding batch
- **WHEN** a source produces more texts than the configured batch size
- **THEN** the integration sends bounded requests until every text has one validated embedding
- **AND** a fake embedding integration can replace Featherless in tests

### Requirement: Query and document embedding purposes

The embedding contract SHALL distinguish query and document purposes. The concrete integration SHALL own any model-specific task instruction or input formatting. Ingestion SHALL request document embeddings and retrieval SHALL request query embeddings. The declared embedding profile SHALL fingerprint both policies without exposing model-specific prompt construction to either workflow.

#### Scenario: Retrieval model uses query instructions
- **WHEN** the configured model documents an instruction for queries and an unprefixed document policy
- **THEN** the integration applies each policy only to its corresponding purpose
- **AND** ingestion and retrieval pass ordinary domain text plus a purpose, rather than constructing model-specific strings

#### Scenario: Query preprocessing changes
- **WHEN** the configured query-formatting policy differs from the active declared profile
- **THEN** compatibility validation detects the change
- **AND** neither workflow silently assumes that matching vector dimensions establish compatibility

### Requirement: Exact embedding shape and ordering

Every stored and query embedding SHALL contain exactly 1536 finite numeric values and have nonzero norm. Batch responses SHALL provide exactly one unique index per input, with embeddings returned in input order. The system SHALL reject wrong dimensions, invalid numbers, zero vectors, missing/duplicate indices, or extra responses; it SHALL NOT pad, truncate, or reshape vectors locally.

#### Scenario: Server returns shuffled embeddings
- **WHEN** a batch response contains all valid indices in a different array order
- **THEN** output vectors are reordered by index to match their original texts

#### Scenario: Selected model returns 2560 values
- **WHEN** a configured model ignores the explicit 1536-dimension request and returns 2560 values
- **THEN** the operation fails with a configuration/dimension error naming expected and received dimensions
- **AND** no source or chunk write is attempted for that operation

#### Scenario: Malformed embedding response
- **WHEN** the response contains NaN, infinity, zero vectors, missing indices, or duplicate indices
- **THEN** the complete response is rejected with a validation error
- **AND** texts are not associated with uncertain or misordered vectors

### Requirement: Explicit embedding-space compatibility

The system SHALL use one active declared embedding profile including provider/model identity, output dimensions, and query/document preprocessing policies. It SHALL detect unknown or incompatible active embeddings before writes or search. Equal dimensions SHALL NOT imply compatibility. Retained historical representations SHALL not be compared across spaces. Profile or chunking changes SHALL use the explicit rebuild workflow.

#### Scenario: Model changes without changing dimension
- **WHEN** configuration selects a different model while persisted chunks use an earlier profile
- **THEN** normal ingestion/retrieval reports an incompatible-profile error
- **AND** it does not compare or silently mix the vectors

#### Scenario: Deployment capability check
- **WHEN** an operator checks the proposed Featherless model configuration
- **THEN** a requested `dimensions: 1536` batch must return correctly ordered, nonzero 1536-value vectors
- **AND** documentation identifies the model as unverified until that check succeeds

### Requirement: Explicit manual corpus rebuild

An operator SHALL be able to rebuild latest retained source versions under a new declared embedding or chunking profile. Retrieval and ordinary ingestion SHALL pause during maintenance. The rebuild SHALL stage and validate a complete compatible corpus before activation, preserve old citations, and expose durable progress. Interrupted or failed rebuilds SHALL not publish a partial corpus or automatically resume incompatible retrieval.

#### Scenario: Model changes through an operator rebuild
- **WHEN** the operator requests a rebuild using a different compatible 1536-dimensional model
- **THEN** latest retained normalized texts are processed without requiring live source fetches
- **AND** ordinary ingestion and retrieval report maintenance while work is incomplete
- **AND** the complete new profile and searchable corpus activate together before retrieval resumes

#### Scenario: Rebuild fails midway
- **WHEN** a batch or database write fails during a rebuild
- **THEN** existing retained citations and the previous complete corpus remain intact
- **AND** staged progress can be resumed or explicitly abandoned
- **AND** abandonment permits return only to the previous complete corpus with its matching runtime configuration

#### Scenario: Rebuild races ordinary work
- **WHEN** an ingestion or retrieval operation started before maintenance attempts to finish afterward
- **THEN** persistence or search checks reject stale maintenance/generation ownership
- **AND** no incompatible vector is committed or compared against another generation

### Requirement: Complete atomic persistence

Persistence SHALL atomically commit retained version/passage records and the current source metadata, processing references, and complete nonempty validated chunk set. It SHALL preserve vector(1536), existing current-table uniqueness, source relations, and server-only access through new migrations. A failure SHALL leave no orphan, partial current version, or changed historical citation.

#### Scenario: Database rejects one chunk in a transaction
- **WHEN** writing a source fails while validating or inserting one of its chunks
- **THEN** all source/chunk/hash changes for that publication roll back
- **AND** a previous complete version remains available if one existed
- **AND** no incomplete retained version is presented as successfully ingested

### Requirement: Failure isolation and bounded retries

Provider and item failures SHALL be isolated so other usable items/providers can continue. Network timeouts, rate limits, and eligible server failures SHALL receive bounded retries with backoff and Retry-After support. Invalid content, authentication/configuration errors, dimension mismatches, and caller cancellation SHALL NOT be blindly retried. Exhausted failures SHALL be observable and retryable on later runs where appropriate.

#### Scenario: Climate Central is unavailable
- **WHEN** Climate Central fails after its retry budget
- **THEN** WWA still runs and can store its evidence
- **AND** the run summary reports Climate Central as failed and WWA's actual outcome

#### Scenario: One publication cannot be embedded
- **WHEN** embedding one normalized publication exhausts transient retries
- **THEN** other publications can continue
- **AND** no partial chunks for the failed publication are persisted

#### Scenario: Empty provider response
- **WHEN** a provider successfully reports no eligible new items
- **THEN** the run records a successful empty result
- **AND** it does not manufacture an error or delete stored evidence

### Requirement: Durable checkpoint and conditional-fetch safety

Discovery, backfill, recheck, and failed-item progress SHALL survive restarts without blocking unrelated work. Successful discovery boundaries SHALL advance only after complete discovery and all eligible items are stored, unchanged, or explicitly invalid. Stable item identities SHALL support replay after downstream failures. Conditional HTTP state SHALL not hide failed content behind a 304 response.

#### Scenario: Process restarts after partial success
- **WHEN** some items commit and the process terminates before provider progress commits
- **THEN** the next run rediscovers pending items and safely skips already committed ones

#### Scenario: Provider returns 304 after an earlier failure
- **WHEN** a failed item has not been successfully handled
- **THEN** pending items are retried through an unconditional fetch or durable pending content
- **AND** 304 is not interpreted as successful processing of that failed item

#### Scenario: Discovery hits the run budget
- **WHEN** a request/page/item budget prevents completion
- **THEN** a durable continuation permits later progress
- **AND** the successful publication boundary is not advanced past undiscovered material

#### Scenario: Downstream failure requires raw content again
- **WHEN** normalization, embedding, or persistence fails for an identified raw item
- **THEN** the shared workflow records that identity for replay through the provider contract
- **AND** it does not inspect provider-specific raw fields or construct provider-specific refetch URLs

### Requirement: Four-hour periodic ingestion

The system SHALL provide a scheduler-independent all-provider job and a four-hour Cloudflare scheduling entry point. This SHALL meet daily CSI publication refresh while avoiding unchanged imports. The job SHALL dispatch due weekly rechecks and continue historical work within budgets. Fenced provider leases SHALL prevent checkpoint races and expire after abandoned runs. The domain workflow SHALL not import scheduler APIs.

#### Scenario: Four-hour schedule fires
- **WHEN** the configured Cron Trigger invokes the job
- **THEN** both WWA and Climate Central are checked
- **AND** unchanged publication content is deduplicated before embedding
- **AND** due older-publication rechecks and unfinished historical work receive bounded progress

#### Scenario: A manual run overlaps a scheduled run
- **WHEN** a valid lease already covers one provider
- **THEN** the second job reports that provider as already running
- **AND** it can run other unlocked providers

### Requirement: Structured operational reporting

Each run SHALL report provider starts, fetched/normalized/skipped items, duplicates, stored sources/versions, chunks, failures, duration, and status. Summaries SHALL distinguish discovery, backfill, revision rechecks, and rebuild/maintenance outcomes. Logs SHALL identify runs/providers/items without secrets, complete source texts, or vectors. Jobs SHALL return machine-readable summaries.

#### Scenario: Mixed success run completes
- **WHEN** a run stores one source, skips a duplicate, and fails another item
- **THEN** counters distinguish the outcomes and identify the failed provider/item
- **AND** a manual runner exits nonzero for unresolved failures while keeping successful commits

### Requirement: Server-only configuration and access

Featherless and Supabase credentials SHALL come from validated runtime environment configuration. Privileged ingestion/retrieval and database RPCs SHALL remain server-only. Missing or invalid required configuration SHALL produce actionable errors without disclosing secrets. The public Astro/React bundle SHALL NOT import privileged clients or receive their credentials.

#### Scenario: Key or required model is missing
- **WHEN** a runner starts without the required embedding configuration
- **THEN** it identifies the missing variable and stops dependent work
- **AND** no key value appears in logs or committed examples

### Requirement: Focused offline pipeline verification

Offline tests SHALL cover normalization, deduplication, immutable citations, revisions, chunking, embedding purposes/validation, provider isolation, historical/recheck progress, and orchestration with fakes. Local database tests SHALL verify atomicity, uniqueness, fencing, rebuild recovery/activation, and privileged access without live Supabase or external credentials.

#### Scenario: Offline acceptance ingestion
- **WHEN** fake HTTP providers supply representative Climate Central and WWA fixtures
- **THEN** a fake or local repository receives normalized sources and correctly indexed 1536-dimensional chunks
- **AND** a second identical run creates zero new records or embeddings

#### Scenario: Offline rebuild acceptance
- **WHEN** a fake embedding integration rebuilds the retained corpus with a new declared profile
- **THEN** tests verify maintenance behavior, failure/resume, and complete activation
- **AND** earlier returned citation IDs still resolve to their original passages and metadata

### Requirement: Evidence processing remains within the ingestion boundary

Ingestion SHALL store published text and provenance only. It SHALL NOT perform ClimateAssessment AI, Human Influence or evidence-strength classification, generate explanations, assess EONET relationships, modify Climate Assessment UI, invoke an autonomous LLM agent, or add providers beyond the two initial sources.

#### Scenario: Stored attribution finding is available
- **WHEN** a study passage has been ingested and embedded
- **THEN** it is available for later retrieval
- **AND** no application event's attribution status or explanation is created or changed
