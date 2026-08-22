# Research Backend Gate — Prism (PRISM-7 / PRISM-8)

**Gate type:** READ-ONLY evidence and uncertainty gate. No code implemented; no repo files edited by this run.
**Produced:** 2026-08-22 (UTC)
**Framework:** Research Foundry (skill `research-foundry` v0.2.0) over the repo-local Foundry control plane (`foundry/FOUNDRY_PROTOCOL.md` v0.95)
**Primary owner:** Research Foundry (mode: evidence/uncertainty gate for backend handoff)
**Status of this document:** canonical-input gate report — DRAFT for Jason's acceptance

---

## 0. Evidence scale used here (Research Foundry E-scale)

| Level | Meaning |
|---|---|
| E0 | assertion — no inspected support |
| E1 | observed/reported — direct local observation or named actor report |
| E2 | sourced — an identifiable, relevant source supports it (cited below) |
| E3 | corroborated — independent sources/methods converge |
| E4 | analyzed — controlled analysis or implementation evidence supports it |
| E5 | operational — real operation, independent review, or repeated external validation |

Repo-local X-scale (X0–X5 in `EVIDENCE_LEDGER.md`, `AUDIT.md`) measures implementation/runtime maturity; E-scale here measures claim support. They are deliberately distinct and both are shown where relevant.

---

## 1. Research mandate

**Decision this research must inform:** whether backend agents can begin PRISM-7 (PrismIdentityRegistry vertical slice) and PRISM-8 (Base ownership proof → binding → resolution → revocation) without violating canonical truth, inventing mechanisms, or making unsupportable privacy/security claims — and what evidence they must emit to move ledger entries from X0/E0 upward.

**Decision owner:** Jason (Victory Et). Audience: coding agents (Codex/Claude workers) executing PRISM-7/8, plus downstream Evidence/Audit review.

**Scope boundary (protected):**
- Starknet is the canonical identity root (DEC-PRISM-001).
- Backend may index/cache/enrich; it must never become canonical authority for identity state (docs v0.3 §6; STARKNET_SYSTEM_PROFILE).
- Identity ≠ controller ≠ execution identity (DEC-PRISM-002/003).
- Base stays a native execution venue; no MPC/universal signer; no private Base execution (DEC-PRISM-004, CON-PRISM-002).
- No shadow accounts, guardians, delegation, recovery, inheritance, agent authority in this slice (DEC-PRISM-015; PRISM-7 non-goals).

**Inference boundary:** everything below labeled E≤2 must be re-verified before it gates a merge; nothing in this document may be upgraded by an implementation agent's own say-so.

**Non-goals of this run:** sprint scoring strategy beyond what gates PRISM-7/8; frontend work; STRK20 helper design (Phase 5) except where the hub own-contract rule constrains sequencing.

---

## 2. Inputs inspected (canonical, with versions/dates)

All paths relative to `/home/ubuntu/prism-work/Prism` unless noted. All read 2026-08-22.

| Artifact | Version/date marker | Role |
|---|---|---|
| `docs/PRISM_DOCUMENTATION_V0_3.md` | v0.3, 2026-08-20 | product/protocol architecture reference |
| `docs/STRK20_CONTEXT.md` | 2026-08-20 | verified ecosystem constraint handoff |
| `STRK20_INTEGRATION_PLAN.md` | v0.1, 2026-08-20 | approved phase plan (Phases 0–8) |
| `foundry/FOUNDRY_INDEX.md`, `FOUNDRY_PROTOCOL.md` | v0.95 | cross-foundry authority/handoff rules |
| `foundry/RESEARCH_FOUNDRY.md` | — | evidence maturity method |
| `projects/prism/CANONICAL_STATE.md` | v0.1, 2026-08-20 | product/system baseline |
| `projects/prism/DECISIONS.md` | v0.2 (DEC-001…018) | decision ledger |
| `projects/prism/ASSUMPTIONS.md` | v0.1 (ASM-001…009) | assumption register |
| `projects/prism/CONTRADICTIONS.md` | v0.2 (CON-001…012) | contradiction register |
| `projects/prism/EVIDENCE_LEDGER.md` | v0.2 (X-scale) | evidence ledger |
| `projects/prism/AUDIT.md` | audit date 2026-08-20 | live build audit, verdict PASS_WITH_LIMITATIONS |
| `projects/prism/PHASE_01_WALLET_CAPABILITY.md` | commit `6f6a138`, 2026-08-20 | Phase 1 record |
| `profiles/*.md` (System, Interface, Privacy, Mainnet-Evidence) | refresh 2026-08-20 | verified ecosystem constraints |
| `src/features/wallet/walletState.ts` | working tree | capability threshold `>=0.10.3` confirmed in code |
| `strk20.json` | root | transactions=[], contracts=[] (confirmed empty) |
| git branches `agent/prism-7-registry`, `agent/prism-8-ownership` | local | currently at same commits as landing branch tip (`40d97fd`); **no PRISM-7/8-specific commits yet** |
| Linear (primary, API read 2026-08-22): PRISM-7 "PrismIdentityRegistry vertical slice" = Todo; PRISM-8 "Base ownership proof, binding, resolution, and revocation" = Todo; PRISM-5 = In Progress; PRISM-6 (G0) = Todo | — | authoritative issue definitions |

