# Backend Bundle 2R Live Review — Closed Live-Wiring (No Live Credentials)

**Worktree:** `backend-bundle-2r-live` @ `778e262` (owner: Prism, Muse Spark 1.2 free)  
**Date:** 2026-08-23 UTC  
**Baseline:** `778e262 feat(ops): bundle 3T testnet evidence preparation (no deployment)` + `5e5519c bundle 2R local runtime boundary`  
**Scope:** Close remaining live-wiring code without using live credentials — injected Account+registry, real-reader-shaped getEvents, Postgres prism_events, process-safe worker, watermarked resolve with Ledger, tests. **No frontend, Cairo, strk20.json, deployment, Linear, Notion, credentials, or GitHub push.**  
**Authority:** `SYSTEM_CANONICAL.md v0.2`, `DOMAIN_MODEL`, `STATE_MACHINES`, `INVARIANTS`, `AUTHORITY_MATRIX`, `CONTRACT_SPEC`, `EVENT_CATALOGUE`, `ERROR_CATALOGUE`, `TEST_ARCHITECTURE`, `STARKNET_SYSTEM_PROFILE`, `STRK20_CONTEXT`, `AUDIT.md`, `EVIDENCE_LEDGER.md`  
**Methodology:** Foundry → Profile → Project → Implementation → Evidence. X2 ceiling for fake-only. No ledger row moves without observed results. All fakes labelled `X2 — TEST DOUBLE, no live RPC`.

---

## 0. Gate Summary

| Gate | Verdict | Basis |
|---|---|---|
| **Product Foundry** | PASS | No product truth mutated; decisive proof preserved; non-goals untouched |
| **System Foundry** | PASS | All live-wiring derives from canonical v0.2 artifacts; no new invariant invented |
| **Research Foundry** | PASS | X2 ceiling declared; no live RPC/credentials; injected fakes only |
| **Antagonist** | PASS | 8 new antagonistic cases (env, mismatch, pagination, duplicate, lifecycle, backoff, stale, unknown) all fail-closed |

---

## 1. Live-Wiring Closeout → System Authority / Reconciliation / Observability

