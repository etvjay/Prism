# BACKEND_PHASE_M4_REVIEW — Prism STRK20 Consumer Wallet API Route (M4)

> **Historical snapshot:** the current wallet/proof boundary, authoritative WalletAccountV6 call shapes, receipt-backed terminal guards, and current maturity ceiling are recorded in [`BACKEND_PHASE_M4_WALLET_PROOF_CLOSEOUT.md`](./BACKEND_PHASE_M4_WALLET_PROOF_CLOSEOUT.md).

**Lane:** M4 · Muse Spark 1.2 free · /home/ubuntu/prism-work/phase-m4-strk20 @ 7a385d2
**Date:** 2026-08-24 UTC
**Scope:** backend/domain Wallet API route only — `src/features/prism-strk20/**`, injected wallet/provider adapters, tests, schemas, review docs. No frontend/Phase 8, no `WalletConnectionPanel` mutation (type-only compat not needed), no REST/SDK, no Pause internals, no contracts, no PrismChannel, no `strk20.json`, no Linear/Notion, no credentials, no GitHub push.
**Model policy:** no ChatGPT; injected X2 doubles only; no live private transaction.

---

## 1. Mandate and Phase Boundary

Implement a provider-injected, privacy-safe STRK20 consumer route:

1. capability detection via `supportedWalletApi` / `supportedSpecs` only;
2. registration, approve→shield/deposit, screening, maturity, private balance consent, private transfer, fee read, receipt state contracts;
3. explicit 12-state machine: `capability_unknown, mismatch, registration_required, approval_pending, shielding, confirmed, maturing, privately_available, transfer_pending, transfer_confirmed, rejected, dependency_failure`;
4. never request/store/log viewing keys or private keys;
5. Wallet API boundary for normal dapp flow; direct SDK out of consumer path;
6. tests for consent, network mismatch, maturity, fee change, screening rejection, relayer sender non-attribution, stale/pending states, privacy overclaim refusal.

No live private transaction. All external I/O via injected wallet doubles labeled **X2**.

Phase per `PRISM_PHASE_CONVERGENCE_CONTRACT.md`: **M4 STRK20 consumer Wallet API route** (M0–M7 delegated; Phase 8 frontend/Home is owner-led and untouched).

---

## 2. Canonical Inputs Inspected

| Artifact | Version / Commit | What was used |
|---|---|---|
| `docs/STRK20_CONTEXT.md` | 2026-08-20 | Wallet API route `get-starknet 6.0.3 → starknet.js 10.4.0 / WalletAccountV6 → Privacy Wallet API v0.10.3 → STRK20 pool 0x04037…812a`; capability via `supportedWalletApi/supportedSpecs`; deposit is two txs; maturity ~10 blocks; fees via `get_fee_amount`; relayer sender not attribution; address normalization; screening; composition leakage |
| `profiles/STRK20_PRIVACY_PROFILE.md` | 2026-08-20 | Golden key boundary (never viewing key); registration via wallet; shield/transfer/open-note truth tables; composition leakage; fee/max; relayers; `privacy_invoke` excluded |
| `STRK20_INTEGRATION_PLAN.md` | v0.1 2026-08-20 | Phase 1–8 plan; Phase 2–3 wallet/privacy slices; fee/maturity/screening constraints |
| `.agents/skills/strk20-privacy-integration/references/wallet-api-route.md` | verified 2026-07-13 | `supportedWalletApi >=0.10` detection; never probe `strk20Balances([])`; two-tx shield; maturity; fee via `get_fee_amount`; screening rejection distinct state; relayer `sender`≠user |
| `.agents/skills/strk20-privacy-integration/references/concepts.md` | 2026-07 | Hidden vs visible table; open notes; composition leaks; golden rule; screening mandatory wording; least privilege |
| `projects/prism/agent-packets/PRISM_PHASE_CONVERGENCE_CONTRACT.md` | 2026-08-23 | Shared equation, boundaries, 13 required report sections, `strk20.json` stays empty |
| `projects/prism/system/SYSTEM_CANONICAL.md` | v0.2 | Product handoff, DEC-PRISM-SYS-001 accepted, scope PRISM-7/8 |
| `projects/prism/system/STATE_MACHINES.md` | v0.1 | SM-PRISM-003 pattern (reused for lifecycle rigor) |
| `projects/prism/system/INVARIANTS.md` | v0.1 | INV-SYS-005 submitted≠completed, INV-SYS-008 no viewing keys, INV-PRISM-011/014 privacy honesty |
| `projects/prism/system/AUTHORITY_MATRIX.md` | v0.1 | Authority per behavior, trust boundaries, must_not_know viewing keys |
| `projects/prism/system/TEST_ARCHITECTURE.md` | v0.1 | T10/T11/T12 ladder mapping |
| `projects/prism/AUDIT.md` | 2026-08-20 | G4/G5, FT-005/007, hub validator, screening/fee/relayer truth |
| `projects/prism/EVIDENCE_LEDGER.md` | v0.2 | X scale, EVD-STRK20-002/003 gates |
| `src/features/wallet/walletState.ts` + `WalletConnectionPanel.tsx` | HEAD | Existing capability helper `supportsStrk20` (+ walletApi), environment classifier, panel already does `supportedWalletApi`/`supportedSpecs` without balances — preserved, not mutated |
| Convergence diff | `7a385d2` base | `node_modules` untracked only; no frontend/contract/`strk20.json` touch |

