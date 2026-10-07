# Spec Delta

## Purpose

Collect traceable climate evidence from official Climate Central and World Weather Attribution publications, retaining their findings and metadata without asserting relevance to an application event.

## ADDED Requirements

### Requirement: Replaceable source and normalization boundaries

The system SHALL expose separate provider-independent contracts for fetching raw source material and normalizing it. Each registered provider SHALL have its own raw representation and normalizer. Fetching SHALL NOT assign domain evidence classifications.

#### Scenario: Raw publication crosses the provider boundary
- **WHEN** either initial provider fetches a publication
- **THEN** it returns a stable item identity, provider-specific raw data, source URL, available dates, location/category metadata, and substantive content
- **AND** its separate normalizer determines the domain fields

### Requirement: Official Climate Central CSI content

The system SHALL discover evidence from the official Climate Shift Index alert log and extract individual alert content, dates, titles, location labels, and findings. It SHALL retain stable alert identifiers and a resolvable official URL for each alert. It SHALL NOT depend on a presumed general-purpose Climate Central API.

#### Scenario: Multiple alerts share one listing page
- **WHEN** the official log contains two alerts with different stable HTML identifiers
- **THEN** they become distinct raw items with distinct official anchored URLs
- **AND** their titles, displayed publication dates, findings, and location labels remain attributable to the correct alert

#### Scenario: Only context about a different hazard is provided
- **WHEN** an alert describes climate-influenced ocean temperatures near a storm
- **THEN** extraction preserves the stated findings and qualifications
- **AND** normalization does not invent attribution findings about the storm or assign unsupported hazard tags

#### Scenario: Daily refresh has no new alert
- **WHEN** the official log is checked during a day with no new or changed publication
- **THEN** the check succeeds without creating another source or embedding unchanged text
- **AND** daily refresh does not imply daily numerical CSI coverage or a new publication every day

### Requirement: Official WWA publication discovery

The system SHALL discover WWA publications from its official RSS feed, support bounded feed pagination, and retain canonical article URLs and publication dates. It SHALL collect substantive attribution or observational findings from feed content or the corresponding official article body, excluding navigation and unrelated pages.

#### Scenario: Feed excerpt is incomplete
- **WHEN** an eligible RSS item lacks sufficient full-text findings
- **THEN** the provider fetches its official canonical article and extracts the article body
- **AND** it retains the publication date, title, publisher, and original URL

#### Scenario: Feed includes unrelated news
- **WHEN** an RSS item concerns recruitment, fundraising, or another subject with no climate-evidence findings
- **THEN** it is excluded from evidence ingestion
- **AND** the exclusion is reported without scraping linked unrelated content

#### Scenario: Older publications require pagination
- **WHEN** eligible older publications lie beyond the first feed page
- **THEN** the provider continues through distinct subsequent pages within its request budget
- **AND** reports incomplete discovery if the budget expires before the accessible archive is exhausted

### Requirement: Gradual historical WWA publication coverage

WWA discovery SHALL prioritize new publications and gradually backfill older eligible HTML studies without a fixed publication-age cutoff. Backfill SHALL persist progress, share bounded work fairly with new discovery and revision checks, and distinguish an exhausted accessible feed from budget exhaustion or fetch/parse failure. PDF-only findings remain outside this capability.

#### Scenario: Relevant study is older than one year
- **WHEN** an eligible WWA attribution study predates the initial recent-discovery window
- **THEN** it remains eligible for the historical backfill
- **AND** its original publication date and canonical URL are preserved

#### Scenario: Backfill continues while new material appears
- **WHEN** historical pagination is incomplete and a new eligible publication appears
- **THEN** the new publication is checked without waiting for the historical scan to finish
- **AND** older work continues in bounded subsequent batches without losing its cursor

#### Scenario: Pagination repeats or fails
- **WHEN** a feed page repeats prior page content or fails before a verified end
- **THEN** discovery reports the problem or incomplete state
- **AND** it does not claim that all historical publications were imported

