# Backend Bundle 2R Review — Local Runtime Boundary

**Branch:** `agent/backend-bundle-2r` (worktree isolated, backend lane)  
**Date:** 2026-08-23 UTC  
**Baseline:** `5684163 feat(prism-operations): add Starknet ledger status adapter` + WP-5 app boundary (`6268583`) + reconciliation (`0f3a770`)  
**Scope:** Remaining local runtime boundary only — Starknet submit, event/indexer, reconciliation worker, watermarked resolve, transport-neutral API handlers. **No frontend, Cairo, strk20.json, deployment, Linear, Notion, credentials, or GitHub push.**  
**Methodology:** Foundry → Profile → Project → Implementation → Evidence. No ledger row moves without observed results.

---

## 0. Gate Summary

| Gate | Verdict | Basis |
|---|---|---|
| **Product Foundry** | PASS | No product truth mutated; decisive proof (create→bind→resolve→revoke) preserved verbatim; non-goals untouched |
| **System Foundry** | PASS | Every new artifact projects from canonical system canonical v0.2 (DOMAIN_MODEL, STATE_MACHINES, CONTRACT_SPEC, EVENT_CATALOGUE, ERROR_CATALOGUE, INVARIANTS, AUTHORITY_MATRIX, TEST_ARCHITECTURE) |
| **Research Foundry** | PASS | X2 ceiling declared; no live RPC/mainnet claimed; fakes labelled; STRK20_CONTEXT route respected |
| **Antagonist / Red-team** | PASS | 7 antagonistic cases exercised (wrong controller, digest replay, stale cache, unknown tx, reverted, dependency outage, restart) — all fail-closed |

---

## 1. Product Foundry Gate

Source: `CANONICAL_STATE.md` v0.1 §10, `DECISIONS.md` DEC-PRISM-SYS-001 (ACCEPTED Option A), `docs/PRISM_DOCUMENTATION_V0_3.md` §29 invariants.

| Required item | Value | Preserved? |
|---|---|---|
| Primary user | Person across venues, disconnected addresses | No mutation |
| Painful moment | Manual identity/privacy/rotation decisions | No mutation |
| Desired outcome | One persistent home, native authority, truthful privacy | No mutation |
| Core primitive | `PrismIdentity` persistent above execution identities | Enforced via registry + binding lifecycle |
| Decisive proof | create P → prove Base control → bind → resolve B → revoke → NO_ACTIVE_DESTINATION → P exists | Exercised via handlers.test + app-boundary.test |
| Non-goals | solver/bridge/PrismZK/private-Base/Solana/guardian/agent/shadow accounts | None introduced |
| Trust model | Starknet canonical root; backend mirrors, never owns | Authority matrix honored (A1–A6) |
| Privacy | Private only where mechanism proves it; no viewing keys | INV-SYS-008/011, no social/metadata in registry |

**Prohibited claims carried (SYSTEM_CANONICAL §8):** all 12 items remain enforced — no blanket privacy, no private-Base implication, no PrismID=address conflation, no trustless claim while backend is verifier, submitted≠completed, tx hash ≠ privacy proof, no shadow accounts, etc. Tests assert submitted≠completed and canonical-only-after-transition.

## 2. System Foundry Gate

Artifact index (`projects/prism/system/`): `SYSTEM_CANONICAL.md` (SYS-PRISM-78 v0.2), `DOMAIN_MODEL.md`, `STATE_MACHINES.md`, `INVARIANTS.md`, `AUTHORITY_MATRIX.md`, `CONTRACT_SPEC.md`, `EVENT_CATALOGUE.md`, `ERROR_CATALOGUE.md`, `TEST_ARCHITECTURE.md` + YAML companions (`domain-model.yaml`, `state-machines.yaml`, `events.yaml`, `errors.yaml`, `operations.yaml`, `invariants.yaml`, `authority-matrix.yaml`).

All files are acknowledged as authoritative; this bundle mutates none of them — it *derives* from them.

## 3. Research Foundry Gate

