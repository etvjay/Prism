# Prism Pause P5–P7 Audit Evidence Map (X2)

**Scope:** P5 settlement adapter boundary, P6 transport/API, P7 observability/security — X2 runtime-open lane. No live chain call, no Postgres live, no P8 testnet.

## 1. P5 settlement boundary

| Requirement | Code | Evidence |
|---|---|---|
| RELEASED creates durable Operation intent/plan without marking completed | `src/features/prism-pause/application/pause-service.ts:release()` + `src/features/prism-pause/application/pause-settlement-bridge.ts` | `p5-settlement-bridge.test.ts` RELEASED → op `submitted`, never `completed`; `op.correlationId` preserved |
| Adapter ports injectable (Starknet/Base/STRK20) | `src/features/prism-pause/ports/execution-adapter.ts` + `adapters/fake-execution-adapters.ts` | `p5` custom adapter override test; `factory.ts` `createFakeAdapterRegistry` injectable via `InMemoryPauseService` opts |
| Distinct states remain distinct | `src/features/prism-operations/domain/operation.ts` ALLOWED table + `submitted_is_not_completed` guard | `p5` chain test stepwise `submitted→processing→confirming→confirmed→indexed→reconciled→completed`, illegal skip `submitted→completed` rejected |
| No live chain call | Adapters are fakes, `fakeTxHash` deterministic | Grep `starknet.*RpcProvider\|Account.*sign` in pause adapters = 0 |

## 2. P6 transport/API convergence

| Requirement | Code | Evidence |
|---|---|---|
| REST Pause routes use rigorous PauseService | `src/app/api/v1/intents/route.ts`, `intents/[intentId]/pause/route.ts`, `pauses/[pauseId]/{verify,release,cancel,escalate,approve,route.ts}` → `getAppFactory().pauseService` (domain guards) | `p6-transport-sdk.test.ts` intent→pause→verify→release via Next route handlers with `plan_hash`/`approval_scope` binding |
| Stable hash/CAS/error semantics | `parseHeaders` `If-Match`/`ETag`, `PauseError` stable `ERR-102…116`, `jsonError` no stacks | `p6` ETag `"version"` round-trip, stale version `409 ERR-111`, `planHash`/`approvalScopeHash` echoed, `X-Request-Id`/`X-Correlation-Id` headers |
| SDK vocabulary without raw calldata | `src/sdk/types.ts` `PauseData { planHash, approvalScopeHash, settlementOperationId, correlationId }`, `src/sdk/client.ts` no `starknet.js` | Grep `felt|calldata` in `src/sdk` = 0, `p6` types check |
| No frontend | `src/app/page.tsx` untouched, no `Home` mutation | `git diff --stat HEAD` shows no frontend |

## 3. P7 observability/security

| Requirement | Code | Evidence |
|---|---|---|
| Append-only pause decisions | `ports/pause-store.ts` `appendDecision` + `memory-pause-store.ts` replay guard + `postgres-pause-store.ts` `INSERT` + decisions ordering | `p7-observability-redteam.test.ts` `getDecisions` ordered, immutable, replay blocked |
| Correlation/operation IDs | `application/pause-service.ts` `release({correlationId})` → `operationStore.create({correlationId})`, `pause-port.ts` `correlationByPause` → `mapDomainPauseToRest`, `http-helpers.ts` `X-Correlation-Id` echo | `p7` op `correlationId == corr-obs-1`, `p6` header echo |
| Metrics hooks | `ports/metrics.ts` `InMemoryPauseMetrics` / `NoopPauseMetrics` injected via `factory.ts` | `p7` counts `pause_verified`, `pause_released`, `settlement_operation_*` |
| Red-team: bypass | `domain/pause.ts` `RELEASE_NOT_READY` guard | `p7` direct release without verify → throw |
| Red-team: plan mutation | `PAUSE_ERROR_CODE.PLAN_HASH_MISMATCH` / `APPROVAL_SCOPE_MISMATCH` | `p7` wrong planHash / wrong scope → throw, `metrics plan_mutation_blocked` |
| Red-team: release replay | `memory-pause-store.appendDecision` replay, `pause.ts` terminal `RELEASED` | `p7` second release → throw, `approval_replay_blocked` |
| Red-team: unknown checks | `checks.ts` `UNKNOWN` is `BLOCKING`, `domain/pause.ts` `CHECK_UNKNOWN_BLOCKING` | `p7` unknown sources → `ESCALATED` + release blocked, `hasBlockingFailure` |

