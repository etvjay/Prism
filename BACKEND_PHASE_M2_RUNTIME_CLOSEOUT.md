# Backend Phase M2 Runtime Closeout — Postgres Wiring & HTTP Smoke (X2)

**Lane:** M2 runtime closeout for Prism · Muse Spark 1.2 free via OpenCode
**Workdir:** `/home/ubuntu/prism-work/phase-m2-runtime-closeout` @ `9816f7c` + closeout
**Date:** 2026-08-24 UTC
**Scope in:** `src/application/factory.ts`, `src/application/pause-port.ts`, `src/app/api/**` (factory await + fail-closed), `src/application/__tests__/factory-postgres-gating.test.ts`, `src/application/__tests__/runtime-http-smoke.test.ts`
**Scope out (untouched):** frontend `page.tsx`/landing/Home, `contracts/Cairo`, `strk20.json`, `ops/starknet/*` live broadcast, Linear/Notion, secrets/credentials, M8/M9, Phase 8

---

## 1. Goal

Close M2 runtime gaps that can be completed without M8+ or secrets:

- environment-gated Postgres adapter wiring for challenge/operation/pause/event stores, explicit fail-closed when `PRISM_POSTGRES_TEST_URL` absent/invalid;
- in-memory adapters retained for isolated tests only, never silently used in production;
- `next start`/HTTP route smoke via injectable ports / isolated local server, no live wallet/chain;
- preserve stable errors, correlation/idempotency/version headers, watermarks, `submitted!=completed`;
- document maturity and remaining live indexer/ledger gates.

No live chain broadcast, no secrets, no `strk20.json` mutation, no frontend, no push.

---

## 2. Factory wiring — environment-gated, fail-closed

### 2.1 Gating contract

| Signal | Behavior |
|---|---|
| `PRISM_POSTGRES_TEST_URL` (or `PRISM_POSTGRES_URL`) present + `postgres://` or `postgresql://` prefix | Attempt Postgres wiring: `PostgresOwnershipProofStore` + `PostgresOperationStore` + `PostgresPauseStore` + `PostgresPrismEventsStore` each `migrate()` idempotently. On connect/migrate failure, throw `AppError` `ERR-021` `503` with sanitized detail (`store_unavailable`, no URL). Never fall back to memory. |
| URL present but malformed (`http://`, empty, garbage) | Synchronous `ERR-021` `invalid_postgres_url_format`, sanitized, fail-closed. |
| URL absent + `NODE_ENV=production` or `PRISM_REQUIRE_POSTGRES=1` or `PRISM_RUNTIME_MODE=production` | `ERR-021` `postgres_url_missing_in_production` (503), fail-closed. Never silent in-memory fallback in production. |
| URL absent + `NODE_ENV!=production` (dev/test) | In-memory adapters (`InMemoryOwnershipProofStore`, `InMemoryOperationStore`, `InMemoryPauseStore`, `PostgresPrismEventsStore=null`). Honest X2 local. |

Helpers exported for testability (no secret logging): `getPostgresUrl()`, `isPostgresUrlValid()`, `isProductionRuntime()`, `shouldUsePostgres()`.

### 2.2 Singleton lifecycle

- `getAppFactory(): Promise<AppFactory>` — async singleton, shared promise, `singletonError` preserved so second caller also fails closed with same stable code.
- `getAppFactorySync()` / `getAppFactoryLegacy()` retained for non-Postgres dev path, but throw `postgres_factory_requires_async_init` if Postgres URL present (forces callers to `await`).
- `createIsolatedFactory(start)` — always in-memory, deterministic `fixedClock`, for isolated T6/T8/T10 tests. Ignores env gating.
- `resetFactory()` / `closeFactory()` / `close()` per store — test lifecycle, graceful shutdown, pool `end()` without awaiting in sync reset.

### 2.3 Pause port refactor

