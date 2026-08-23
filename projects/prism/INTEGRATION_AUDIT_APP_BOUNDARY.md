# Integration Audit — Backend Application/API/Auth Boundary (Lane A)

**Date:** 2026-08-23
**Worktree:** `backend-muse-api` (isolated)
**Baseline:** WP-4B OperationStore/recovery `a9c72e4` / `e62fdcd` + PRISM-7/8 system canonical v0.2
**Scope:** Typed application command/query boundary around existing domain + OperationStore, without frontend/Cairo/deployment coupling.

---

## 0. Exit Contract Traceability

```
CANONICAL_STATE.md v0.1 (PrismID persistent, Starknet root, Base native execution)
  ↓ SYSTEM_CANONICAL.md v0.2 + DOMAIN_MODEL + STATE_MACHINES + INVARIANTS + AUTHORITY_MATRIX + CONTRACT_SPEC + EVENT_CATALOGUE + ERROR_CATALOGUE + TEST_ARCHITECTURE
  ↓ RESEARCH gate (STRK20_CONTEXT.md, DEC-PRISM-SYS-001 Option A, EIP-1271/ERC-6492 ladder)
  ↓ AUDIT.md G0–G8 (G1/G2/G3 decisive proof gates)
  ↓ T1–T12 ladders
  ↓ X maturity (see §7)
```

---

## 1. New Application Boundary — Files

| File | Role | System artifact anchor |
|---|---|---|
| `src/application/auth.ts` | AppSession vs execution authority separation (CON-PRISM-006) | AUTHORITY_MATRIX §3 trust boundary; SYSTEM_CANONICAL §5 DEC-PRISM-SYS-001 |
| `src/application/errors.ts` | Stable ERR catalogue, transport-neutral `httpStatusHint` | `projects/prism/system/errors.yaml` + ERROR_CATALOGUE.md (ERR-001..023) |
| `src/application/schemas.ts` | `AppCommandRequest` / `AppResponse` envelopes, idempotencyKey + expectedVersion headers, payload shapes | CONTRACT_SPEC §3-§4, operations.yaml (CMD-7-01, CMD-B-01/02, QRY-7-01, QRY-8-01); STACK_DECISIONS SD-003 |
| `src/application/ports.ts` | Replaceable ports: `RegistryReadPort`, `StarknetSubmitPort`, `IdGenerator` + re-exported challenge/operation ports | AUTHORITY_MATRIX A1/A6, CONTRACT_SPEC §5, SD-003 ports/adapters |
| `src/application/prism-application.ts` | Orchestrator: `issueChallenge` / `submitProof` / `createIdentity` / `bind` / `revoke` / `getIdentity` / `resolve` / `getOperation` / `retryOperation` / `transitionOperation` — enforces operation_id-before-submit, submitted≠completed, never infers canonical from backend | SM-PRISM-001/002/003, INV-SYS-003/004/005/007, CONTRACT_SPEC §2-§5 |
| `src/application/adapters/in-memory-registry.ts` | In-memory `RegistryReadPort+StarknetSubmitPort` for tests; fail-closed, no fake completion | AUTHORITY_MATRIX §4 reconciliation rules, INV-SYS-005 |
| `src/features/prism-operations/adapters/memory-operation-store.ts` | In-memory `OperationStore` with CAS + idempotencyKey dedup (reference impl; Postgres adapter remains production) | `domain/operation-store.ts` port, INV-SYS-010, TEST_ARCHITECTURE T7 |
| `src/application/__tests__/app-boundary.test.ts` | 12 contract/API tests covering 9 required failure modes (see §4) | TEST_ARCHITECTURE T6/T8/T11/T12, AUDIT FT-001..004 |

**No frontend files, Cairo, `strk20.json`, deployment or Linear/Notion credentials touched.**
**No live chain receipt faked; `InMemoryRegistry` never marks bindings as completed synchronously.**

---

## 2. Command / Query Mapping → System Artifacts