| Live wiring item | Files | System authority | Reconciliation | Observability |
|---|---|---|---|---|
| **1. Injected Account + registry-address submit adapter with explicit env/config validation, no secret reads in tests** | `starknet-submit.ts` (`StarknetSubmitAdapter`, `validateStarknetSubmitConfig`, `parseStarknetSubmitEnv`, `StarknetSubmitConfigError`) | **Authority A1–A3** (`CONTRACT_SPEC` OP-7-01/OP-8-01/OP-8-03; `INV-SYS-002` controller-only; `INV-SYS-004` digest single-use) — adapter enforces `account != registry` and `account == controller` pre-checks before on-chain `caller==controller` | Fail-closed `ERR-004`/`ERR-023` on mismatch; `ERR-021` on dependency; never marks `submitted` as `completed` (INV-SYS-005 double-guard) | Stable `ERR-00x` codes without stack leak; `StarknetSubmitConfigError` for env; config validated via injected record (X2) |
| **2. Real-reader-shaped getEvents pagination/continuation + event selector mapping** | `starknet-event-indexer.ts` (`PRISM_EVENT_SELECTORS`, `ALL_PRISM_EVENT_SELECTORS`, `fetchRegistryEvents`, `fetchAllRegistryEvents`) | **Authority A1/A3** (`EVENT_CATALOGUE` EVT-PRISM-IDENTITY-CREATED/EXECUTION-IDENTITY-BOUND/BINDING-REVOKED; `DOMAIN_MODEL` OBJ-PRISM-001/003) — selectors are `starknet_keccak(name)` exact | `getEvents` keys `[ALL_SELECTORS]` with `continuation_token` loop; `fetchAllRegistryEvents` aggregates globally deduped by `(tx_hash,event_index)`; deterministic `(block,tx,event)` ordering per `events.yaml` | Watermark `max(block)` per page and global; `continuationToken` exposed; unknown selectors dropped (fail-closed) |
| **3. Postgres prism_events adapter/table** | `postgres-prism-events-store.ts` (`PRISM_EVENTS_MIGRATION_SQL`, `PostgresPrismEventsStore`, `InMemoryPrismEventsStore`) | **Authority LEGER_INDEX** (`CONTRACT_SPEC §5` persistence classification) — `(tx_hash,event_index)` is canonical `correlation_id` per `EVENT_CATALOGUE` Q7.3 reconstruction guarantee | Idempotent `INSERT ... ON CONFLICT DO NOTHING`; deterministic ordering `ORDER BY block ASC, tx_hash ASC, event_index ASC`; rebuildable from chain, never authoritative for identity | `count()`, `listOrdered()`, `listByBlockRange()` with `created_at`; migration `prism_events_meta` versioned; in-memory X2 double for tests |
| **4. Process-safe ReconciliationWorker start/stop with bounded backoff, metrics hooks, requires_attention** | `reconciliation-worker.ts` (`ReconciliationWorker`, `WorkerMetrics`, `computeBackoffMs`) | **Authority SM-PRISM-003** (`STATE_MACHINES` happy path + failure branches; `AUTHORITY_MATRIX §4` divergence table) — submitted ≠ completed enforced double-guard | `tickAllOnce` deterministic sweep (`listNonTerminal`), bounded backoff `min(base*2^attempts, max)` with jitter, `requires_attention` escalation `ERR-022` after `requiresAttentionAfterMs`, `recoverAtStartup`, unknown/reverted/stale handled via `tickReconciliation` | `WorkerMetrics` (`sweeps/ticks/advanced/noops/dependencyFailures/staleConflicts/escalated/reverted`), `onMetrics`/`onEscalation` hooks (best-effort), `getMetrics()`/`isRunning()` |
| **5. WatermarkedResolveService wired to Ledger/confirmed-block port, fail closed on stale/unknown** | `resolve-service.ts` (`WatermarkedResolveService`, `ConfirmedBlockPort`, `StaleCacheError`), `starknet-ledger-status.ts` (`StarknetLedgerStatusAdapter.getConfirmedBlock`, `ConfirmedBlockReader`) | **Authority A6 QRY-8-01** (`CONTRACT_SPEC` QRY-8-01; `INV-SYS-007` resolver honesty) — canonical registry preferred, indexer fallback only when fresh | `isWatermarkStale`/`isStaleProjection` with `K=5`; unknown confirmed block or null watermark with ACTIVE → `stale_refused`/`StaleCacheError` (fail-closed); `NO_ACTIVE_DESTINATION` always safe | `ResolveServingResult` (`authoritativeSource` `registry_canonical`/`indexer_projection`/`stale_refused`, `staleRefused` flag, `watermark`); `isStale()` helper |
| **6. Tests (X2, injected fakes, no live RPC)** | `bundle-2r-live-boundaries.test.ts` (33 tests) + updated `starknet-event-indexer.test.ts` | All 6 items mapped to invariants `INV-SYS-002/004/005/007` + error catalogue | Pagination, duplicate, unknown, stale, backoff, lifecycle exercised via labelled fakes | Each test names its authority/error code; `X2 — TEST DOUBLE` label in describe |

No file mutates `SYSTEM_CANONICAL.md` or any YAML companion; all are *derived*.

---

## 2. Test Architecture T8 / T9 / T10 / T12

Per `projects/prism/system/TEST_ARCHITECTURE.md`.

