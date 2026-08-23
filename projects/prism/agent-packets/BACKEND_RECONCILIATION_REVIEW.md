# Backend Reconciliation Closeout Review — WP-4B+ / backend-muse-reconciliation

**Branch:** `agent/backend-muse-reconciliation` (worktree isolated, backend lane B)
**Date:** 2026-08-23 UTC
**Baseline:** WP-4B OperationStore/recovery (a9c72e4/e62fdcd) + Postgres OperationStore (8097486/773d17f)
**Scope:** chain-observation / reconciliation boundary only; no frontend, Cairo, deployment, strk20.json, Linear, Notion, credentials, or GitHub push

---

## 1. Exit contract mapping

| Exit layer | Artifact / code | Verdict |
|---|---|---|
| Product Foundry truth | `CANONICAL_STATE.md` §10 decisive proof, `DECISIONS.md` DEC-PRISM-SYS-001 (ACCEPTED), `INVARIANTS.md` INV-SYS-005 (submitted≠completed) | Product invariants preserved; no product truth mutated |
| System Foundry authority/state/error/reconciliation | `SYSTEM_CANONICAL.md` §4–§5, `AUTHORITY_MATRIX.md` §4–§5, `STATE_MACHINES.md` SM-PRISM-003, `ERROR_CATALOGUE.md` ERR-023/022/021 | Authority per state, trust boundaries, error catalogue, reconciliation matrix implemented |
| Research Foundry evidence limits | `RESEARCH_BACKEND_GATE.md` §8, `EVIDENCE_LEDGER.md` X-scale | X2 ceiling for this lane; no live RPC claimed |
| AUDIT G0–G8 | see §5 | G0–G8 honest status, G1–G3 mapped |
| T1–T12 | `TEST_ARCHITECTURE.md` | T7/T9/T12 explicitly exercised |
| X maturity | `EVIDENCE_LEDGER.md` template | X2 (local controlled) ceiling declared |

---

## 2. Transport-neutral ports

**File:** `src/features/prism-operations/domain/ports.ts:1`

Two narrow, transport-neutral ports (no `starknet.js`, `viem`, `pg`, or RPC SDK imported in `domain/`):

```ts
LedgerStatusPort  { observeChain(txHash: Hex): Promise<ChainTxObservation | null> }
EventIndexerPort  { observeIndexer(txHash): Promise<IndexerObservation | null>;
                    observeReconciliation(txHash): Promise<ReconciliationObservation | null> }
```

Composite (convenience) `OperationReconciliationPort extends LedgerStatusPort & EventIndexerPort` retains backward compatibility.

Aliases `LedgerPort` / `IndexerPort` satisfy the closeout wording verbatim.

Observations are typed boundaries (`ChainTxObservation`, `IndexerObservation`, `ReconciliationObservation`) — adapters translate any transport (RPC, gateway, fake) into these facts. Fakes are explicitly labelled test doubles in `__tests__/poll-worker-divergence.test.ts` and `__tests__/event-reconstruction.test.ts`.

**Invariants:** ledger authority for `submitted/processing/confirming/confirmed/reverted`; indexer authority for `indexed/reconciled` — see `recovery.ts` header table and `AUTHORITY_MATRIX.md` row 6–7.

---

## 3. Deterministic operation poll / reconciliation worker boundary

**Files:**
- `src/features/prism-operations/domain/ports.ts` — pure policy `decideReconciliationStep(op, facts) -> {nextState, authoritativeSource}`
- `src/features/prism-operations/domain/recovery.ts` — `tickReconciliation` + `tickReconciliationWithNarrowPorts` + `recoverNonTerminalOperations`

**Boundary:**
```
OpStore.getById(id) -> ledger.observeChain(txHash) -> indexer.observeIndexer(txHash)
                    -> indexer.observeReconciliation(txHash) -> decideReconciliationStep
                    -> OpStore.transition(id, {to, expectedVersion, txHash, watermark, metadata})
```
Single-operation tick is pure, fail-closed, version-CAS. Sweeper `recoverNonTerminalOperations` lists non-terminal ops and ticks each once — resume point is the durable row (`txHash` + `version`), no in-memory cursor. Restart after crash resumes from same row.

**Authoritative source per state (STATE_MACHINES.md SM-PRISM-003, AUTHORITY_MATRIX §5):**