No `starknet-privacy` SDK imported in consumer path (verified `grep sdk` clean).

---

## 3. Product Truth Preserved

- **Prism ID persists** (`INV-PRISM-001/002`) — untouched; M4 is financial surface, not identity primitive.
- **Starknet is canonical root** (`DEC-PRISM-001`) — chainId / environment is Wallet API-observed, mismatch handled as explicit `mismatch` state that blocks readiness, per `PHASE_01_WALLET_CAPABILITY.md` already pass.
- **Venue separation** (`DEC-PRISM-004`) — Base remains public; STRK20 privacy is Starknet-only (`STRK20_PRIVACY_PROFILE`).
- **Privacy honesty** (`DEC-PRISM-013`, `INV-PRISM-011/014`) — shield truth (public depositor/token/amount/timing), transfer truth (sender/recipient/amount hidden), open-note note, `privacy_invoke` not claimed; copy guard enforces `references/concepts.md` allowed vs forbidden phrasing.
- **No private Base** — no claim added.
- **Least privilege** — capability never reads balances; private balance is explicit consent feature (`DEC-PRISM-018`).
- **Whole-product phases respected** — Phase 8 frontend/Home not touched.

Product Foundry QA: **PASS** — no product invariant mutated; one decisive flow (shield→maturing→private→transfer) made explicit without redefining identity.

---

## 4. Research Foundry Sources, Freshness, and Claim Limits

| Claim | Source | Freshness | Limit disclosed |
|---|---|---|---|
| Wallet API route `6.0.3/10.4.0/0.10.3` is current stable consumer path | `STRK20_CONTEXT`, skill `wallet-api-route.md` verified 2026-07-13, `package.json` pins | 2026-08-20 refresh in plan; pins re-verify per `STRK20_CONTEXT` rule — freshness noted | Pins are deliberate; `next` tag now `10.7.0` but not auto-adopted |
| Capability via `supportedWalletApi/supportedSpecs >=0.10.3` | `STRK20_CONTEXT`, `WalletConnectionPanel.tsx:101-105` live impl | PASS source-level | Does not prove live wallet answers; X2 only |
| Deposit is two txs (approve+shield) | `STRK20_CONTEXT`, `wallet-api-route.md` gotcha, `STRK20_PRIVACY_PROFILE` | PASS | UX must label both steps |
| Maturity ~10 blocks | `STRK20_CONTEXT`, `concepts.md`, `INTEGRATION_PLAN.md §5` | Approximate heuristic, not constant — enforced as `MATURITY_BLOCKS=10` guard, not hard fork rule | Treatment flagged per `RESEARCH_BACKEND_GATE` A4/C11 |
| Fees via `get_fee_amount` | `STRK20_CONTEXT`, `wallet-api-route.md` | Fee was 4 STRK at writing; read live — `fee-policy.ts` implements `assertFeeUnchanged` & `computeMaxSpendable` | Never hard-coded; change is blocking error |
| Relayer sender ≠ user | `concepts.md` + `STRK20_CONTEXT` | PASS | Attribution must use pool `Deposit` first key |
| Screening onchain, not bypassed | `concepts.md` screening, `INTEGRATION_PLAN` | From v0.14.3 onchain | `rejected` vs `dependency_failure` distinct |
| Shadow accounts wallet-API unavailable | `STRK20_CONTEXT` + `STRK20_PRIVACY_PROFILE` | 0.14.3-RC.5 SDK rename noted; wallet route not exposed — excluded from MVP | Not a claim SDK absent |

Research Foundry verdict: **PASS_WITH_LIMITATIONS** — source-level X2; live wallet/pool re-check required before X3.

---

## 5. System Foundry Authority / State / Error / Invariant Mapping

### Authority & Trust Boundary (per `AUTHORITY_MATRIX.md` + `STRK20_PRIVACY_PROFILE`)

