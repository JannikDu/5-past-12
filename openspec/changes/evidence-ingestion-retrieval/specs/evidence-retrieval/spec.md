# Spec Delta

## Purpose

Provide later application services with ranked scientific evidence passages and original provenance through one provider-independent hybrid retrieval contract.

## ADDED Requirements

### Requirement: Provider-independent query and result contract

Retrieval SHALL accept query text plus optional existing event category, region, event date, evidence/source type preference arrays, and result limit. Metadata SHALL guide ranking without strict relevance exclusion. The public contract SHALL hide embedding transport, database clients, RPC names, and pgvector representations. Concrete integrations SHALL be replaceable.

#### Scenario: Application searches for evidence
- **WHEN** a caller submits text and an optional `eventType` using the existing event vocabulary
- **THEN** it receives normalized evidence results through the retrieval contract
- **AND** it does not construct vectors, know Supabase RPC names, or select a source provider

### Requirement: Query validation

The system SHALL reject blank text, invalid dates/enums, blank supplied regions, and noninteger/out-of-range limits before external calls. Limit SHALL default to 10 and accept 1 through 100. Omitted hints and empty evidence/source preference arrays SHALL add no ranking preference and SHALL not force an empty result. The new retrieval API SHALL expose no strict-filter mode or cosine relevance cutoff.

#### Scenario: Invalid date or limit
- **WHEN** a caller supplies an invalid date or a limit of 0
- **THEN** retrieval raises an actionable query validation error
- **AND** no embedding or database request is sent

#### Scenario: Explicitly empty classifications
- **WHEN** a valid query supplies `evidenceTypes: []` or `sourceTypes: []`
- **THEN** the array adds no classification preference
- **AND** otherwise valid passages remain eligible for the normal search

### Requirement: Compatible query embeddings

Retrieval SHALL request query-purpose embedding through the active declared profile and validate exactly 1536 finite values with nonzero vector norm before search. Compatible document/query policies SHALL not require identical strings. Search SHALL revalidate generation and maintenance state before comparison. Embedding/configuration failures SHALL surface errors rather than silently using another space or lexical-only search.

#### Scenario: Query embedding has wrong dimensions
- **WHEN** the embedding integration returns a 1024-value query vector
- **THEN** retrieval raises a dimension/configuration error
- **AND** the database search is not called

#### Scenario: Corpus enters rebuild maintenance
- **WHEN** retrieval starts during maintenance or its generation becomes stale before database comparison
- **THEN** it receives a maintenance or generation-conflict error
- **AND** the query vector is not compared with a partially rebuilt or different embedding space

### Requirement: Hybrid semantic and lexical ranking

Search SHALL combine cosine semantic and full-text candidates through reciprocal rank fusion with bounded metadata bonuses. It SHALL preserve cosine similarity separately from the final ranking score, deduplicate by chunk ID, and use deterministic ties. Semantic-only and lexical-only candidates SHALL remain eligible. Candidate and result limits SHALL bound work without asserting that omitted evidence is irrelevant.

#### Scenario: A chunk appears in both candidate lists
- **WHEN** semantic and lexical searches both identify the same chunk
- **THEN** one result combines both rank contributions
- **AND** its similarity remains its cosine value rather than its fused score

#### Scenario: Exact place name helps retrieval
- **WHEN** an indexed passage has strong lexical overlap with a location or named event but ranks lower semantically
- **THEN** lexical ranking contributes to its fused score
- **AND** the returned list is ordered by the documented fusion, metadata, and diversity rules

#### Scenario: No lexical candidates exist
- **WHEN** the full-text query finds no passages but semantic search finds qualifying chunks
- **THEN** semantic-only candidates can be returned
- **AND** empty lexical results do not fail the query

### Requirement: Metadata guides ranking without exclusion

Event category, region, and evidence/source classifications SHALL contribute bounded positive ranking preferences. Exact existing event tags, case-insensitive trimmed region labels, and any matching preferred classification SHALL qualify for their documented bonuses. Nonmatching or missing metadata SHALL remain eligible without fabricated tags, geographic claims, or hard predicates on either candidate branch.