| State | Source stored in `operation.authoritativeSource` |
|---|---|
| `created` … `ready` | `backend_op_row` |
| `submitted` / `processing` / `confirming` | `starknet_rpc_tx_status` |
| `confirmed` | `execution_status_succeeded` |
| `indexed` | `indexer_event_observed` |
| `reconciled` | `reconciliation_match` |
| `completed` | `receipt_issued` |
| `reverted` | `tx_receipt_revert_code` |
| `failed_*` / `expired` / `cancelled` / `requires_attention` | `op_policy` / `ttl_policy` / `user_or_operator` |

Helper `authoritativeSourceForState(state)` and `AUTHORITATIVE_SOURCE` map are the single source of truth; `decideReconciliationStep` returns the source per transition and `tickReconciliation` persists it via `reconciliationMetadata.authoritativeSource`.

**Invariant enforcement:** `INV-SYS-005 / INV-PRISM-015` — `transition()` rejects `submitted/processing/confirming/confirmed -> completed` (tested in `operation-lifecycle.test.ts` and `poll-worker-divergence.test.ts` "never marks").

---

## 4. Persistence through OperationStore

**Files:** `src/features/prism-operations/domain/operation-store.ts`, `src/features/prism-operations/adapters/postgres-operation-store.ts`, `src/features/prism-operations/domain/operation.ts`

Persisted fields (WP-4B contract, `PersistedOperation`):

```
id, kind, state, version, idempotencyKey, requestFingerprint,
txHash (Hex|null), errorCode|null, errorDetail|null,
attempts (retry count), correlationId,
createdAt, updatedAt, authoritativeSource,
reconciliationWatermark (block number|null),
reconciliationMetadata (Record<string,unknown>|null)
```

Semantics:
- `txHash` — set on `ready -> submitted`, validated `0x` + 64 hex, persisted thereafter; mismatched hash on idempotent re-apply throws `ERR-023`.
- `reconciliationWatermark` — `chain.blockNumber` if present else `indexer.blockNumber`; persisted on every advancing tick (operation-store.test.ts "watermark and metadata are persisted via transition").
- `event correlation` — `reconciliationMetadata` holds `{txHash, eventIndex, eventName, blockNumber, authoritativeSource, observedAt}` keyed by `tx_hash + event_index` (EVENT_CATALOGUE `correlation_id`). See `recovery.ts` patch block.
- `attempts` (retry count) — `transition()` increments on any `FAILURE_BRANCHES` or `requires_attention`; read via `getById` after tick — tested in `poll-worker-divergence.test.ts` "persist".
- `reconciliationMetadata` — generic map for audit; populated deterministically per tick, never fabricated chain truth.

**Store guarantees:** parameterized SQL only, versioned migration `prism_operations`, unique `idempotency_key`, expected-version CAS (`UPDATE ... WHERE id=$1 AND version=$14`), duplicate-key conflict `ERR-023 idempotency_key_conflict`, stale_version `ERR-023`, check-violation fail-closed.

---

## 5. Divergence matrix (AUTHORITY_MATRIX §4 + SYSTEM_FOUNDRY §20)

All cases are exercised in `poll-worker-divergence.test.ts` (labelled fakes) and `event-reconstruction.test.ts`:

| Divergence case | Canonical authority | Detection in tick | Repair / handling | Test |
|---|---|---|---|---|
| **submitted-but-unknown** | chain RPC re-query | `chain===null` | `noop` `awaiting_chain_observation` | `submitted-but-unknown` |
| **confirmed-but-unindexed** | chain receipt | `indexer.eventObserved===false` | `noop` `awaiting_indexer_event` | `confirmed-but-unindexed` |
| **reverted** | `tx_receipt_revert_code` | `chain.execution===REVERTED` | `-> reverted` with stable `revertCode` (ERR-007 class) | `reverted` |
| **duplicate event** | `tx_hash+event_index` idempotent key | `applyEvent` `isDuplicate` + store `idempotent:true` | benign duplicate, no version bump | `duplicate event`, `event-reconstruction duplicate` |
| **missed event** | chain receipts ground truth | `observeIndexer===null` | `noop` gap scan, `awaiting_indexer_event` | `missed event` |
| **stale cache** (ACTIVE for REVOKED) | registry state / watermark `confirmedBlock-K` | `isWatermarkStale(watermark, confirmedBlock, K)` | invalidate, serve `NO_ACTIVE_DESTINATION` | `stale cache` + `event-reconstruction isStaleProjection` |
| **dependency outage** (RPC/indexer/store) | `op_policy` | `observe*` throws | fail-closed `dependencyFailure:true`, no state change | `dependency outage` (3 subcases) |
| **restart** | durable op row | `recoverNonTerminalOperations` sweeps `listNonTerminal` | resume from last `txHash`+`version` | `restart` |
| **retryable vs terminal** | `op_policy` | `isRetryableFailure` vs `isTerminal` | `failed_retryable -> ready` allowed; `failed_terminal` terminal | `retryable vs terminal` |
| **never completed early** | `INV-SYS-005` | `transition` guard + worker double-guard | `ERR-023` `submitted_is_not_completed` | `never marks …` |