| Behavior | Primary authority | Consumer implementation | Never authoritative |
|---|---|---|---|
| STRK20 capability | Wallet `supportedWalletApi`/`supportedSpecs` | `domain/wallet-capability.ts:supportsStrk20` pure; `adapters/injected-wallet.ts:observeCapability()` | Balance read (`strk20Balances`) — forbidden for detection; guard test asserts `calls.balances==0` |
| Network/environment | Starknet chainId via wallet (`requestChainId`) | `classifyWalletEnvironment` + `mismatch` state | Frontend cache |
| Registration | Privacy wallet (owns viewing key/notes/proving) | `isRegistered()` port; Prism only checks `registration_required` state | Prism app storing viewing key — `VIEWING_KEY_FORBIDDEN` guard |
| Fee truth | Pool `get_fee_amount` | `ports.PoolFeeReader` + `fee-policy.ts` live-read, no hard-code | Hard-coded history |
| Private balance | Wallet consent-gated `strk20Balances(tokens)` | `requestPrivateBalances({requireConsent:true})` + `maturing→privately_available` consent gate | Viewing key in app |
| Screening | Pool protocol | `screening: rejected/unavailable` distinct; `rejected` maps to `STRK20-006`, `unavailable` to `STRK20-007`/`013` | Self-hosted prover bypass |
| Activity attribution | STRK20 pool `Deposit` first key | `receipt.ts:buildShieldReceipt()` ignores `sender` | `transaction.sender` (relayer) — `STRK20-017` |

Trust map: `backend_service` `must_not_know: [viewing keys]` enforced by `assertNoViewingKey` on every adapter entry + state transition; `starknet_sequencer` ordering is pool finality; `user_controller` is wallet signer.

### State Machines

**New SM-PRISM-M4** (backend-only, not yet in project `state-machines.yaml` — proposed extension, D2+ draft, no canon mutation):

```
capability_unknown ─┬─ mismatch ←→ capability_unknown (retry)
                    ├─ registration_required → approval_pending → shielding (txHash required)
                    │                                              ├─ confirmed (block) → maturing → privately_available (≥10 blocks + consent granted)
                    │                                              │                                    └─ transfer_pending (txHash) → transfer_confirmed
                    │                                              └─ rejected (screening_rejected, reason required) ── terminal
                    └─ dependency_failure ─┬─ capability_unknown / retry branches (allowed)
                                           └─ terminal? no — retryable
rejected, transfer_confirmed are terminal; mismatch & dependency_failure are failure/pending; all illegal jumps throw STRK20-012.
```

Invariants enforced: `shielding/confirmed/maturing/transfer_pending` are not `completed` (INV-SYS-005 analogue); `maturing→privately_available` blocked until `currentBlock >= confirmedBlock+10`; consent `denied` blocks; fee change blocks `shielding`/`transfer_pending`; `rejected` requires reason; `stale_version` on `expectedVersion`.

Corresponds to `INTEGRATION_PLAN.md:189-194` maturing UX and `AUDIT.md §8` lifecycle.

### Errors (stable, per `ERROR_CATALOGUE` pattern)

| Code | Name | Trigger | Retry | HTTP | Tested |
|---|---|---|---|---|---|
| STRK20-001 | capability_unknown | detection not yet run | re_read | 409 | X2 state machine |
| STRK20-002 | network_mismatch | `chainId != expected` | no | 409 | mismatch test + integration |
| STRK20-003 | registration_required | `isRegistered()==false` | no | 409 | registration_required state |
| STRK20-004/005 | consent_required/denied | balances without/denied consent | no | 403 | consent tests (2) |
| STRK20-006 | screening_rejected | pool screening rejected | no | 422 | shielding→rejected + adapter throw distinct from 013 |
| STRK20-007 | screening_unavailable | screening service down | backoff | 503 | adapter throw |
| STRK20-008 | fee_changed | quoted ≠ observed | re_quote | 409 | fee guard |
| STRK20-009 | fee_unavailable | fee read null/negative | backoff | 503 | fee policy |
| STRK20-010 | maturity_pending | <10 blocks | poll | 202 | maturing guard |
| STRK20-011 | stale_state | version mismatch | re_read | 409 | stale test |
| STRK20-012 | illegal_transition | disallowed edge | no | 409 | illegal test |
| STRK20-013 | dependency_failure | RPC/pool down | backoff | 503 | dependency_failure state |
| STRK20-014 | privacy_overclaim | forbidden copy | no | 422 | overclaim refusal |
| STRK20-015 | viewing_key_forbidden | payload has viewingKey | no | 400 | guard |
| STRK20-017 | relayer_attribution_forbidden | sender used as identity | no | 422 | receipt test |