External sources consulted (access date 2026-08-22):
- S1: https://strk20-by-example.org/starknet-wallet-api/overview — STRK20 support landed in starknet.js 10.4.0 on npm `next`; `latest` (10.0.x) has none of the STRK20 API.
- S2: https://registry.npmjs.org dist-tags (fetched via curl) — `starknet`: latest 10.0.2 / next 10.7.1; `@starknet-io/get-starknet-discovery`: latest 5.0.0-beta.0 / next 6.0.4; `@starknet-io/get-starknet-wallet-standard`: latest 5.0.0-beta.0 / next 6.0.5; `@starknet-io/types-js`: latest 0.10.3 / beta 0.10.4-beta.2.
- S3: https://docs.base.org/base-account/guides/sign-and-verify-typed-data — Base Account is an ERC-4337 smart wallet; message verification goes through EIP-1271 `isValidSignature`; undeployed wallets sign under ERC-6492 wrappers.
- S4: https://github.com/base/skills/blob/master/skills/building-with-base-account/references/authentication.md — SIWE (EIP-4361) flow; viem `verifyMessage`/`verifyTypedData` handle EIP-1271/ERC-6492 automatically; server-side nonce tracking required.
- S5: https://eips.ethereum.org/EIPS/eip-1271 (via S3/S4 descriptions; standard text not separately fetched this run).

Not externally re-verified this run (flagged where material): current hub validator source `scripts/build-projects.mjs` (taken as documented in STARKNET_MAINNET_EVIDENCE_PROFILE + EVD-RSCH-STRK20-002, E2); Privacy SDK changelog 0.14.3-RC.5 shadow-account rename (E2, single-source); "~10 block" note maturity (E2, single-source, approximate wording already in-repo).

---

## 3. Atomic questions

### PRISM-7 — PrismIdentityRegistry vertical slice

- Q7.1 Can identity creation/read be proven on Starknet such that `PrismID != Starknet address` is enforced structurally (not just in copy)?
- Q7.2 Does the registry enforce one-time creation (uniqueness) and controller-only mutation, with rejection paths for duplicates and unauthorized callers?
- Q7.3 Do canonical past-tense events (`PrismIdentityCreated`, later `ExecutionIdentityBound`, `BindingRevoked`) reconstruct full state from receipts alone?
- Q7.4 Does identity state persist unchanged across unrelated binding mutations (the persistence half of the decisive proof)?
- Q7.5 What is the minimal Cairo/Scarb/Starknet Foundry surface that carries no upgradeability, portfolio, bridge, or metadata responsibility?
- Q7.6 What evidence upgrades EVD-PRISM-004 from X0, and at what maturity does a devnet/testnet deployment vs SN_MAIN deployment differ?

### PRISM-8 — Base ownership proof → binding → resolve → revoke