- `STRK20_CONTEXT.md` route: wallet-mediated private surface, capability detection via Wallet API, not balance probes — untouched.
- `RESEARCH_BACKEND_GATE.md` U2/Q8.3 trust split (backend verifier + controller-signed tx + onchain digest single-use) — implemented and tested via `LocalErc1271SemanticsChecker`→`StarknetSubmitAdapter` duality.
- Evidence scale per `EVIDENCE_LEDGER.md`: **X2 ceiling** for this lane. No `SN_MAIN`/`SN_SEPOLIA` RPC call, no funded deployer, no `snforge` mainnet fork. All ledger/indexer observations are **labelled fakes** (`FakeOperationStore`, injected `StarknetAccountLike`/`StarknetEventReader` doubles).
- `strk20.json` untouched (`{"transactions":[],"contracts":[]}`).
- `EVIDENCE_LEDGER.md` rows `EVD-PRISM-004..007` remain `X0 / NOT_IMPLEMENTED` until live observation via yaml template.

## 4. Antagonist / Red-team Gates

| Adversarial case | Invariant under attack | Detection | Result |
|---|---|---|---|
| Wrong Starknet controller signs bind | INV-SYS-002 | Registry `caller==controller` + app boundary pre-check | `ERR-004 not_controller` (submit + app tests) |
| Replay same proof digest | INV-SYS-004 | `consumed_digests` map onchain + `isDigestConsumed` pre-check | `ERR-007 proof_digest_already_consumed` |
| Replay same challenge nonce | INV-SYS-010 | `consumeNonce` CAS single-winner | `ERR-006 nonce_already_used` |
| Altered challenge field | INV-SYS-011 | `assertPresentedFaithful` digest recompute | `ERR-012 altered_message` |
| Stale watermark cache (ACTIVE for REVOKED) | INV-SYS-007 | `isWatermarkStale` / `isStaleProjection` | `stale_refused` sentinel, never served as active |
| Unknown tx (submitted-but-unknown) | AUTHORITY_MATRIX submitted-but-unknown | `observeChain` returns null | noop, fail-closed |
| Reverted tx | SM-PRISM-003 TR-O2 | `execution==REVERTED` → `reverted` with `revertCode` | `ERR-007` class preserved, `attempts` incremented |
| Dependency outage (RPC/indexer/store throws) | SYSTEM_FOUNDRY §20 fail-closed | `observe*` throws → `dependencyFailure:true` | no state change, metrics counted |
| Restart mid-operation | AUTHORITY_MATRIX backend restart | `recoverAtStartup` sweeps `listNonTerminal` | resume from durable `txHash+version` |

All cases have at least one failing-and-correct test; no optimistic completion is possible.

---

## 5. Feature → System Artifact Mapping

Every feature required by the bundle brief is traced to its canonical artifact.