Raw stacks never leak; `Strk20Error.toExternalShape()` is stable.

### Invariants New/Referenced

- `INV-PRISM-011` application never requests/persists viewing key — enforced by `assertNoViewingKey` on every port boundary + `VIEWING_KEY_FORBIDDEN`.
- `INV-PRISM-014` no privacy property beyond mechanism — enforced by `assertPrivacyCopy` + `SHIELD_TRUTH`/`PRIVATE_TRANSFER_TRUTH` + receipt honesty `assertReceiptPrivacyHonesty`.
- `INV-SYS-005` submitted≠completed analogue — `shielding/maturing/transfer_pending` cannot become `transfer_confirmed` early; transitions table excludes skip.
- `INV-SYS-008` registry minimalism analogue — no viewing keys/balances stored in Prism domain (`Strk20Flow` has only hashes/blocks/fees/consent, no keys).
- Collection leakage — `concepts.md` bundling warning documented in `receipt` note; recommended flow is `shield → maturity → transfer` not bundling.

### Persistence / Reconciliation / Observability (M4 slice)

Persistence: `Strk20Flow` is **WORKFLOW** (not ledger index). Fields classified: `WORKFLOW` (state, version, tx hashes, blocks, fees, screening, consent) vs `DERIVED` (maturity target). No PII; no viewing keys. Stored via `MemoryStrk20Store` X2 double; production choice deferred (not Prisma/PG in this slice — intentional to avoid D3).

Reconciliation: divergence assumption — `maturity` lag (wait `K=10`), `fee_changed` (re-quote), `dependency_failure` (bounded backoff, not implemented as timer here — state only), `rejected` vs `unavailable` separate.

Observability: `flow.id → version → txHash → block → receipt.poolEventFound → attributedDepositor` chain via `receipt.ts`; `screening` and `errorCode` are audit fields.

System Foundry QA: **PASS** — authority/state/error/invariant aligned; no D4/D5 drift; SDK out of consumer path verified by absence of `starknet-privacy` import.

---

## 6. Implementation / Files / Commit

**Allowed area only:** `src/features/prism-strk20/**` (new), injected wallet/provider adapters, tests, schemas, review docs. No frontend/Phase 8, no `WalletConnectionPanel` mutation, no contracts, no `strk20.json` edit.

```
src/features/prism-strk20/
  domain/
    errors.ts              # stable catalogue STRK20-001..017, never raw stack
    wallet-capability.ts   # pure supportsStrk20 + detectCapability (least-privilege)
    privacy-guard.ts       # assertNoViewingKey, assertPrivacyCopy, truth tables, allow/deny phrases
    fee-policy.ts          # live-read guard, MAX reserve, fee-change detection
    receipt.ts             # Shield/transfer receipts, relayer non-attribution, honesty guards, pool 0x0403…812a
    ports.ts               # Strk20WalletPort (narrow Wallet API boundary), PoolFeeReader, ForbiddenSdkPort sentinel
    strk20-state.ts        # 12-state pure machine, MATURITY_BLOCKS=10, guards for maturity/consent/fee/screening/stale
    index.ts               # domain barrel (type-safe re-export to avoid WalletEnvironment clash)
  adapters/
    injected-wallet.ts     # InjectedWalletStrk20Adapter (provider-injected, X2), asserts no viewing keys, screening distinct, consent explicit
    memory-store.ts        # MemoryStrk20Store X2 double
  __tests__/
    wallet-capability.test.ts        # 6 tests — capability via versions only, mismatch, UNKNOWN
    strk20-state.test.ts             # 14 tests — 12 states, happy path, maturity, consent, rejected, fee, stale, illegal, idempotent, retry
    privacy-guard.test.ts            # 8 tests — viewingKey forbidden, overclaim rejected, honest copy
    fee-policy.test.ts               # 4 tests — MAX, fee change, decide
    receipt.test.ts                  # 5 tests — relayer ignored, honesty, forbidden attribution
    strk20-flow-integration.test.ts  # 12 tests — injected X2 doubles: consent not calling balances, mismatch, maturity, fee change, screening rejected vs unavailable, relayer, stale/pending, overclaim, viewingKey, SDK-out
```

Lines: ~1.1k domain+adapters, ~0.8k tests. All doubles labeled `X2 — TEST DOUBLE` in describe.

**Not touched:** `src/features/wallet/WalletConnectionPanel.tsx` (read as reference; no edit), `src/features/prism-operations/**`, `contracts/**`, `ops/**`, `src/app/**`, `strk20.json` (`{"transactions":[],"contracts":[]}` intact), `.env`, `LINEAR`/`Notion`.