`InMemoryPauseService` now accepts optional `PauseStore` injection: `new InMemoryPauseService(clock, store?)`. When Postgres is enabled, factory passes `PostgresPauseStore` so the same rigorous domain `PauseService` logic (plan_hash binding, approval_scope_hash, CAS `expectedVersion`, UNKNOWN blocking, `RELEASED` settlement-only) runs over durable rows instead of `Map`. No duplicate service implementation.

### 2.4 Route handler propagation

All 17 `src/app/api/**` handlers now `await getAppFactory()` inside `try { } catch (e) { return jsonError(..., "ERR-021", 503, safe) }` with `safe = msg.includes("postgres") ? "store_unavailable" : msg.slice(0,80)` — never reflects connection string, always `503` stable shape (`x-error-code`, `x-request-id`). Covers:

- `POST /v1/identity`, `GET /v1/identity/:prismId`, `POST /v1/identity/:prismId/bindings`, `POST /v1/identity/:prismId/bindings/:bindingId/revoke`
- `POST /v1/challenge/issue`, `POST /v1/challenge/verify`
- `GET /v1/resolve/:identifier`, `GET /v1/operations/:operationId`, `GET /v1/receipts/:receiptId`
- `POST /v1/intents`, `POST /v1/intents/:intentId/pause`, `GET /v1/pauses/:pauseId` + `verify/release/cancel/escalate/approve`

Headers preserved: `Idempotency-Key`, `X-Request-Id`/`X-Correlation-Id` echo, `If-Match`/`X-Expected-Version` → `expectedVersion`, `X-Prism-Watermark` + `ETag` (watermark) / `ETag` (operation version), `submitted!=completed` state never conflated.

### 2.5 What is wired vs deferred

| Store | Wired when Postgres enabled | Notes |
|---|---|---|
| Challenge / `OwnershipProofStore` | ✅ `PostgresOwnershipProofStore` (CAS `consumeNonce`, `transitionState`) | `PRISM_POSTGRES_TEST_URL` gating, migration via `prism_store_meta.schema_version=2` |
| Operation / `OperationStore` | ✅ `PostgresOperationStore` (idempotency + `expectedVersion` CAS, `submitted!=completed` guard, watermark/metadata) |migration `operation_schema_version`; registry submit port remains `InMemoryRegistry` (ledger adapter not yet real) |
| Pause / `PauseStore` | ✅ `PostgresPauseStore` (intent idempotency, planHash binding, active-per-intent unique index, CAS version, append-only decisions) |via `InMemoryPauseService` wrapper over `PostgresPauseStore`; `execution_intents`/`execution_plans`/`execution_pauses`/`pause_checks`/`pause_decisions` |
| Event / `PrismEventsStore` | ✅ `PostgresPrismEventsStore` (`prism_events` `tx_hash+event_index` PK, deterministic ordering, `ON CONFLICT DO NOTHING`) |exposed as `factory.prismEventsStore`; not yet used by reconciliation workers (T9/T12 live) |
| Registry read/submit | ⚠️ still `InMemoryRegistry` | Real `StarknetLedgerStatusAdapter` + `EventIndexerAdapter` remain live gates (see §5) |

---

## 3. HTTP route smoke — injectable ports, isolated local server

New test `src/application/__tests__/runtime-http-smoke.test.ts` (8 tests) starts a Node `http.createServer` on ephemeral `127.0.0.1:0` using `createIsolatedFactory(1_789_000_000)` (no Postgres, no chain). Dispatch replicates Next route semantics (`parseHeaders` → `factory.app.*` → `toHttpResponse` + header echo) and is exercised via `fetch`.

Vectors verified over real HTTP (not direct `app.*` calls):