| # | Required feature (brief) | Implementation file(s) | System artifact(s) | IDs |
|---|---|---|---|---|
| **F1** | Concrete `StarknetSubmitPort` adapter via injected `starknet.js` Account/provider; never reads secrets from files; never submits live txs | `src/features/prism-operations/adapters/starknet-submit.ts` (`StarknetSubmitAdapter`) | `CONTRACT_SPEC.md` OP-7-01/OP-8-01/OP-8-03; `AUTHORITY_MATRIX.md` A1–A3; `ERROR_CATALOGUE.md` ERR-001/002/004/005/007/008; `INVARIANTS.md` INV-SYS-002/004 | OP-7-01, OP-8-01, OP-8-03 |
| **F2** | Concrete event/indexer adapter over injected `RpcProvider.getEvents` with deterministic `(block_number, transaction_hash, event_index)` ordering and `(tx_hash,event_index)` idempotency | `src/features/prism-operations/adapters/starknet-event-indexer.ts` (`StarknetEventIndexerAdapter`) | `EVENT_CATALOGUE.md` EVT-PRISM-IDENTITY-CREATED / EVT-EXECUTION-IDENTITY-BOUND / EVT-BINDING-REVOKED; `SYSTEM_CANONICAL.md` §3; `DOMAIN_MODEL.md` OBJ-PRISM-003 | EVT-… |
| **F3** | Wire `StarknetLedgerStatusAdapter` + event indexer + `OperationStore` into deterministic reconciliation worker | `src/features/prism-operations/domain/reconciliation-worker.ts` (`ReconciliationWorker`); `src/features/prism-operations/domain/recovery.ts` (`tickReconciliation`, `decideReconciliationStep`) | `STATE_MACHINES.md` SM-PRISM-003; `AUTHORITY_MATRIX.md` §4 reconciliation matrix; `CONTRACT_SPEC.md` §5 persistence; `SYSTEM_CANONICAL.md` §4 | SM-PRISM-003 |
| **F4** | Startup recovery, bounded retry/backoff, unknown status, reverted, stale watermark, requires_attention escalation | Same worker + `src/features/prism-operations/domain/recovery.ts` (`isWatermarkStale`, `authoritativeSourceForState`) | `STATE_MACHINES.md` SM-PRISM-003 failure branches; `AUTHORITY_MATRIX.md` §4 divergence table; `INVARIANTS.md` INV-SYS-005/007; `ERROR_CATALOGUE.md` ERR-022/023 | SM-PRISM-003 failure branches |
| **F5** | Watermarked resolve serving boundary with canonical-source preference and stale-cache refusal | `src/features/prism-operations/domain/resolve-service.ts` (`WatermarkedResolveService`, `StaleCacheError`) | `CONTRACT_SPEC.md` QRY-8-01; `AUTHORITY_MATRIX.md` A6; `INVARIANTS.md` INV-SYS-007; `DOMAIN_MODEL.md` SM-PRISM-002 resolve | QRY-8-01 |
| **F6** | Transport-neutral API adapter/handler contracts for `issue`/`verify`/`bind`/`resolve`/`revoke`/`operation read`, preserving stable errors, idempotency, submitted!=completed | `src/application/ports.ts` (`RegistryReadPort`, `StarknetSubmitPort`), `src/application/prism-application.ts` (`PrismApplicationService`), `src/application/handlers.ts` (`PrismApiHandlers`, `API_CONTRACTS`) | `CONTRACT_SPEC.md` CMD-7-01/CMD-B-01/02/QRY-7-01/8-01 + OP-7-01..03; `ERROR_CATALOGUE.md` ERR-001..023; `STATE_MACHINES.md` SM-PRISM-001/002/003 | CMD-B-01/02, QRY-7/8, OP-7/8 |
| **F7** | Focused unit/contract/failure/restart tests + review artifact | Tests below (§9); this file | `TEST_ARCHITECTURE.md` T7–T12; `EVIDENCE_LEDGER.md` X scale | T7–T12 |

No file introduces a new invariant; every guard delegates to a canonical code (`ERR-00x`) or an existing domain transition (`transition()` with `INV-SYS-005` double-guard).

---

## 6. Test Architecture T7–T12 Mapping

Per `projects/prism/system/TEST_ARCHITECTURE.md` ladder.

| Tier | Definition | Tests | Count | What it proves |
|---|---|---|---|---|
| **T7 DB integration** | Nonce/store atomicity, durability across restart | `sqlite-ownership-proof-store.test.ts`, `postgres-ownership-proof-store.test.ts`, `postgres-operation-store.test.ts` + `postgres-*.integration.test.ts` (gated, skipped honestly) | 10+8+11+3(gate) + new `reconciliation-worker` restart sweep | CAS single-winner, owned copies, close/reopen durability, versioned migration, operation sweep resume |
| **T8 API contract** | Error shapes, idempotency, watermark headers | `app-boundary.test.ts`, `handlers.test.ts` | 12 + 5 | Stable ERR codes, idempotencyKey dedup, expectedVersion CAS, `httpStatusHint`, watermark in resolve |
| **T9 Ledger integration** | Backend ↔ registry event indexing, reconstruction guarantee | `event-reconstruction.test.ts`, `starknet-event-indexer.test.ts` | 12 + 10 | Idempotent `(tx_hash,event_index)` key, deterministic `(block,tx,event)` ordering, resolver honesty, watermark staleness, dedup |
| **T10 Frontend integration** | State labels derive from op states only | (out of scope — no frontend files touched per isolation rule; SM-PRISM-003 labels are preserved in handler contracts) | 0 | N/A — not mutated |
| **T11 E2E** | Decisive proof sequence FT-001 end-to-end | `app-boundary.test.ts` success path, `handlers.test.ts` issue→verify→bind→resolve→revoke | 2 | `resolve=B` pre-revoke, `NO_ACTIVE_DESTINATION` post-revoke, `P` persists |
| **T12 Failure/recovery** | RPC outage, indexer lag, duplicate events, restart mid-bind, retry vs terminal, reverted, requires_attention | `recovery-policy.test.ts`, `poll-worker-divergence.test.ts`, `reconciliation-worker.test.ts`, `resolve-service.test.ts`, `starknet-ledger-status.test.ts`, `starknet-submit.test.ts` | 8+14+9+7+5+10 | All 9 divergence cases + backoff + escalation |

