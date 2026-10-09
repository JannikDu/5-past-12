# Spec Delta

## Purpose

Explain scientific connections for reported natural events through conservative, reusable assessments backed by immutable source passages.

## ADDED Requirements

### Requirement: Scientific evidence discovery
The service SHALL retrieve approximately four perspectives: specific-event attribution, regional observed trends, physical mechanisms, and comparable events. It SHALL use actual passages, preserve generation/version guarantees, deduplicate chunks, limit publication concentration, and avoid strict region filters.

#### Scenario: Regional metadata differs
- **WHEN** a broader regional study supports a relevant mechanism
- **THEN** it remains eligible for assessment despite nonmatching region metadata

### Requirement: Grounded claims
Every substantive scientific statement SHALL have verified retrieved passages. Direct findings, supported multi-source synthesis, and general mechanisms SHALL remain distinguishable. Unsupported intermediate steps, analogues, observed trends, projections, immediate causes, uncertainty, and conflicting findings SHALL be qualified explicitly. Source material SHALL be treated as untrusted data.

#### Scenario: Invalid claim or citation
- **WHEN** output is malformed, a citation is unknown, a version mismatches, or a claim lacks passage support
- **THEN** the assessment is rejected with no partially trusted publication; only missing required JSON fields permit a bounded repair

#### Scenario: Additional JSON fields or scientific rejection
- **WHEN** a model response adds fields, uses invalid values, or fails scientific support checks
- **THEN** unknown additional fields are discarded, invalid required values or scientific rejection fail the assessment, and no automatic generation retry is made

#### Scenario: Required JSON fields are missing
- **WHEN** a response omits required schema fields
- **THEN** the same phase can be repaired using the exact missing-field feedback, up to three total attempts, without regenerating an already validated draft

#### Scenario: Comparable attribution is indirect
- **WHEN** a study attributes a different historical event
- **THEN** its findings are not transferred to the assessed event

### Requirement: Independent conservative levels
Human Influence and Evidence Strength SHALL independently use none, low, medium, or high, never probabilities. High SHALL require strong explicit same-event attribution and supported findings. General context SHALL not establish event-specific influence or elevate evidence beyond low. Missing attribution SHALL not imply physically absent influence.

#### Scenario: General mechanisms only
- **WHEN** only applicable mechanisms support claims
- **THEN** influence remains none and evidence is at most low

### Requirement: Secure reusable persistence
Generation SHALL run server-side with protected credentials and explicit operator initiation or the authorized scheduled catalog job. Saved results SHALL be reused across page loads. Assessment JSON and citations SHALL persist atomically against immutable records. Changed events, source corrections, and corpus changes SHALL be detectable and explicit reassessment SHALL be supported.

#### Scenario: Saved result is read
- **WHEN** a public detail page requests an existing assessment
- **THEN** no embedding or generation call is made and authoritative citation metadata is resolved

#### Scenario: Source changes while assessment is generated
- **WHEN** the active corpus changes before persistence
- **THEN** saving fails rather than mixing corpus snapshots

### Requirement: Conservative acceptance scenarios
Automated tests SHALL cover direct, indirect, and insufficient evidence, invalid responses, citation mismatches, unsupported attribution, contradictory evidence, persistence, and deduplication. Real authenticated evaluation SHALL be reported separately from fixtures.

#### Scenario: No applicable evidence
- **WHEN** retrieval succeeds without applicable scientific evidence
- **THEN** an insufficient-evidence assessment is saved with none levels and no fabricated findings

### Requirement: Recent bounded connection discovery
Operator discovery SHALL assess candidates sequentially within the last three calendar years, emit each validated outcome progressively, reuse compatible saved results, and stop at the requested connection count or explicit candidate/model-call limits. Direct or indirect cited findings SHALL count as connections without a minimum influence level. Nonmatching and failed outcomes SHALL remain visible in the report. No expensive discovery SHALL run on public page loads.

#### Scenario: No connection yet
- **WHEN** a candidate has insufficient evidence or fails validation
- **THEN** the outcome is reported and discovery proceeds to a different candidate within its remaining budget, without retrying the rejected scientific response

#### Scenario: Three-year boundary
- **WHEN** an event's first reported observation is older than the three-year cutoff or in the future
- **THEN** it is excluded from discovery and new assessment without a generation call; the age of supporting publications is not restricted

#### Scenario: Resume an earlier search
- **WHEN** the operator supplies a valid prior discovery report
- **THEN** all cumulatively attempted IDs are excluded from the next run without regenerating rejected responses; the new run uses its own explicit call budget

### Requirement: Scientific event identity normalization
Provider registration numbers SHALL NOT be required as source-text anchors for otherwise identifiable named events. Matching SHALL normalize punctuation, diacritics, and supported month spellings while preserving event-name specificity, date compatibility, and scientific attribution requirements.

#### Scenario: Named fire has an administrative suffix
- **WHEN** the event name and compatible study period match but a provider's numeric suffix is absent from the publication
- **THEN** that suffix alone does not prevent direct attribution validation

#### Scenario: Only country and category match
- **WHEN** an unnamed event and a study share only a country and hazard category
- **THEN** this does not establish direct same-event attribution; qualified indirect findings remain eligible

### Requirement: Scheduled catalog processing
The existing Worker SHALL select stored attribution studies before looking up corresponding real EONET events, verify the three-year event window, persist study-version lookup outcomes and progressively assess matched records. It SHALL NOT fall back to chronological discovery. A database lease SHALL exclude overlapping runs. Unchanged failed attempts SHALL NOT trigger generation retries. Selection overlap SHALL NOT establish attribution or raise assessment levels.

#### Scenario: Study precedes event lookup
- **WHEN** a scheduled run discovers candidates
- **THEN** it selects unchecked current study versions first, derives bounded provider queries from their dates and hazard categories, and queues only matching real events within the three-year window

#### Scenario: Study has no corresponding provider event
- **WHEN** a complete lookup finds no matching eligible event, or the study provides no usable date/category
- **THEN** that outcome is retained and later studies can be selected; no unrelated chronological fallback or generation occurs

#### Scenario: More events than fit in one invocation
- **WHEN** the completion budget or runtime limit is reached
- **THEN** untouched events remain pending and a later cron resumes processing

#### Scenario: Rejected scientific response
- **WHEN** assessment fails scientific validation
- **THEN** its event attempt is retained as failed and subsequent unchanged runs do not regenerate it

#### Scenario: Provider window is saturated
- **WHEN** EONET fills the configured result limit
- **THEN** the date window is split or reported incomplete, and that study lookup is not recorded as complete