| Tier | Definition | Live-wiring evidence (X2) | Tests |
|---|---|---|---|
| **T8 API contract** | Error shapes, idempotency, watermark headers | `StarknetSubmitConfigError` → `ERR-023` env validation; `ERR-004` account/registry mismatch and account/controller mismatch; `validateStarknetSubmitConfig`/`parseStarknetSubmitEnv` never reads `fs` | `bundle-2r-live-boundaries.test.ts` §1–2 (11 tests): missing `STARKNET_RPC_URL` → `ERR-023`, invalid URL, malformed hex, equal `account==registry` → mismatch, controller mismatch → `ERR-004` |
| **T9 Ledger integration** | Backend ↔ registry event indexing, reconstruction, deterministic ordering, continuation, dedup | `PRISM_EVENT_SELECTORS` exact `starknet_keccak`; `fetchRegistryEvents` keys `[[SELECTORS]]` + `continuation_token` + `chunk_size`; `fetchAllRegistryEvents` pagesFetched + global watermark; `postgres-prism-events-store` `(tx_hash,event_index)` PK + `ON CONFLICT DO NOTHING` + ordered `listOrdered` | `starknet-event-indexer.test.ts` 12/12 (ordering, dedup, malformed skip, watermark, pagination continuation 2 pages, selector mapping 3 kinds), `bundle-2r-live-boundaries.test.ts` §3–4 (5 + 3 tests) |
| **T10 Frontend integration** | State labels derive from op states only | Out of scope per isolation — handler contracts (`API_CONTRACTS`) preserved, no frontend files touched | N/A (0) — intentionally untouched |
| **T12 Failure / recovery** | RPC outage, indexer lag, duplicate events, restart mid-bind, retry vs terminal, stale, unknown, requires_attention | Worker `tickAllOnce` + `isWatermarkStale`, ledger `observeChain null` → noop, reverted `ERR-007`, stale watermark → `stale_refused`/`StaleCacheError`, unknown confirmed block → fail-closed, bounded backoff `computeBackoffMs`, process-safe `globalWorkerRunning` guard, metrics `onMetrics`/`onEscalation` | `reconciliation-worker.test.ts` 9/9, `resolve-service.test.ts` 7/7, `poll-worker-divergence.test.ts` 14, `recovery-policy.test.ts` 8, `bundle-2r-live-boundaries.test.ts` §5–8 (5+3+5+3 tests: lifecycle no-daemon-in-tests, start guard, second concurrent start, startup recovery; backoff bounded/capped/noop within window + metrics hook; stale watermark 5 + unknown 3) |

Focused live-wiring suite: `bundle-2r-live-boundaries.test.ts` **33 tests** (env 6, mismatch 5, pagination 3, duplicate 3, lifecycle 4, backoff 3, stale 6, unknown 3) — all labelled `Bundle 2R Live — …` per closeout contract.

**Full suite (this worktree, fake-only, X2):**

```
Test Files  25 passed | 2 skipped (27)
     Tests  286 passed | 14 skipped (300)
Duration ~9.4s
```

Integration tests gated on `PRISM_POSTGRES_TEST_URL` skipped honestly (14) — never fabricated.

---

## 3. AUDIT G2 / G3

Per `projects/prism/AUDIT.md` §13 build gates.

| Gate | Criterion | Live-wiring evidence | Maturity |
|---|---|---|---|
| **G2 Base ownership proof + binding** | Valid owner binds, wrong signer rejected, replay/expiry/chainId, submit adapter maps to `bind_execution_identity` with controller/digest checks | **Closed live-wiring:** `StarknetSubmitAdapter` now has explicit env/config validation (`STARKNET_RPC_URL` + `STARKNET_REGISTRY_ADDRESS` + `validateStarknetSubmitConfig` account≠registry), enforces `account==controller` (`ERR-004`) before `execute()`, and still maps `ERR-001/002/004/005/007/008` via `mapRevertToCode`. Tests: env validation 6/6, mismatch 5/5. | **X2 — submit + env boundary closable**, not X3 (no live Base/Starknet trace) |
| **G3 Resolution + revocation** | `resolve=B` pre-revoke, `NO_ACTIVE_DESTINATION` post-revoke, `P` persists; resolver never returns revoked as active; pagination/ordering/duplicate correct | **Closed live-wiring:** `StarknetEventIndexerAdapter` real selectors + pagination `fetchAllRegistryEvents` + deterministic ordering + `(tx_hash,event_index)` dedup; `PostgresPrismEventsStore` `PRIMARY KEY (tx_hash,event_index)` + ordered `listOrdered`; `WatermarkedResolveService` wired to `ConfirmedBlockPort` (`StarknetLedgerStatusAdapter.getConfirmedBlock`) and fail-closed on `stale/unknown` (109 tests T9+T12). | **X2 — resolver honesty + indexer + ledger-index via injected Ledger port**, not X3 (no live indexer block) |