**Focused new tests (this bundle):**

| File | Tests | Focus |
|---|---|---|
| `starknet-submit.test.ts` | 10 | Injected Account boundary, no secret reads, entrypoint/calldata mapping, stable revert codes, dependency fail-closed, malformed digest (ERR-023), invalid venue (ERR-001) |
| `starknet-event-indexer.test.ts` | 10 | Deterministic ordering, `(tx_hash,event_index)` dedup, malformed tx_hash skip, watermark, missed event, `observeIndexer`/`observeReconciliation`, fail-closed on `getEvents` throw, domain `applyEvent` integration |
| `reconciliation-worker.test.ts` | 9 | Startup recovery sweep, bounded retry/backoff (`computeBackoffMs`), unknown tx noop, reverted with `revertCode`, stale watermark persistence, `requires_attention` escalation (ERR-022), dependency outage, never-completes-early, deterministic sweep order |
| `resolve-service.test.ts` | 7 | Canonical preference, stale ACTIVE refusal (INV-SYS-007), `allowStale` opt-in, indexer fallback when fresh, `StaleCacheError` when stale, `NO_ACTIVE_DESTINATION` sentinel, `isStale` bound |
| `handlers.test.ts` | 5 | `API_CONTRACTS` completeness (8 endpoints), full decisive tail via handlers, idempotency conflict (ERR-023), stable ERR mapping (ERR-012), `getOperation` with `submitted != completed` |

**Full suite (this worktree, fake-only):**

```
Test Files  22 passed | 2 skipped (24)
     Tests  239 passed | 14 skipped (253)
Duration ~7s
```

Integration tests gated on `PRISM_POSTGRES_TEST_URL` are skipped honestly — not fabricated.

Property / unit / failure / restart are explicitly labelled in the test names per closeout requirement.

---

## 7. AUDIT G2 / G3 Mapping

Per `projects/prism/AUDIT.md` §13 build gates and `projects/prism/system/TEST_ARCHITECTURE.md` acceptance.

| Gate | Name | Criterion (`PRODUCT_BACKEND_GATE.md` §7 analogue) | Evidence in this bundle | Maturity |
|---|---|---|---|---|
| **G1** | PrismIdentityRegistry | `create/read` + identity invariants, deployment receipt when live | Contract already green at `contracts/prism_identity_registry/` (7+ snforge tests). This bundle preserves the operation envelope that wraps future registry writes; no new on-chain claim. | X2 (contract) remains X0 in ledger per honest ledger rule |
| **G2** | Base ownership proof + binding | Valid owner binds, wrong signer rejected, replay/expiry, challenge fields; submit adapter maps to `bind_execution_identity` with controller/digest checks | Offchain slice V8.1–V8.2 already green (ladder EOA→1271→6492). **This bundle closes the submit half of G2:** `StarknetSubmitAdapter` via injected Account, digest single-use pre-check (`isDigestConsumed`), `handleSubmit` fail-closed to `failed_retryable` (ERR-021) or `failed_terminal` (ERR-004/007/008). `starknet-submit.test.ts` 10/10 pass. | **X2 — application + submit boundary closable**, not X3 (no live Base/RPC trace) |
| **G3** | Resolution + revocation | Decisive proof `resolve=B` pre-revoke, `NO_ACTIVE_DESTINATION` post-revoke, `P` persists; resolver never returns revoked as active | `WatermarkedResolveService` canonical-preference + stale-refusal (INV-SYS-007), `event-indexer.ts` `resolveBinding` + `isStaleProjection`, plus `handlers.test.ts` decisive tail (X2). `resolve-service.test.ts` 7/7 pass. | **X2 — resolver honesty & revoke idempotence via handlers**, not X3 (no live indexer) |
| G0/G4–G8 | Mainnet pool / Unified Home / STRK20 wallet / private app action / final hashes / release | Not in scope | Not touched | NOT_IMPLEMENTED |

Ledger rows `EVD-PRISM-004..007` remain `X0` per `EVIDENCE_LEDGER.md` template — no ledger movement without live observation.

## 8. Notion SC-06 / SC-27 / SC-28 Mapping (Backend Bundle 2R)

Upstream Notion SC rows are not in-repo; mapping is by bundle brief wording (closeout checklist).

