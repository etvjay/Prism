# Backend Bundle 3T Review — Deployment/Testnet Phase Preparation (No Deployment)

**Worktree:** `backend-bundle-3t` @ `5684163` (base) → Bundle 3T commit pending verification  
**Date:** 2026-08-23  
**Owner:** Prism (Muse Spark 1.2 free, Bundle 3T testnet/evidence-preparation)  
**Scope:** evidence-preparation only — no frontend edits, no contract behavior change, no deployment execution, no live-network contact, no `strk20.json` population, no Linear/Notion edits, no credentials, no push  
**Authority:** `PRODUCT_FOUNDRY.md`, `SYSTEM_FOUNDRY.md`, `RESEARCH_FOUNDRY.md` + `projects/prism/system/*` (md+yaml), `foundry/FOUNDRY_PROTOCOL.md`, `AUDIT.md`, `EVIDENCE_LEDGER.md`, `CANONICAL_STATE.md`, `DECISIONS.md`, `ASSUMPTIONS.md`, `CONTRADICTIONS.md`, `docs/PRISM_DOCUMENTATION_V0_3.md`, `docs/STRK20_CONTEXT.md`, `profiles/STARKNET_*`, `TEST_ARCHITECTURE.md`, `BACKEND_PRODUCTION_READINESS_PACKET.md:§1–§10`, `CHAINID_V2_DECISION_PACKET.md:SD-008`

**Antagonist gate:** every claim below is checked against “no ledger row moves without observed results” (`EVIDENCE_LEDGER.md:X-Scale`, `SYSTEM_FOUNDRY:§27`). Anything labelled TEST DOUBLE is X2 maximum; no X3+ is claimed.

---

## 0. What this bundle is and is not

| Layer | Claim | Maturity |
|---|---|---|
| Product truth | `CANONICAL_STATE.md §10` decisive proof (P→B bind→resolve→revoke→NO_ACTIVE→P persists) | **Preserved — not redefined** |
| System canonical | `SYSTEM_CANONICAL.md v0.2` + `DOMAIN_MODEL`, `STATE_MACHINES`, `INVARIANTS`, `AUTHORITY_MATRIX`, `CONTRACT_SPEC`, `ERROR_CATALOGUE`, `STACK_DECISIONS` | **Acknowledged — no protected DEC mutated** |
| Research / evidence limits | `RESEARCH_BACKEND_GATE.md`, `STARKNET_MAINNET_EVIDENCE_PROFILE.md` | **Enforced — X2 ceiling for this lane** |
| Implementation | Offchain challenge (chainId v2), Operation lifecycle, Ledger status, Event reconstruction (prior WP-3/4B) | **X2 local controlled, re-verified** |
| **This bundle (3T)** | Target-network manifest+proposal, secret-free templates, evidence envelope builder/validator, decisive-sequence harness/procedure, static/fixture gate tests | **X2 — preparation without runtime claim** |
| Live deployment / onchain evidence | SN_SEPOLIA deploy, class hash, tx hash, block, independent read | **NOT_EVIDENCED — no deployment executed** |

---

## 1. Target-network manifest / proposal — `G1/G2/G3` gate, `SD-006` / `CON-PRISM-012`

**Files:** `ops/target-network/manifest.yaml`, `ops/target-network/PROPOSAL.md`, `ops/target-network/validate.mjs`

| Requirement | Realization |
|---|---|
| Default testnet | `SN_SEPOLIA` + `Base Sepolia` (`84532`) — `manifest.yaml:environments.testnet` |
| Mainnet | `SN_MAIN` + `Base Mainnet` (`8453`, pool `0x0403…812a`) — `manifest.yaml:environments.mainnet` with `status: RELEASE_GATED_PROPOSED` |
| Environment-scoped | No global default — every consumer must select `testnet|mainnet` (`R01_environment_scoped`) |
| No silent accept | `status: PROPOSED` + `owner_decision.status: UNDECIDED`; `validate.mjs` fails until owner fills `DEC-PRISM-OPS-001` append-only in `DECISIONS.md` (`R02_no_silent_accept`) |
| ChainId binding | `base.chain_id` per env becomes mandatory `policy.defaultChainId` (SD-008 / `e8886af` chainId v2 companion) — harness & envelope assert `altered_fields:chain_id` on mismatch (`R03`) |
| Starknet network binding | Envelope/harness refuse promotion when `observed network != manifest network` (`R04`) |
| Release gate | Mainnet requires `owner_decision.selected_environment includes mainnet + funding gate closed` (`R05`) |
| `strk20.json` guard | Testnet envelopes never write `strk20.json` (`R06`) — enforced by envelope builder + `validate.mjs` |