- Q8.1 What exactly does a "Base ownership proof" verify when the Base account is an ERC-4337 smart wallet rather than an EOA (EIP-1271 path; ERC-6492 for undeployed accounts)? [This is the sharpest unresolved technical question in PRISM-8 — see §5.]
- Q8.2 Is the challenge domain-bound, nonce-bound, expiry-bound, account-bound, and Prism-ID-bound such that replay/expiry/cross-domain reuse fails? (PRISM-8 acceptance tests demand all six bindings.)
- Q8.3 Where does signature verification happen — offchain (backend verifies, registry accepts attestation) vs onchain on Starknet — and does either preserve "canonical acceptance only after Starknet state transition" (ASM-PRISM-005 validation clause)? The repo documents offchain-verify→onchain-accept; it does NOT specify the mechanism that makes acceptance trust-minimized.
- Q8.4 Does the resolver never return revoked/stale bindings as active, including across RPC/indexer/cache disagreement (STARKNET_SYSTEM_PROFILE reconciliation rule)?
- Q8.5 Does revocation preserve the parent Prism ID (readable after revoke) — the decisive identity proof EVD-PRISM-007?
- Q8.6 What explicit error states exist for invalid signer, altered message, expiry, replay, stale binding, revoked binding?
- Q8.7 Does the binding flow avoid exposing more social/financial linkage than necessary (PRISM-8 privacy implication)?

---

## 4. Source/evidence status per material claim

Legend: Claim — E-level — status — basis.

### Product/canonical structure
| # | Claim | E | Status | Basis |
|---|---|---|---|---|
| C1 | Starknet is canonical identity root for v0 | E2 (as decision) | CANONICAL (decision-level, not empirical) | DEC-PRISM-001; docs v0.3 §6; CANONICAL_STATE §6 |
| C2 | PrismID ≠ Starknet address ≠ execution identity | E2 | CANONICAL decision; structurally unproven until PRISM-7 ships | DEC-PRISM-002/003 |
| C3 | Registry/binding/revocation/resolution implemented anywhere | E0 | NOT_IMPLEMENTED | EVD-PRISM-004..007 all X0; Linear PRISM-7/8 = Todo; branches carry no new commits (git observed) |
| C4 | Wallet capability slice code-complete, build passes | E4 | PASS at X2 (local controlled) | PHASE_01 record commit 6f6a138; tsc/build/diff pass recorded; manual wallet observation still open (honestly labeled) |
| C5 | Landing/Home shell compiles and renders truthfully | E4 | PASS at X2 | AUDIT §16B, commit d0c27ed; explicitly NOT X3+ |

### STRK20 / ecosystem (context for backend sequencing)
| # | Claim | E | Status | Basis |
|---|---|---|---|---|
| C6 | Route = get-starknet 6.0.3 → starknet.js 10.4.0/WalletAccountV6 → Privacy Wallet API ≥0.10.3 → pool | E3 | CORROBORATED as planned route; zero runtime runs | docs/STRK20_CONTEXT.md; INTEGRATION_PLAN §2–3; corroborated by S1/S2 version landscape |
| C7 | Repo pins are stale/outdated | E0 | REFUTED as stated | S1+S2: STRK20 support exists only in the `next` line (10.4.0+); npm `latest` 10.0.2 lacks WalletAccountV6/strk20 APIs entirely. Pins are deliberate; treat "upgrade pins" instructions from any agent as a drift risk requiring re-verification, not silent compliance |
| C8 | Hub validator requires every final hash to touch pool AND involve declared Prism contracts once contracts declared | E2 | SOURCED (documented from upstream script inspection on 2026-08-20; not independently re-fetched this run) | STARKNET_MAINNET_EVIDENCE_PROFILE; EVD-RSCH-STRK20-002; CON-PRISM-008/009 |
| C9 | G0 (SN_MAIN reachability) still open; strk20.json empty | E1 | OBSERVED locally | strk20.json read 2026-08-22 (transactions=[], contracts=[]); EVD-STRK20-001 X0; Linear PRISM-6 Todo |
| C10 | Shield deposit is public (depositor/token/amount/timing); private transfer hides sender/recipient/amount/token within supported route; withdrawals public destination/amount; composition leaks correlation | E2 | SOURCED, consistent across three internal docs | STRK20_PRIVACY_PROFILE; STRK20_CONTEXT truth table; AUDIT §8. Single external family of sources (STRK20 docs) — not independently audited |
| C11 | Note maturity ≈10 blocks; two-tx shield (approve+deposit); fees via get_fee_amount; relayer senders unreliable | E2 | SOURCED, approximate ("generally", "roughly") — treat as heuristic UX constraint, not protocol constant | STRK20_CONTEXT; INTEGRATION_PLAN §5; PRIVACY_PROFILE |
| C12 | Screening is protocol-enforced; self-hosting prover doesn't bypass it | E2 | SOURCED, load-bearing for legal/compliance posture — single-source | STRK20_CONTEXT "Screening" |
| C13 | Shadow accounts exist SDK-side (RC 0.14.3-RC.5) but not on wallet-API route; excluded from MVP | E2 | SOURCED + internally consistent; upstream moving (CON-PRISM-011 OPEN — newer starknet.js next-guide reportedly documents `shadow_account_invoke`) | DEC-PRISM-015; CON-PRISM-003/011; AUDIT §9 |