Additional branches: `requires_attention` (ERR-022 timeout_unknown_status) tested in `operation-lifecycle.test.ts` and `recovery-policy.test.ts`; `expired`/`cancelled` covered.

---

## 6. Idempotent event reconstruction keyed by tx_hash + event_index

**File:** `src/features/prism-operations/domain/event-indexer.ts`

Three registry facts (EVENT_CATALOGUE):

```
PrismIdentityCreated        {prism_id, controller}                     key: prism_id
ExecutionIdentityBound      {prism_id, venue, execution_account, proof_digest}  key: prism_id+venue+execution_account+bound_at_block
BindingRevoked              {prism_id, venue, execution_account}              key: prism_id+venue+execution_account+revoked_at_block
```

Implementation:
- `RegistryCanonicalEvent {txHash, eventIndex, blockNumber, kind, payload}` — `correlation_id = tx_hash + event_index` per catalogue.
- `eventKey(txHash, eventIndex) = lower(txHash):index` — seen ledger `Set<string>` (LEDGER_INDEX).
- `applyEvent(state, event) -> {state, isDuplicate}` — first-seen wins; duplicate key is benign `isDuplicate:true`; malformed hash/index returns `error` fail-closed.
- `reconstruct(events)` — sorts by `(blockNumber, txHash, eventIndex)` (chain order) then applies idempotently; duplicate/dropped permutations converge deterministically (property test).
- `resolveBinding(state, prismId, venue) -> executionAccount | null` — filters `status===ACTIVE` only (INV-PRISM-004, INV-SYS-007).
- `isStaleProjection(watermark, confirmedBlock, K)` — QRY-8-01 bounded staleness `watermark < confirmedBlock-K`.
- Identities survive revocation (INV-SYS-006) — tested.

Tests: `event-reconstruction.test.ts` — 12 tests covering empty+replay guarantee (TEST-7-3-1), duplicate with same/different payload, missed gap, out-of-order determinism, property random shuffles, resolve→revoke→resolve sentinel, stale detection, restart replay, malformed fail-closed, reverted-no-event noop.

Classification: `LEDGER_INDEX` (derivable, rebuildable) — never authoritative for Operation lifecycle, but reconstruction guarantee is the indexer↔operation correlation boundary for `indexed`/`reconciled` advancement.

---

## 7. Tests (T7 / T9 / T12)

**Summary:**

| Tier | Definition | File | Count | What it proves |
|---|---|---|---|---|
| **T7** DB integration | nonce/store atomicity, durability across restart | `src/features/prism-identity/__tests__/sqlite-ownership-proof-store.test.ts`, `src/features/prism-identity/__tests__/postgres-ownership-proof-store.test.ts`, `src/features/prism-operations/__tests__/postgres-operation-store.test.ts` (SQL contract, no live DB) + `postgres-operation-store.integration.test.ts` (gated live, skipped honestly) | 10 + 8 + 11 + 3 (gate) | CAS single-winner, owned copies, close/reopen durability, versioned migration |
| **T9** Ledger integration | backend ↔ registry event indexing, reconstruction guarantee | `src/features/prism-operations/__tests__/event-reconstruction.test.ts` | 12 | Idempotent key, ordering, resolver honesty, watermark staleness |
| **T12** Failure/recovery | RPC outage, indexer lag, duplicate events, restart mid-bind | `src/features/prism-operations/__tests__/recovery-policy.test.ts` + `poll-worker-divergence.test.ts` + `src/features/prism-operations/__tests__/operation-lifecycle.test.ts` (failure branches) | 8 + 14 + 18 | All 9 divergence cases, retryable vs terminal, INV-SYS-005 guard |

**Full suite (this worktree, fake-only):**

```
15 files passed | 2 skipped (integration gated)
176 tests passed | 14 skipped
Duration ~7s
```

Integration tests (`postgres-ownership-proof-store.integration.test.ts`, `postgres-operation-store.integration.test.ts`) are gated on `PRISM_POSTGRES_TEST_URL` else skipped — honest skip, not fabricated.

