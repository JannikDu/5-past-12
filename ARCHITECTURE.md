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

The exact globe / map rendering technology remains undecided and should be evaluated separately.

### Backend

- Cloudflare Workers

Workers will host server-side application logic and integrations required by the MVP.

### Database

- Supabase PostgreSQL

No PostgreSQL extensions are committed to yet. Extensions may be evaluated and added later if the implementation requires them.

### Scheduling

- Cloudflare Cron Triggers

Cron-based ingestion or refresh jobs may be used for recurring data collection.

Additional asynchronous infrastructure is not part of the current architecture decision and may be evaluated later.

### AI Providers

AI access must be implemented behind a provider abstraction.

Featherless AI is expected to be an initial provider during the hackathon, but application logic must not depend directly on Featherless-specific behaviour where avoidable.

The architecture should allow alternative providers or models to be added later without rewriting the evidence-processing pipeline.

### Data Providers

Concrete climate, disaster, research, news, and environmental data providers are intentionally not fixed yet.

All external data integrations should be isolated behind provider-specific adapters where practical.

Example conceptual interface:

```ts
interface EventSourceProvider {
  fetchEvents(input: EventQuery): Promise<NormalizedEvent[]>;
}
```

The objective is to keep the application data model independent from any single external API.

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

- globe / mapping technology,
- PostgreSQL extensions,
- concrete event-data providers,
- concrete climate-data providers,
- concrete research and publication providers,
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
