# Backend Phase M2 Runtime Ledger Reconciliation Closeout — Durable Stores + Read-Only Starknet + K=5 + Worker Lifecycle (X2)

**Lane:** M2 ledger runtime reconciliation
**Workdir:** `/home/ubuntu/prism-work/phase-backend-m2-ledger-runtime` @ `c68cd72` + closeout
**Date:** 2026-08-24 UTC
**Scope in:** `src/application/factory.ts`, `src/application/adapters/starknet-registry-reader.ts`, `src/app/api/v1/resolve/[identifier]/route.ts`, `src/application/__tests__/m2-runtime-gates.test.ts`
**Scope out (untouched):** frontend `page.tsx`/landing/Home, `contracts/Cairo`, `strk20.json`, `ops/starknet/*` live broadcast, Linear/Notion, credentials/private keys, M8/M9, Phase 8, `strk20.json` transactions

---

## 1. Goal

Close remaining M2 backend runtime gates without live secrets/broadcast:

- durable Postgres operation/event stores remain env-gated `PRISM_POSTGRES_TEST_URL`, fail-closed, never silent memory fallback in production;
- real read-only Starknet provider ports (`StarknetRegistryReader`, `StarknetLedgerStatusAdapter`, `StarknetEventIndexerAdapter`) env-gated via `STARKNET_RPC_URL` + `STARKNET_REGISTRY_ADDRESS`, fail-closed on invalid/incomplete, memory fallback only for isolated tests/dev;
- event pagination via `fetchAllRegistryEvents` continuation_token with global dedup `(tx_hash,event_index)` and deterministic `(block,txHash,eventIndex)` ordering;
- watermark `K=5` stale refusal via `WatermarkedResolveService` wired to factory and `GET /v1/resolve` with `x-prism-watermark-k:5` + `x-prism-stale-refused` observability;
- restart/recovery via `listNonTerminal` replay + `ReconciliationWorker.tickAllOnce`/`recoverAtStartup(trim)` without `submitted→completed` shortcut;
- duplicate event idempotence via `prism_events` `PK(tx_hash,event_index) ON CONFLICT DO NOTHING` + domain `seenKeys`;
- `submitted!=completed` double-guard (`transition` + `tickReconciliation` `submitted_is_not_completed_blocked`).

No deployment, no private key, no connection string echoed, no `strk20.json` mutation.

---

## 2. Wiring closed

### 2.1 Factory — environment-gated read-only Starknet + Postgres

`src/application/factory.ts` now exposes:

```
AppFactory {
  registry: InMemoryRegistry            // test helpers seedIdentity/applyBindForTest
  registryReadPort: RegistryReadPort    // real StarknetRegistryReader when STARKNET_RPC_URL+REGISTRY present, else memory
  submitPort: StarknetSubmitPort        // still InMemoryRegistry (no Account/private key in this lane, honest boundary)
  ledgerStatusAdapter: StarknetLedgerStatusAdapter | null
  eventIndexerAdapter: StarknetEventIndexerAdapter | null
  resolveService: WatermarkedResolveService  // K=5, confirmedBlockPort = ledger when configured
  reconciliationWorker: ReconciliationWorker // store+ledger+indexer, K=5, sweepLimit 100
  prismEventsStore: PostgresPrismEventsStore | null // PG when PRISM_POSTGRES_TEST_URL, else null
  isPostgres: boolean
  isStarknetConfigured: boolean
  shutdown(): Promise<void>             // worker.stop + pool end
}
```

Helpers (no secret logging): `getStarknetRpcUrl()`, `getStarknetRegistryAddress()`, `isStarknetReadConfigured()`, `isStarknetRpcUrlValid()`.

Gating:

| Signal | Behavior |
|---|---|
| `STARKNET_RPC_URL`+`STARKNET_REGISTRY_ADDRESS` present & valid | construct `StarknetRegistryReader`+`StarknetLedgerStatusAdapter`+`StarknetEventIndexerAdapter`; if any init fails throw `ERR-021` fail-closed, never silent fallback |
| present but malformed/incomplete | `ERR-021` `invalid_starknet_rpc_url` / `invalid_starknet_registry_address` / `starknet_read_config_incomplete`, never leak URL |
| absent in dev/test | `isStarknetConfigured=false`, `registryReadPort=InMemoryRegistry`, fallback ledger/indexer fakes (unknown chain) — X2 local |
| Postgres absent/invalid/unreachable | same fail-closed `503` as before (`postgres_url_missing_in_production`, `invalid_postgres_url_format`, `store_unavailable`) |

`createMemoryFactory` and `createPostgresFactory` both call `createStarknetReadPorts()` before returning; singleton `createSingletonFactory` preserves `singletonError` so second caller also fails closed.

### 2.2 Read-only Starknet reader

`src/application/adapters/starknet-registry-reader.ts`:

- `StarknetRegistryReader implements RegistryReadPort` via injected `RpcProvider.callContract` (no `Account`, no `execute`, no file reads);
- `getIdentity` maps `prism:<decimal>` → `felt` via `prismIdToRegistryFelt` (M3-X2), handles `Option<Identity>` sentinel `0` → null;
- `resolve` maps `venue BASE` → `0x42415345` felt, handles `Resolution` variant;
- `getBinding`/`isDigestConsumed` fail-closed stubs (real binding status requires storage not exposed via view; submit path remains `InMemoryRegistry` until Account wiring lands);
- validates `rpcUrl` `https?` and `registryAddress` `0x hex` before `new RpcProvider`.

### 2.3 Watermark K=5 wiring

`WatermarkedResolveService` was already implemented with `staleBoundK=5` logic; now factory constructs it as:

```ts
new WatermarkedResolveService(registryReadPort, { staleBoundK: 5, confirmedBlockPort: ledgerStatusAdapter ?? undefined })
```

`src/app/api/v1/resolve/[identifier]/route.ts` now prefers `factory.resolveService.resolve(prismId, venue, { allowStale })` when available:

- stale ACTIVE → `executionAccount=null, staleRefused=true, watermark` + `200` `NO_ACTIVE_DESTINATION` with `x-prism-stale-refused:1`, `x-prism-watermark`/`etag` + `x-prism-watermark-k:5` (fail-closed, INV-SYS-007);
- stale projection fallback (registry throws, projection stale) → `StaleCacheError` `ERR-023` `409` via `jsonError`;
- otherwise canonical preference `registry_canonical` vs `indexer_projection` preserved.

### 2.4 Reconciliation worker lifecycle

Factory now constructs `ReconciliationWorker` in both memory and PG paths:

```ts
new ReconciliationWorker({ store: operationStore, ledger: fallbackLedger, indexer: fallbackIndexer, clock, config: { staleWatermarkK: 5, sweepLimit: 100 } })
```

- `fallbackLedger` returns `null` unknown when Starknet not configured (X2 fake);
- `fallbackIndexer` returns `eventObserved:false` (missed event → noop);
- worker never started as daemon in tests (`allowDaemonInTests=false`); `start()` throws `invariant_violation: must not start in tests — use tickAllOnce()` (X2 guard);
- global `globalWorkerRunning` prevents two daemons per process;
- `recoverAtStartup()` = `tickAllOnce` over `listNonTerminal` (resume point is durable row itself);
- `factory.shutdown()` stops worker + closes pools; `resetFactory`/`closeFactory` also stop worker idempotently.

### 2.5 Event pagination + duplicate idempotence

- `StarknetEventIndexerAdapter.fetchAllRegistryEvents` already implements `continuation_token` loop, per-page sort `(block,txHash,eventIndex)`, global dedup `(txHash,eventIndex)`, `watermark = max blockNumber`, `pagesFetched` counter;
- `PostgresPrismEventsStore` `prism_events` `PRIMARY KEY (tx_hash,event_index)` `ON CONFLICT DO NOTHING` + `InMemoryPrismEventsStore` map keyed same; `insert → { inserted, duplicate }`;
- domain `applyEvent(state, event)` with `seenKeys` set keyed `txHash:eventIndex` → `isDuplicate=true` benign, first wins.