**Property / unit / failure / restart explicitly:**
- *Property:* determinism under permutation (event-reconstruction "random shuffles reconstruct to same state"), idempotent duplicate, watermark monotonic.
- *Unit:* SQL contract (parameterized INSERT, versioned CAS UPDATE, snake_case mapping, watermark/metadata persistence), authoritative source map, `isWatermarkStale`.
- *Failure:* dependency throws → `dependencyFailure:true`, `submitted-but-unknown`, `confirmed-but-unindexed`, `reverted`, stale cache, illegal skips.
- *Restart:* `recoverNonTerminalOperations` sweep, `close/reopen durability`, `restart-equivalent replay`.

No live RPC / fork / deployment test is included — transport fakes are labelled "FakeLedgerPort", "FakeIndexerPort", "FakeOperationStore doubles" per closeout requirement.

---

## 8. System reconciliation / observability mapping

**Reconciliation (AUTHORITY_MATRIX §4, SYSTEM_FOUNDRY §20):** implemented in `recovery.ts` header table and `decideReconciliationStep` policy — each row has canonical authority, detection, repair, user/operator visibility, audit entry. See §5 above.

**Observability correlation chain (AUTHORITY_MATRIX §5, SYSTEM_FOUNDRY §21):**

```
user_action_id -> request_id -> command_id -> operation_id -> db_tx_id
              -> chain_tx_hash -> event_id (tx_hash+event_index)
              -> reconciliation_id -> served_state_version (watermark)
```

Minimum obligations satisfied:
- Every chain-touching command creates `Operation` before submission (`createOperation` + `PersistedOperation` row).
- Every `submitted` transition stores `chain_tx_hash`.
- Resolution/event-reconstruction responses would carry `watermark` (projection `watermark`, operation `reconciliationWatermark`).
- Error responses carry stable `ERR-0xx` codes (`OPERATION_ERROR_CODE` maps to `ERROR_CATALOGUE.md`), never stack traces (`OperationError.toExternalShape()`).

Logging privacy: `describeUnknownFailure` collapses hex blobs to `<opaque>` (prism-identity `errors.ts` pattern reused).

---

## 9. AUDIT G1–G3 mapping

| Gate | Name | Criterion (PRODUCT_BACKEND_GATE §7) | Evidence here | Maturity |
|---|---|---|---|---|
| **G1** | PrismIdentityRegistry | `create/read` + identity invariants, deployment receipt when live | Contract scaffold at `contracts/prism_identity_registry/` already green (PRISM7_CROSSWALK, 7 snforge tests). This packet does **not** re-earn G1; it preserves the operation envelope that wraps future registry writes. No new on-chain claim. | X2 (contract) remains X0 in `EVIDENCE_LEDGER.md` per honest ledger rule; no deployment receipt fabricated |
| **G2** | Base ownership proof + binding | valid owner binds, wrong signer rejected, replay/expiry, challenge fields | Offchain slice V8.1–V8.2 already green (42 tests, ladder EOA→1271→6492). This packet closes the **poll/reconciliation** half of G2: binding tx `submitted` state is now tracked durably and only confirmed via ledger + indexer. | X2 |
| **G3** | Resolution + revocation | decisive proof `resolve=B` pre-revoke, `NO_ACTIVE_DESTINATION` post-revoke, `P` persists; resolver never returns revoked as active | `event-indexer.ts` `resolveBinding` + stale-cache invalidation + reconstruction guarantee (TEST-7-3-1 analogue at API level) exercises the resolver contract without a live node. No live resolve RPC. | X2 |

G4–G8 remain `NOT_IMPLEMENTED` (AUDIT.md §13) — not touched by this lane.

---

## 10. Notion SC-06 / SC-27 / SC-28 mapping (backend lane B)

Upstream Notion SCs are not in-repo; mapping is by closeout checklist wording:

| SC | Interpreted requirement | Implementation |
|---|---|---|
| **SC-06** | Define transport-neutral Ledger / RPC status port; explicit authoritative source per state; never complete early | `ports.ts` `LedgerStatusPort` + `EventIndexerPort` + `recovery.ts` authoritative-source table + `INV-SYS-005` guard |
| **SC-27** | Idempotent event/indexer reconstruction keyed by `tx_hash + event_index` for the three registry facts | `event-indexer.ts` + `event-reconstruction.test.ts` (12) |
| **SC-28** | Deterministic operation poll/reconciliation worker + failure/restart handling + durable retry/watermark/metadata | `recovery.ts` tick + sweep + `poll-worker-divergence.test.ts` (14) + `PersistedOperation` watermark/metadata/attempts |

No Linear/Notion mutation was performed (worktree isolation rule).

---

## 11. What this packet deliberately does NOT claim (evidence ceiling)