- `POST /api/v1/identity` with `x-request-id`/`x-correlation-id`/`idempotency-key` → `200` with `x-request-id`/`x-correlation-id` echo, `etag` version, body `state: submitted` (not `completed`), `requestId` round-trip.
- Idempotency: same key + same fingerprint → benign same `operationId`; same key + different fingerprint (`controllerAddress` changed) → `409` `ERR-023` `idempotency_key_conflict`, no stack.
- `GET /api/v1/resolve/:prismId` + `GET /api/v1/identity/:prismId` → `x-prism-watermark` + `etag` + `watermark` body field (deterministic `100`/`1` fake values) after `applyBindForTest` seeding.
- Unknown `GET /api/v1/operations/:id` → `404` `ERR-002` stable, `x-request-id` echo, no `stack`.
- `If-Match` / stale version (`transitionOperation` with `0` vs current version) → `ERR-023` `stale_version`.
- `submitted` is never `completed` — operation fetched after create is `submitted`; illegal `submitted→completed` via `transitionOperation` → `submitted_is_not_completed` (`ERR-023`), double-guard (store + domain).
- Header isolation: header blob contains no `postgres`/`password` (secrets never reflected); request headers are injectable and observed.

No `starknet.js`, no `viem` chain call, no wallet, no secret file read.

---

## 4. Factory gating tests — fail-closed proof

New test `src/application/__tests__/factory-postgres-gating.test.ts` (11 tests) exercises gating pure-logic without live DB except one unreachable-endpoint probe:

- `isPostgresUrlValid` format check
- `getPostgresUrl` null when absent, `shouldUsePostgres` false
- `isProductionRuntime` respects `NODE_ENV` / `PRISM_REQUIRE_POSTGRES` / `PRISM_RUNTIME_MODE`
- dev/test without URL → `isPostgres=false`, memory adapters
- production without URL → `rejects` `ERR-021` `503`, error message sanitized (no URL), second call also fails closed via `singletonError`
- production with invalid URL → `invalid_postgres_url_format`, sanitized, no `http://` leak
- non-prod invalid URL → also fail-closed (no silent fallback)
- unreachable URL (`127.0.0.1:54329`) → `ERR-021` `store_unavailable`, truncated `≤80` chars, no `nobody:nothing` leak, no memory fallback
- `createIsolatedFactory` always memory even when production env + URL present (isolated test path)
- `resetFactory` clears singleton so next `getAppFactory()` re-evaluates env

All Postgres integration suites (`postgres-operation-store.integration`, `postgres-ownership-proof-store.integration`) remain `describe.skip` when `PRISM_POSTGRES_TEST_URL` absent — honest `NOT RUN`, not inflated pass.

---

## 5. Runtime maturity X0–X5

| Claim | Target | Now | Basis |
|---|---|---|---|
| Challenge nonce/transition CAS durable | X2 (local) → X3 (live) | **X2 wiring complete, X3 open** | Postgres adapter implemented + gated in factory; live Postgres run requires `PRISM_POSTGRES_TEST_URL` against real server (see `ops` `postgres-*.integration.test.ts` 14 skipped). No PG fallback. |
| Operation idempotency + `expectedVersion` CAS durable | X2 → X3 | **X2 wiring complete, X3 open** | Same: store wired; live CAS race (`6` contenders) and restart durability proved in integration file but not executed locally without DB. |
| Pause intent/pause/decision CAS + expiry index durable | X2 → X3 | **X2 wiring complete, X3 open** | `PostgresPauseStore` migrated + injected via `InMemoryPauseService` wrapper; live expiry index (`expires_at`) and active-per-intent unique index proven in integration, not yet live-observed. |
| Event index (`prism_events`) deterministic ordering + dedup | X2 → X3 | **X2 wiring complete, X3 open** | `PostgresPrismEventsStore` migrated + `insert ON CONFLICT DO NOTHING` + ordering `(block_number, tx_hash, event_index)`; not yet fed by live indexer. |
| HTTP route contract over real transport | X2 → X3 | **X2 PASS** | New `runtime-http-smoke` proves `next start`-observable headers over `127.0.0.1` ephemeral server; `openapi.yaml` + `next build` 18 routes still local. No live `next start` capture yet. |
| Ledger (Starknet submit / read) | X3 | **OPEN** | `InMemoryRegistry` still bounds `submitPort`/`RegistryReadPort`; real `RpcProvider`/`Account`/`call`/`getIdentity` + `get_events` pagination not wired. `STRK20` helpers non-goal. |
| Reconciliation / indexer / watermark `K=5` refusal / duplicate `ON CONFLICT` / worker `start()+recoverAtStartup` | X3 | **OPEN** | `StarknetLedgerStatusAdapter` + `StarknetEventIndexerAdapter` + `PostgresPrismEventsStore` feed + daemon not yet observed against `SN_SEPOLIA`/`Base Sepolia`. Watermark `100`/`1` remains deterministic fake. |
| T7 DB integration | T7 | **Wiring complete, live verification gated** | Migration, CAS, idempotency, expiry index, append-only decisions wired; honest skip without `PRISM_POSTGRES_TEST_URL`. |
| T8 API contract | T8 | **PASS (local contract + HTTP smoke)** | Schema/errors/idempotency/concurrency + real `fetch` over isolated server; stable codes, no stacks. |
| T9 Ledger integration | T9 | **OPEN (port only)** | Boundary `RegistryReadPort`/`StarknetSubmitPort` preserved; no live `SN_SEPOLIA` trace. |
| T12 Failure/recovery | T12 | **X2 PASS (fake), X3 OPEN** | Unreachable Postgres → `503` fail-closed, stale version, `submitted→completed` guard, unknown operation `404`, idempotency conflict covered; live `RPC outage`, `indexer lag`, `duplicate event`, `backend restart` against real DB/RPC remain future. |