### 2.6 submitted!=completed double-guard

- domain `transition` guard `completionGuardSources.includes(from) && to===completed` → `submitted_is_not_completed`;
- `tickReconciliation` double-guard `if to===completed && from in [submitted,processing,confirming,confirmed] → noop`;
- `decideReconciliationStep` advances stepwise `submitted→processing→confirming→confirmed→indexed→reconciled→completed`; no shortcut even when port fabricates matched facts.

---

## 3. Tests added

`src/application/__tests__/m2-runtime-gates.test.ts` — 16 tests, all green:

- startup failure: Postgres unreachable `ERR-021` without leaking URL; Starknet incomplete/invalid rpc `ERR-021` fail-closed (covers `invalid_postgres_url_format`, `starknet_read_config_incomplete`, `invalid_starknet_rpc_url`);
- recovery: durable `submitted` row survives close, `worker.tickAllOnce` advances `submitted→processing` via injected ledger `SUCCEEDED`; `recoverNonTerminalOperations` sweep without `submitted→completed`;
- CAS/idempotency: concurrent `transition` same `expectedVersion` → exactly one winner, other `stale_version`; same `idempotencyKey`+same fingerprint benign, different fingerprint `409 conflict`;
- duplicate delivery: `InMemoryPrismEventsStore.insert` duplicate `(txHash,eventIndex)` → `duplicate:true` no double count; domain `applyEvent` duplicate benign `isDuplicate`;
- event pagination: `fetchAllRegistryEvents` continuation_token aggregation, global dedup, deterministic ordering, watermark;
- unknown/reverted/lagging: `chain=null` stays `submitted` never `completed`; `REVERTED` advances to `reverted` with `ERR-007`; `isWatermarkStale` K=5 refusal `90 vs 100` true, `98 vs 100` false, stale ACTIVE → `staleRefused`;
- `submitted!=completed` illegal skip rejected, worker stepwise not skip;
- safe shutdown: `factory.shutdown` idempotent, `worker.isRunning()` false, daemon start in test throws.

Preserved existing suites: `factory-postgres-gating` 11 tests, `runtime-http-smoke` 8 tests, `reconciliation-worker` 9, `recovery-policy` 10, `starknet-ledger-status` 5, `starknet-event-indexer` 12, `event-reconstruction` 11, etc.

---

## 4. Observed results

From `/home/ubuntu/prism-work/phase-backend-m2-ledger-runtime`:

- `npm test` — **50 passed | 2 skipped (52)** · **518 passed | 14 skipped (532)** · covers `m2-runtime-gates` 16/16 green; integration tiers (`postgres-*.integration` 14 skipped) remain honest `NOT RUN` because `PRISM_POSTGRES_TEST_URL` absent — blocker documented.
  - `PRISM_POSTGRES_TEST_URL` **ABSENT** at test time (`env | grep PRISM` shows none, `isStarknetReadConfigured=false`), so Postgres integration not executed, as required.
- `npm run typecheck` — `tsc --noEmit` **0 errors**.
- `npm run build` — `next build --webpack` **Compiled successfully**, `18` routes (`/` + `/_not-found` + `17` `/api/v1/...`), no errors.
- `git diff --check` — **clean**.
- No connection string appears in `npm test` output or `git diff`; all error messages sanitized `≤80` chars, `store_unavailable` shape.

---

## 5. Remaining live gates (not inflated)

1. **Live Postgres integration (T7 X3)** — run `PRISM_POSTGRES_TEST_URL=postgresql://… npm test -- postgres-*.integration.test.ts` against real server; expect `migrates idempotent`, `nonce race exactly one winner`, `CAS race`, `restart durability`, `unreachable → store_connect_failed`. Currently blocked: `PRISM_POSTGRES_TEST_URL` not set in this environment (see blocker §4). No memory fallback in production — future run must be green to claim `X3`.