| SC | Interpreted requirement | Implementation | Tests |
|---|---|---|---|
| **SC-06** | Define transport-neutral `LedgerStatusPort` / `StarknetSubmitPort` / `RpcProvider` boundary; explicit authoritative source per state; never complete early; startup recovery & `requires_attention` escalation | `src/features/prism-operations/domain/ports.ts` (`LedgerStatusPort`/`EventIndexerPort`/`OperationReconciliationPort`), `src/features/prism-operations/adapters/starknet-ledger-status.ts`, `src/features/prism-operations/adapters/starknet-submit.ts`, `src/features/prism-operations/domain/reconciliation-worker.ts` (`authoritativeSourceForState`, `INV-SYS-005` double-guard, `recoverAtStartup`, `requires_attention` escalation) | `starknet-ledger-status.test.ts` (5), `starknet-submit.test.ts` (10), `reconciliation-worker.test.ts` (9), `poll-worker-divergence.test.ts` (14) |
| **SC-27** | Idempotent event/indexer reconstruction keyed by `tx_hash + event_index` for the three registry facts; deterministic `(block, tx, event)` ordering | `src/features/prism-operations/adapters/starknet-event-indexer.ts` (`fetchRegistryEvents` sorted + deduped), `src/features/prism-operations/domain/event-indexer.ts` (`eventKey`, `applyEvent`, `reconstruct`, `resolveBinding`, `isStaleProjection`) | `event-reconstruction.test.ts` (12), `starknet-event-indexer.test.ts` (10) |
| **SC-28** | Deterministic operation poll/reconciliation worker + failure/restart handling + durable retry/watermark/metadata | `src/features/prism-operations/domain/recovery.ts` (`tickReconciliation`, `recoverNonTerminalOperations`, `isWatermarkStale`) + `src/features/prism-operations/domain/reconciliation-worker.ts` (`tickAllOnce`, `computeBackoffMs`, retry/backoff, unknown/reverted/requires_attention) + `src/features/prism-operations/adapters/postgres-operation-store.ts` + `memory-operation-store.ts` (watermark/metadata/attempts persistence) | `recovery-policy.test.ts` (8), `poll-worker-divergence.test.ts` (14), `reconciliation-worker.test.ts` (9), `postgres-operation-store.test.ts` (11) |
| **SC-06/27/28 resolve** | Watermarked resolve serving boundary with canonical-source preference and stale-cache refusal | `src/features/prism-operations/domain/resolve-service.ts` (`WatermarkedResolveService`) | `resolve-service.test.ts` (7) |
| **SC API** | Transport-neutral API adapter/handler contracts for `issue/verify/bind/resolve/revoke/operation read` | `src/application/ports.ts`, `src/application/prism-application.ts`, `src/application/handlers.ts` (`API_CONTRACTS`, 8 endpoints) | `app-boundary.test.ts` (12), `handlers.test.ts` (5) |

No Linear/Notion mutation was performed (worktree isolation rule).

---

## 9. X Maturity

```
X0 hypothesis          — all decisive runtime claims remain X0 (no live network)
X1 fixture/mock        — challenge fixtures, registry doubles, Account/EventReader fakes
X2 local controlled    — ✅ this lane: StarknetSubmitAdapter + StarknetEventIndexerAdapter
                          + ReconciliationWorker + WatermarkedResolveService
                          + PrismApiHandlers — 22 files pass locally
  typecheck            — PASS (tsc --noEmit, 0 errors)
  next build           — PASS (Next webpack, routes / and /_not-found)
  vitest (all)         — PASS (239 passed | 14 skipped, Duration ~7s)
  operation lifecycle  — PASS (SM-PRISM-003 pure domain, INV-SYS-005 guarded)
  challenge service    — PASS (EOA/1271/6492 ladder via test doubles, INV-SYS-009/010/011)
  ledger/indexer ports — PASS via injected fakes (no live RPC)
X3 realistic/testnet   — NOT_EVIDENCED (no SN_SEPOLIA / Base Sepolia trace)
X4 repeated/reproduced — NOT_EVIDENCED
X5 mainnet/production  — NOT_EVIDENCED
```

Maturity rule: local pass = X2; deployed + observed = X3+; mainnet + independent re-read = X4/X5. **No ledger row moves without observed results.**

## 10. Verification Performed This Session