Overall ceiling remains **X2 — local controlled** (as in `BACKEND_PHASE_M2_REVIEW.md` §10). This closeout does **not** claim `X3`/testnet/mainnet. Postgres wiring is proven at the code-path level and will be `X3` once `PRISM_POSTGRES_TEST_URL` points at a real server and the integration suites go green (see `npm test` 14 skipped). Ledger/indexer remain explicit `BLOCKED` gates.

---

## 6. Remaining live indexer/ledger gates (not inflated)

1. **Live Postgres integration (T7 X3)** — run `PRISM_POSTGRES_TEST_URL=postgresql://… npm test -- postgres-*.integration.test.ts` against real server; expect `migrates idempotent`, `nonce race exactly one winner`, `guarded transition race`, `restart/reopen durability`, `unreachable → store_connect_failed`.
2. **Real transport observation (T8 X3)** — `next build && PORT=3001 next start` + `curl`/SDK `fetch` against `localhost:3001` for all `openapi.yaml` routes; record `X-Request-Id`/`X-Correlation-Id`/`X-Prism-Watermark`/`ETag` vectors; attach as `T8` server evidence.
3. **Ledger adapter bridge (P5/T9)** — `InMemoryRegistry` → real `StarknetSubmitPort` (`Account`+`RpcProvider`, `declare`/`invoke` for `create_identity`/`bind`/`revoke`) + `RegistryReadPort` (`call`/`get_identity`) + `chainId` binding; preserve `OperationStore.create` before `submit`, `submitted != completed` via reconciliation, not `submit` return.
4. **Event indexer + reconciliation (T9/T12 X3)** — `StarknetEventIndexerAdapter` (`getEvents` pagination) → `PostgresPrismEventsStore` (`ON CONFLICT` idempotence) → reconciliation worker `start()` + `recoverAtStartup(trim)` with durable `prism_operations` + `prism_events` under real `RpcProvider`; prove `StarknetLedgerStatusAdapter` watermark `K=5` stale refusal, `listNonTerminal` replay after restart, duplicate event no double-apply, `requires_attention` escalation.
5. **Worker/daemon liveness** — process restart mid-`submitted→processing→confirming→confirmed→indexed→reconciled→completed`; duplicate delivery; validator `pool && mine` where applicable (out of M2 but noted).
6. **SDK hardening (S6)** — runtime `X-Prism-Api-Version` negotiation, rate-limit/observability headers, privacy-label audit, `semver` pin (already typed, not yet version-gated).
7. **Evidence ledger movement** — after live `SN_SEPOLIA`/`Base Sepolia` decisive tail `create P → bind B → resolve=B → revoke → resolve=null → P persists`, write `EVIDENCE_LEDGER.md` `EVD-PRISM-004…` at `X3` with `commit_sha`, `spec_versions`, `network`, `txHash+block`, `hub_validator` where applicable.