**Antagonist check:** a PR that edits `manifest.yaml:status` to `ACCEPTED` without a mirrored `DECISIONS.md` entry is rejected by `validate.mjs`. Deferral is itself a recorded decision with named risk window (`CHAINID_V2_DECISION_PACKET.md:§3`).

**Gate mapping:** prepares `G1` (registry deploy target), `G2` (binding venue chainId), `G3` (resolution network) — all remain `NOT_IMPLEMENTED` until live `V7.5/V8.5` observes.

---

## 2. Secret-free sncast / provider / account templates + validation — `G8` hygiene

**Files:** `ops/starknet/sncast.toml.example`, `ops/starknet/provider.example.toml`, `ops/starknet/accounts.json.example`, `ops/starknet/VALIDATION.md`, `ops/starknet/validate.mjs`

- No `url = "https://..."` with embedded key — every profile references `url_env_var = "STARKNET_*_RPC_URL"` (checked by `validate.mjs`).
- No `0x` 64-hex private key literal — only placeholders `0x<…>` / `YOUR_…` (checked).
- No active `sncast.toml` committed — only `.example` (checked).
- `.env.example` stays placeholder (`YOUR_ALCHEMY_KEY`); `.gitignore` already excludes `.env` (verified).
- Validation commands (offline, no env required): `node ops/starknet/validate.mjs`, `node ops/target-network/validate.mjs`, `node ops/evidence/validate.mjs --self-test`, `scarb build` / `snforge test` toolchain checks.
- Live checks (`sncast --profile sepolia account list`, `sncast call … get_identity`) are documented as `OFFLINE — requires env + funded deployer + owner gate` and are **not run** in this bundle.

---

## 3. Deterministic evidence-envelope builder / validator — `EVD-PRISM-004..007` lifecycle

**Module:** `src/features/evidence/evidence-envelope.ts` (pure, deterministic, offline)  
**CLI:** `ops/evidence/build.mjs`, `ops/evidence/validate.mjs` (offline)  
**Docs:** `ops/evidence/README.md`

**Fields covered (every `BACKEND_PRODUCTION_READINESS_PACKET.md §6.7` envelope row):**

| Field | Builder | Validator |
|---|---|---|
| `network` | `environment` = `SN_SEPOLIA`/`SN_MAIN` | `isValidNetwork`; `deployment.network == envelope.environment`, `tx.network == environment` |
| `address` | `deployment.address: Hex` | `isHex` |
| `class hash` | `deployment.class_hash: Hex` (+ `contracts[].class_hash`) | `isHex` |
| `deploy tx` | `deployment.deploy_tx: Hex` | `isHex` |
| `blocks` | `deployment.block_number` + `transactions[].block` | `finite >0`; `null` blocks → blocker |
| `status` | `deployment.status` + `transactions[].status` (`SUCCEEDED` only promotable) | `SUCCEEDED` only; `REVERTED`/`UNKNOWN` → blocker |
| `independent reads` | `independent_verification: {explorer_url, rpc_second_read, verified_at}` | absent → blocker + downgrade |
| `limitations` | `limitations: string[]` (what is NOT evidenced) | empty → warning (must document) |
| `commit/spec versions` | `build: {commit_sha, spec_versions: {scarb, snforge, starknet,…}}` | missing → error; non-hex SHA → warning |

**Determinism:** `canonicalStringify` (sorted keys, no whitespace) — two builds of logically identical input are byte-identical; `envelopeHash` is stable for audit correlation.

**Promotion rule (the core of §5):**