**Commit:** pending `feat(prism-strk20): M4 provider-injected Wallet API consumer route (X2)` on `7a385d2` base. `git status --short` shows only `?? src/features/prism-strk20/` + `?? node_modules` (reused). `git diff --check` clean.

Schemas: `ports.ts` types are schema (Hex ``0x${string}``, ScreeningOutcome, PrivateBalanceObservation with `consent` discriminant) plus runtime guards (`assertNoViewingKey`, `assertPrivacyCopy`, `assertFeeUnchanged`, `assertReceiptPrivacyHonesty`). No external `zod` import justified (Sprint hygiene `SD-007`).

---

## 7. Tests and Exact Commands

**M4 focused tests (X2, no live RPC, no private tx):**

| Suite | Count | What it proves |
|---|---|---|
| `wallet-capability.test.ts` | 6 | supportsStrk20 via `apiVersions/specs >=0.10.3` only; mismatch; UNKNOWN; no balance read |
| `strk20-state.test.ts` | 14 | 12 states, happy path, maturity 10-block guard, consent gate `required/denied/granted`, `rejected` reason, fee-change block, stale_version, illegal_transition, `dependency_failure` recovery, idempotent same-state |
| `privacy-guard.test.ts` | 8 | `viewingKey/privateKey/seedPhrase` forbidden (field+pattern+recurse), overclaim phrases rejected (`completely invisible`, `zero metadata` etc.), honest phrases allowed, truth tables |
| `fee-policy.test.ts` | 4 | `computeMaxSpendable` reserves fee, `assertAmountWithFee`, `assertFeeUnchanged`/`decideFeeAction` |
| `receipt.test.ts` | 5 | `buildShieldReceipt` pool-address check & first-key attribution, `senderIgnored` preserved, private-transfer hidden fields, honesty, `assertNotSenderAttribution` |
| `strk20-flow-integration.test.ts` | 12 | **consent** (no `balances` on `observeCapability`, `denied/required` throw), **network mismatch** (`mismatch` state), **maturity** (205 vs 210), **fee change** (4n→5n blocked), **screening rejection** (`STRK20-006` vs `STRK20-013`), relayer non-attribution, stale/pending, privacy overclaim refusal, viewing-key forbidden, SDK-out |

**Full suite (this worktree, X2 fakes only):**

```
$ npm test
  Test Files  31 passed | 2 skipped (33)
       Tests  341 passed | 14 skipped (355)
  Duration  ~53s
```

Integration tests gated on `PRISM_POSTGRES_TEST_URL` skipped honestly (14) — never fabricated.

**Exact verification performed this session (offline, X2):**

```
npm test               — 31 passed | 2 skipped (33) | 341 passed | 14 skipped | 53s  — PASS
npx tsc --noEmit       — PASS (0 errors, 22s) — typecheck  — PASS
npm run build          — PASS (Compiled 43s + TypeScript 22s, routes / and /_not-found) — PASS
git diff --check       — clean — PASS
focused M4 lane        — wallet-capability 6/6, strk20-state 14/14, privacy-guard 8/8, fee-policy 4/4, receipt 5/5, integration 12/12 — PASS
node_modules           — reused (/home/ubuntu/prism-work/Prism/node_modules symlink) — no new pin
secrets                — none committed; provider injected only (X2)
```

---

## 8. Antagonist Attack Cases and Findings

