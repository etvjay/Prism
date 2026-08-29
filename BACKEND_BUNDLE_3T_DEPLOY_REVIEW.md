# Backend Bundle 3T Deploy Review — Pre-Deployment Readiness (No Deployment)

**Worktree:** `backend-bundle-3t-deploy` @ `778e262` + deploy-hardening  
**Date:** 2026-08-23  
**Owner:** Prism (Muse Spark 1.2 free, Bundle 3T-Deploy readiness)  
**Scope:** Evidence-preparation only — no frontend edits, no contract behavior change, no live deployment, no RPC contact, no `strk20.json` writes, no Linear/Notion, no credentials, no push  
**Authority:** `SYSTEM_CANONICAL.md`, `AUTHORITY_MATRIX.md`, `CONTRACT_SPEC.md`, `INVARIANTS.md`, `STATE_MACHINES.md`, `TEST_ARCHITECTURE.md`, `RESEARCH_BACKEND_GATE.md`, `AUDIT.md`, `EVIDENCE_LEDGER.md`, `CHAINID_V2_DECISION_PACKET.md`, `STARKNET_MAINNET_EVIDENCE_PROFILE.md`, `STARKNET_SYSTEM_PROFILE.md`

---

## 1. Target-Network Decision / Manifest Validation — SD-006 / CON-PRISM-012 / SYSTEM_CANONICAL §4

Explicit per `ops/target-network/manifest.yaml` and `ops/target-network/validate.mjs` (offline, no secrets, no RPC):

- Default **testnet** = `SN_SEPOLIA` + `Base Sepolia` `84532` (`manifest.yaml:environments.testnet` `PROPOSED`).
- Release-gated **mainnet** = `SN_MAIN` + `Base Mainnet` `8453` + pool `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a` (`manifest.yaml:environments.mainnet` `RELEASE_GATED_PROPOSED`).
- `owner_decision.status: UNDECIDED` — manifest remains `PROPOSED` until owner creates append-only `DEC-PRISM-OPS-001` in `DECISIONS.md` (template in `ops/target-network/PROPOSAL.md:§2`) and mirrors into `manifest.yaml:owner_decision` (`ACCEPTED`, `selected_environment`, `disposition_chainId_v2`, `signature`).
- `validate.mjs` enforces `R01_environment_scoped` (no global default), `R02_no_silent_accept`, `R03_chainId_binding`, `R04_starknet_network_binding`, `R05_release_gate`, `R06_strk20_json_guard`.
- Offline check: `node ops/target-network/validate.mjs` → `PROPOSED/UNDECIDED correctly blocking`.

**Antagonist:** editing `status: ACCEPTED` without `DECISIONS.md` record is rejected by validator/review.

---

## 2. Secret-Free sncast / Provider / Account Templates + Dry-Run Checks — G8

Templates (`ops/starknet/sncast.toml.example`, `provider.example.toml`, `accounts.json.example`):

- No `0x` 64-hex private key; only placeholder `0x<…>` / env-var references (`STARKNET_*_RPC_URL`, `STARKNET_*_PRIVATE_KEY` env var names, keystore env var).
- No hard-coded `alchemy.com/v2/<key>`; every profile uses `url_env_var`.
- No active `sncast.toml` committed (only `.example`); `snfoundry.toml` has only commented placeholders.
- `node ops/starknet/validate.mjs` checks all of the above (offline).
- **Hardened:** `node ops/starknet/dry-run-check.mjs` validates that every `sncast declare/deploy` is gated by `--dry-run` or `OFFLINE — requires env` marker, that `manifest` stays `PROPOSED/UNDECIDED`, and that templates are env-var driven. Live dry-runs (`sncast declare --dry-run`, `sncast deploy --dry-run`) are documented in `ops/starknet/VALIDATION.md:§4` as the next gate after owner decision — not executed in this bundle.
- `ops/starknet/VALIDATION.md` now explicitly documents dry-run commands and offline secrecy guarantees.

---

## 3. Evidence Envelope Build/Validate — EVD-PRISM-004..007 Lifecycle

Module `src/features/evidence/evidence-envelope.ts` (pure, deterministic, offline) + CLI `ops/evidence/build.mjs`, `ops/evidence/validate.mjs`:

- **Fields enforced (every `BACKEND_PRODUCTION_READINESS_PACKET §6.7` row):** `network` (`SN_SEPOLIA`/`SN_MAIN`), `address` (`Hex`), `class_hash` (`Hex`), `deploy_tx` (`Hex`), `blocks` (`block_number` + `transactions[].block` finite>0), `status` (`SUCCEEDED` only), `independent_verification` (`explorer_url` or `rpc_second_read`), `limitations` (non-empty — now `error+blocker` if missing), `commit`/`spec_versions`, `maturity`.
- **Determinism:** `canonicalStringify` sorted keys; `envelopeHash` stable.
- **Promotion rule:**

```
valid == errors.length==0
promotable == valid && blockers.length==0
blockers ∈ { deployment missing, wrong network, status REVERTED/UNKNOWN, block missing, independent_verification missing, chainId mismatch, malformed receipt, limitations missing, writeStrk20Json }
suggestedMaturity: errors→X0; blockers→X2 (independent read absent always X2); otherwise preserve claimed maturity
```

- No path writes `strk20.json` — `buildEvidenceEnvelope` throws on `write strk20.json` procedure without prohibition wording; `assertNoStrk20JsonWrite` blocks path `strk20.json`; validator errors on `writeStrk20Json==true` and on path itself.
- `validate.mjs` also refuses to validate a file whose path is `strk20.json`.
- Hardened in this deploy patch: `limitations` empty now produces `errors` + `blockers` (not just warning), ensuring missing limitation fields block promotion; all other missing fields already block.

---

## 4. Deterministic Testnet Decisive-Sequence Fixture Harness — FT-001 / CANONICAL_STATE §10

Procedure `ops/testnet/DECISIVE_SEQUENCE_PROCEDURE.md` + harness `src/features/evidence/decisive-sequence-harness.ts` + CLI `ops/testnet/decisive-sequence.harness.mjs` (offline):

- **Sequence (TEST DOUBLE, offline, no RPC):** `create P → read P → issue challenge {chain_id:84532} → Base proof EOA ecrecover → controller-signed bind (submitted, not completed) → resolve(P,BASE)=B (ACTIVE) → revoke (submitted) → resolve=NO_ACTIVE_DESTINATION → P persists`.
- **Fixture harness now covers (deterministic, offline, labeled TEST DOUBLE, X2 ceiling):**
  - success tail (above)
  - wrong signer → `ERR-004` (INV-SYS-002, FT-002)
  - replay nonce → `ERR-006` / replay digest → `ERR-007` (INV-SYS-004/010, FT-003)
  - revoke tail + idempotent second revoke (`ERR-011` benign) (INV-SYS-006/007, FT-004)
  - stale/dependency: `isStaleProjection(watermark, confirmedBlock, K)` + `WatermarkedResolveService` stale ACTIVE refusal (SC-04/SC-06, INV-SYS-007, T9/T12)
  - retry/recovery: `failed_retryable → retry to submitted`, `recoverNonTerminalOperations` sweep, `isWatermarkStale`, `requires_attention` escalation (SC-06/21, SM-PRISM-003, T12)
  - chainId mismatch → `altered_fields:chain_id` (SD-008)
  - `submitted ≠ completed` at every step (INV-SYS-005, SC-06)
  - no `strk20.json` writes

Tests: `src/features/evidence/__tests__/decisive-sequence.test.ts` (9 tests: 1 success + 1 defaults + wrong signer, replay nonce, replay digest, revoke, stale classification, stale refusal, dependency/retry) + `envelope-and-gates.test.ts` (10) + `poll-worker-divergence.test.ts` + `resolve-service.test.ts` etc. All via injected InMemory doubles.

**Offline result:** `X2 — fixture, TEST DOUBLE, NOT PROMOTABLE` (independent read absent). Live V8.5 will replace ports with real `RpcProvider` + funded wallets and record per-step envelopes with independent reads → `X3`.

---

## 5. Release-Readiness Checklist — Explicit Deployment Gate

`ops/release/READINESS_CHECKLIST.md` gates deployment on:

- **chainId decision** (`DEC-PRISM-SYS-003` accept/reject of `e8886af` SD-008; companion spec amendment)
- **target-network decision** (`DEC-PRISM-OPS-001` `ACCEPTED` with `selected_environment`, `disposition_chainId_v2`, `signature`)
- **funded accounts** (env-var driven templates pass `validate.mjs` + `dry-run-check.mjs`; funded SN_SEPOLIA deployer + Base Sepolia EOA are owner-provisioned outside repo — never committed)
- **independent reads** (envelope `independent_verification` explorer + RPC second read present; validator `validate.mjs --self-test` passes; live re-read required before any `EVIDENCE_LEDGER.md` promotion)