```text
valid == (errors.length==0)
promotable == valid && blockers.length==0
blockers ∈ { deployment missing, wrong network, status REVERTED/UNKNOWN, block missing,
             independent_verification missing, chainId target mismatch, malformed receipt,
             writeStrk20Json }
suggestedMaturity:  errors → X0;  blockers → X2 (independent read absent always X2,
                  even if claimed X3/X4/X5);  otherwise preserve claimed maturity
```

- No code path writes `strk20.json` — `buildEvidenceEnvelope` throws if `procedure` contains `write strk20.json` without `do not write` wording; `assertNoStrk20JsonWrite(path)` blocks path `strk20.json`; `validateEvidenceEnvelope` errors on `inputs.writeStrk20Json==true` or `procedure` writing it.
- `validate.mjs` also refuses to validate a file whose path itself is `strk20.json`.

---

## 4. Testnet decisive-sequence harness / procedure — `FT-001` / `CANONICAL_STATE §10`

**Procedure:** `ops/testnet/DECISIVE_SEQUENCE_PROCEDURE.md`  
**Harness:** `src/features/evidence/decisive-sequence-harness.ts` + `ops/testnet/decisive-sequence.harness.mjs` (offline)  
**Test:** `src/features/evidence/__tests__/decisive-sequence.test.ts`

**Sequence exercised (offline, TEST DOUBLE labeled):**

```
create P (seeded InMemoryRegistry) → read P → issue challenge {chain_id:84532, domain, venue:BASE, account, prism_id}
  → Base proof EOA ecrecover (LocalErc1271SemanticsChecker TEST DOUBLE)
  → controller-signed bind_execution_identity(prism_id, BASE, account, proof_digest) — operation `submitted`, not `completed`
  → resolve(P,BASE)=B (ACTIVE) → revoke_binding — operation `submitted` → resolve(P,BASE)=NO_ACTIVE_DESTINATION → P still exists
```

**Invariants asserted by harness:**

- `submitted ≠ completed` at every chain-touching step (`INV-SYS-005` / `INV-PRISM-015`) — illegal `submitted→completed` skip throws `ERR-023`.
- `chainId` target mismatch fails `ERR-012 altered_fields:chain_id` (SD-008).
- Wrong controller → `ERR-004` before any binding (INV-SYS-002).
- Replay → `ERR-006` (nonce) / `ERR-007` (digest) — never double-consumed (INV-SYS-004/010).
- Expired proof → `ERR-013`.
- No `strk20.json` writes.

**Offline result (this bundle):** `X2 — fixture, TEST DOUBLE, NOT PROMOTABLE` (missing `independent_verification`). Live run (next packet, owner-approved, `V8.5`) will replace the `InMemory*` ports with real `RpcProvider` + funded wallets, record per-step envelopes with `deployment+transactions+independent reads`, and promote to `X3` (testnet).

---

## 5. Evidence cannot be promoted when fields / receipts missing + cannot write `strk20.json` — `INV-SYS-005` / `G8`

**Enforcement points:**

| Missing / malformed case | Builder | Validator | CLI | Test |
|---|---|---|---|---|
| deployment missing / `address/class_hash/deploy_tx/block/status` absent | `promotion_blockers: ["deployment missing…"]`, maturity→`X2` | `blockers: ["deployment missing"]` | `validate.mjs` exits 1, prints `⊘ NOT PROMOTABLE` | `envelope-and-gates.test.ts: missing deployment` |
| transaction `block` null / `status UNKNOWN/REVERTED` / `hash` malformed | — | `blockers: ["…block missing", "…status REVERTED"]`, `errors: ["…hash malformed"]` | — | `malformed receipt`, `reverted` |
| `independent_verification` absent | maturity clamped to `X2` | `blockers: ["independent_verification missing"]`, `suggestedMaturity X2` | `validate.mjs --require-independent-read` | `absent independent read` |
| `write strk20.json` in `procedure` or `inputs.writeStrk20Json` | throws `procedure must not write strk20.json` | `errors: ["procedure attempts to write strk20.json"]` | refuses file path `strk20.json` | `cannot write strk20.json` |
| `strk20.json` file itself validated | — | — | `✕ envelope path is strk20.json — must never be an evidence envelope` | — |