| # | Attack / Hypothesis | Method | Result |
|---|---|---|---|
| A1 | **Viewing-key exfiltration** — app requests/stores/logs viewing key | Pass `viewingKey` in provider/params; expect `VIEWING_KEY_FORBIDDEN` | **FAIL-CLOSED**: `assertNoViewingKey` throws `STRK20-015` on field `viewingKey`, `viewing_key`, nested objects, and string pattern `viewing key`; adapter guards every entry |
| A2 | **Capability probe via balances** — use `strk20Balances([])` to feature-detect, triggering consent | Call `observeCapability` and count `balances` invocations | **FAIL-CLOSED**: `observeCapability` only calls `supportedWalletApi`/`supportedSpecs` + `requestChainId`; integration test `calls.balances==0` green |
| A3 | **Network mismatch suppressed** — show ready while on wrong chain | Return `SN_MAIN` while expected `SN_SEPOLIA`; attempt shield | **FAIL-CLOSED**: `detectCapability` flags `mismatch:true`; state machine forces `mismatch` state; `mismatch` blocks `shielding`/`transfer_pending` |
| A4 | **Fee change race** — quote 4n, submit at 5n | Quote 4n then `observeFee` returns 5n; transition `shielding` with `quotedFee≠observedFee` | **FAIL-CLOSED**: `transition` throws `FEE_CHANGED` `STRK20-008`; `fee-policy.ts` `assertFeeUnchanged` also; `MAX` recompute required |
| A5 | **Screening bypass attempt** — treat rejected screening as retryable dependency | `requestShield` returns `screening: rejected` | **FAIL-CLOSED**: adapter throws `STRK20-006` (never `STRK20-013`); `rejected` terminal state requires `rejectionReason`; distinct from `screening_unavailable` (`503` retryable) |
| A6 | **Maturity skip** — spend freshly shielded notes immediately | `confirmedBlock=100`, try `privately_available` at `105` | **FAIL-CLOSED**: `transition` throws `MATURITY_PENDING` until `110`; 10-block heuristic enforced, not bypassable |
| A7 | **Consent bypass** — read private balance without consent | `requestPrivateBalances({requireConsent:false})` or `balances consent: denied` | **FAIL-CLOSED**: adapter throws `CONSENT_REQUIRED`/`CONSENT_DENIED`; state machine gate also requires `balanceConsent: granted` for `maturing→privately_available` |
| A8 | **Relayer attribution** — group activity by `sender` (relayer) | Build shield receipt with `senderAddress=relayer`, `keys[0]=depositor` | **FAIL-CLOSED**: `buildShieldReceipt` stores `senderIgnored`; `assertNotSenderAttribution` throws if `attributed==sender`; docs warn grouping by `sender` yields single-whale illusion |
| A9 | **Stale/pending overclaim** — mark shielding as complete, or replay stale version | `shielding → transfer_confirmed` skip, or `expectedVersion=0` when `version=1` | **FAIL-CLOSED**: skip throws `ILLEGAL_TRANSITION` `STRK20-012`; stale throws `STALE_STATE` `STRK20-011` with `stale_version` detail |
| A10 | **Privacy overclaim** — copy says "completely invisible shield" or "all amounts hidden" | `assertPrivacyCopy("completely invisible")` | **FAIL-CLOSED**: throws `PRIVACY_OVERCLAIM` `STRK20-014`; only allowed phrases (`Private balance`, `Send privately` etc.) pass |
| A11 | **SDK leakage into consumer path** — app imports `starknet-privacy` SDK requiring viewing key | Grep SDK import in `prism-strk20` || **PASS**: `grep -r starknet-privacy src/features/prism-strk20` 0 hits; `ForbiddenSdkPort` sentinel + adapter only uses Wallet API boundary |
| A12 | **Pending→completed confusion** — treat submitted as completed | Check state labels | **PASS**: `shielding`/`transfer_pending` are pending; only `transfer_confirmed` is terminal; `maturing` is explicit wait |

Antagonist verdict: **PASS** — 12 attack cases, all fail-closed or correctly distinguished; no viewing-key path, no balance-probe, no sender-attribution, no maturity bypass, no overclaim survived.

---

## 9. AUDIT.md G/T/FT Gate Mapping