Checklist also enumerates `EVD-PRISM-004..007` tail, `G1/G2/G3`, `T9/T11/T12`, and `SC-04/05/06/10/21` coverage with exact test/file references. Aggregate verdict for this bundle: `PASS_WITH_LIMITATIONS — LOCAL BUILD EVIDENCE EARNED, RUNTIME/MAINNET EVIDENCE OPEN`; deployment is `BLOCKED` on the four gates above (all `UNDECIDED/OPEN` offline — correctly).

---

## 6. Static Validators & Tests Only — No RPC / No Deployment

Run offline in this worktree:

```
node ops/target-network/validate.mjs        # PROPOSED/UNDECIDED correctly blocking
node ops/starknet/validate.mjs              # secret-free templates pass
node ops/starknet/dry-run-check.mjs         # dry-run gate passes
node ops/evidence/validate.mjs --self-test  # promotion guards pass
node ops/evidence/build.mjs --self-test     # deterministic fixture (TEST DOUBLE)
npm test                                    # 24 passed | 2 skipped | 258 passed | 14 skipped (offline, no RPC)
npm run typecheck                           # PASS (tsc --noEmit)
npm run build                               # PASS (next build)
git diff --check                            # clean
strk20.json                                 # {"transactions":[],"contracts":[]} empty (no writes)
```

No file contacts a Starknet/Base RPC; no `sncast declare/deploy` is executed; no contract is deployed.

---

## 7. System / Research / Audit / Test / Ledger / SC Mapping

| Layer | Claim | This bundle | Evidence |
|---|---|---|---|
| System deployment `SD-006` | Per-environment target networks, no global default | `manifest.yaml` + `validate.mjs` + checklist §2 | `R01/02/05` pass |
| System authority `AUTHORITY_MATRIX` | Backend TRUSTED VERIFIER only (DEC-PRISM-SYS-001 Option A), canonical at Starknet transition | Envelope + harness label `TEST DOUBLE` | `DECISIONS.md` `DEC-PRISM-SYS-001 ACCEPTED` unchanged |
| System evidence `CONTRACT_SPEC` `OP-8-01/02` `QRY-8-01` | Controller-signed bind, digest single-use, bounded staleness | Harness success + wrong signer + replay + stale tests | `INV-SYS-002/003/004/006/007` |
| Research freshness/claim limits `RESEARCH_BACKEND_GATE §7`, `STRK20_CONTEXT` | No blanket privacy, no X3+ without observed evidence, TEST DOUBLE labeled X2 | Envelope clamps maturity to X2 when independent read absent | `envelope-and-gates.test.ts` |
| Audit `AUDIT.md §13` | `G1` registry create/read, `G2` Base proof+bind, `G3` resolve+revoke | Harness exercises `G1/G2/G3` at X2 (7+ snforge tests carryover, app-boundary 12 tests, decisive harness 9 tests) | All gates `NOT_IMPLEMENTED` until live `V7.5/V8.5` |
| Audit `G1/G2/G3` evidence | `EVD-PRISM-004..007` decisive proof | Envelope valid fixture `EVD-PRISM-004..007` promotable only with independent read | Ledger rows stay `X0 NOT_IMPLEMENTED` (no live promotion) |
| Test architecture `T9` ledger integration | Event indexing reconstruction + watermarked resolve | `event-reconstruction.test.ts`, `starknet-event-indexer.test.ts`, `resolve-service.test.ts`, harness stale test | T9 **X2** (no live ledger) |
| Test architecture `T11` E2E | Decisive `FT-001` tail end-to-end | `decisive-sequence.test.ts` 9 tests + `app-boundary.test.ts` success path | T11 **X2** |
| Test architecture `T12` failure/recovery | RPC outage, stale watermark, duplicate events, restart, retry, recovery | `poll-worker-divergence.test.ts`, `reconciliation-worker.test.ts`, `recovery-policy.test.ts`, harness dependency/retry test | T12 **X2** |
| SC-04 Resolve as Recorded | `resolve(P,venue)` returns ACTIVE as recorded, watermark bound | `resolve(P,BASE)=B` pre-revoke, `isStaleProjection`, `WatermarkedResolveService` canonical preference | T9/T11 |
| SC-05 Revocation persistence | `revoke` preserves `P`, post-revoke `NO_ACTIVE`, no reactivation | Harness revoke + second revoke idempotent + `P persists` | T11 |
| SC-06 Ledger/operation boundary | `submitted ≠ completed`, reconciliation, authoritative source per state | `INV-SYS-005` guard, `tickReconciliation`, `authoritativeSourceForState` | T12 |
| SC-10 Nonce single-use | Challenge `nonce` consumed atomically, replay `ERR-006` | Harness replay nonce test + `app-boundary.test.ts` | T6/T12 |
| SC-21 Evidence maturity & promotion | Deterministic envelope, independent verification gate, `X0→X2→X3`, `strk20.json` isolation | `evidence-envelope.ts` promotion blockers + `canonicalStringify` + `envelope-and-gates.test.ts` + `validate.mjs` | T8/T9 |
| Notion SC-11 Digest single-use (sibling) | `ERR-007` | Harness replay digest test + `test_prism_v83.cairo` | T6 |