G1 contract (7 snforge) unchanged; G0/G4–G8 remain `NOT_IMPLEMENTED`; ledger rows `EVD-PRISM-004..007` remain `X0` — no ledger movement without live observation.

---

## 4. Notion SC-06 / SC-27 / SC-28

Mapping by bundle brief wording (closeout checklist — no Linear/Notion mutation per isolation).

| SC | Interpreted requirement | Implementation | Tests |
|---|---|---|---|
| **SC-06** | Transport-neutral `LedgerStatusPort` / `StarknetSubmitPort` / `RpcProvider` boundary; explicit authoritative source per state; never complete early; startup recovery & `requires_attention` escalation; confirmed-block wiring | `domain/ports.ts` (`LedgerStatusPort`/`EventIndexerPort`/`OperationReconciliationPort`), `adapters/starknet-ledger-status.ts` (+ `ConfirmedBlockReader.getConfirmedBlock`), `adapters/starknet-submit.ts` (injected `Account` + `registryAddress` + `validateStarknetSubmitConfig`/`parseStarknetSubmitEnv`), `domain/reconciliation-worker.ts` (`authoritativeSourceForState`, `INV-SYS-005` double-guard, `recoverAtStartup`, `requires_attention` + jitter + `globalWorkerRunning` guard), `domain/resolve-service.ts` (`ConfirmedBlockPort` wired, fail-closed) | `starknet-ledger-status.test.ts` 5 (`getConfirmedBlock` + unknown/reverted), `starknet-submit.test.ts` 10, `reconciliation-worker.test.ts` 9, `bundle-2r-live-boundaries.test.ts` §1–2, §5, §8 (env, mismatch, lifecycle, unknown) |
| **SC-27** | Idempotent event/indexer reconstruction keyed by `tx_hash + event_index` for the three registry facts; deterministic `(block,tx,event)` ordering; pagination/continuation; selector mapping; Postgres `prism_events` | `adapters/starknet-event-indexer.ts` (`PRISM_EVENT_SELECTORS` exact, `fetchRegistryEvents` with `keys:[[SELECTORS]]` + `continuation_token` + `chunk_size`, `fetchAllRegistryEvents` pagesFetched), `domain/event-indexer.ts` (`eventKey`, `applyEvent`, `reconstruct`, `resolveBinding`), `adapters/postgres-prism-events-store.ts` (`PRIMARY KEY (tx_hash,event_index)`, `ON CONFLICT DO NOTHING`, `ORDER BY block,tx_hash,event_index`) | `event-reconstruction.test.ts` 12, `starknet-event-indexer.test.ts` 12 (incl. pagination continuation + selector mapping), `bundle-2r-live-boundaries.test.ts` §3–4 |
| **SC-28** | Deterministic operation poll/reconciliation worker + failure/restart + durable retry/watermark/metadata + Postgres `prism_operations` | `domain/recovery.ts` (`tickReconciliation`, `recoverNonTerminalOperations`, `isWatermarkStale`) + `domain/reconciliation-worker.ts` (`tickAllOnce`, `computeBackoffMs` bounded + capped, `maxRetries`, `backoffBaseMs`/`backoffMaxMs`, `requiresAttentionAfterMs`, `staleWatermarkK`, `sweepLimit`, `runStartupRecovery`, `allowDaemonInTests` guard, `onMetrics`/`onEscalation`), `adapters/postgres-operation-store.ts` + `memory-operation-store.ts` (watermark/metadata/attempts), `adapters/postgres-prism-events-store.ts` | `recovery-policy.test.ts` 8, `poll-worker-divergence.test.ts` 14, `reconciliation-worker.test.ts` 9, `postgres-operation-store.test.ts` 11, `bundle-2r-live-boundaries.test.ts` §6–7 (backoff ‖ stale watermark) |
| **SC-06/27/28 resolve** | Watermarked resolve with canonical preference + stale/unknown refusal via Ledger | `domain/resolve-service.ts` (`WatermarkedResolveService` + `ConfirmedBlockPort` from `starknet-ledger-status.ts`) | `resolve-service.test.ts` 7, `bundle-2r-live-boundaries.test.ts` §7–8 (stale 6, unknown 3) |