| Gate | Criterion | M4 Evidence | Maturity |
|---|---|---|---|
| **G4 Unified Home** | Real Starknet/Base coherent Home | **NOT_IN_SCOPE** — M4 is STRK20 wallet product path, not Home shell; Home remains at `EVIDENCE_LEDGER` X2 (landing shell only). No drift introduced. | — |
| **G5 STRK20 wallet product path** — wallet capability + intentional balance + shield + private transfer | Wallet capability via versions; registration_required; approve→shield two-step; screening `rejected` vs `dependency_failure`; maturity 10 blocks; consent-gated balance; fee via pool; private transfer lifecycle; receipt via pool event | **X2 — backend/domain contract closed via injected X2 doubles** across 6 suites (49 tests). Live wallet/pool trace still required for X3. | X2 (X0 live) |
| **T10 Frontend integration** | State labels derive from op states only | **PASS via backend contract preservation** — `Strk20Flow` 12 states are the single source of truth; `WalletConnectionPanel` already derives labels from `supportedWalletApi`/`supportedSpecs`; M4 adds no frontend file per isolation — type compat preserved | X2 |
| **T11 E2E** | Decisive proof sequence | **X2 slice**: `capability_unknown → registration_required → approval_pending → shielding → confirmed → maturing → privately_available → transfer_pending → transfer_confirmed` exercised in `strk20-state.test.ts` happy path + `strk20-flow-integration.test.ts` provider-injected double (no live chain). Full E2E with live wallet still blocked. | X2 |
| **T12 Failure/recovery** | RPC outage, dependency, stale, duplicate, maturity lag, consent denial, screening divergence, retry | **PASS X2**: `dependency_failure` retry branch (`→capability_unknown`), `stale_version` (`STRK20-011`), `idempotent` same-state for `shielding/maturing/transfer_pending`, fee-change retry, screening `rejected` vs `unavailable`, `unknown` capability re-detect — exercised across `strk20-state` + `recovery` implicit via `dependency_failure` state | X2 |
| **FT-005 Private balance lifecycle** — `shield → confirmed → maturing → available → refresh/reconnect` | Confirmed→maturing→privately_available with 10-block gate + consent; refresh would re-read via `isRegistered`/`observeCapability` (stateless) | **X2 PASS** — maturity guard (105 blocked, 110 allowed) + consent gate; refresh/reconnect not yet with live wallet storage | X2 |
| **FT-007 Privacy copy** | Every private label checked vs observer visibility | **PASS X2**: `privacy-guard.test.ts` + `receipt` honesty + integration overclaim refusal; `SHIELD_TRUTH` vs `PRIVATE_TRANSFER_TRUTH` explicit | X2 |
| **SC-09 Controller-only mutation** | `ERR-004 not_controller` | **MAPPED**: Wallet owns STRK20 mutation (shield/transfer); Prism app never mutates pool directly; adapter never presents `viewingKey`; mismatch blocks readiness analogous to controller guard | X2 |
| **SC-12 Optimistic CAS** | `ERR-023 stale_version` | **PASS**: `strk20-state` `expectedVersion` check → `STRK20-011 stale_version` | X2 |
| **SC-13 Idempotency** | same-key/same-body benign | **PASS**: `IDEMPOTENT_SAME_STATE` for `shielding/maturing/transfer_pending/dependency_failure/mismatch`; re-apply returns `idempotent:true` without version bump | X2 |
| **SC-14 Dependency failure** | `ERR-021/022` fail-closed not completed | **PASS**: `dependency_failure` distinct from `rejected`; transition `→dependency_failure` allowed from every pending/mismatch; never reaches `transfer_confirmed`; `fee_unavailable`/`screening_unavailable` map here | X2 |
| **SC-15 Retry semantics** | `failed_retryable → ready → submitted` | **PASS**: `dependency_failure → capability_unknown/approval_pending/shielding/maturing/transfer_pending` recovery branch | X2 |

Carryover gates unchanged: G0 pool reachability `NOT_IMPLEMENTED` (requires funded wallet), G1 registry `NOT_IMPLEMENTED` (contracts lane), G2/G3 binding/resolve `NOT_IMPLEMENTED` (ops lane), G6 helper `NOT_IMPLEMENTED`, G7 final hashes `NOT_IMPLEMENTED` (`strk20.json` still `{"transactions":[],"contracts":[]}`), G8 release `NOT_IMPLEMENTED`.

---

## 10. Evidence Maturity X0–X5

```
X0 hypothesis          — all live decisive claims remain X0 (no live pool/wallet tx, no SN_SEPOLIA trace)
X1 fixture/mock        — wallet capability fixtures ("0.10.3" vectors), screening fixtures (approved/rejected/unavailable), relayer receipts (sender vs keys[0]), fee fixtures
X2 local controlled    — ✅ THIS LANE: pure capability detection (least-privilege) + 12-state machine with 14 edge tests + privacy guard + fee policy + relayer-correct receipts + injected InjectedWalletStrk20Adapter (X2 doubles, 49 tests) — typecheck + next build + diff-check green
   typecheck            — PASS (0 errors)
   next build           — PASS (webpack 43s + TS 22s, routes / and /_not-found)
   vitest (all)         — PASS (31 passed | 2 skipped, 341 passed | 14 skipped)
   focused M4 suite     — PASS (49/49)
X3 realistic/testnet   — NOT_EVIDENCED — no Ready wallet + SN_SEPOLIA shield/transfer with blocking-time maturity wait + live fee + independent receipt re-read
X4 repeated/reproduced — NOT_EVIDENCED
X5 mainnet/production  — NOT_EVIDENCED — no SN_MAIN pool event + STRK20 hub `ok=pool=mine=true` (requires declared Prism contract, out of scope for M4)
```

Maturity rule: local pass = X2; deployed + observed = X3+; mainnet + independent re-read = X4/X5. **No ledger row moves without observed results.** `EVIDENCE_LEDGER.md`/`AUDIT.md` gates G5, FT-005, FT-007 remain **X2 (domain contract)** until live `SN_SEPOLIA` observation via yaml evidence template.

