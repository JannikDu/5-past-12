# Spec Delta

## Purpose

Give public readers understandable event assessments with separate influence and evidence indicators and transparent scientific citations.

## ADDED Requirements

### Requirement: Separate assessment indicators
Event details SHALL prominently show Human Influence and Evidence Strength separately with level definitions, a statement that levels are not probabilities, and the meaning of none. Unavailable results SHALL not fabricate levels.

#### Scenario: Indirect evidence assessment
- **WHEN** an assessment has differing influence and evidence levels
- **THEN** both independently labeled values and explanations appear

### Requirement: Transparent findings and references
The page SHALL show scientific findings, climate connection, immediate cause where supported, limitations, and uncertainty. Direct Evidence and Indirect Evidence SHALL appear separately with publication title, publisher, date if known, finding, passage, and original URL. Publications SHALL be deduplicated while retaining cited findings.

#### Scenario: Direct evidence absent
- **WHEN** no verified same-event attribution is available
- **THEN** the page explicitly says "No direct event-specific attribution evidence was found in the available knowledge base."

### Requirement: Honest lifecycle states
The page SHALL handle loading, unavailable assessment, insufficient evidence, failed generation, and missing/outdated citations explicitly. Outdated assessments SHALL be flagged; unverifiable citations SHALL prevent trusted display. Generation SHALL not occur on page load.

#### Scenario: Missing citation
- **WHEN** a saved citation cannot resolve to its immutable passage
- **THEN** the assessment is unavailable with an explanation and no fabricated scientific content

### Requirement: Persisted climate connection feed
The globe SHALL default to a read-only feed of validated completed assessments with cited direct or indirect findings, with no minimum influence threshold. Historical records within three calendar years SHALL remain discoverable independently of the live 30-day feed. Pending, insufficient and failed totals SHALL explain processing progress without fabricated connections.

#### Scenario: Historical connection is saved
- **WHEN** the scheduled job saves a validated finding for a historical event
- **THEN** the event becomes available in the connection feed without a frontend rebuild or generation on page load