#### Scenario: Combined metadata preferences
- **WHEN** a query requests `Wildfire`, region ` Spain `, and two preferred evidence types
- **THEN** matching tags, region labels, and either preferred evidence type can improve ranking
- **AND** Mediterranean heat or drought context can still be returned through semantic or lexical relevance
- **AND** the preferences do not establish a direct match to an application event

#### Scenario: Missing region or event tags
- **WHEN** a source has null region or no applicable event tags and corresponding query hints are supplied
- **THEN** its passage remains eligible without receiving unsupported metadata bonuses
- **AND** returned metadata stays null or empty rather than being inferred to justify a match

### Requirement: Event date is a relevance hint

An optional event date SHALL provide a bounded ranking bonus for an explicit overlapping event interval on that UTC calendar day. Disjoint historical intervals and unknown event dates SHALL remain eligible. Publication date SHALL not substitute for event time. Date proximity SHALL not establish direct attribution or relevance to the caller's actual event.

#### Scenario: A study is published after its studied event
- **WHEN** its explicit studied interval overlaps the query day but its publication date is later
- **THEN** its explicit interval can contribute a date bonus
- **AND** publication time is not used as event onset

#### Scenario: Explicit interval is disjoint or unknown
- **WHEN** a query day is outside a known event interval
- **THEN** the source remains eligible as historical evidence without an overlap bonus
- **AND** a source with unknown event dates remains eligible and retains those null dates

### Requirement: No hard relevance cutoff

Hybrid retrieval SHALL not reject a valid candidate using a cosine relevance threshold or strict metadata mode. Every returned passage SHALL still belong to a latest source version in the active compatible generation and have a valid embedding. Finite candidate/result budgets and diversity controls SHALL be documented. The later assessment AI determines relevance; this pipeline SHALL not make that assessment.

#### Scenario: Lexical hit has low semantic similarity
- **WHEN** a valid lexical candidate has cosine similarity 0.2 and strong overlap with the query's place or event vocabulary
- **THEN** it remains eligible without being rejected by a cosine cutoff
- **AND** its lexical rank contributes to selection despite its low cosine similarity

### Requirement: Diverse nonredundant evidence passages

Retrieval SHALL suppress identical or substantially overlapping passages and apply a documented per-publication passage cap to the ranked candidate pool. Distinct eligible publications SHALL have an opportunity to appear before repeated passages from one publication dominate results. It SHALL return fewer results when the bounded pool cannot satisfy these controls, without generating claims about evidence strength or study independence.

#### Scenario: One long study supplies many high-ranked chunks
- **WHEN** one publication supplies most top-ranked chunks and other publications also have ranked candidates
- **THEN** the configured publication cap prevents that one source from filling the result list
- **AND** additional distinct publications can appear while original scores and provenance remain available

#### Scenario: Passages substantially overlap
- **WHEN** two candidate passages from a source largely repeat the same underlying text
- **THEN** the documented redundancy rule retains the higher-ranked representative
- **AND** the same chunk appearing in both search branches is returned only once

### Requirement: Complete normalized evidence provenance

Every result SHALL include immutable chunk ID, source ID, source-version ID, content, cosine similarity, ranking score, source title, publisher, original URL, EvidenceType, SourceType, and nullable publication date. Fields SHALL use validated camelCase mapping and metadata belonging to that version. Scores SHALL not represent confidence, attribution strength, or the later AI's relevance judgment.

#### Scenario: Database row maps to a result
- **WHEN** the database returns a valid source/chunk match
- **THEN** identifiers, text, classifications, dates, similarity, and original URL survive mapping
- **AND** `published_at: null` becomes `publishedAt: null`
- **AND** `source_title` and `source_url` become the corresponding domain fields
- **AND** the source-version identifier identifies the retained metadata used for the passage

#### Scenario: Database returns malformed metadata
- **WHEN** a search row contains an unsupported classification or invalid score
- **THEN** retrieval reports a result-contract error
- **AND** the row is not silently trusted or converted into invented metadata

### Requirement: Latest search and durable citation resolution