## 4. X2 boundary & blockers (honest)

| Blocker | Status | Next gate |
|---|---|---|
| **Postgres live adapter** | Port + migration SQL exists (`postgres-pause-store.ts:PAUSE_STORE_MIGRATION_SQL`, partial unique index `active_per_intent`, CAS `UPDATE WHERE version`) but no live `pg` test run (`PG` env absent). Memory adapter is X2 substitute. | T7 `postgres-*-test.ts` with `PRISM_POSTGRES_TEST_URL` against real `pg` |
| **Live chain adapters** | Fakes only (`FakeStarknetAdapter`/`FakeBaseAdapterImpl`/`FakeStrk20Adapter`). No `RpcProvider`/`Account`/`viem` live submit. Submit creates fake `0x` txHash deterministically, never broadcasts. | P5 live helper: `StarknetExecutionAdapter` with `Account.execute` + `RpcProvider.waitForTransaction`, `BaseExecutionAdapter` with `viem walletClient`, `STRK20WalletActionAdapter` with wallet API, plus testnet tx hash verification |
| **P8 testnet rehearsal** | Out of scope by lane instruction (no live testnet, no deploy/broadcast, no `strk20.json` write). Bridge stops at `submitted`. | P8 sequence: `intent→pause→verify→release→submit→confirming→confirmed→indexed→reconciled→completed` with `SN_SEPOLIA`/`Base Sepolia` receipts + independent read |
| **Frontend/Phase 8** | Explicitly untouched (`strk20.json` remains `{"transactions":[],"contracts":[]}`) | P8 product slice adds `Send/Activity/Home` states per plan P6 |

## 5. Invariant preservation

- `submitted != completed` (INV-SYS-005) via `operation.ts:canTransition` + `submitted_is_not_completed` guard + adapter never marks completed.
- `RELEASED != completed` via `pause.ts:RELEASED` terminal + `operationStore` separate lifecycle.
- `plan_hash` immutability via `domain/pause.ts` version + `store.updatePause` planHash check + `PENDING`-`P5` `verificationSources` binding.
- `approval_scope_hash` exact plan binding via `computeApprovalScopeHash(pauseId+planHash+policyVersion)` and `APPROVAL_SCOPE_MISMATCH` checks on release/approve.
- `UNKNOWN` fail-closed via `checks.ts:hasBlockingFailure` + `CHECK_UNKNOWN_BLOCKING` + `canAutoRelease()==false`.
- Authority: Starknet registry remains canonical (A1), Base proof ladder (A4), settlement truth is chain+reconciliation (A8), backend never becomes canonical (AM).

## 6. Maturity

- P5–P7 foundation: **X2 — local controlled** (pure domain + in-memory store + fake adapters + route handlers without server start).  
- No X3 claimed (requires Postgres live + next start transport trace + testnet tx).  
- Blockers listed above gate X3.

## 7. Test counts (post-lane)

- `npm test` expected green: see `npm test -- --reporter=verbose` output (new suites: `p5-settlement-bridge`, `p6-transport-sdk`, `p7-observability-redteam`).
- Stable error catalogue: `src/features/prism-pause/domain/errors.ts` `ERR-100…122`.
- Reason codes: `PAUSE_REASON_CODE` `PAUSE-IDENTITY-001…PAUSE-SIM-004`.
