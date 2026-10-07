# 5 Past 12 — Architecture

## Purpose

This document records the technical decisions that have already been approved for the Project.

## Architectural Goals

The architecture should support:

- a public, read-only climate information experience,
- interactive global and regional exploration,
- ingestion of climate-event and scientific-evidence data,
- AI-assisted evidence extraction and explanation,
- strict traceability from scientific claims back to evidence,
- deterministic downstream processing of AI outputs,
- interchangeable AI and data providers,
- deployment on Cloudflare and Supabase,
- rapid iteration during the 7-day hackathon.

## Confirmed Technology Stack

### Frontend

- Astro
- React
- TypeScript

The first slice uses a dependency-free React SVG globe with an orthographic
projection, decorative dotted continent silhouettes, and front-hemisphere event
markers. Dragging, keyboard controls, and a complete event list expose all events.
This is a prototype; production globe / map technology remains an open decision.

### Backend

- Cloudflare Workers

The dedicated evidence Worker runs the same server-only ingestion job as the
manual runner. The Astro frontend remains static. Provider adapters and services
live under the existing `src/data`, `src/domain`, `src/services`, and `src/server`
conventions; no application framework or monorepo restructuring is required.

### Database

- Supabase PostgreSQL

The deployed evidence baseline uses pgvector with `vector(1536)` and a cosine
HNSW index. An additive migration retains immutable source versions and passage
citations alongside the current searchable projection, English full-text/GIN
support, processing generations, and provider progress. Evidence tables and RPCs
remain server-only with RLS and explicit service-role grants.

### Scheduling

- Cloudflare Cron Triggers

The evidence Worker uses `0 */4 * * *` UTC to check both evidence providers.
Durable state starts/resumes weekly publication rechecks and bounded historical
backfill. Fenced leases coordinate overlapping manual and scheduled runs.
Deployment and migration application remain explicit manual operations.

Additional asynchronous infrastructure is not part of the current architecture decision and may be evaluated later.

### AI Providers

AI access must be implemented behind a provider abstraction.

Featherless AI is expected to be an initial provider during the hackathon, but application logic must not depend directly on Featherless-specific behaviour where avoidable.

The architecture should allow alternative providers or models to be added later without rewriting the evidence-processing pipeline.

### Data Providers

NASA EONET v3 is the first natural-event source. Additional climate, disaster,
news, and environmental providers remain open decisions. Evidence ingestion adds
separate Climate Central CSI alert and World Weather Attribution RSS/HTML adapters,
each paired with an independent normalizer. No event relationships are created.

All external data integrations should be isolated behind provider-specific adapters where practical.

Implemented event-provider contract (`src/data/providers/event-source.ts`):

```ts
interface EventSourceProvider {
  readonly id: string;
  readonly name: string;
  fetchEvents(query?: EventQuery): Promise<EventBatch>;
  fetchEvent(externalId: string, signal?: AbortSignal): Promise<ClimateEvent | null>;
}
```

The objective is to keep the application data model independent from any single external API.

`EventQuery` supplies `days`, `limit`, and an optional cancellation signal.
`EventBatch` contains normalized events and a count of skipped malformed or
duplicate records. `fetchEvent` returns null for a missing event and rejects on
provider failure or invalid data. Both lookup paths share the same domain contract.

### First vertical slice

Astro still builds static pages. React islands hydrate on the homepage and
`/events/detail`; the browser requests EONET at runtime, so builds do not depend on
NASA availability. The detail ID is query-encoded and resolved directly from the
provider, allowing reloads and links to events outside the current feed. Missing
or invalid IDs, unavailable records, and provider errors have separate UI states.

```text
EONET v3 JSON → EonetProvider → ClimateEvent → React globe / event list
                                      └──→ event card → /events/detail?id=…
```

The core model lives in `src/domain/climate-event.ts`. It uses namespaced IDs,
category/status/severity/evidence/source enums, GeoJSON-order longitude/latitude,
dated point or polygon observations, source links, and fetch provenance. Latest
geometry supplies the marker. For polygons, the first boundary vertex is used and
labelled accordingly; it is not a centroid. Observation dates are not asserted to
be event onset, and provider closure is curation metadata that can precede later
observations. Reported magnitudes remain separate from severity.

The EONET adapter validates unknown JSON and rejects impossible timestamps,
unsupported or malformed geometry, and out-of-range coordinates. It normalizes
timestamps to UTC, maps categories (including broad temperature extremes), keeps
safe HTTP(S) links, removes duplicate records, and reports skipped records. It
has request cancellation, a 15-second timeout, and explicit errors. Domain
validation checks structural/provenance consistency; it does not establish the
truth or sufficiency of scientific evidence.

To add a source such as GDACS or FIRMS, implement `EventSourceProvider`, normalize
into `ClimateEvent`, and register it in `src/data/events.ts`. Provider-specific
identifiers and field names stay inside adapters. No GDACS/FIRMS ingestion,
AI explanation or event-to-evidence assessment has been implemented in that
event slice. The separate evidence backend now supplies immutable ingestion,
hybrid retrieval/citation lookup, and maintenance rebuilds through replaceable
contracts. See [evidence operating guide](docs/evidence.md).