### Requirement: Incremental discovery does not hide failed items

Providers SHALL accept an optional successful-ingestion boundary and use recent overlap and HTTP validators to reduce unnecessary fetching. The boundary SHALL be a hint, not proof of persistence or a historical eligibility cutoff. Stable item identities SHALL permit provider-independent replay of failed fetch, normalization, embedding, or persistence work. Truncated discovery SHALL NOT be reported as complete.

#### Scenario: One article failed on the previous run
- **WHEN** a later publication was stored but an earlier discovered article failed
- **THEN** a subsequent run can rediscover the failed article
- **AND** a global publication timestamp does not silently exclude it

#### Scenario: Recently published content is revised
- **WHEN** an already discovered alert or article changes within the configured revision window
- **THEN** the provider returns the changed raw content for hash comparison
- **AND** unchanged content is not treated as a new publication

### Requirement: Older publication corrections are monitored

The system SHALL initiate weekly bounded recheck cycles for previously ingested publications regardless of publication age. Rechecks SHALL use actual publication content, retain durable progress and retries, and be independent of new-publication feed timestamps. Unchanged rechecks SHALL not create duplicate evidence or embeddings; observed corrections SHALL enter the normal versioning workflow.

#### Scenario: An older WWA study is corrected
- **WHEN** a stored study outside the recent overlap receives revised findings
- **AND** its canonical article is revisited by the weekly recheck cycle
- **THEN** the changed content is returned for normalization and version comparison
- **AND** an unchanged RSS publication date does not hide the correction

#### Scenario: Recheck cycle exceeds one run
- **WHEN** weekly rechecks exceed a run's item or time budget
- **THEN** the remaining publications stay in a durable continuation
- **AND** later runs resume the cycle while continuing new-publication discovery

#### Scenario: Previously stored publication becomes unavailable
- **WHEN** a recheck cannot fetch a previously stored article or find an old alert anchor
- **THEN** the outcome is reported without deleting its retained evidence or citation records
- **AND** unavailability is not represented as an empty replacement publication

### Requirement: Normalize into the deployed source representation

Normalization SHALL produce a nonempty title and publisher, canonical HTTP(S) URL, source/evidence classifications, textual content, existing event-vocabulary tags, and nullable region/publication/event dates. It SHALL target the existing `evidence_sources` representation and SHALL NOT introduce event links or a competing event enum.

#### Scenario: Metadata is explicitly available
- **WHEN** a publication supplies an event interval and an unambiguous region
- **THEN** normalization preserves them, validates interval ordering, and preserves the publication date separately
- **AND** fetch time or publication time is not substituted for event onset

#### Scenario: Optional metadata is unknown
- **WHEN** reliable region, publication date, or event dates cannot be established
- **THEN** the corresponding fields are null
- **AND** unsupported event tags are represented by an empty array, as required by the deployed schema

### Requirement: Reuse the existing event vocabulary

Applicable event tags SHALL use `EventCategory` values from the existing climate-event model, including `Wildfire`, `Flood`, and `Extreme heat`. The system SHALL infer tags only from explicit provider categories or sufficiently clear textual statements and SHALL NOT guess categories from publisher identity.

#### Scenario: WWA publishes a fire-weather study
- **WHEN** an article explicitly studies wildfire conditions
- **THEN** its normalized event tags include the existing `Wildfire` literal
- **AND** no separate `EventType` enum or lowercase database vocabulary is created

#### Scenario: Cold and unspecified temperature extremes
- **WHEN** source material describes cold spells or broad temperature extremes
- **THEN** it uses the existing temperature-extremes vocabulary when supported
- **AND** it is not automatically tagged as extreme heat

### Requirement: Conservative evidence and source classification

The system SHALL use the existing EvidenceType and SourceType values. WWA attribution studies SHALL default to reusable `analogue_attribution`, with `attribution_study` source type; observational articles and general explanations SHALL receive context classifications according to their actual content. Initial ingestion SHALL NOT assign `direct_attribution` based on publisher alone or claim a match to an EONET event.