### Base / cryptography (PRISM-8 critical path)
| # | Claim | E | Status | Basis |
|---|---|---|---|---|
| C14 | A "signed Base challenge" can prove account control strongly enough for v0 binding | E2/HYPOTHESIS | ASSUMPTION ASM-PRISM-005, Open, risk High. The naive form (ecrecover over personal_sign) is insufficient for smart-contract wallets | S3/S4: Base Account = ERC-4337 smart wallet; verification must go through EIP-1271, with ERC-6492 wrapper handling for undeployed accounts. Repo docs do NOT yet name EIP-1271/ERC-6492 — this gate adds that requirement |
| C15 | Offchain verification + canonical Starknet acceptance preserves authority integrity | E0 | UNRESOLVED DESIGN QUESTION (Q8.3). No repo artifact specifies how the registry validates the offchain result without becoming a trusted oracle for it | Absence in DECISIONS/ASSUMPTIONS/docs v0.3 §7 (authority map lists "externally verified proof" without mechanism) |
| C16 | Replay/expiry/nonce/domain binding requirements are implementable in-scope | E2 | Requirements sourced from PRISM-8 acceptance tests; feasibility unproven (no spike exists) | Linear PRISM-8 description; FT-002/FT-003 in AUDIT |
| C17 | Viem-style unified verification (EOA + 1271 + 6492) reduces custom crypto surface | E3 | CORROBORATED by two independent Base sources | S3, S4 |

### Process/evidence hygiene
| # | Claim | E | Status | Basis |
|---|---|---|---|---|
| C18 | Audit verdict PASS_WITH_LIMITATIONS; methodology no longer bottleneck, execution/evidence are | E4 | Analyzed conclusion of 2026-08-20 audit; still accurate as of 2026-08-22 (nothing new shipped since — git observed) | AUDIT §18 |
| C19 | Sprint deadline 2026-08-31 23:59 UTC | E2 | SOURCED | AUDIT §5 |

---

## 5. Protocol & cryptographic assumptions (explicit register)

Backend agents MUST treat these as assumptions, not facts. Each blocks or shapes PRISM-7/8 work:

- A1 (Critical, Open — ASM-PRISM-002 analog for identity track): the minimal Cairo registry can express create/read/bind/revoke/resolve with the required authorization semantics inside sprint scope. Validation: smallest Scarb project + snforge tests before any UI coupling. Currently zero Cairo exists in the repo.
- A2 (Critical, Open — sharpens ASM-PRISM-005): **Base ownership proofs must handle contract wallets.** Any challenge/verify design that assumes `ecrecover(signer == account)` will silently reject ERC-4337 Base Accounts (a large share of real Base users). Required verification ladder: EOA ecrecover → EIP-1271 `isValidSignature` call on deployed accounts → ERC-6492 unwrapping for undeployed accounts. Where verification happens (backend viem-style vs on-Starknet) interacts directly with Q8.3 and is an irreversible-ish architecture choice — surface options to Jason before locking.
- A3 (High, Open): challenge binding fields (domain, nonce, expiry, account, prism_id) can be made tamper-evident end-to-end, with server-side single-use nonce consumption (S4 security checklist mirrors PRISM-8 tests).
- A4 (Medium): STRK20 behavioral constants (~10-block maturity, fee behavior, screening latency) remain approximately stable through Aug 31. Mitigation already mandated: read fees live, never hard-code; represent maturity as state, never as constant.
- A5 (High, time-boxed): upstream `next` tags keep moving (S2 shows discovery next=6.0.4, wallet-standard next=6.0.5, starknet next=10.7.1 vs pinned 10.4.0). Pins are correct today; every phase start re-runs the freshness check instead of upgrading opportunistically.
- A6 (Medium, Open — CON-PRISM-011): shadow-account wallet-route exposure may have changed upstream. Irrelevant to PRISM-7/8 scope; do not let it expand scope.

---

## 6. Uncertainty & contradictions (current, honest)

