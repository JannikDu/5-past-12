# Evidence unit and integration tests

Run the existing test setup with Node 24 and the pinned pnpm version:

```sh
pnpm test                 # All 105 tests, including existing EONET/domain tests
pnpm test:unit            # 73 unit/component tests; no database
pnpm test:integration     # 32 integration tests, including nested SQL cases
pnpm lint
pnpm check
```

The existing CI `pnpm test` step automatically includes every `tests/*.test.ts`
file. The unit/integration scripts also allow focused local runs. No test loads
`.env`, requires credentials, contacts hosted Supabase/Featherless, deploys a
Worker, or starts a browser. E2E tests remain outside this suite.

## Unit/component coverage

| File | Important behavior covered |
| --- | --- |
| `tests/evidence.test.ts` | Provider HTML/RSS extraction, conservative classifications, canonical URLs, history/recheck budgets, conditional replay, deterministic Unicode chunking, vector validation, query validation and safe result/log mapping |
| `tests/evidence-services.test.ts` | Generic provider registration, complete atomic write payload/provenance, unchanged sources skipped before embedding, item failure isolation, incomplete chunk embeddings rejected before storage, profile guards, query-purpose ordering/preferences and rebuild capability failure before maintenance |
| `tests/evidence-adapters.test.ts` | Featherless authentication, batching/order and rate-limit recovery; permanent authentication/response failures; cancellation during body consumption; Retry-After dates/bounds; Supabase UTC-date/preference serialization and outage/authentication distinction |

Assertions target returned outcomes, actual adapter requests and important side
effects: writes and embedding calls must occur only when appropriate. Existing
domain/EONET tests remain in the unit group.

## Integration coverage

PGlite executes both repository migrations with pgvector in isolated in-memory
PostgreSQL instances. Repository requests use the actual SQL RPC implementations
under `service_role`; HTTP fixtures emulate source and embedding responses.

| File | Important behavior covered |
| --- | --- |
| `tests/evidence-sql.test.ts` | Atomic revision rollback, immutable citations, stale owner/version fencing, weekly progress, legacy adoption, alternative vector schema, rebuild transitions and original semantic-RPC compatibility |
| `tests/evidence-integration.test.ts` | Real factory/provider/normalizer/Featherless/Supabase wiring; tracking duplicates; a later document-batch failure and replay; overlapping jobs; lost successful store/checkpoint responses and idempotent retries; historical continuation; interrupted rebuild/resume; partial rebuild abort; concurrent RPC writes; public-role access denial |
| `tests/evidence-retrieval-sql.test.ts` | Empty corpus/missing citation; lexical-only recovery outside the first 50 semantic candidates; semantic results without lexical hits; deterministic RRF ranking; larger candidate pools; bounded metadata/date bonuses without exclusion; publication dates distinct from event intervals; passage caps/overlap suppression; maintenance or generation activation during query embedding |

`tests/helpers/evidence-application.ts` creates the application with explicit
test configuration and an injected HTTP router. Unexpected destinations fail;
there is no external-network fallback. Only HTTP responses are simulated in these
application integration tests. Normalization, chunking, request serialization,
vector validation, orchestration, RPC SQL and result mapping execute normally.

The database helper uses transaction callbacks so concurrent RPC requests cannot
interleave `BEGIN`/role changes in the test connection. PGlite serializes its
transactions: overlapping jobs and stale writes are covered, while multi-session
PostgreSQL lock contention and hosted Data API behavior need separate environment
verification. These tests use controlled vectors and do not establish real-model
retrieval quality or replace the pending human-reviewed evidence evaluation.
