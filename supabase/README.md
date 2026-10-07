# Climate evidence knowledge base

Migration: `migrations/20261006164800_create_climate_evidence_knowledge_base.sql`.

There was no Supabase configuration, SQL schema, migration history, database read
policy, or standard timestamp trigger in this repository. This change introduces
the conventional `supabase/migrations` location. It does not change the application,
dependencies, existing CI workflow, or create event relationships. CI currently
runs lint, type checks, unit tests, and the frontend build; it does not deploy SQL.

## Schema

- `public.evidence_type`: `direct_attribution`, `event_context`,
  `analogue_attribution`, `general_context`.
- `public.source_type`: `attribution_study`, `scientific_report`, `observation`,
  `dataset`, `article`.
- `public.evidence_sources`: source identity, URL, classifications, event category
  tags, optional region/event dates/publication date, and creation/update timestamps.
  Exact canonical URLs are unique. A later ingestion adapter must normalize URL
  variants before an upsert; different query parameters remain different URLs.
- `public.evidence_chunks`: source-linked text, optional embedding, zero-based
  chunk position, and creation timestamp. `(source_id, chunk_index)` is unique.
  Deleting a source cascades to its chunks.
- `vector` extension: created in `extensions` if absent. An existing installation
  is reused in place, with its schema used for type/operator resolution and the RPC.
- B-tree indexes on evidence type, source type, publication date, and `lower(region)`
  for non-null regions; a cosine HNSW index on embeddings. The composite chunk
  uniqueness index also covers `source_id`; there is no redundant standalone index.
- `public.set_updated_at()` and `evidence_sources_set_updated_at`: a reusable
  invoker trigger function which sets the update timestamp on every source update.
- `public.match_evidence_chunks(...)`: invoker RPC returning matching text and provenance.

Evidence categories describe the relationship to an event, not a verdict about
scientific sufficiency. `direct_attribution` explicitly investigates anthropogenic
influence on the concrete event; `event_context` describes its current conditions;
`analogue_attribution` concerns a comparable historical event; `general_context`
describes a general scientific mechanism. An article is not automatically an
attribution study, and a semantic match is not proof of climate attribution.

## Event vocabulary

The existing model uses `EventCategory` in `src/domain/climate-event.ts`, not an
`EventType` enum. It exists only in TypeScript. `event_types` therefore uses
`text[]`, with the existing literal values such as `Wildfire`, `Flood`, and
`Extreme heat`. Empty arrays are allowed when a source is not category-specific.

No PostgreSQL category enum or hardcoded category constraint is introduced. This
avoids maintaining a second independently evolving domain vocabulary. A later
ingestion layer must validate these tags against the TypeScript vocabulary. The
RPC uses exact, case-sensitive tag membership. These tags are classifications,
not links to stored events.

## Embedding space

There is no embedding provider, model, or dimension configuration in the project.
The provisional default is **1536 dimensions**: a practical size for dense text
embeddings, within pgvector's 2000-dimension HNSW limit for the `vector` type. It
does not select or require a particular provider.

Before applying the migration, another dimension requires changing both
`embedding vector(1536)` and the dimension validation/message in
`match_evidence_chunks`. After it has been applied, make a new migration instead
of editing migration history. Change the column and RPC guard, rebuild the vector
index as needed, and re-embed existing chunks. Above 2000 dimensions, review the
index/type choice, for example a `halfvec` expression index.

All stored vectors and query vectors must use the same model, preprocessing, and
embedding space. Even a model change with the same dimension requires re-embedding.
NULL embeddings allow ingestion before embedding generation and are excluded from
retrieval. Zero vectors are rejected because cosine similarity is undefined.

## Retrieval contract

| Parameter | Meaning |
| --- | --- |
| `query_embedding` | Required nonzero vector of the configured dimension |
| `match_count` | 1–100; defaults to 10 |
| `match_threshold` | Optional minimum cosine similarity, inclusive, from -1 to 1; NULL disables the cutoff |
| `filter_evidence_type` | Optional exact evidence classification |
| `filter_source_type` | Optional exact source classification |
| `filter_event_type` | Optional membership in the existing event category tags |
| `filter_region` | Optional case-insensitive exact region match; surrounding query whitespace is ignored |