The exploratory layer displays **reported natural events**, never publishes them
as scientifically attributed climate-impact events. EONET references are typed
as event reports; severity is unknown and attribution is unverified. Demo fixtures
are explicitly fictional, have no sources, and use missing attribution evidence.
Supported evidence would require references to scientific-study sources, but no
current adapter produces supported climate attribution. The detail page separates
event reports, scientific evidence, and missing cause / climate explanations.

### Deployment

- Cloudflare for the web application and backend runtime
- Supabase for PostgreSQL persistence

## Repository Strategy

The project uses a monorepo.

The exact folder structure may evolve, but the repository should keep frontend, backend, shared types, schemas, and project documentation together.

A possible structure is:

```text
5-past-12/
├── apps/
│   └── web/
├── workers/
├── packages/
│   ├── shared/
│   └── providers/
├── docs/
├── README.md
├── PRODUCT.md
└── ARCHITECTURE.md
```

This is a structural direction, not a requirement to create every folder immediately.

## High-Level System Model

```text
External Event / Climate / Research / News Sources
                     │
                     ▼
              Provider Adapters
                     │
                     ▼
             Normalized Domain Data
                     │
          ┌──────────┴──────────┐
          ▼                     ▼
   Application Storage    Evidence Processing
                                │
                                ▼
                         AI Provider Layer
                                │
                                ▼
                       Structured AI Output
                                │
                                ▼
                          Validated Schemas
                                │
                                ▼
                         User-Facing Content
```

## Provider Abstraction

Both AI and external data sources should be replaceable.

Provider-specific details should stay at the boundary of the application rather than leaking throughout the core domain model.

This applies to:

- climate-event sources,
- environmental data sources,
- scientific research sources,
- supplementary news sources,
- AI model providers.

The internal application should work primarily with normalized domain objects.

## AI Output Contract

AI outputs must be structured according to explicit schemas.

Free-form model output must not be assumed to be valid application data.

Expected flow:

```text
Prompt + verified input evidence
            │
            ▼
         AI model
            │
            ▼
    Structured response
            │
            ▼
      Schema validation
            │
       ┌────┴────┐
       │         │
     valid     invalid
       │         │
       ▼         ▼
   continue   reject / retry
```

Schemas should be represented in code and validated before AI-generated data is stored or displayed.

The exact validation library has not yet been selected.

## Evidence Policy

Evidence handling is a core architectural constraint, not merely a content guideline.

### Scientific claims

A climate-related scientific claim must not be generated unless supporting evidence has been retrieved.

Conceptually:

```text
Claim
  │
  └── Evidence reference
          │
          ├── Source
          └── Relevant passage / section where available
```

The system should preserve enough provenance to allow a user to inspect where a claim came from.

### Event inclusion

An event must not be published as a climate-impact event unless the available evidence establishes a sufficiently supported relationship to climate change.

The exact method for determining evidence sufficiency has not yet been defined and should be designed during implementation.

### News

News content may provide supplementary information such as:

- event chronology,
- observed impacts,
- reported damage,
- imagery,
- public statements,
- additional context.

News must not replace scientific evidence when making climate-attribution claims.

## Evidence Processing Model

The intended conceptual pipeline is:

```text
Normalized event
      │
      ▼
Evidence retrieval
      │
      ▼
Relevant source material
      │
      ▼
Evidence extraction
      │
      ▼
Structured evidence objects
      │
      ▼
Claim generation from evidence
      │
      ▼
Schema validation
      │
      ▼
Stored claim + provenance
      │
      ▼
User-facing explanation
```

The LLM is therefore downstream of retrieved evidence.

It is not permitted to act as an independent source of factual climate attribution.

## Regional Input and Privacy

The application should not require automatic geolocation.

Users enter a region or location manually when they want localised information.

For the MVP:

- no user accounts,
- no persistent personal profile,
- no precise-location tracking,
- no requirement to retain region searches,
- personal-data collection should be avoided wherever possible.

The application should function as an information service rather than a user-tracking or engagement platform.

## Public Read Model

The MVP is primarily read-only from the user's perspective.

Users explore public information but do not need to create content, maintain accounts, or manage personal state.

This simplifies the security model and supports the project's privacy goals.

## Security Principles

At minimum:

- API credentials and secrets must never be committed to the repository.
- Environment-specific configuration should be provided through runtime secrets or environment variables.
- `.env.example` may document required configuration names without containing secret values.
- External API responses should not be trusted blindly and should be validated or normalized before use.
- AI output must be schema-validated before application use.

Further security controls may be added as integrations are selected.

## Open Decisions

The following remain intentionally undecided:

- production globe / mapping technology beyond the SVG prototype,
- additional event-data providers beyond NASA EONET,
- additional climate-data and research/publication providers,
- concrete news providers,
- AI model selection,
- AI schema-validation library,
- evidence-confidence methodology,
- event inclusion thresholds,
- additional asynchronous infrastructure,
- caching strategy,
- detailed database schema,
- final monorepo folder structure.

These should be resolved only when implementation requirements are clear enough to justify the decision.

## Architectural Principle

> **The database stores facts and provenance. AI interprets verified evidence. AI is never the source of truth.**