| App boundary operation | System operation | Domain object | State machine | Authority | Replaces |
|---|---|---|---|---|---|
| `issueChallenge` | `CMD-B-01 IssueChallenge` (`operations.yaml`) | `OBJ-PRISM-005 OwnershipProof` (ISSUED) | SM-PRISM-001 `→ ISSUED` | Backend verifier issues challenge (A4, PROPOSED via DEC-PRISM-SYS-001) | Product Foundry: Base proof-of-control (ASSUMPTIONS.md ASM-PRISM-005) |
| `submitProof` | `CMD-B-02 SubmitProof` | `OBJ-PRISM-005` (`ISSUED → VERIFIED/REJECTED/EXPIRED`) | SM-PRISM-001 ladder EOA→1271→6492 | Backend verifier ladder (A4) + `consumeNonce` CAS (INV-SYS-010) | — |
| `createIdentity` | `CMD-7-01 CreateIdentity` wrapper → `OP-7-01 create_identity` | `OBJ-PRISM-001 PrismIdentity` | SM-PRISM-003 `created→awaiting_authorization→ready→submitted` | Registry `create_identity` (A1), submitPort is relayer only; operation row authoritative WORKFLOW | CANONICAL_STATE §10 create P |
| `bind` | `OP-8-01 bind_execution_identity` (`CMD-8-01`) | `OBJ-PRISM-003 Binding` (`null→ACTIVE`) | SM-PRISM-002 `TR-8-01` ; SM-PRISM-003 chain-touching wrapper | Registry caller==controller (A2) + digest single-use (A4/A5, INV-SYS-004) | CANONICAL_STATE bind B to P |
| `revoke` | `OP-8-03 revoke_binding` (`CMD-8-02`) | `OBJ-PRISM-003` (`ACTIVE→REVOKED`) | SM-PRISM-002 `TR-8-02` | Registry caller==controller (A2) | CANONICAL_STATE revoke B |
| `getIdentity` | `QRY-7-01 GetIdentity` (`OP-7-02 get_identity`) | `OBJ-PRISM-001` read | — | Registry canonical (A1) | — |
| `resolve` | `QRY-8-01 ResolveDestination` (`OP-8-02 resolve`) | `OBJ-PRISM-003` projection | — | Registry canonical or indexer under bounded staleness (A6, INV-SYS-007) | CANONICAL_STATE resolve(P,BASE)=B / NO_ACTIVE |
| `getOperation` | SM-PRISM-003 operation read | `Operation` WORKFLOW | SM-PRISM-003 | Backend op row (AUTHORITY_MATRIX A8) | — |
| `retryOperation` / `transitionOperation` | SM-PRISM-003 `failed_retryable → ready → submitted` etc. | `Operation` | SM-PRISM-003 | Backend op row | TEST_ARCHITECTURE T12 recovery |

**Transport neutrality:** `AppCommandRequest<T>` / `AppResponse<T>` carry `requestId / idempotencyKey / expectedVersion / correlationId` in headers, not in HTTP path/query. Adapters map `httpStatusHint` to any transport (HTTP 400/401/403/404/409/410/503 etc.) without domain coupling (SD-003).

**Auth separation (CON-PRISM-006):** `AppSession` (`sessionId/userId/issuedAt/expiresAt`) is validated by `assertValidAppSession`; Starknet `controllerAddress` and Base `proofDigest` are validated via `RegistryReadPort` + challenge store, never derived from session. A session cannot authorize a bind; a proof cannot authenticate a product session.

**Idempotency + CAS at boundary:** `OperationStore.create(idempotencyKey, requestFingerprint)` — same key + same fingerprint → benign return of existing row; same key + different fingerprint → `ERR-023 idempotency_key_conflict` (SYSTEM_FOUNDRY §18). `transition(expectedVersion)` — stale writer → `ERR-023 stale_version`. Both surfaced before any chain submission.

**Persist-before-submit:** `createIdentity/bind/revoke` create the `PersistedOperation` row first, return `operationId` in both success and dependency-failure paths, then attempt `submitPort.*` . A `submitPort` throw is mapped to `ERR-021 rpc_unavailable` and the row is moved to `failed_retryable`; it is never marked `completed`.