Filters combine with AND. Results include `chunk_id`, `source_id`, `content`,
`similarity`, `source_title`, `publisher`, `source_url`, `evidence_type`,
`source_type`, and `published_at`. Higher similarity is better, with nearest
vectors ordered first; fewer rows are returned if fewer matches qualify.

HNSW uses its default build parameters and needs no populated training dataset.
The RPC orders by cosine distance directly, sets `ef_search` to 100, and enables
strict iterative scans on pgvector 0.8+ to improve retrieval with selective filters.
HNSW remains approximate and its scan limits can still reduce recall. For a small
dataset PostgreSQL may choose an exact sequential scan instead. Event tag filtering
does not add a separate GIN index at this initial scale.

## Access

RLS is explicitly enabled on both tables, even when the project automatically
enables it for new tables. No permissive policies are added. Table privileges are
revoked from PUBLIC, `anon`, and `authenticated`; only `service_role` receives
SELECT/INSERT/UPDATE/DELETE. It bypasses RLS in Supabase, so no ingestion policy is
needed. The RPC is SECURITY INVOKER, with execution revoked from PUBLIC, `anon`,
and `authenticated`, and granted to `service_role`. The timestamp function is
similarly restricted.

The website's public information model does not yet define direct database reads.
Raw evidence and embeddings therefore remain server-only until a reviewed public
read interface is introduced. The migration changes only its own object grants;
it does not alter project-wide default grants, existing policies, or auto-RLS hooks.

## Review and apply manually

The SQL is transactional and has a five-second lock timeout. Schema/extension/table
and index creation use IF NOT EXISTS; functions and the trigger can be recreated.
An existing enum with different labels causes a rollback rather than being silently
reinterpreted. Re-running the migration preserves data. IF NOT EXISTS is not a
schema reconciliation tool: unexpected pre-existing tables/functions must still be
reviewed before deployment.

Run from the repository root in PowerShell. The pinned CLI does not add a project
dependency. Initialize once, because there is currently no `supabase/config.toml`:

```powershell
pnpm.cmd dlx --allow-build=supabase supabase@2.120.0 init
pnpm.cmd dlx --allow-build=supabase supabase@2.120.0 login
pnpm.cmd dlx --allow-build=supabase supabase@2.120.0 link --project-ref jzhndnbxttnrjfmiaaoe
pnpm.cmd dlx --allow-build=supabase supabase@2.120.0 migration list
pnpm.cmd dlx --allow-build=supabase supabase@2.120.0 db push --dry-run
```

`login` authenticates your Supabase account. `link` prompts for the database
password. The existing publishable/secret Data API keys in `.env` are not CLI
management credentials. A personal access token can be generated at
[Account → Access Tokens](https://supabase.com/dashboard/account/tokens).
Use the database password set when creating the project; if forgotten, reset it
in the project's database settings. The CLI also accepts `SUPABASE_ACCESS_TOKEN`
and `SUPABASE_DB_PASSWORD` as environment variables; it does not automatically
load the project's `.env`. Never commit these values.

The dry run lists pending migrations; it does not execute or validate their SQL.
After reviewing the SQL and pending list, explicitly apply:

```powershell
pnpm.cmd dlx --allow-build=supabase supabase@2.120.0 db push
pnpm.cmd dlx --allow-build=supabase supabase@2.120.0 migration list
```

For a local Supabase smoke test, start Docker, then run the pinned CLI's `start`
and `db reset` commands against the local stack. A local reset recreates the local
database; use no remote flags. No migration has been applied to production by
this change.

## Verification

The migration passed 83 local behavior checks using isolated PostgreSQL 18.3
(PGlite) with pgvector 0.8.1. These exercised initial/repeated application, data
preservation, constraints, cascade deletion, timestamp updates, cosine ranking and
all filters, invalid RPC input, HNSW index use, service-role access, client-role
denial with both grants and RLS, reuse of existing vector schemas, and transactional
rollback on conflicting enums. The pinned CLI and initialization into a directory
with an existing migrations folder were also checked. This is not a deployment or
a validation run against the hosted production database.

References: [Supabase migrations](https://supabase.com/docs/guides/deployment/database-migrations),
[CLI authentication/linking](https://supabase.com/docs/reference/cli/supabase-link),
[HNSW indexes](https://supabase.com/docs/guides/ai/vector-indexes/hnsw-indexes),
[Data API security](https://supabase.com/docs/guides/api/securing-your-api).