#### Scenario: WWA reports a study of a specific published event
- **WHEN** an article reports an attribution analysis of an identified historical weather event
- **THEN** it is retained as an attribution study with reusable analogue evidence
- **AND** it does not establish direct evidence for any current application event

#### Scenario: WWA publishes observations without a new attribution analysis
- **WHEN** an article contextualizes an event using observations or earlier studies
- **THEN** it is classified as `event_context` or `general_context`, with source format determined from its content
- **AND** the presence of WWA branding does not make it an attribution study

#### Scenario: Climate Central publishes a CSI alert
- **WHEN** an alert explains regional climate conditions using CSI findings
- **THEN** it is stored as event context with an appropriate article/observation source format
- **AND** its numerical findings and uncertainty qualifiers remain intact

### Requirement: Stable canonical source identity

Normalization SHALL remove tracking parameters and normalize safe URL variants without removing identity-bearing query parameters or official alert fragments. WWA SHALL use validated canonical article URLs; Climate Central log items SHALL retain their stable official `#alert-<id>` identity. Unsupported schemes, credential-bearing URLs, and conflicting identities SHALL be rejected.

#### Scenario: Tracking variants identify the same WWA publication
- **WHEN** two discovered links differ only in tracking parameters
- **THEN** both normalize to the same canonical source URL
- **AND** they can be deduplicated through the existing URL uniqueness constraint

#### Scenario: Climate Central fragments distinguish real sources
- **WHEN** two alerts share a base URL but have different official alert identifiers
- **THEN** canonicalization preserves the fragments
- **AND** the alerts are not collapsed into one source

### Requirement: Validate external content and preserve meaning

The system SHALL validate untrusted feed/page data, preserve paragraph and heading boundaries, remove markup and page boilerplate, and retain scientific caveats. Malformed required identity/content fields SHALL skip the item with a reason; absence of optional metadata SHALL NOT invalidate otherwise usable evidence.

#### Scenario: Malformed required fields
- **WHEN** a raw item has no safe canonical URL, no title, or no substantive textual findings
- **THEN** normalization returns a skipped outcome
- **AND** ingestion logs the provider/item reason without creating a source

#### Scenario: Evidence includes uncertainty or negative findings
- **WHEN** a study finds no detectable change or substantial uncertainty
- **THEN** normalization retains that statement and its surrounding qualifiers
- **AND** no positive climate-influence conclusion is generated

### Requirement: Source limitations are documented

Operational documentation SHALL describe official endpoints, four-hour publication checks, gradual WWA backfill, weekly older-publication rechecks, budgets, and coverage limits. It SHALL distinguish daily CSI alert refresh from numerical daily CSI ingestion, and publicly discoverable HTML coverage from a guaranteed complete archive. PDF-only findings and numerical CSI datasets remain outside this pipeline.

#### Scenario: Operator evaluates source coverage
- **WHEN** the operator reads the ingestion documentation
- **THEN** it distinguishes publication evidence from complete CSI data coverage
- **AND** it explains that absence of retrieved content does not establish absence of climate influence
- **AND** it identifies unfinished backfill/recheck work and the absence of guaranteed complete historical coverage

### Requirement: Offline provider contract verification

Provider and normalizer tests SHALL use representative XML/HTML fixtures and injected HTTP fakes. They SHALL cover both providers, canonical identity, nullable metadata, classification differences, historical pagination, publication corrections, duplicate entries, malformed content, and changed page structure without live services.

#### Scenario: Official page structure changes
- **WHEN** an HTTP fixture lacks previously required alert/article structure
- **THEN** a test verifies an observable parse failure or skipped item with a reason
- **AND** an empty fabricated source is never treated as valid evidence

#### Scenario: Historical and corrected publications are fixtures
- **WHEN** fixtures include a study older than one year and a changed older article with an unchanged feed date
- **THEN** tests verify historical eligibility and correction discovery through rechecks
- **AND** all external calls remain mocked