**Submitted ≠ completed:** enforced by `domain/operation.ts` (`submitted_is_not_completed` guard) and `ports.decideReconciliationStep`; the application layer double-guards and the test `submitted is never completed without reconciliation` asserts `ERR-023` on `submitted→completed` skip (INV-SYS-005 / INV-PRISM-015). Registry mutations are applied only via test helpers `applyBindForTest` simulating reconciliation, never inside `submit*`.

**Never infer canonical identity:** `resolve` and `getIdentity` always call `RegistryReadPort.getIdentity/resolve`; they never read from `OperationStore` or cache alone (INV-SYS-007). `BindingRevoked` flips resolve to `NO_ACTIVE_DESTINATION` while identity projection is preserved (INV-SYS-006).

---

## 3. Error Catalogue Mapping (stable ERR codes)

| Code | Name | App boundary surfacing | System source | HTTP hint |
|---|---|---|---|---|
| ERR-001 | invalid_venue | `issueChallenge`/`bind`/`resolve` venue enum check | ERROR_CATALOGUE, INV-SYS-011, operations.yaml | 422 |
| ERR-002 | identity_not_found | `bind`/`revoke` identity missing | ERR-002, OP-8-01/03 | 404 |
| ERR-003 | invalid_signer | `submitProof` ladder invalid/wrong account (FT-002) | ERR-003, TEST-8-2-5 | 401 |
| ERR-004 | not_controller | `bind`/`revoke` controller ≠ identity.controller (INV-SYS-002) | ERR-004 | 403 |
| ERR-005 | invalid_execution_account | `issueChallenge`/`bind`/`revoke` Base address form | ERR-005 | 422 |
| ERR-006 | nonce_already_used | `submitProof` second consume of same nonce (INV-SYS-010, FT-003 service layer) | ERR-006 | 409 |
| ERR-007 | proof_digest_already_consumed | `bind` digest already in `consumedDigests` (INV-SYS-004) | ERR-007 | 409 |
| ERR-008 | binding_already_active | `bind` duplicate ACTIVE same-key | ERR-008 | 409 |
| ERR-009 | binding_not_found | `revoke` target missing | ERR-009 | 404 |
| ERR-010 | identity_not_found_read | `getIdentity`/`resolve` on unknown PrismId (view flag) | ERR-010 | 404 |
| ERR-011 | binding_already_revoked | `revoke` on already REVOKED (benign 200-with-state) | ERR-011 | 200 |
| ERR-012 | altered_message | `submitProof` presented fields ≠ stored (INV-SYS-011, TEST-8-2-4) | ERR-012 | 400 |
| ERR-013 | proof_expired | `submitProof` TTL exceeded pre-verify + expired `AppSession` (reuse of stale-state code for auth expiry) | ERR-013 | 410 |
| ERR-014 | unsupported_signature_class | `submitProof` unclassified signature | ERR-014 | 422 |
| ERR-021 | rpc_unavailable | `submitPort` dependency throw, fixer clock unavailable, checker undetermined | ERR-021 | 503 |
| ERR-022 | timeout_unknown_status | Operation `requires_attention` branch (not exercised via app submit path; via `transition`) | ERR-022 | 202 |
| ERR-023 | stale_state_conflict | `stale_version`, `idempotency_key_conflict`, illegal transition, `submitted_is_not_completed`, bad `txHash`, unknown operation | ERR-023 | 409 |

Every cause gets a distinct code (`A8-9`); raw stacks never leak; `AppError.toExternalShape()` / `AppResponse.error` is the only external form.

---

## 4. Test Coverage → Gates & Notion SC Rows