```
npm test (vitest run)             — 22 passed | 2 skipped (24) | 239 passed | 14 skipped | ~7s
npx tsc --noEmit (typecheck)      — PASS (0 errors)
npm run build (next build)        — PASS (Compiled successfully, 7.7s + 6.8s typecheck)
git diff --check                  — clean (no whitespace errors)
focused lane tests                — starknet-submit.test.ts 10/10 PASS
                                   starknet-event-indexer.test.ts 10/10 PASS
                                   reconciliation-worker.test.ts 9/9 PASS
                                   resolve-service.test.ts 7/7 PASS
                                   handlers.test.ts 5/5 PASS
                                   starknet-ledger-status.test.ts 5/5 PASS (carryover)
                                   poll-worker-divergence.test.ts 14/14 PASS (carryover)
                                   event-reconstruction.test.ts 12/12 PASS (carryover)
```

No `node_modules` reinstall (existing shared modules reused). No secrets committed.

## 11. What This Packet Deliberately Does NOT Claim (Evidence Ceiling)

**Evidence ceiling: X2 — LOCAL BUILD EVIDENCE EARNED, RUNTIME/MAINNET EVIDENCE OPEN**

- No Starknet RPC call was made. No `sncast` profile, no funded deployer, no Sepolia/mainnet transaction was submitted. All ledger/submit/indexer observations are **labelled injected fakes** (`StarknetAccountLike` fake execute, `StarknetEventReader` fake `getEvents`, `FakeOperationStore` doubles). StarknetSubmitAdapter never reads a secret file; Account is injected.
- No `snforge` mainnet fork beyond existing offchain ladder fakes.
- No `strk20.json` was edited.
- No `EVIDENCE_LEDGER.md` / `AUDIT.md` gate movement — `EVD-PRISM-004..007` remain `NOT_IMPLEMENTED / X0` until a live observation is recorded via the yaml template.
- Build gates G0, G4–G8 remain `NOT_IMPLEMENTED`.

## 12. Unimplemented Live Boundaries (Explicit)

These remain open for a follow-on lane with funded network access and owner approval:

1. **Live submit wiring:** production `Account` (from `starknet.js` `Account` + `RpcProvider` + funded controller key from env `STARKNET_PRIVATE_KEY` — never a file path) plus `registryAddress` env-scoped (`SN_SEPOLIA` default per `SD-006`). No file-based secret reads.
2. **Live ledger adapter param:** `StarknetLedgerStatusAdapter` already real (injected `RpcProvider`); needs `STARKNET_RPC_URL` env wiring and a live `getTransactionStatus`/`getTransactionReceipt` trace (replay the worker's `submitted → processing → confirming → confirmed` path).
3. **Live indexer deployment:** `StarknetEventIndexerAdapter` already real (injected `RpcProvider.getEvents`); needs live polling for `PrismIdentityCreated` / `ExecutionIdentityBound` / `BindingRevoked`, continuation-token gap scan, and `(tx_hash,event_index)` dedup against real chain.
4. **Durable event ledger table:** Postgres `prism_events` keyed `(tx_hash, event_index)` with idempotent upsert — domain `event-indexer.ts` is pure; its durable counterpart is not yet implemented.
5. **Resolve serving env wiring:** `WatermarkedResolveService` needs a live `getConfirmedBlock` (via `provider.getBlockLatestAccepted` or ledger adapter) and `staleBoundK` config exposure; current lane uses injected `() => 100` fakes.
6. **Worker process wiring:** `ReconciliationWorker.start()` with `recoverAtStartup` on process boot, exponential backoff/jitter poll interval, `requires_attention` escalation after `requiresAttentionAfterMs` (ERR-022) — domain is complete; process singleton wiring (signal handling, graceful `stop()`, metrics endpoint) not yet.
7. **Network deployment:** `SN_SEPOLIA` contract deploy + evidence envelope (network, address, class hash, deploy tx, block) and V8.5 decisive workflow on `SN_SEPOLIA` + `Base Sepolia` — gates G1–G3 to X3.
8. **Release-gated mainnet:** `SN_MAIN` repeat + hub validator `ok=pool=mine=true` once Prism contracts are declared — out of scope for this lane (INV-PRISM-016 belongs to Phase 5 helper).

---

## 13. File Inventory (Backend-Only, This Bundle)

```
src/features/prism-operations/adapters/starknet-submit.ts              # NEW — F1: injected Account submit adapter (no file reads)
src/features/prism-operations/adapters/starknet-event-indexer.ts       # NEW — F2: injected RpcProvider.getEvents indexer (deterministic ordering, dedup)
src/features/prism-operations/adapters/starknet-ledger-status.ts       # carryover — F3 ledger leg (already real)
src/features/prism-operations/domain/reconciliation-worker.ts          # NEW — F3/F4: worker with startup recovery, retry/backoff, escalation
src/features/prism-operations/domain/resolve-service.ts                # NEW — F5: watermarked resolve (canonical preference, stale refusal)
src/features/prism-operations/domain/recovery.ts                       # carryover — tick engine
src/features/prism-operations/domain/event-indexer.ts                  # carryover — idempotent reconstruction
src/features/prism-operations/domain/ports.ts                          # carryover — transport-neutral Ledger/Index ports
src/application/ports.ts                                               # carryover — RegistryReadPort/StarknetSubmitPort
src/application/prism-application.ts                                   # carryover — operation_id-before-submit, submitted!=completed
src/application/handlers.ts                                            # NEW — F6: transport-neutral handler contracts (8 endpoints)
src/features/prism-operations/__tests__/starknet-submit.test.ts        # NEW — 10 focused tests (unit/contract/failure)
src/features/prism-operations/__tests__/starknet-event-indexer.test.ts # NEW — 10 tests (ordering/idempotency/missed/backoff/failure)
src/features/prism-operations/__tests__/reconciliation-worker.test.ts  # NEW — 9 tests (startup/restart/retry/unknown/reverted/stale/requires_attention)
src/features/prism-operations/__tests__/resolve-service.test.ts        # NEW — 7 tests (canonical, stale refusal, fallback, fallback-stale, watermark)
src/application/__tests__/handlers.test.ts                             # NEW — 5 tests (contract completeness, decisive tail, idempotency, ERR codes)
projects/prism/BACKEND_BUNDLE_2R_REVIEW.md                              # THIS FILE — mapping + gates
```

All other `src/features/prism-operations/**` and `src/application/**` files are WP-4B/WP-5 carryover (operation lifecycle, stores, challenge service) — touched only by re-export, not by logic change. No frontend/Cairo/deployment mutation.

---

## 14. Commit & Verification (To Be Recorded After Green)

**Commit:** pending — will be `feat(prism-runtime): bundle 2R local runtime boundary (submit+indexer+worker+resolve+handlers)` after `npm test + typecheck + build + diff-check` green.

**Governing principle:** Research → Experiment → Build → Evidence. No ledger row moves without observed results.

---

### Appendix: Stable Error Surface (Unchanged)

`ERR-001 invalid_venue`, `ERR-002 identity_not_found`, `ERR-003 invalid_signer`, `ERR-004 not_controller`, `ERR-005 invalid_execution_account`, `ERR-006 nonce_already_used`, `ERR-007 proof_digest_already_consumed`, `ERR-008 binding_already_active`, `ERR-009 binding_not_found`, `ERR-010 identity_not_found_read`, `ERR-011 binding_already_revoked` (benign), `ERR-012 altered_message`, `ERR-013 proof_expired`, `ERR-014 unsupported_signature_class`, `ERR-021 rpc_unavailable`, `ERR-022 timeout_unknown_status`, `ERR-023 stale_state_conflict`/`stale_version`/`idempotency_key_conflict`/`submitted_is_not_completed`.

Every error names retryability and user action; raw stacks never leak (`toExternalShape()` only).

---

### Appendix: Authority Mapping for Reviewers

| Concern | Primary authority | Never authoritative |
|---|---|---|
| Prism ID existence | Starknet `PrismIdentityRegistry` | Backend indexer/cache |
| Controller state | Registry `caller` check | UI session |
| Binding status | Registry | Optimistic UI |
| Base proof validity | Backend verifier ladder (EOA→1271→6492) | Frontend messages |
| Canonical acceptance | Registry transition only | Backend verified flag |
| Resolution | Registry canonical (or indexer under bounded staleness K) | Stale cache ACTIVE |
| Operation UX state | `Operation` workflow + reconciliation | Optimistic UI |

Authority split A4 (verify offchain, accept onchain) **is** `DEC-PRISM-SYS-001` and is now `ACCEPTED (Option A, owner Jason, 2026-08-23)`.

---

*Branch `agent/backend-bundle-2r` — isolated worktree from `5684163`. No frontend, contracts/Cairo, `strk20.json`, deployment, Linear, Notion, credentials, or GitHub push was touched.*

(End of review)