---

## 5. X Maturity

```
X0 hypothesis          — all decisive runtime claims remain X0 (no live network)
X1 fixture/mock        — challenge fixtures, registry doubles, Account/EventReader fakes, prism_events in-memory
X2 local controlled    — ✅ this lane: StarknetSubmitAdapter+env guard + StarknetEventIndexerAdapter (selectors+pagination) + PostgresPrismEventsStore (PK+dups+ordering) + ReconciliationWorker (process-safe+backoff+metrics+requires_attention) + WatermarkedResolveService (Ledger port, fail-closed)
   typecheck            — PASS (tsc --noEmit, 0 errors, 11.1s)
   next build           — PASS (Next webpack, 9.3s + 11.1s, routes / and /_not-found)
   vitest (all)         — PASS (25 passed | 2 skipped, 286 passed | 14 skipped, ~9.4s, X2 fakes only)
   operation lifecycle  — PASS (SM-PRISM-003 pure, INV-SYS-005 guarded)
   ledger/indexer       — PASS via injected fakes, selectors verified
X3 realistic/testnet   — NOT_EVIDENCED (no SN_SEPOLIA / Base Sepolia trace with funded Account/RpcProvider.getEvents paginated live)
X4 repeated/reproduced — NOT_EVIDENCED
X5 mainnet/production  — NOT_EVIDENCED
```

Maturity rule: local pass = X2; deployed + observed = X3+; mainnet + independent re-read = X4/X5. **No ledger row moves without observed results.** `strk20.json` remains `{"transactions":[],"contracts":[]}`.

---

## 6. Verification Performed This Session (offline, X2)

```
npm test (vitest run)              — 25 passed | 2 skipped (27) | 286 passed | 14 skipped | ~9.4s
npx tsc --noEmit (typecheck)       — PASS (0 errors)
npm run build (next build)         — PASS (Compiled 9.3s, TypeScript 11.1s, Generate 430ms, routes / and /_not-found)
git diff --check                   — clean
focused lane                       — bundle-2r-live-boundaries.test.ts 33/33 PASS
                                     starknet-event-indexer.test.ts 12/12 PASS (ordering+dedup+pagination+selectors)
                                     starknet-submit.test.ts 10/10 PASS (+ env/mismatch via new suite)
                                     reconciliation-worker.test.ts 9/9 PASS (+ lifecycle/process-safe)
                                     resolve-service.test.ts 7/7 PASS (+ Ledger fail-closed)
                                     postgres-prism-events-store (in-memory) 6/6 via new suite
node_modules                       — reused (node_modules -> /home/ubuntu/prism-work/Prism/node_modules)
secrets                            — none committed; Account/reader injected only (X2)
```

---

## 7. Evidence Ceiling (Explicit)

**Evidence ceiling: X2 — LOCAL BUILD EVIDENCE EARNED, RUNTIME/MAINNET EVIDENCE OPEN**

- No Starknet RPC call was made. No `RpcProvider`, `Account`, funded deployer, or `getEvents` live pagination was executed. All ledger/submit/indexer observations are **labelled injected fakes** (`StarknetAccountLike` fake `execute`, `StarknetEventReader` fake `getEvents` with `continuation_token`, `InMemoryPrismEventsStore`, `FakeOperationStore`). `parseStarknetSubmitEnv`/`validateStarknetSubmitConfig` are pure record validators (X2) — they prove the gate, not the network.
- No `snforge` mainnet fork beyond existing offchain ladder fakes.
- No `strk20.json` edit; `EVIDENCE_LEDGER.md`/`AUDIT.md` gates G2/G3 remain `X0/NOT_IMPLEMENTED` until live `SN_SEPOLIA` observation via yaml template + independent `getConfirmedBlock` read.
- Build gates G0, G4–G8 remain `NOT_IMPLEMENTED`.

---

## 8. Remaining Live Boundaries (Explicit — funded network + owner approval required)

