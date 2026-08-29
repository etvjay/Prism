# WP-3 Production Persistence — PostgreSQL OwnershipProofStore Adapter Report

Status: adapter implemented and locally verified at the static/unit tier.
Live PostgreSQL integration tier: **NOT RUN** (no PostgreSQL service available
in the execution environment; `PRISM_POSTGRES_TEST_URL` unset). Skipped tests
are reported as skipped, never as passed. No pg-mem or permanent fake was used
as production evidence.

Scope: backend slice only. No frontend, deployment secrets, V8.3
bind/resolve/revoke, DEC-PRISM-SYS-001, or chainId-proposal changes. Domain
port `OwnershipProofStore` unchanged.

## What was built

`src/features/prism-identity/adapters/postgres-ownership-proof-store.ts`

A real `OwnershipProofStore` adapter on `pg` (node-postgres) `Pool`:

- **Parameterized SQL only** — every value goes through `$n` placeholders;
  no string interpolation of values anywhere. Pinned by unit contract tests.
- **Versioned migration** — `ownership_challenges` with `challenge_id TEXT
  PRIMARY KEY`, typed `state TEXT CHECK (state IN ('ISSUED','VERIFIED',
  'REJECTED','EXPIRED'))` and `nonce_state TEXT CHECK (nonce_state IN
  ('UNUSED','CONSUMED'))`, BIGINT timestamps, snake_case columns. Schema
  version tracked in `prism_store_meta` under an advisory row lock inside a
  transaction; newer-than-supported databases are refused
  (`store_migrate_failed`). Migration is idempotent.
- **getById** — returns owned copies; corrupt `rejection_json` fails closed
  (`store_read_failed`).
- **putIssued** — INSERT; unique violation `23505` on
  `ownership_challenges_pkey` classified as `duplicate_challenge_id`; other
  constraint violations (`23514`) as `invalid_record`; everything else as
  `store_write_failed`. Input validation rejects invalid state/nonceState/
  non-finite numerics before any query.
- **consumeNonce** — single conditional UPDATE
  `SET nonce_state = 'CONSUMED' WHERE challenge_id = $1 AND nonce_state =
  'UNUSED'`. `rowCount === 1` identifies the unique winner; zero rows falls
  back to a parameterized SELECT distinguishing `already_consumed` vs
  `unknown`. This is the INV-SYS-010 enforcement point.
- **transitionState** — guarded CAS over `state` with dynamic SET list
  containing only patch keys actually present, so absent patches never erase
  persisted evidence fields (`verified_signature_class`, `verified_at`,
  `rejection_json`); explicit `undefined` patch values write NULL.
- **Lifecycle** — `PostgresOwnershipProofStore.create()` connects and
  migrates fail-fast; `close()` ends the pool (idempotent); operations after
  close are refused (`store_connect_failed`). All pool/connection options
  (host, port, user, password, database, connectionString, ssl, max, idle/
  connection timeouts, statement_timeout, etc.) are caller-supplied via
  constructor options or pg's own PG* env handling — no secrets are
  hardcoded, logged, or persisted.

## Transaction isolation & retry behavior

Every mutation is a SINGLE atomic statement. PostgreSQL executes each
statement atomically at READ COMMITTED, which is sufficient: the CAS is the
row lock itself, not a transaction boundary. Under concurrent or
multi-instance contention, row-level locking serializes the two candidate
updates; the loser re-evaluates the WHERE predicate against the committed
row and updates zero rows. No explicit BEGIN wraps store operations, so
there is no serialization-failure retry inside the adapter. Multi-statement
compositions by callers must handle deadlock/serialization errors
(`40001`/`40P01`), which surface fail-closed as `store_write_failed` /
`store_read_failed` with the driver cause preserved.

## Multi-instance deployment assumptions

All instances MUST point at the SAME PostgreSQL database/cluster so
row-level locking serializes nonce consumption cluster-wide. Unlike the
SQLite adapter (single shared POSIX file, no network filesystems), this
adapter supports multi-host horizontal scaling with no shared filesystem.

## Error codes (stable, machine-readable)

`PostgresOwnershipProofStoreError` with `code`:
`store_connect_failed` | `store_migrate_failed` | `duplicate_challenge_id` |
`invalid_record` | `store_write_failed` | `store_read_failed`.
Fail-closed policy: driver/constraint failures are never swallowed into
optimistic results.

## Tests

Unit/SQL-contract (`postgres-ownership-proof-store.test.ts`, 17 tests, no
server required): exact parameterized SQL per operation; row→record mapping
incl. BIGINT-as-string tolerance and absent-optional preservation; duplicate
classification (23505 on pkey vs other constraints); conditional-CAS SQL
shapes for consumeNonce and transitionState; patch-only SET lists; explicit
NULL clearing; pre-query input validation; fail-closed write/read errors;
pool close idempotence + closed-store refusal; migration SQL shape.

Live integration (`postgres-ownership-proof-store.integration.test.ts`, 6
tests, gated on `PRISM_POSTGRES_TEST_URL`, `describe.skip` otherwise):
migration + evidence round-trip; duplicate rejection; nonce race across 8
independent pools (exactly one winner); guarded transition race across 6
pools (exactly one winner, evidence preserved); restart/reopen durability
(consumed nonce stays blocked, VERIFIED evidence survives, downgrade CAS
refused); fail-closed against unreachable endpoint.

## Verification run (local, this commit)

- Focused Postgres unit suite: 17/17 pass.
- Full prism-identity suite: 11 files — 69 passed, 6 skipped (the skipped 6
  are the gated live-integration tier; NOT RUN, not passed).
- `npm run typecheck`: clean.
- `npm run build`: clean.
- `git diff --check`: clean.
- Dependency changes: `pg` added to dependencies, `@types/pg` to
  devDependencies; lockfile updated. No secret values committed.

## Integration status

**NOT RUN** — no PostgreSQL service is reachable from this environment and
`PRISM_POSTGRES_TEST_URL` was not set. To run the live tier:

```
PRISM_POSTGRES_TEST_URL=postgresql://user:pass@host:5432/db \
  npx vitest run src/features/prism-identity/__tests__/postgres-ownership-proof-store.integration.test.ts
```

## Maturity & production limits

- Static/unit tier verified (adapter logic, SQL contracts, error
  classification). Live-server behavior (real locking under contention,
  real connection lifecycle, real timeouts) is UNVERIFIED here.
- Before production: run the gated integration suite against a real
  PostgreSQL instance, ideally including a two-process race, and set pool
  `statement_timeout`/`connectionTimeoutMillis` to deployment-appropriate
  values.
- Callers composing multiple store operations must implement their own
  retry for `40001`/`40P01` driver errors (see isolation section).
- The adapter does not implement TTL-based expiry sweeps; EXPIRED
  transitions are CAS-driven by the domain, as in the SQLite adapter.