Ordinary search SHALL use only the latest successfully activated source versions in the active processing generation. A provider-independent citation lookup SHALL resolve an earlier returned chunk ID to its original retained passage and version metadata after corrections or rebuilds. Historical citation lookup SHALL not silently substitute current text or require live provider access.

#### Scenario: Corrected study replaces searchable findings
- **WHEN** a new complete source version activates
- **THEN** ordinary search returns its current passages rather than superseded ones
- **AND** lookup of a previously returned chunk ID still resolves the original findings and metadata

#### Scenario: Embedding rebuild changes chunk representation
- **WHEN** a rebuild activates a new chunking or embedding generation
- **THEN** ordinary search uses that complete generation
- **AND** earlier citation IDs continue to resolve independently of current vector search

### Requirement: Supabase details stay within privileged data access

The concrete data-access implementation SHALL contain RPC/vector serialization, version joins, generation validation, citation lookup, and ranking details. It SHALL preserve the existing semantic RPC's parameter/result contract while adding broad hybrid ranking. Legacy filtering behavior SHALL not become strict filters in the new retrieval service. Privileged access and keys SHALL remain unavailable to the browser bundle.

#### Scenario: Existing semantic-only caller remains valid
- **WHEN** a server-side caller invokes the deployed semantic RPC with its original parameters
- **THEN** the original parameter/result contract continues to work
- **AND** new hybrid support does not require a breaking migration of that caller

### Requirement: Empty matches differ from integration failures

Retrieval SHALL return an empty array for a successful search with no eligible candidates. Exhausted embedding, authentication, database, timeout, maintenance, generation, or result-contract failures SHALL surface useful typed errors. Empty results SHALL not trigger generated explanations, relevance judgments, or evidence-absence classifications.

#### Scenario: Query has no qualifying evidence
- **WHEN** the database successfully finds no matching chunks
- **THEN** retrieval returns an empty array
- **AND** it does not generate an explanation or an assessment of evidence absence

#### Scenario: Database is unavailable
- **WHEN** database search fails after bounded transient retries
- **THEN** retrieval reports a database failure
- **AND** the caller can distinguish that failure from zero relevant matches

### Requirement: Offline hybrid retrieval acceptance

Offline tests SHALL verify query-purpose embeddings, result mapping, nonexcluding metadata/date hints, hybrid ranking, diversity, latest-version search, citation retention, and empty/error behavior. A fixture-based acceptance scenario SHALL ingest both providers, repeat without duplicates, and retrieve original-URL passages for the Spain/Mediterranean wildfire query, including useful context with different or missing metadata.

#### Scenario: Spain wildfire query after repeatable ingestion
- **WHEN** fixtures include Spain/Wildfire evidence, Mediterranean context, and relevant historical studies with different or missing metadata
- **AND** the same provider fixtures are ingested twice
- **AND** retrieval is called with text `wildfire conditions in Spain and the Mediterranean`, event type `Wildfire`, and region `Spain`
- **THEN** relevant fixture passages are returned with original URLs and source metadata
- **AND** source/chunk counts are unchanged by the second ingestion
- **AND** the results make no direct-attribution or Climate Assessment claim

### Requirement: Human-reviewed real-evidence retrieval acceptance

Readiness acceptance SHALL include a small human-reviewed evaluation using real Climate Central and WWA publications and representative queries. It SHALL record expected useful passages, retrieved ranks, original citations, source diversity, historical-analogue/context recall, and limitations. This SHALL be separate from credential-free unit tests and SHALL not implement a Climate Assessment AI or claim model output verified without actual execution.

#### Scenario: Representative real-evidence queries are reviewed
- **WHEN** the operator evaluates Spain/Mediterranean wildfire conditions and additional heat/drought or historical-analogue cases
- **THEN** the report records which expected publications/passages occur within the configured result limit
- **AND** verifies citations, relevance for the intended evidence-discovery use, and publication diversity
- **AND** failures are recorded and addressed or reported before claiming retrieval-quality acceptance

#### Scenario: Authenticated evaluation cannot run
- **WHEN** required runtime credentials or a real indexed corpus are unavailable
- **THEN** automated tests still run offline
- **AND** the real-evidence acceptance check remains explicitly pending rather than being reported as passed