1. **Live submit wiring (env):** `STARKNET_RPC_URL` + `STARKNET_REGISTRY_ADDRESS` from `manifest.yaml:environments.testnet` bound via `parseStarknetSubmitEnv` to a real `starknet.js Account` (`Account` + `RpcProvider` + funded controller key from env `STARKNET_PRIVATE_KEY` — never a file) — proceed only after `DEC-PRISM-OPS-001` ACCEPT. No secret file reads (STARKNET_SYSTEM_PROFILE).
2. **Live ledger trace:** `StarknetLedgerStatusAdapter` with real `RpcProvider.getTransactionStatus`/`getTransactionReceipt` + `getConfirmedBlock` (via `getBlockLatestAccepted`) replaying `submitted → processing → confirming → confirmed → reverted` and persistence of `reconciliationWatermark`.
3. **Live indexer pagination against chain:** `StarknetEventIndexerAdapter.fetchAllRegistryEvents` with real `RpcProvider.getEvents` `keys:[[SELECTORS]]`, `chunk_size`, `continuation_token` gap-scan, and `PostgresPrismEventsStore` `INSERT ... ON CONFLICT` against live `SN_SEPOLIA` for `PrismIdentityCreated`/`ExecutionIdentityBound`/`BindingRevoked`.
4. **Durable event projection read:** `PostgresPrismEventsStore.listOrdered`/`listByBlockRange` served with `watermark` check `K=5` under `WatermarkedResolveService` — requires live `indexer` + `ConfirmedBlockPort`.
5. **Worker daemon in production:** `ReconciliationWorker.start()` with `recoverAtStartup`, jittered `pollIntervalMs`, `onMetrics` → metrics endpoint, `onEscalation` → operator alert, `globalWorkerRunning` singleton across process, graceful `stop()` on SIGTERM.
6. **Network deployment:** `SN_SEPOLIA` contract deploy + envelope (`network, address, class_hash, deploy_tx, block`) and V8.5 decisive workflow `SN_SEPOLIA` + `Base Sepolia` (funded EOA→1271→6492 ladder + `chainId 84532` binding) — gates G1→G2→G3 to X3.
7. **Release-gated mainnet:** `SN_MAIN` repeat + hub validator `ok=pool=mine=true` once Prism contracts declared — out of scope (INV-PRISM-016, Phase 5 helper).

---

## 9. File Inventory (Backend-Only, This Live-Wiring)

```
src/features/prism-operations/adapters/starknet-submit.ts              # EXTENDED — env validation + mismatch guards (parseStarknetSubmitEnv, validateStarknetSubmitConfig, account==registry & account==controller checks)
src/features/prism-operations/adapters/starknet-event-indexer.ts      # EXTENDED — real selectors + keys filter + pagination fetchAllRegistryEvents + strict inferKind/inferPayload
src/features/prism-operations/adapters/starknet-ledger-status.ts      # EXTENDED — ConfirmedBlockReader + getConfirmedBlock (getBlockLatestAccepted/getBlockNumber) for Ledger port
src/features/prism-operations/adapters/postgres-prism-events-store.ts # NEW — prism_events table PK (tx_hash,event_index), ON CONFLICT dedup, deterministic ordering, in-memory X2 double
src/features/prism-operations/domain/reconciliation-worker.ts         # EXTENDED — process-safe start/stop (globalWorkerRunning + VITEST guard), jitter, onMetrics/onEscalation hooks, allowDaemonInTests
src/features/prism-operations/domain/resolve-service.ts               # EXTENDED — ConfirmedBlockPort wiring + fail-closed on stale/unknown (null watermark / null confirmed block → stale_refused / StaleCacheError)
src/features/prism-operations/__tests__/starknet-event-indexer.test.ts# UPDATED — real selectors (SEL_CREATED/SEL_BOUND/SEL_REVOKED), paginatedReader helper, 2 new tests (pagination continuation, selector mapping) → 12 total
src/features/prism-operations/__tests__/bundle-2r-live-boundaries.test.ts # NEW — 33 tests covering env validation (6), mismatch (5), pagination (3), duplicate (3), worker lifecycle (4), backoff (3), stale (6), unknown (3) — X2 labelled
projects/prism/BACKEND_BUNDLE_2R_LIVE_REVIEW.md                        # THIS FILE — authority/reconciliation/observability + T8/T9/T12 + G2/G3 + SC-06/27/28
```