**Result:** any envelope missing a promoter field stays under `ops/evidence/envelopes/` as preparatory evidence only; it is never copied into `EVIDENCE_LEDGER.md` or `strk20.json`. The repo file `strk20.json` remains `{"transactions":[],"contracts":[]}` (verified by `git status`).

---

## 6. Static / fixture tests — `T2/T5/T6/T8` ladder

**File:** `src/features/evidence/__tests__/envelope-and-gates.test.ts` (10 tests, offline, no RPC)

| Required fixture | Test | What it proves | System artifact |
|---|---|---|---|
| **chainId target mismatch** | `chainId target mismatch is a promotion blocker (altered_fields:chain_id)` — builds envelope with `inputs.chainId 8453` vs manifest `84532` | Cross-network replay closed; digest/message differ per chain (SD-008 / `e8886af`) | `INV-SYS-011`, `DEC-PRISM-SYS-003`, `TEST-8-2-4` |
| **missing secrets** | `missing secrets — envelope is secret-free…` — asserts `canonicalStringify` has no `PRIVATE_KEY`/`api_key`, `build` promotable without embedding a secret | Templates hold env-var names, not values (`ops/starknet/validate.mjs` checks `0x` 64-hex) | `G8` hygiene, `STARKNET_SYSTEM_PROFILE` |
| **malformed receipt** | `malformed receipt — bad hex address, UNKNOWN status, missing block` | Bad `0xzzzz`, `status UNKNOWN`, `block null` → `errors/blockers` | `ERROR_CATALOGUE`, `CONTRACT_SPEC` receipt `SUCCEEDED` only |
| **wrong network** | `wrong network is a blocker` — `SN_MAIN` envelope vs `SN_SEPOLIA` deployment/tx | Network-scoped promotion blocked | `SD-006`, `STARKNET_SYSTEM_PROFILE` |
| **absent independent read** | `absent independent read is a promotion blocker and downgrades X maturity to X2` | No `explorer_url`/`rpc_second_read` → `blockers`, `X3→X2` | `BACKEND_PRODUCTION_READINESS_PACKET §6.7`, `EVIDENCE_LEDGER` template |
| **X maturity assignment** | `X maturity assignment: structural errors → X0, missing fields → X2, independent read present → claimed maturity preserved` + `valid fixture is promotable and deterministic` | `X0` on structural errors, `X2` on any blocker, `X3` preserved only with full promotable envelope | `EVIDENCE_LEDGER.md X-Scale`, `AUDIT.md §3` |
| **cannot write strk20.json** | `cannot write strk20.json — builder throws, validator blocks` + `reverted transaction blocks promotion` | Builder throws, validator errors, `validate.mjs` refuses path `strk20.json` | `G8`, `EVIDENCE_LEDGER.md Mainnet Receipt Rule` |

**Overall suite (this worktree):** `npm test` → **19 passed | 2 skipped (integration gated) | 209 passed | 14 skipped** (before Bundle 3T: 17 passed). New coverage is `T2` (state machine / chainId binding), `T5` (contract adversarial via malformed receipt), `T6` (backend verifier ladder via challenge class), `T8` (API contract `strk20.json` guard).

---

## 7. Packet → Audit / Ledger / Test Architecture / Notion mapping

### Audit gates — `AUDIT.md §4, §13`