All `T9/T11/T12` exercised at **X2** (TEST DOUBLE). Live `SN_SEPOLIA` variants gated on `ACCEPTED` + funded deployer (V7.5/V8.5).

---

## 8. Verification Performed in This Worktree (2026-08-23, offline)

```
npm test                         — 24 passed | 2 skipped | 258 passed | 14 skipped (harness now 9 tests)
npm run typecheck                — PASS
npm run build                    — PASS (routes / , /_not-found)
git diff --check                 — clean
node ops/target-network/validate.mjs — PROPOSED/UNDECIDED correctly blocking
node ops/starknet/validate.mjs       — secret-free ✓ (no hex key, no hard-coded RPC, no active sncast.toml)
node ops/starknet/dry-run-check.mjs  — dry-run gated ✓ (env-var driven, no bare deploy, manifest still PROPOSED)
node ops/evidence/validate.mjs --self-test — promotion guards ✓ (missing field + strk20 blocked)
node ops/evidence/build.mjs --self-test    — deterministic fixture ✓ (TEST DOUBLE)
strk20.json                      — empty {"transactions":[],"contracts":[]} (no writes, verified)
frontend files touched           — none
contract behavior touched        — none
live network contact             — none (all offline)
```

---

## 9. Unresolved Owner / Funding Gates (Explicit Blockers)

| Gate | Owner | Status | Blocks |
|---|---|---|---|
| `DEC-PRISM-SYS-003` chainId-v2 (`e8886af`, SD-008) `ACCEPT/REJECT` + spec amendment | Jason | **OPEN — PROPOSED** | `policy.defaultChainId` wiring; cross-network replay window |
| `DEC-PRISM-OPS-001` target-network `ACCEPT` (testnet `SN_SEPOLIA+84532` default, mainnet release-gated) | Jason | **OPEN — PROPOSED/UNDECIDED** | Any `SN_SEPOLIA` deploy, V7.5/V8.5 live run, envelope promotion to X3 |
| Funding gate — funded SN_SEPOLIA deployer + Base Sepolia EOA | Jason/owner | **OPEN — templates only** | Live `declare/deploy`, `Base` EOA→1271→6492 fixture corpus |
| Independent reads | Operator | **OPEN — offline fixtures lack second read** | Ledger promotion `EVD-PRISM-004..007` X0→X3, `G1/G2/G3` |

All runtime rows `EVD-PRISM-004..007` remain `NOT_IMPLEMENTED / X0`; harness is `X2` only.

---

## 10. X Maturity — Honest

```
X0 hypothesis  — large parts remain hypothesis — unchanged
X1 fixture/mock — challenge fixtures, InMemory doubles, envelope fixtures — ✅ this bundle
X2 local controlled — ✅ this bundle: PrismApplicationService + InMemory stores + snforge 7 tests + vitest 258 tests + deterministic envelope/harness/validators — all green at X2
X3 realistic/testnet — NOT_EVIDENCED — requires DEC-PRISM-OPS-001 ACCEPT + funded SN_SEPOLIA deploy + live DB CAS
X4 repeated / X5 mainnet — NOT_EVIDENCED — requires SN_MAIN repeat + independent re-read (V8.6, release-gated)
```