Open contradictions (from CONTRADICTIONS.md, unchanged by this run):
- CON-PRISM-006 — product auth vs wallet authority: OPEN until one end-to-end authenticated session + real wallet execution. Directly relevant to PRISM-8 (binding session ↔ signing authority separation).
- CON-PRISM-011 — shadow-account MVP exclusion vs newer WalletAccountV6 docs: OPEN. Contained; must not leak into PRISM-7/8.

Gaps/uncertainties introduced or sharpened by this gate:
- U1 (new, High): EIP-1271/ERC-6492 handling absent from repo canon. All existing PRISM-8 language says "signed Base challenge" generically. Until A2 is resolved and written into the plan/profile, any agent implementing plain-signature verification is building against an incomplete spec.
- U2 (new, High): acceptance-trust mechanism for cross-chain proofs unspecified (Q8.3). Options visible in-canon: (a) backend verifies and submits binding tx signed by user's Starknet controller (controller attests — simplest, keeps authority with keys the user controls); (b) on-Starknet verification of Base signatures (heavy; likely out of sprint scope); (c) some light-client/attestation route (out of scope). Option (a) appears consistent with DEC-PRISM-001/004 but is nowhere written down — needs an explicit DEC before PRISM-8 build starts. This is a reversible-to-decide-now / expensive-to-flip-later item: flagging for sign-off per standing directive.
- U3 (Medium): hub validator logic (C8) rests on one inspection episode (2026-08-20). Cheap to re-verify; do so before any `strk20.json` write (not on PRISM-7/8 critical path).
- U4 (Low/Medium): C10–C12 privacy truths come from a single documentation family; consistent internally, not independently audited. Acceptable for build constraints; insufficient for any external privacy CLAIM (which anyway requires runtime evidence per DEC-PRISM-013).
- U5 (Low): "roughly ten blocks" maturity figure is heuristic; exact value must be observed at runtime, not assumed.

Resolved contradictions relied upon (do not reopen casually): CON-PRISM-001/002/004/005/007/008/009/010/012.

---

## 7. Prohibited claims (hard bans for agents and copy)

No agent working PRISM-7/8 may produce any of the following, in code, docs, UI, or commit messages:

1. "Prism IDs are private" or any blanket privacy claim (DEC-PRISM-013). Private applies only to specific STRK20 routes with runtime evidence.
2. Any private-Base-execution implication (CON-PRISM-002). A Base binding being *verified* does not make Base activity private.
3. "Prism ID = address" conflation in any direction (STARKNET_SYSTEM_PROFILE protected boundary).
4. Claims that identity/bindings are "trustless," "fully decentralized," or "permissionless" — the acceptance mechanism (U2) is not yet specified; strongest permitted phrasing pre-evidence: "canonical state accepted on Starknet after control proof."
5. Submission-as-completion states anywhere in operation lifecycles (Interface Profile minimum lifecycle).
6. Treating a transaction hash as proof of any privacy property (Mainnet Evidence Profile).
7. Shadow accounts, guardians, delegation, recovery, inheritance, agent authority as features of this slice (DEC-PRISM-015; PRISM-7/8 non-goals).
8. Solver/bridge/cross-chain movement functionality or implication (DEC-PRISM-010, CON-PRISM-004).
9. Silent dependency upgrades of the `next`-tagged pins (A5); silent expansion into anonymizer/Cairo-for-hire work outside the declared slice.
10. Social handles, viewing keys, private balances, or linkage metadata stored/emitted by the registry (PRISM-7 privacy implications).
11. Marking EVD-PRISM-004..007 or any X-level entry as passed without an observed result recorded per the evidence template.
12. "Untraceable / invisible / anonymous amounts / zero metadata" vocabulary (Privacy Profile banned list).

---

## 8. Exact verification plan

Ordered; each step names its gate and the evidence it emits (§9 defines artifact shape).

### PRISM-7 — PrismIdentityRegistry
- V7.1 Scaffold smallest Scarb/Starknet Foundry project (separate crate; do not entangle Next.js app). Gate: `snforge test` green on empty scaffold. Emit: TEST-7.1 output + commit SHA.
- V7.2 Implement `create_identity` + `get_identity` (+ controller auth). Tests: unique-once creation; duplicate rejection; unauthorized mutation rejection; deterministic read. Gate: positive+negative+boundary suites pass. Emit: TEST-7.2 + contract class hash (devnet).
- V7.3 Add canonical events (`PrismIdentityCreated` first). Test: event reconstructs state from receipts alone. Gate: reconstruction test passes.
- V7.4 Persistence-under-mutation stub: create P, perform (later) binding ops, assert identity read unchanged. Interim: assert across controller rotation if implemented.
- V7.5 Deploy to SN_SEPOLIA. Record deployment tx + address + class hash. Upgrades EVD-PRISM-004 to at most X3 (testnet). X5 requires SN_MAIN + independent explorer/RPC re-read.
- V7.6 Explicitly defer: bind/revoke/resolve belong to V8.x; do not let them creep into V7 scope.