| Gate | Target | Current after this bundle | Evidence |
|---|---|---|---|
| **G0 Mainnet pool reachability** | `SN_MAIN` pool interaction | `NOT_IMPLEMENTED` | No `SN_MAIN` tx; `ops/target-network/manifest.yaml:mainnet RELEASE_GATED_PROPOSED` correctly blocks |
| **G1 PrismIdentityRegistry** | `create/read` + identity invariants | `NOT_IMPLEMENTED` (code at X2, 7 snforge tests) — *no deploy* | `contracts/prism_identity_registry` unchanged; this bundle *prepares* deployment target `SN_SEPOLIA` without executing |
| **G2 Base ownership proof + binding** | Valid owner binds, wrong signer/replay/expiry/chainId fail | `X2 — offchain ladder + operation wrapper` (app-boundary `ERR-012/013/004/006/007/023`) — *no live Base/RPC trace* | `src/application/__tests__/app-boundary.test.ts` + `envelope-and-gates.test.ts:chainId` |
| **G3 Resolution + revocation** | Decisive `resolve=B` pre-revoke, `NO_ACTIVE` post-revoke, `P` persists | `X2 — resolver honesty via InMemoryRegistry + event-indexer` — *no live indexer* | `decisive-sequence.test.ts` + `event-reconstruction.test.ts` |
| G4 Unified Home | Real Starknet/Base balances | `NOT_IMPLEMENTED` | Unchanged |
| G5 STRK20 wallet product path | Shield/private transfer | `NOT_IMPLEMENTED` | Unchanged |
| G6 Prism-owned private application action | Helper deployed/tested | `NOT_IMPLEMENTED` | Unchanged |
| G7 Final evidence set (≥3 hashes `ok=pool=mine`) | Hub validator `sn_scripts/build-projects.mjs` | `NOT_IMPLEMENTED` — `strk20.json` empty | `ops/evidence/validate.mjs` checks `hub_validator` but does not populate `strk20.json` |
| G8 Release | Demo, video, `strk20.json`, no secrets | `NOT_IMPLEMENTED` | Secret-free templates pass; `strk20.json` guard enforced |

### Evidence ledger — `EVIDENCE_LEDGER.md`

| Evidence ID | Claim | Target | Current after bundle | Status |
|---|---|---|---|---|
| `EVD-PRISM-004` | Prism ID can be created/read on Starknet | X5 | X0 | `NOT_IMPLEMENTED` — no live `SN_SEPOLIA`/`SN_MAIN` create/read envelope |
| `EVD-PRISM-005` | Base control proof prevents unauthorized binding | X4 | X0 | `NOT_IMPLEMENTED` — offchain ladder proven at X2 only (TEST DOUBLE checker) |
| `EVD-PRISM-006` | Active Base binding resolves from Prism ID | X4 | X0 | `NOT_IMPLEMENTED` — harness `resolve=B` is InMemory, X2 |
| `EVD-PRISM-007` | Revoked Base binding no longer resolves while Prism ID persists | X4 | X0 | Decisive tail `X2` in harness; envelope `NOT PROMOTABLE` without independent read |

All rows remain `NOT_IMPLEMENTED` per “local pass = X2, never X3+ without observed evidence” (`RESEARCH_BACKEND_GATE.md`, `FOUNDRY_PROTOCOL §17`).

### Test architecture — `TEST_ARCHITECTURE.md` T‑ladder

| Tier | Definition | New / re-verified in this bundle | Maturity |
|---|---|---|---|
| T1 Domain | Challenge digest rules, template binding, envelope determinism | `envelope-and-gates.test.ts: deterministic`, `serialization.test.ts` | X2 |
| T2 State machine | All legal/illegal `SM-PRISM-001/002/003` transitions, envelope `X maturity` | `envelope-and-gates.test.ts: X maturity`, `decisive-sequence.test.ts` | X2 |
| T3 Property | Replay / chainId monotonicity fuzz | `envelope-and-gates.test.ts: chainId mismatch`, `replay-expiry-concurrency.test.ts` | X2 |
| T4 Contract unit | Registry `create/read/bind/revoke` storage/auth/events | Unchanged (7 snforge tests) | X2 |
| T5 Contract adversarial | Wrong caller, duplicate create, replayed digest, front-run | `envelope-and-gates.test.ts: malformed receipt / wrong network` | X2 |
| T6 Backend | Challenge service, verifier ladder, op lifecycle | `app-boundary.test.ts` (already X2), `decisive-sequence.test.ts` | X2 |
| T7 DB integration | `OwnershipProofStore` CAS, `OperationStore` durability | Unchanged (SQLite + gated Postgres, X2) | X2 |
| T8 API contract | Error shapes, idempotency, `strk20.json` guard | `envelope-and-gates.test.ts: cannot write strk20.json` | X2 |
| **T9 Ledger integration** | Backend ↔ registry event indexing, reconstruction guarantee | **Re-verified** via envelope deployment `block/status` + `event-reconstruction.test.ts`; envelope `wrong network` guards the `confirmed_block−K` staleness contract | X2 (no live ledger) |
| T10 Frontend integration | State labels derive from op states only | Unchanged | X2 |
| **T11 E2E** | Decisive proof sequence (`FT-001`) end-to-end | **New harness** `decisive-sequence.test.ts` + `DECISIVE_SEQUENCE_PROCEDURE.md` — offline `create→resolve→revoke→NO_ACTIVE` via `PrismApplicationService` | **X2** |
| **T12 Failure/recovery** | RPC outage, indexer lag, duplicate events, restart mid-bind | **Re-verified** via `envelope-and-gates.test.ts: absent independent read downgrade`, `poll-worker-divergence.test.ts`, `recovery-policy.test.ts`; envelope `REVERTED/UNKNOWN` blockers | X2 |
| T13 Upgrade | n/a (immutable, SD-002) | n/a | — |
| T14 Performance | not sprint-critical | — | — |