None of the above is required to land this lane; they are explicit `X3/X5` follow-ons and remain `BLOCKED` without `PRISM_POSTGRES_TEST_URL` / live RPC.

---

## 7. Invariants and authority — unchanged

- `submitted != completed` (`INV-SYS-005`, `INV-PRISM-015`, `SM-PRISM-003`) — double-guarded: domain `transition` + store `UPDATE … WHERE version=$expectedVersion`; HTTP `200` always with `state: submitted` after factory path, illegal `submitted→completed` → `ERR-023`.
- `INV-SYS-002/004/006/007/010` controller/digest/binding/watermark/nonce CAS preserved; `INV-SYS-003` offchain-verify / onchain-accept split untouched.
- Authority matrix (§5 `SYSTEM_FOUNDRY.md`) intact: `A1` identity existence `RegistryReadPort`, `A2` controller `Registry caller`, `A3` binding lifecycle `Registry`, `A4` proof ladder `Backend verifier`, `A5` canonical acceptance `OperationStore+ledger`, `A6` resolution `Registry/indexer under K`, `A8` operation `SM-PRISM-003`, `A9` privacy no new vocabulary.
- No Phase 8/Home mutation, no `strk20.json` write, no Linear/Notion, no push, no secret persistence.

---

## 8. Tests, typecheck, build — observed

From `/home/ubuntu/prism-work/phase-m2-runtime-closeout`:

- `npm test` — `47` test files `45 passed | 2 skipped`, `467 passed | 14 skipped` (was `43 passed | 2 skipped`, `448 passed | 14 skipped`; +2 files: `factory-postgres-gating` 11 tests, `runtime-http-smoke` 8 tests). All new tests green; integration tiers remain `skipped` without `PRISM_POSTGRES_TEST_URL` (honest).
- `npm run typecheck` — `tsc --noEmit` `0 errors`.
- `npm run build` — `next build --webpack` `Compiled 7.8s`-ish, `18` app routes listed (`/` + `/_not-found` + `17` `/api/v1/...`).
- `git diff --check` — clean.

No connection string appears in `npm test` output or `git diff`.

---

## 9. Verdict

```
MANDATE:            Close M2 runtime gaps without M8+/secrets — Postgres gating, HTTP smoke, preserve system invariants
FACTORY GATING:     PASS — 4 stores environment-gated, fail-closed on absent/invalid/unreachable, isolated in-memory for tests only
HTTP SMOKE:         PASS — 8 vectors over isolated 127.0.0.1 server, stable errors, correlation/idempotency/version, watermark, submitted!=completed
STABLE ERRORS:      PASS — ERR-021 503 for store unavailability, ERR-023 409/410 for idempotency/version, ERR-002 404 for unknown, no stacks, request correlation echo
INVARIANTS:         PASS — AUTHORITY_MATRIX / INV-SYS / SM-PRISM-003 preserved
T7/T8/T12:          T7 wiring complete, live off; T8 local PASS; T9/T12 ledger/indexer still X3 OPEN (explicit)
BUILD:              PASS — typecheck 0, build 18 routes
M2_RUNTIME:         X2 complete — Postgres wiring present but X3 live verification still gated on PRISM_POSTGRES_TEST_URL + ledger
```

### Verdict: **M2_RUNTIME_X2_COMPLETE_POSTGRES_WIRING_OPEN**

This lane is `LANE_COMPLETE_X2` and acceptable for parent integration as the M2 backend runtime closeout. It must **not** be credited toward `G0/G4–G8` or `X3+` ledger/indexer evidence; those remain `OPEN` per §5–§6.

---

*No Phase 8/home/landing, contracts/Cairo, Pause domain promotion, STRK20 implementation, `PrismChannel` domain, `strk20.json`, Linear/Notion, credentials, or GitHub push was touched. `node_modules` present in worktree at review time and excluded from commits.*