### PRISM-8 — Base ownership proof → binding → resolve → revoke
- V8.0 (BLOCKING, human sign-off): decide acceptance-trust mechanism (U2 option (a) vs alternatives) and write it into DECISIONS.md as a new DEC + update ASM-PRISM-005 validation plan with EIP-1271/ERC-6492 requirement (A2). No PRISM-8 implementation before this.
- V8.1 Challenge service: domain-bound, nonce-bound (single-use, server-tracked), expiry-bound, account-bound, prism-id-bound SIWE/EIP-712-style challenge. Gate: unit tests on nonce consumption/expiry/domain mismatch. Emit: TEST-8.1.
- V8.2 Verification ladder: ecrecover (EOA) → EIP-1271 `isValidSignature` (deployed smart wallet) → ERC-6492 unwrap (undeployed). Gate: fixtures for all three signature classes pass; wrong signer/altered message/expired/replayed all fail with DISTINCT error states. Emit: TEST-8.2 + fixture set.
- V8.3 Binding acceptance: verified proof → binding tx submitted/authorized by user's Starknet controller → registry state transition. Canonical acceptance = post-transition only. Tests: valid owner binds; unrelated signer cannot; replayed proof fails even against fresh registry state. (FT-002/FT-003.)
- V8.4 Resolve + revoke: resolver returns active binding; revoked binding NEVER returned as active (FT-004); Prism ID readable after revocation (decisive proof, EVD-PRISM-007). Include cache-disagreement test per System Profile reconciliation rule.
- V8.5 Full decisive sequence on SN_SEPOLIA (Starknet side) + Base Sepolia (or Base mainnet read-only proof): create P → bind B → resolve=B → revoke B → resolve fails → P persists. Record every tx hash + status. Target maturity: X3.
- V8.6 Only after Jason-approved release gate: SN_MAIN deployment and repeat of V8.5 → unlocks X4/X5 territory and touches sprint final-evidence eligibility (note: registry ops alone do NOT satisfy hub own-contract rule — that needs the Phase 5 helper; keep expectations separate).

### Cross-cutting gates (both slices)
- Every phase start: re-run pin freshness check (A5) + hub validator re-read if near submission work (U3).
- Every merge: tsc --noEmit + production build still pass (Phase 1 pattern).
- Privacy-copy lint against §7 ban list on any user-visible string added.
- Update EVIDENCE_LEDGER.md + AUDIT.md per milestone; never batch-update retroactively.

---

## 9. Evidence artifacts agents MUST emit

Minimum envelope per completed step (extends FOUNDRY_PROTOCOL §6.7 + EVIDENCE_LEDGER template):

```yaml
evidence_id: EVD-...            # existing IDs where the ledger already defines them
claim: <one sentence>
slice: PRISM-7 | PRISM-8
build:
  commit_sha:
spec_versions: []               # scarb, snforge/starknet-foundry, starknet.js, pins touched
environment:                    # devnet | SN_SEPOLIA | SN_MAIN | BASE_SEPOLIA | BASE_MAINNET
procedure:                      # exact commands run, in order
inputs:
result:                         # observed, not intended
transactions:                   # one block per tx
  - network:
    hash:
    block:
    status:                     # execution_status as observed
    contracts: []
tests:
  - suite:                      # e.g. identity_create_negative
    passed: N
    failed: N
hub_validator: { ok: , pool: , mine: }   # only where applicable
claim_scope:                    # what this evidence does NOT show
limitations:
independent_verification:       # explorer/RPC second read where available
maturity: X0..X5
observed_at: <UTC timestamp>
```