`T9/T11/T12` are **exercised at X2** (TEST DOUBLE). Live SN_SEPOLIA variants are gated on the target-network `ACCEPTED` + funded deployer (V7.5/V8.5) — see §10.

### Notion SC mapping (proposed SC rows — no Notion mutation per worktree isolation)

| Notion SC | Interpreted requirement | Implementation | Gate |
|---|---|---|---|
| **SC-04** | Resolve as Recorded — `resolve(P, venue)` returns ACTIVE destination as recorded onchain, with staleness bound | `decisive-sequence.harness.ts: resolveActive == B`, `event-indexer.ts: resolveBinding` + `isStaleProjection(watermark, confirmedBlock, K)` | T9/T11 |
| **SC-05** | Revocation persistence — `revoke` preserves `P`, `resolve` after revoke = `NO_ACTIVE_DESTINATION`, no reactivation | `decisive-sequence.harness.ts: revoke + resolve==null + get_identity persists`, `STATE_MACHINES.md SM-PRISM-002 TR-8-02 REVOKED→ACTIVE invalid` | T11 |
| **SC-06** | Ledger / operation boundary — `submitted ≠ completed`, ledger authority per state, reconciliation | `ops/evidence/evidence-envelope.ts: suggestedMaturity` clamps `submitted→completed` skip to `ERR-023`, `src/features/prism-operations/domain/operation.ts: INV-SYS-005` guard, `envelope-and-gates.test.ts: X maturity` | T12/AD-06 |
| **SC-10** | Nonce single-use — challenge `nonce` consumed atomically, replay fails `ERR-006` | `envelope-and-gates.test.ts: absent independent read` + `app-boundary.test.ts: replay submitProof ERR-006`, `InMemoryOwnershipProofStore.consumeNonce` CAS, `TEST-8-1-2` | T6/T12 |
| **SC-21** | Evidence maturity & promotion — deterministic envelope, independent verification gate, `X0→X2→X3` assignment, `strk20.json` isolation | `src/features/evidence/evidence-envelope.ts: validateEvidenceEnvelope` promotion blockers + `canonicalStringify`, `envelope-and-gates.test.ts` 10/10, `ops/evidence/validate.mjs --self-test`, `assertNoStrk20JsonWrite` | T8/T9 |

`SC-11 Digest single-use (ERR-007)` is sibling to SC-10 and is covered by `app-boundary.test.ts: replay via digest ERR-007` + `contracts/tests/test_prism_v83.cairo` — noted here for completeness. No Linear/Notion row was created or edited (worktree isolation).

---

## 8. Verification performed in this worktree (2026-08-23, offline)

```
npm test                        — 19 passed | 2 skipped (integration gated) | 209 passed | 14 skipped
                                — new: envelope-and-gates 10/10, decisive-sequence 2/2
npm run typecheck (tsc --noEmit) — PASS
npm run build (next build --webpack) — PASS  (routes / , /_not-found)
git diff --check               — clean (no whitespace errors)
node ops/target-network/validate.mjs — ✓ PROPOSED/UNDECIDED correctly blocking promotion
node ops/starknet/validate.mjs — ✓ secret-free templates pass
node ops/evidence/validate.mjs --self-test — ✓ promotion guards pass
node ops/evidence/build.mjs --self-test — ✓ deterministic fixture emitted (TEST DOUBLE labeled)
strk20.json check              — ✕ empty (correct — {"transactions":[],"contracts":[]} — not populated)
EVIDENCE_LEDGER.md / AUDIT.md / DECISIONS.md edits — none (no ledger row moves)
Frontend files touched          — none (checked: git status shows only backend/ops/evidence files)
Live network contact            — none (all validators/tests are offline)
```

