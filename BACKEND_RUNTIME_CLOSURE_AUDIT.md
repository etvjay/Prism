# Backend runtime closure audit

## Outcome

This worktree verified the existing X2 runtime implementation and fixed one factory boundary defect: isolated test factories now ignore a **partial ambient Starknet environment** (for example, an RPC URL without a registry address), while production-like factories still fail closed. Complete explicit Starknet configuration is unchanged and still uses the shared read provider.

The repository already contains the durable operation, pause/decision, event, and checkpoint adapters, their migration SQL, CAS/deduplication rules, reconciliation worker recovery path, and the settlement lifecycle guards. No canonical product or authority decision was changed.

## Evidence observed

- Full local suite: `133 passed | 7 skipped` files; `1308 passed | 40 skipped` tests.
- Focused runtime/settlement suite: `2 passed`; `19 passed`.
- `npm run typecheck`: passed.
- `npm run build`: passed with Next.js 16.3.1.
- `git diff --check`: passed.
- `next build` + `next start` on an isolated local port: observed `/` 200 with an ETag and `/api/v1/operations/no-such-operation` 404 with `ERR-002`; this is local transport evidence only.
- PostgreSQL integration suites were skipped in the execution shell because no usable `PRISM_POSTGRES_TEST_URL` was present to the test process. No live PostgreSQL claim is made.
- No live Starknet transport, broadcast, wallet, receipt, external readback, or process-restart evidence was observed.

## Remaining blockers

- Real PostgreSQL migration/CAS/reopen evidence requires a reachable dedicated test database URL.
- Live `getEvents`/transaction status and settlement receipt tail require configured Starknet RPC plus canonical registry scope.
- Worker process restart/recovery against real Postgres/RPC remains unobserved.
- Overall maturity remains X2 local controlled implementation; this audit does not promote X3 or production readiness.