| Test (src/application/__tests__/app-boundary.test.ts) | System gate / artifact | Notion SC row (proposed) | Expectation |
|---|---|---|---|
| success: issue→verify→bind→resolve→revoke→resolve NO_ACTIVE + P persists | CANONICAL_STATE §10 decisive proof; SM-PRISM-001/002/003; INV-SYS-002/003/004/006/007; CONTRACT_SPEC OP-7-01/8-01/8-02/8-03; TEST_ARCHITECTURE T11 | SC-001 Create Prism ID <br> SC-002 Prove Base control <br> SC-003 Bind execution identity <br> SC-004 Resolve active <br> SC-005 Revoke binding <br> SC-006 Resolve revoked → empty + identity persists | `bind.state==submitted` (not completed), `resolve==B`, after revoke `resolve==null`, `getIdentity.exists==true` |
| altered proof → ERR-012 | INV-SYS-011, TEST-8-2-4 (mutation matrix), ERR-012 | SC-007 Challenge tamper-evidence | `code ERR-012, http 400` |
| expiry → ERR-013 | INV-SYS-010, TEST-8-1-3, SM-PRISM-001 EXPIRED, ERR-013 | SC-008 Challenge expiry | `code ERR-013, http 410` |
| wrong controller → ERR-004 | INV-SYS-002, TEST-8-3-2 / FT-002, ERR-004, A2 | SC-009 Controller-only mutation | `code ERR-004, http 403` |
| replay submitProof → ERR-006 | INV-SYS-010, TEST-8-1-2, ERR-006, FT-003 (service) | SC-010 Nonce single-use | `code ERR-006, http 409` |
| replay digest → ERR-007 | INV-SYS-004, TEST-8-3-3, ERR-007, FT-003 (onchain) | SC-011 Digest single-use | `code ERR-007, http 409` |
| stale version → ERR-023 `stale_version` | SYSTEM_FOUNDRY §18 stale-conflict, INV-SYS-010 CAS, ERR-023 | SC-012 Optimistic CAS | `detail stale_version` |
| idempotency conflict → ERR-023 `idempotency_key_conflict` + benign replay | CONTRACT_SPEC §5 idempotency, ERR-023, T8 API contract | SC-013 Idempotency key semantics | conflict on same key+diff fingerprint, benign on same fingerprint |
| dependency failure → ERR-021, fail-closed, no completed | INV-SYS-005, AUTHORITY_MATRIX §5, ERR-021, T12 failure/recovery | SC-014 Dependency failure handling | `code ERR-021, http 503`, `state==failed_retryable` not completed |
| retry → failed_retryable→ready→submitted | SM-PRISM-003 retry branch, T12 | SC-015 Retry semantics | `state==submitted` after retry, still not completed |
| auth separation expired session → ERR-013 | CON-PRISM-006, DEC-PRISM-SYS-001 trust split, A4 note | SC-016 App auth vs execution authority | session expiry independent of wallet proof |
| submitted is never completed skip → ERR-023 | INV-SYS-005 / INV-PRISM-015 | SC-017 Submitted≠Completed invariant | illegal skip rejected |

Additional in-repo suites (unchanged, still green at X2):
- `src/features/prism-operations/__tests__/operation-lifecycle.test.ts` — SM-PRISM-003 happy path, failure branches, illegal skips, idempotent same-state, stale version (T2/T4)
- `src/features/prism-identity/__tests__/issue-challenge.test.ts` / `submit-proof-*.test.ts` / `mutation-matrix.test.ts` / `replay-expiry-concurrency.test.ts` — challenge service (T1/T2/T6)
- `src/features/prism-operations/__tests__/postgres-operation-store.test.ts` + `recovery-policy.test.ts` — OperationStore SQL contract + recovery policy (T6/T12, X2)

---

## 5. What Was NOT Built / NOT Evidenced

- No HTTP routes invented (repo has no transport convention). Transport-neutral ports + `httpStatusHint` are the contract; any HTTP adapter is a thin mapper outside domain.
- No Cairo contract edits, deployment, `strk20.json` writes, or STRK20 pool interaction — `InMemoryRegistry` simulates only registry reads/writes for X2.
- No frontend coupling; `src/features/landing` / `wallet` untouched beyond shared domain.
- No live Base EIP-1271 / ERC-6492 RPC trace — `LocalErc1271SemanticsChecker` remains a deterministic TEST DOUBLE (T7 live-corpus still NOT_EVIDENCED).
- No durable Postgres `OperationStore` exercised in this lane (WP-4B Postgres adapter exists but app tests use `InMemoryOperationStore` for speed; gated Postgres integration tier remains separate).
- No `get-starknet` / wallet-standard execution; STRK20 private flows remain out of scope for this backend boundary.

---

## 6. Gate Mapping (AUDIT.md G0–G8)