Carryover: `postgres-operation-store.ts`, `memory-operation-store.ts`, `ports.ts`, `recovery.ts`, `event-indexer.ts`, `operation.ts`, `prism-application.ts`, `handlers.ts` — unchanged except re-export compatibility.

**Explicitly NOT in this commit:** `strk20.json` (empty), any `snfoundry.toml` with live secrets, `sncast.toml`, `.env`, keystore, `EVIDENCE_LEDGER.md`/`AUDIT.md`/`DECISIONS.md` row moves, frontend files, `contracts/` Cairo edits, `ops/` live deployment, `node_modules` change.

---

## 10. Commit & Verification (To Be Recorded After Green)

**Commit:** pending — will be `feat(prism-runtime): bundle 2R live-wiring (env+selectors+persist+worker+resolve+X2)` after `npm test + typecheck + build + diff-check` green (base `778e262`).

**Governing principle:** Research → Experiment → Build → Evidence. No ledger row moves without observed results.

---

### Appendix: Stable Error Surface (Live-Wiring)

`ERR-001 invalid_venue`, `ERR-002 identity_not_found`, `ERR-003 invalid_signer`, `ERR-004 not_controller` (incl. account/controller + account/registry mismatch), `ERR-005 invalid_execution_account`, `ERR-006 nonce_already_used`, `ERR-007 proof_digest_already_consumed`, `ERR-008 binding_already_active`, `ERR-009 binding_not_found`, `ERR-010 identity_not_found_read`, `ERR-011 binding_already_revoked` (benign), `ERR-012 altered_message`, `ERR-013 proof_expired`, `ERR-014 unsupported_signature_class`, `ERR-021 rpc_unavailable`, `ERR-022 timeout_unknown_status` (`requires_attention`), `ERR-023 stale_state_conflict`/`stale_version`/env/lifecycle.

Raw stacks never leak; `StaleCacheError` → `409`.

---

### Appendix: Authority Mapping for Reviewers (Live-Wiring)

| Concern | Primary authority | Never authoritative | Live-wiring proof |
|---|---|---|---|
| Prism ID existence | Starknet `PrismIdentityRegistry` | Backend indexer | `validateStarknetSubmitConfig` never invents id; `prism_events` rebuildable |
| Controller state | Registry `caller` check | UI session | `account==controller` pre-check + on-chain `ERR-004` |
| Binding status | Registry | Optimistic UI | `prism_events` `kind` + `resolveBinding` under `K` |
| Base proof validity | Backend verifier ladder (EOA→1271→6492) | Frontend messages | `parseStarknetSubmitEnv` does not validate proof — ladder does (T6) |
| Canonical acceptance | Registry transition only | Backend verified flag | `StarknetSubmitAdapter` returns `txHash` only (INV-SYS-005) |
| Resolution | Registry canonical or indexer under `K` via Ledger `getConfirmedBlock` | Stale ACTIVE | `WatermarkedResolveService` + `ConfirmedBlockPort` fail-closed |
| Operation UX state | `Operation` workflow + reconciliation | Optimistic UI | `ReconciliationWorker` + `PostgresOperationStore` + `PostgresPrismEventsStore` |
| Ledger/indexer boundary | `LedgerStatusPort` vs `EventIndexerPort` + `Continued getEvents` | Cache | `PRISM_EVENT_SELECTORS` + `fetchAllRegistryEvents` + `PRIMARY KEY (tx_hash,event_index)` |

Authority split A4 (verify offchain, accept onchain) **is** `DEC-PRISM-SYS-001` `ACCEPTED (Option A, owner Jason, 2026-08-23)`.

---

*Worktree `backend-bundle-2r-live` from `778e262`. No frontend, contracts/Cairo, `strk20.json`, deployment, Linear, Notion, credentials, or GitHub push was touched. X2 labelled fakes only.*

(End of review)
