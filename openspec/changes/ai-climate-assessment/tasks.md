# Tasks

## 1. Assessment domain and scientific validation

- [x] 1.1 Add independent domain types, strict draft/review/public validators, exact passage verification, same-event guards, and conservative levels; verify direct/indirect/empty and rejection unit tests.

## 2. Retrieval and generative service

- [x] 2.1 Implement context/fingerprint, four queries, diverse passage selection, Featherless draft/review with bounded retries, and persisted service reuse; verify injected-provider pipeline tests and document scientific limits.

## 3. Persistence and secure endpoints

- [x] 3.1 Add service-only tables and atomic snapshot/read/save RPCs plus Supabase repository; verify migration grants, rollback, stale detection, immutable citation retrieval, and persistence tests.
- [x] 3.2 Extend existing Worker with public reads, CORS, protected explicit generation, and a manual runner/configuration; verify HTTP authentication/no-generation-on-read tests and dry-run bundle; document setup.

## 4. Event detail presentation

- [x] 4.1 Add independent indicators, cited findings, deduplicated direct/indirect publication lists, uncertainties and loading/unavailable/error/stale states; verify rendered UI tests and frontend type/build checks.

## 5. Integrated acceptance

- [x] 5.1 Run lint, type checks, full test suite, frontend build, Worker bundle, and OpenSpec validation; record outcomes and separately attempt/report real provider/database readiness without automatic deployment.

## 6. Recent progressive connection discovery

- [x] 6.1 Normalize named-event identity without administrative numbers, preserve country-only/analogue rejection, enforce the three-year window for new assessments, and verify matching and boundary tests.
- [x] 6.2 Add validated historical EONET queries and bounded sequential discovery with hard model-call limits, cached reuse, progressive outcomes and direct/indirect matches; verify budget, continuation, deduplication and reporting tests.
- [x] 6.3 Run required checks, document measured runtime and operating commands, and verify a bounded live discovery run without publishing unvalidated findings.

## 7. Automatic processing and authorized production deployment

- [x] 7.1 Add service-only catalog/cursor persistence and bounded scheduled processing for all discovered event categories, with overlap exclusion, historical continuation and retained failures; verify SQL and job tests.
- [x] 7.2 Add a read-only connection feed, default globe integration and honest processing progress; verify HTTP, rendering and frontend checks.
- [ ] 7.3 Run required checks, apply the additive migration, deploy both existing Workers with secure environment bindings and verify live endpoints and scheduled processing; document actual results and remaining limitations.