| Gate | Status after this lane | Evidence |
|---|---|---|
| G0 Mainnet pool reachability | NOT_IMPLEMENTED | unchanged — no mainnet tx |
| G1 PrismIdentityRegistry | NOT_IMPLEMENTED (code exists at X2, no deploy) | unchanged |
| G2 Base ownership proof + binding | **X2 — application boundary closable** (offchain ladder + operation wrapper), NOT X3 (no live Base/RPC trace) | new: `app-boundary.test.ts` 12 passed |
| G3 Resolution + revocation | **X2 — resolver honesty & revoke idempotence via application `resolve`/`revoke`** (in-memory, not live indexer) | new: decisive tail via app service (X2) |
| G4 Unified Home | NOT_IMPLEMENTED | unchanged |
| G5 STRK20 wallet product path | NOT_IMPLEMENTED | unchanged |
| G6 Prism-owned private app action | NOT_IMPLEMENTED | unchanged |
| G7 Final evidence set (≥3 hashes pool+mine) | NOT_IMPLEMENTED | unchanged |
| G8 Release | NOT_IMPLEMENTED | unchanged, no secrets committed |

Product/Evidence ledger rows `EVD-PRISM-004..007` remain X0 (no live network observation); new tests are X2 local-controlled and do not advance ledger maturity.

---

## 7. X Maturity

```
X0 hypothesis          — all decisive runtime claims remain X0
X1 fixture/mock        — challenge fixtures, registry test double
X2 local controlled    — ✅ this lane: PrismApplicationService + InMemory stores + 12 tests pass locally
  typecheck            — PASS (see §8)
  next build           — PASS (see §8)
  vitest (all)         — PASS (see §8)
  operation lifecycle  — PASS (SM-PRISM-003 pure domain)
  challenge service    — PASS (EOA/1271/6492 ladder via test double)
X3 realistic/testnet   — NOT_EVIDENCED (no SN_SEPOLIA / Base Sepolia trace)
X4 repeated/reproduced — NOT_EVIDENCED
X5 mainnet/production  — NOT_EVIDENCED
```

---

## 8. Verification Performed This Session

```
npm test (vitest run)             — 8 files? now 9 files, 12 new tests pass in lane A
npx tsc --noEmit (typecheck)      — PASS (0 errors)
npm run build (next build)        — PASS (existing landing/wallet build unaffected)
git diff --check                  — (no whitespace errors observed)
focused lane tests                — src/application/__tests__/app-boundary.test.ts 12/12 PASS
                                  — src/features/prism-operations  X2 suites still PASS
                                  — src/features/prism-identity    X2 suites still PASS
```

Maturity rule: local pass = X2; deployed + observed = X3+; mainnet + independent re-read = X4/X5. No ledger row moves without observed results.

---

## 9. Blockers & Next Steps

1. **DEC-PRISM-SYS-001 Option A** is accepted (per `DECISIONS.md` / `SYSTEM_CANONICAL.md` v0.2) — no longer blocking; lane A honors controller-signed bind + backend-verifier trust.
2. **Live Base ladder corpus** (EIP-1271 deployed wallet + ERC-6492 undeployed wrapper against real RPC) — still NOT_EVIDENCED; needed for X3/T7.
3. **Durable Postgres OperationStore wired to application boundary** — `PostgresOperationStore` exists (WP-4B) but app wiring in production config (env `PRISM_POSTGRES_URL`, migration, TTL sweeper) is not yet exercised in lane A (T7/T12 integration tier gated).
4. **Registry deployment to SN_SEPOLIA** + live `create/read/bind/resolve/revoke` observation (EVD-PRISM-004..007 → X3) — requires `snfoundry.toml` profile + funded deployer account (no secrets committed).
5. **Indexer / watermark serving** (QRY-8-01 bounded staleness) — `InMemoryRegistry` is a test double; production indexer + `reconciliation` worker (SM-PRISM-003 `indexed→reconciled→completed`) not yet wired.
6. **Notion SC row creation** — SC-001..017 proposed above; owner must create/confirm rows in Notion and link this audit commit.
7. **Transport adapter** (typed HTTP/gRPC mapper) — out of scope for this isolated lane by spec; when added, it must delegate to `PrismApplicationService` and map `AppError.httpStatusHint` only.

---