Shared `node_modules` reused (`node_modules -> /home/ubuntu/prism-work/Prism/node_modules`); no reinstall.

---

## 9. Antagonist / Foundry review (must pass)

| Gate | Verdict | Note |
|---|---|---|
| Product Foundry — `CANONICAL_STATE §10` decisive proof preserved | **PASS** | No invariant redefined; harness exercises exactly the product-stated tail |
| System Foundry — `SYSTEM_CANONICAL §27` canonicity | **PASS** | New artifacts (`envelope.ts`, harness, manifest) are SPEC/OPS, not canonical domain/state/invariant edits; `DEC-PRISM-SYS-001` (ACCEPTED Option A) unchanged |
| Research Foundry — evidence limits, X-Scale, TEST DOUBLE labeling | **PASS** | Every non-live execution is labeled `TEST DOUBLE`, downgraded to `X2`, marked `NOT PROMOTABLE`; no X3+ claimed |
| Authority matrix — `DEC-PRISM-SYS-001` trust split | **PASS** | Envelope documents `backend TRUSTED VERIFIER for proof validity only, never for identity state`; no “trustless” claim |
| Privacy / banned claims — `SYSTEM_CANONICAL §8`, `RESEARCH gate §7` | **PASS** | No blanket privacy, no private-Base, no `PrismID=address`, no `strk20.json` writes, no shadow/guardian/solver language |
| Deployment safety — `SD-002` immutable, `SD-006` env-scoped, `SD-008` chainId | **PASS** | Manifest is release-gated; chainId bound into digest; templates have no active `url=` |

---

## 10. Unresolved owner / funding gates (explicit — do not silently accept)

| Gate | Owner | Status | Blocks |
|---|---|---|---|
| **DEC-PRISM-SYS-003** — chainId-v2 hardening (`e8886af`, SD-008) disposition `ACCEPT/REJECT` + EXTEND spec amendment (`SD-005`/`INV-SYS-011`/`OBJ-PRISM-005`) | Jason | **OPEN — red-team recommends ACCEPT as pre-deployment gate** (`CHAINID_V2_DECISION_PACKET.md §2`) | `policy.defaultChainId` wiring; cross-network replay window stays open until decided |
| **DEC-PRISM-OPS-001** — target-network manifest `ACCEPT` (testnet `SN_SEPOLIA+84532` default, mainnet `SN_MAIN+8453` release-gated) | Jason | **OPEN — PROPOSED/UNDECIDED** (`ops/target-network/manifest.yaml:owner_decision`) | Any `SN_SEPOLIA` deploy, V7.5/V8.5 harness live run, envelope promotion to `X3` |
| **Funding gate** — funded SN_SEPOLIA deployer (account + faucet), Base Sepolia funded EOA for ladder | Jason / owner | **OPEN** | Live `create/declare/deploy` (`sncast declare/deploy`), `Base` EOA→1271→6492 fixture corpus against live RPC |
| **G0 mainnet reachability** — small `SN_MAIN` pool interaction, `pool` receipt | Jason (manual wallet) | `NOT_IMPLEMENTED` | Phase-5 helper final-hash evidence (pool+mine) |
| `strk20.json` final hashes | — | `EMPTY` by design | Requires `DEC-PRISM-016` own-contract helper + 3× `ok=pool=mine` receipts |

All other runtime rows `EVD-PRISM-004..007` remain `NOT_IMPLEMENTED / X0`; local harness is `X2` only and never upgrades them (ledger template `BUILD_PRODUCTION_READINESS_PACKET §10 NOT_EVIDENCED`).

---

## 11. X maturity — honest assessment