**Evidence ceiling: X2 — LOCAL BUILD EVIDENCE EARNED, RUNTIME/TESTNET/MAINNET EVIDENCE OPEN**

---

## 11. Docs / Decision Drift

- **Zero canon mutation:** `SYSTEM_CANONICAL.md`, `state-machines.yaml`, `invariants.yaml`, `authority-matrix.yaml`, `DECISIONS.md`, `ASSUMPTIONS.md` not edited; M4 proposes `SM-PRISM-M4` as additive D2 draft, not a silent overwrite — parent integration must review.
- **No product invariant drift:** D0/D1 only (new domain module). D2+ candidate (`SM-PRISM-M4` to `projects/prism/system/state-machines.yaml`) flagged for parent, not committed.
- **Profiles respected:** `STRK20_CONTEXT` pins re-verified (skill install `npx skills add starkience/strk20-agent-skills` unchanged); pool fee never hard-coded.
- **Convergence contract obeyed:** all workers branch from `7a385d2`; parallel lanes not touching same files (only `src/features/prism-strk20/**`); `strk20.json` untouched.

Drift audit: **PASS — D0/D1 only** (new additive backend slice).

---

## 12. Remaining Blockers

1. **Live wallet capability re-read:** Ready extension `supportedWalletApi` live answer + `requestChainId` mismatch flow with real `createStore`/`subscribeWalletEvent` (requires funded privacy wallet + RPC URL).
2. **Live fee & screening:** `get_fee_amount` live vs quotedFee race + `screening=rejected` vs `unavailable` observed from real pool (requires `SN_SEPOLIA` funded shield).
3. **Live maturity wait:** shield → wait real ~10 blocks → `maturing→privately_available` with real block numbers + consent `balances` prompt from wallet.
4. **Live private transfer via relayer:** `requestPrivateTransfer` through real wallet + receipt `sender≠depositor` live assertion + pool event first-key attribution.
5. **Parent integration:** merge `SM-PRISM-M4` into project `system/state-machines.yaml` + `AUTHORITY_MATRIX` addition for Wallet API capability authority; update `AUDIT.md` G5 `X2→X3` only after 1–4.
6. **EVIDENCE_LEDGER promotion:** move `EVD-STRK20-002/003` from `X0→X2` (domain) → `X3` only after live traces + independent `getTransactionReceipt` re-read.
7. **Network config:** `STARKNET_RPC_URL` + expected env `SN_SEPOLIA` vs `SN_MAIN` gated release — mainnet blocked per `DEC-PRISM-OPS-001`.
8. **Frontend shell (owner-led Phase 8):** M4 explicitly does not build Home `PrivateBalance/Shield/Transfer` UI surfaces — integration is parent/owner.

---

## 13. Explicit Verdict

**ACCEPTABLE_FOR_INTEGRATION — X2**

Backend/domain Wallet API consumer route for M4 is contract-complete via provider-injected doubles, 12-state machine with guards, privacy-safe (no viewing keys, no SDK, consent-gated, capability least-privilege), fee-aware, maturity-honest, screening-distinct, relayer-correct, and antagonistically verified. Integration into parent worktree is acceptable. Promotion beyond X2 requires funded testnet traces and independent receipt readback per `PRISM_PHASE_CONVERGENCE_CONTRACT.md` — no mainnet claim made, no `strk20.json` write.

```
plan + implementation + required tests + Product Foundry QA + Research Foundry source/claim review + System Foundry authority/state/error/reconciliation alignment + Antagonist red-team + AUDIT.md G/T/FT gate mapping + evidence maturity assignment + documentation/reconciliation + independent parent verification = accepted phase packet (pending parent merge)
```

---

### Appendix: Privacy Truth Label (honest, per receipt domain)

```
Shield:              public  depositor, token, amount, timing, pool event — never "private deposit"
Private transfer:    private sender, recipient, amount, token_type — public proof artifacts, timing
Open note:           public amount where contract output is plaintext, hidden owner
Relayer:             sender is paymaster/relayer — attribute via pool Deposit keys[0], never sender
Allowed copy:        "Private balance", "Send privately", "Private transfer", "Private on Starknet with STRK20", "Identity-private DeFi execution"
Forbidden copy:      "completely invisible", "private everywhere", "untraceable", "all amounts hidden", "zero metadata", "anonymous amount", "invisible shield"
```

---

*Worktree `agent/phase-m4-strk20` from `7a385d2`. No frontend, no `WalletConnectionPanel` edit, no contracts/Cairo, no `strk20.json` write, no deployment, no Linear/Notion, no credentials, no GitHub push was touched. All injected doubles labeled `X2 — TEST DOUBLE, no live RPC, no private transaction`.*