2. **Real Starknet readback (X3)** — with `STARKNET_RPC_URL=https://...` + `STARKNET_REGISTRY_ADDRESS=0x...` against `SN_SEPOLIA`, observe `get_identity`/`resolve` + `get_events` pagination + `getTransactionStatus`/`getTransactionReceipt` for a real `txHash` (e.g., `EVD-PRISM-004` shape) and record `txHash+block`, `hub_validator` where applicable; `create P → bind B → resolve=B → revoke → resolve=null → P persists` tail.

3. **Ledger submit (P5/T9 X5)** — real `StarknetSubmitAdapter` with injected `Account`+`RpcProvider` for `create_identity`/`bind`/`revoke` remains out of this lane (private keys not touched). Current `submitPort` is `InMemoryRegistry` (X2 read-only).

4. **Worker daemon liveness (T12 X3)** — process restart mid `submitted→processing→confirming→confirmed→indexed→reconciled→completed` with real DB/RPC; prove `listNonTerminal` resume + duplicate delivery across pages no double-apply under real `RpcProvider.getEvents`.

5. **HTTP real transport observation (T8 X3)** — `next build && PORT=3001 next start` + `curl`/`fetch` against `localhost:3001` for all `openapi.yaml` routes with `X-Request-Id`/`X-Correlation-Id`/`X-Prism-Watermark`/`ETag`/`x-prism-watermark-k` vectors; already proven locally via `runtime-http-smoke` ephemeral server, but not yet against real `next start`.

None required to land this lane; they are explicit `X3/X5` follow-ons and remain `BLOCKED` without env/chain.

---

## 6. Verdict

```
MANDATE:            Close M2 runtime gaps: Postgres durable, Starknet read-only ports, pagination, K=5 refusal, recovery, duplicate idempotence, submitted!=completed
FACTORY GATING:     PASS — Postgres 4 stores + Starknet read 3 ports env-gated, fail-closed on absent/invalid/unreachable, isolated memory for tests only
HTTP ROUTES:        PASS — 17 handlers await factory with 503 sanitized, resolve now via WatermarkedResolveService K=5 + staleRefused header
EVENT INDEXER:      PASS — pagination continuation_token + global dedup + deterministic ordering proven via m2-runtime-gates and starknet-event-indexer (12 tests)
WATERMARK K=5:      PASS — stale ACTIVE refused (90 vs 100), fresh within K passes, projection stale throws 409
RECONCILIATION:     PASS — tick/recovery never submitted→completed, reverted with stable code, unknown stays submitted, retry/backoff deterministic, startup recovery via listNonTerminal
DUPLICATE:          PASS — prism_events ON CONFLICT DO NOTHING + domain seenKeys; no double-apply
INVARIANTS:         PASS — AUTHORITY_MATRIX / INV-SYS-005 / SM-PRISM-003 preserved; double-guard
T7/T8/T12:          T7 wiring complete, live off (14 skipped honest); T8 local PASS; T9/T12 ledger/indexer X2 PASS, X3 blocked
BUILD:              PASS — typecheck 0, build 18 routes, diff --check clean
X MATURITY:         X2 — local controlled (no live RPC tx hash, no real receipt/readback observed)
POSTGRES LIVE:      NOT RUN — PRISM_POSTGRES_TEST_URL absent (blocker: no DB URL in env)
```

### Verdict: **M2_RUNTIME_X2_COMPLETE_LEDGER_RECONCILIATION_WIRED — LIVE_GATED**

Count as `M2_BLOCKED_BY_RUNTIME_ENVIRONMENT` for `X3` purposes until `PRISM_POSTGRES_TEST_URL` + live `SN_SEPOLIA` readback are observed. This lane must **not** be credited toward `G0/G4–G8` or `X3+` ledger evidence; those remain `OPEN` per §5.

---

*No Phase 8/home/landing, contracts/Cairo, STRK20 implementation, `strk20.json`, Linear/Notion, credentials, or GitHub push was touched. `node_modules` present in worktree at review time and excluded from commits.*