Additional mandatory artifacts:
- PRISM-7: contract artifact/class hash per deploy; event-reconstruction test output; explicit statement that registry stores no social/private metadata.
- PRISM-8: challenge fixture corpus (valid EOA, valid 1271, valid 6492, wrong-signer, altered-message, expired, replayed × domain/account/prism-id variants) with verification results table; the DEC recording the acceptance-trust mechanism (V8.0) BEFORE implementation evidence.
- Both: updated rows in `projects/prism/EVIDENCE_LEDGER.md` (only after observed results), a session footer per FOUNDRY_PROTOCOL §17, and drift classification if any deviation from canonical docs was needed (D0–D5 scale).

---

## 10. Freshness triggers (re-verify conditions)

| Trigger | Re-verify | Current anchor |
|---|---|---|
| Any phase start | npm dist-tags for starknet / get-starknet-* / types-js (`next` tags move weekly) | 2026-08-22 snapshot in §2/S2 |
| Before any `strk20.json` write | upstream `scripts/build-projects.mjs` validator logic | last audited 2026-08-20 |
| STRK20 Privacy SDK release/changelog change | shadow-account route status (CON-PRISM-011) | RC 0.14.3-RC.5 rename |
| starknet.js `next` guide change | WalletAccountV6 STRK20/shadow methods vs pinned 10.4.0 | CON-PRISM-011 sources |
| Pool fee/screening/maturity anomaly at runtime | fee read, screening states, maturity window | C11/A4/U5 heuristics |
| Base Account / Smart Wallet contract changes | EIP-1271/ERC-6492 verification assumptions (A2) | 2026-08-22 docs snapshot |
| Any privacy-claim-affecting contract/wallet/helper change | affected evidence marked stale and re-run | Mainnet Evidence Profile regression rule |
| Calendar: 2026-08-31 23:59 UTC | entire submission-evidence set recheck | sprint deadline |

---

## 11. Decision-grade handoff

**Verdict: CONDITIONAL GO for PRISM-7 and PRISM-8 backend work.**

- PRISM-7: GO immediately. Constraints are fully specified in-canon (scope, events, tests, non-goals). No unresolved contradiction touches it. Its evidence ceiling before mainnet deployment is X3; say so, don't overstate.
- PRISM-8: GO on V8.1–V8.2 (challenge service + verification ladder — these are pure-offchain and safe). BLOCKED at V8.3+ on one human decision: the acceptance-trust mechanism (U2/V8.0). Recommended default: backend verifies proof (viem-style, covering EOA/1271/6492), user's Starknet controller signs the binding transaction; canonical acceptance = Starknet state transition only. This is consistent with every protected decision but is currently unwritten — it must become an explicit DEC before implementation, because flipping it later means reworking registry authorization.

**Protected decisions acknowledged (unchanged, not mutated by this gate):** DEC-PRISM-001..018 as recorded; this gate ADDS requirements (EIP-1271/6492 coverage, acceptance-mechanism DEC) — it removes none. Per protocol, adding requirements to the PRISM-8 path is a STRENGTHEN-class change proposal, flagged for owner acceptance rather than silently applied.

**Honest bottom line (matches AUDIT §18):** methodology and documentation are strong; zero Prism protocol runtime evidence exists (every identity/base/STRK20 runtime row is X0). Just under ten days of runway remain before the sprint deadline (2026-08-31 23:59 UTC) when measured from 2026-08-22 00:00 UTC. PRISM-7/8 completion to testnet depth is feasible; mainnet-depth evidence additionally depends on the funded-wallet G0 path and the Phase 5 helper — neither started. Agents should optimize for honest X2/X3 evidence density, not breadth.

**Reopen conditions for this gate:** any A-assumption falsified; upstream validator logic diverges from C8; Base signature standards shift; sprint scope changes; CON-PRISM-006/011 resolutions alter the authority model.

---

*Session footer (FOUNDRY_PROTOCOL §17):*
```text
Canonical artifacts updated: none (read-only gate; this document is the only output)
Decisions created: 0 (1 REQUIRED before PRISM-8 V8.3 — acceptance-trust mechanism)
Decisions superseded: 0
Assumptions added: A1..A6 registered here pending migration into ASSUMPTIONS.md by owner
Contradictions added: U1, U2 surfaced here; registers untouched per read-only mandate
Evidence added: none; maturity unchanged (all runtime rows X0)
Drift detected: none in repo; agent-facing risk flagged on pin-upgrade pressure (A5/C7)
Unresolved questions: Q8.3 (blocking), U3/U4/U5 (non-blocking)
Next evidence-producing step: V7.1 scaffold tests (parallel-safe) + V8.0 decision (owner)
```