> **PASS_WITH_LIMITATIONS — LOCAL BUILD EVIDENCE EARNED, RUNTIME/MAINNET EVIDENCE OPEN** (`AUDIT.md §18` preserved).

No amount of offline promotion blocking or fixture passing moves any `X` beyond `X2`.

---

## 11. Inventory — This Bundle (ops/evidence-prep only)

```
ops/target-network/manifest.yaml
ops/target-network/PROPOSAL.md
ops/target-network/validate.mjs
ops/starknet/sncast.toml.example
ops/starknet/provider.example.toml
ops/starknet/accounts.json.example
ops/starknet/VALIDATION.md
ops/starknet/validate.mjs
ops/starknet/dry-run-check.mjs           # NEW — dry-run deployment command check
ops/evidence/README.md
ops/evidence/build.mjs
ops/evidence/validate.mjs
ops/evidence/validate.mjs                # hardened: limitations missing → error+blocker
ops/release/READINESS_CHECKLIST.md       # NEW — explicit gate on chainId / target-network / funded accounts / independent reads
ops/testnet/DECISIVE_SEQUENCE_PROCEDURE.md
ops/testnet/decisive-sequence.harness.mjs
src/features/evidence/evidence-envelope.ts    # hardened: limitations missing → X0 + blocker
src/features/evidence/decisive-sequence-harness.ts
src/features/evidence/__tests__/decisive-sequence.test.ts  # extended: wrong signer, replay, revoke, stale/dependency/retry/recovery
src/features/evidence/__tests__/envelope-and-gates.test.ts
BACKEND_BUNDLE_3T_REVIEW.md              # prior bundle review (carryover)
BACKEND_BUNDLE_3T_DEPLOY_REVIEW.md       # THIS FILE — deploy readiness map
```

Not in this commit: `strk20.json` (empty), any `snfoundry.toml` with live secrets, any `sncast.toml`/`.env`/keystore, `EVIDENCE_LEDGER.md`/`AUDIT.md`/`DECISIONS.md` moves, frontend, Cairo edits, deployment receipts.

---

## 12. Session Footer (FOUNDRY_PROTOCOL §17)

```
Bundle:            3T-Deploy readiness (Muse Spark 1.2 free)
Base commit:       778e262
New commit:        HEAD after verification (see git log --oneline -1)
Canonical artifacts updated: 0 (evidence-preparation, not system canonicalization)
Decisions created: 0 — 2 DECISION_REQUIRED proposals remain (DEC-PRISM-OPS-001 + DEC-PRISM-SYS-003)
Decisions superseded: 0
Assumptions added: 0
Evidence added:    0 (EVD-PRISM-004..007 stay NOT_IMPLEMENTED / X0; fixtures are X2 local)
Maturity changes:  none — ceiling X2 honestly declared
Drift detected:    none
Unresolved:        DEC-PRISM-SYS-003 (chainId-v2), DEC-PRISM-OPS-001 (target-network), funding gate, G0, final hashes
Next step:        WP-0 owner decisions → V7.5 SN_SEPOLIA deploy + envelope with independent read (X3) → V8.5 decisive E2E (X3) → V8.6 SN_MAIN (release-gated, X4/X5)
Verification:      npm test 258/14 ✓, typecheck ✓, build ✓, diff-check ✓, manifest ✓, starknet templates ✓, dry-run ✓, envelope guards ✓
Gates:             G1/G2/G3 remain NOT_IMPLEMENTED until live observation per ledger template
```

*Governing principle: Research → Experiment → Build → Evidence. No ledger row moves without observed results.*

---

## 10. Post-acceptance owner decision update — 2026-08-23

The owner decisions previously listed as open are now recorded append-only in
`projects/prism/DECISIONS.md` at commit `e612c4a`:

- `DEC-PRISM-SYS-003`: **Accepted**, Option 1; chainId-v2 is a mandatory
  pre-deployment security gate and schema-v2 companion work is accepted.
- `DEC-PRISM-OPS-001`: **Accepted for testnet**, selecting `SN_SEPOLIA` +
  Base Sepolia (`84532`); `SN_MAIN` + Base Mainnet (`8453`) remains
  `RELEASE_GATED_PROPOSED`.

`ops/target-network/manifest.yaml` mirrors the accepted decision and retains
its dry-run, funded-account, live-receipt, independent-read, and evidence
promotion gates. This update changes governance state only; it does not create
X3 evidence or authorize a broadcast by itself.