```
X0 hypothesis            — large parts of sprint remain hypothesis (PrismClaim, PrismChannel, helper) — unchanged
X1 fixture/mock          — challenge fixtures, InMemory doubles, envelope fixtures — ✅ this bundle
X2 local controlled      — ✅ this bundle: PrismApplicationService + InMemory stores + snforge 7 tests + vitest 209 tests
                            + deterministic envelope/harness/validators — all green at X2
X3 realistic/testnet     — NOT_EVIDENCED — requires DEC-PRISM-OPS-001 ACCEPT + funded SN_SEPOLIA deploy + live DB CAS
X4 repeated/reproduced   — NOT_EVIDENCED — requires SN_MAIN repeat (V8.6, release-gated)
X5 mainnet/production independently verifiable — NOT_EVIDENCED — requires 3× hub-validator `ok=pool=mine` + explorer/RPC second read
```

No amount of offline promotion blocking or fixture passing moves any `X` level beyond `X2`. The statement for this bundle is:

> **PASS_WITH_LIMITATIONS — LOCAL BUILD EVIDENCE EARNED, RUNTIME/MAINNET EVIDENCE OPEN** (`AUDIT.md §18` verdict preserved).

---

## 12. Commit & inventory

**Base:** `5684163` (`feat(prism-operations): add Starknet ledger status adapter`)  
**Bundle 3T commit:** `HEAD` after `npm test + typecheck + build + diff-check` green — exact SHA recorded in session footer below (this packet is the review; the code packet is the same commit).

**Files in this bundle (backend/ops/evidence-prep only — no frontend/Cairo behavior change):**

```
ops/target-network/manifest.yaml
ops/target-network/PROPOSAL.md
ops/target-network/validate.mjs
ops/starknet/sncast.toml.example
ops/starknet/provider.example.toml
ops/starknet/accounts.json.example
ops/starknet/VALIDATION.md
ops/starknet/validate.mjs
src/features/evidence/evidence-envelope.ts
ops/evidence/README.md
ops/evidence/build.mjs
ops/evidence/validate.mjs
src/features/evidence/decisive-sequence-harness.ts
ops/testnet/DECISIVE_SEQUENCE_PROCEDURE.md
ops/testnet/decisive-sequence.harness.mjs
src/features/evidence/__tests__/decisive-sequence.test.ts
src/features/evidence/__tests__/envelope-and-gates.test.ts
BACKEND_BUNDLE_3T_REVIEW.md              (this file)
```

**Explicitly NOT in this commit:** `strk20.json` (empty), any `snfoundry.toml` with live secrets, any `sncast.toml`, `.env`, keystore, `EVIDENCE_LEDGER.md`/`AUDIT.md`/`DECISIONS.md` row moves, frontend files, contract Cairo edits, deployment receipts.

---

## 13. Session footer (FOUNDRY_PROTOCOL §17)

```text
Bundle:            3T testnet/evidence-preparation (Muse Spark 1.2 free)
Base commit:       5684163
New commit:        HEAD after verification (see git log --oneline -1)
Canonical artifacts updated: 0 (bundle is evidence-preparation, not system canonicalization)
Decisions created: 0 — 2 DECISION_REQUIRED proposals created (DEC-PRISM-OPS-001 + DEC-PRISM-SYS-003 companion)
Decisions superseded: 0
Assumptions added: 0 (ASM-SYS-001..003 remain open per SYSTEM_CANONICAL §6)
Evidence added:    0 (all runtime rows EVD-PRISM-004..007 stay NOT_IMPLEMENTED / X0; new fixtures are X2 local)
Maturity changes:  none — ceiling X2 honestly declared
Drift detected:    none — no product truth redefined; no protected DEC mutated
Unresolved:        DEC-PRISM-SYS-003 (chainId-v2), DEC-PRISM-OPS-001 (target-network), funding gate, G0, final hashes
Next evidence step: WP-0 owner decisions → V7.5 SN_SEPOLIA deploy + envelope with independent read (X3) → V8.5 decisive E2E on SN_SEPOLIA+Base Sepolia (X3) → V8.6 SN_MAIN (release-gated, X4/X5)
Verification:      npm test 19/2 209/14 ✓, typecheck ✓, build ✓, diff-check ✓, manifest ✓, starknet templates ✓, envelope guards ✓
Next gates:        G1/G2/G3 remain NOT_IMPLEMENTED until live network observation per ledger template
```

---

*Governing principle: Research → Experiment → Build → Evidence. No ledger row moves without observed results.*