**Evidence ceiling: X2 — LOCAL BUILD EVIDENCE EARNED, RUNTIME/MAINNET EVIDENCE OPEN**

- No Starknet RPC call was made. No `sncast` profile, no funded deployer, no Sepolia/mainnet transaction was submitted. All ledger/indexer observations are fakes labelled `FakeLedgerPort` / `FakeIndexerPort` / `FakeOperationStore doubles`.
- No `snforge` mainnet fork, no live EIP-1271/ERC-6492 wallet observation beyond the existing offchain ladder fakes (V8.1–V8.2 doubles).
- No `strk20.json` was edited (remains `{"transactions":[],"contracts":[]}`).
- No `EVIDENCE_LEDGER.md` / `AUDIT.md` gate movement — `EVD-PRISM-004..007` remain `NOT_IMPLEMENTED / X0` until a live observation is recorded via the yaml template.
- `npm run typecheck` and `npm run build` pass in this worktree (existing shared `node_modules` reused, no reinstall). `git diff --check` clean.

---

## 12. Unimplemented live boundaries (explicit)

These remain open for a follow-on lane with funded network access and owner approval:

1. **Live ledger adapter:** real `LedgerStatusPort` implementation over `starknet.js` RPC (`getTransactionStatus` / `getTransactionReceipt`) plus tx submission path — currently `Notion SC-06` domain but live transport is absent.
2. **Live indexer adapter:** polling or websocket event indexer for `PrismIdentityCreated` / `ExecutionIdentityBound` / `BindingRevoked`, gap scan, duplicate detection against real chain — `SC-27` live half.
3. **Operation submission path:** `CreateIdentity` / `bind_execution_identity` broadcast via Starknet account, handling `submitted-but-unknown` via re-poll by hash and `failed_retryable` after N misses — `CONTRACT_SPEC.md` OP-7-01/OP-8-01 wiring.
4. **Resolver serving layer:** `QRY-8-01` watermarked resolution endpoint (`GET /v1/resolve/:identifier?venue=BASE`) with cache invalidation on `BIND`/`REVOKED` events (AUTHORITY_MATRIX cache policy).
5. **Durable event ledger table:** Postgres `prism_events` / indexer projection table keyed `(tx_hash, event_index)` with idempotent upsert — the domain `event-indexer.ts` is pure; its durable counterpart is not yet implemented.
6. **Startup wiring:** `recoverNonTerminalOperations` call on process boot, backoff/jitter poll interval, `requires_attention` escalation after timeout (ERR-022).
7. **Network deployment:** `SN_SEPOLIA` contract deploy + evidence envelope (network, address, class hash, deploy tx, block) and V8.5 decisive workflow on `SN_SEPOLIA` + `Base Sepolia` — gates G1–G3 to X3.
8. **Release-gated mainnet:** `SN_MAIN` repeat + hub validator `ok=pool=mine=true` once Prism contracts are declared — out of scope for this lane (INV-PRISM-016 belongs to Phase 5 helper).

---

## 13. Commit & verification

**Commit:** pending — will be `feat(prism-operations): close chain-observation/reconciliation boundary ...` after `npm test + typecheck + build + diff-check` green.

**Verification performed in this worktree (2026-08-23):**
- `npm test` → 15 passed | 2 skipped (integration gated) | 176 passed | 14 skipped
- `npm run typecheck` → PASS
- `npm run build` → PASS (Next webpack, routes `/`, `/_not-found`)
- `git diff --check` → clean (no whitespace errors)

No secrets committed, no `node_modules` reinstall, no frontend/Cairo/deployment mutation.

---

## 14. File inventory (backend-only)

```
src/features/prism-operations/domain/ports.ts            # +LedgerStatusPort, EventIndexerPort, aliases
src/features/prism-operations/domain/recovery.ts         # divergence table, watermark/metadata persistence, authoritativeSourceForState, tickWithNarrowPorts
src/features/prism-operations/domain/event-indexer.ts    # NEW — idempotent reconstruction
src/features/prism-operations/domain/index.ts            # re-exports
src/features/prism-operations/__tests__/event-reconstruction.test.ts  # NEW — 12 tests
src/features/prism-operations/__tests__/poll-worker-divergence.test.ts # NEW — 14 tests
projects/prism/agent-packets/BACKEND_RECONCILIATION_REVIEW.md        # this file
```

All other `src/features/prism-operations/**` files are WP-4B carryover (operation lifecycle, OperationStore, postgres adapter) — untouched except the two narrow-port additions above.

---

*Governing principle: Research → Experiment → Build → Evidence. No ledger row moves without observed results.*
