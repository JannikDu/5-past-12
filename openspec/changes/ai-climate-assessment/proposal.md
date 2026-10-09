# Proposal

## Why

Event details currently expose evidence gaps but cannot explain scientific connections using the ingested knowledge base. The hackathon needs reusable, conservative assessments with traceable passages and separate Human Influence and Evidence Strength indicators.

## What Changes

- Add an independent assessment model, four-perspective retrieval, Featherless JSON generation, passage verification, and conservative evidence limits.
- Retain assessments and claim citations against immutable evidence versions; reuse saved results and allow explicit reassessment.
- Extend the existing evidence Worker with public reads and operator-authenticated generation; keep the static frontend and scheduled ingestion.
- Show independent levels, scientific findings, deduplicated direct/indirect sources, uncertainty, and honest empty/error/stale states.
- Add offline pipeline, provider, database, HTTP, and rendered UI tests and a manual demonstration command.
- Add bounded sequential connection discovery across at most three calendar years, with progressive results, saved-result reuse, and an explicit model-call budget. Validated direct or indirect findings count as connections regardless of influence level.
- Normalize event identity anchors without requiring provider registration numbers for named events. Keep country-only records and historical analogues indirect unless same-event identity is established.
- Select stored scientific attribution studies first, find corresponding real EONET events and verify the three-year event window using the existing Worker's cron, shared leases, bounded calls and retained lookup/assessment outcomes.
- Publish validated direct or indirect connections to the globe and deploy both existing Workers with backend-only credentials.

## Capabilities

### New Capabilities

- `climate-assessment`: Evidence-grounded generation, verification, persistence, and explicit refresh of event assessments.
- `assessment-presentation`: Public display of independent levels, scientific findings, evidence relationships, and fallback states.

### Modified Capabilities

None. Existing retrieval contracts and ingestion remain compatible.

## Impact

New domain/service/repository modules, an additive Supabase migration, the existing Cloudflare Worker, event detail React UI/CSS, configuration, scripts, tests, and operating documentation. Reuse native runtime validation and HTTP utilities; introduce no framework, queue, or Worker.
