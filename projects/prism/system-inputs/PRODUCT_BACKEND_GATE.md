# Prism — Product Backend Scope & Acceptance Gate (PRISM-7 / PRISM-8)

**Gate type:** Read-only backend scope + acceptance gate
**Run mode:** Product Foundry → canonical-repository-implementation-engine → `repository-drift-check` (consults product-truth via CANONICAL_STATE.md)
**Context profile:** deep (comprehensive audit scope declared by operator)
**Date:** 2026-08-22 (UTC)
**Repository:** `/home/ubuntu/prism-work/Prism` (`etvjay/Prism`, sprint STRK20 Private Sprint, deadline 2026-08-31 23:59 UTC)

**Read-only declaration:** This run edited no repository file. No code was implemented. No deployment status is inferred anywhere below — deployment claims appear only where an existing register states them, or as required future evidence with explicit NOT_EARNED status.

**Status of this document: DRAFT.** It becomes proposed when Jason accepts or amends the scope boundary in §5–§6; it does not become canonical without the acceptance criteria being wired into the PRISM-7/PRISM-8 Linear definitions of done and a passing gate execution.

---

## 1. Project & Maturity

| Field | Value |
|---|---|
| Project | Prism — Starknet-native identity & financial coordination protocol |
| Sprint | STRK20 Private Sprint (STRK20), due **2026-08-31 23:59 UTC** |
| Canonical baseline | `projects/prism/CANONICAL_STATE.md` v0.1 (2026-08-20); DECISIONS v0.2; CONTRADICTIONS v0.2; EVIDENCE_LEDGER v0.2; AUDIT verdict `PASS_WITH_LIMITATIONS` |
| Implementation truth | Branch `supremacy817/prism-17-build-canonical-prism-landing-experience` @ `40d97fd`. Local `main` is **stale** (`fbb5084`) and does not contain the wallet-capability slice (`6f6a138`) or landing experience (`d0c27ed`). |
| Maturity register | Product truth: **canonical / stable**. System contracts: specified but **not canonicalized** under FOUNDRY_PROTOCOL §12 system gates (no domain-model.yaml/state-machine artifacts exist in-repo). Implementation: **early** — landing + wallet capability slice implemented (X2 local build evidence); identity/binding/resolution: NOT_IMPLEMENTED. Runtime/mainnet evidence: **X0 across all decisive claims** (AUDIT §4, EVIDENCE_LEDGER). |

Working-tree observation (fact): the checked-out branch carries one modified file (`src/features/landing/PrismLanding.module.css`) and several untracked files (`AGENTS.md`, `CLAUDE.md`, `docs/*`, `src/components/`). These are uncommitted implementation state, not accepted evidence.

Branch observation (fact): `agent/prism-7-registry` and `agent/prism-8-ownership` exist locally but both currently point at `40d97fd` — they are placeholders with no distinct work yet.

---

## 2. Protected Product Truth (accepted — do not silently change)

Sourced from CANONICAL_STATE.md §1–§15, DECISIONS.md (DEC-PRISM-001…018), docs/PRISM_DOCUMENTATION_V0_3.md §29 invariants. Any change to these is ≥ C6 and requires Product Truth review, not backend convenience.

**Accepted definition (canonical):**
> Prism is a Starknet-native identity and financial coordination protocol that gives a user one persistent Prism ID across multiple chain-specific execution accounts. Starknet anchors identity and continuity state; connected chains remain native execution venues; STRK20 provides Prism's first private financial state and private Starknet execution surface.

- Primary user: person managing assets across multiple venues who must reason about disconnected addresses/accounts/chains (CANONICAL_STATE §2).
- Painful moment: manual decisions about which address represents them, what is current, what is private, what survives rotation (§3).
- Core primitive: **`PrismIdentity`** — persistent ID independent of any execution address (§5).
- Canonical root: **Starknet owns canonical Prism identity state** (§6, DEC-PRISM-001).
- Execution model: Base = native external execution venue; venue-native signatures never substituted (§7, DEC-PRISM-004).
- Privacy model: private where the underlying system can prove privacy; STRK20 = first real private environment; Base public in v0 (§8, DEC-PRISM-006, DEC-PRISM-013).
- Trust/authority separation: `identity ≠ controller ≠ execution account` (DEC-PRISM-003); authentication ≠ execution authority (CON-PRISM-006).
- MVP venues: Starknet + Base only (DEC-PRISM-005).
- Shadow accounts excluded from sprint MVP (DEC-PRISM-015; CON-PRISM-011 open re upstream WalletAccountV6 evidence).
- Backend mirrors/indexes; it is never canonical authority for protocol state (DEC-PRISM-001 consequences; STARKNET_SYSTEM_PROFILE authority map).

### Negative invariants (must remain false)

From docs/PRISM_DOCUMENTATION_V0_3.md §29 (INV-PRISM-001…016), binding for backend work:

1. INV-001: Prism ID ≠ any bound execution address.
2. INV-002: revoking a binding never destroys the Prism ID.
3. INV-003: no external account becomes canonical without control evidence.
4. INV-004: resolver never returns revoked state as active.
5. INV-006/007: Base actions use Base-valid authorization; Starknet actions use Starknet-valid authorization.
6. INV-008/009: social handle is not the stable key; username reassignment must not silently transfer a binding.
7. INV-011: application code never requests/persists a viewing key.
8. INV-013: no cross-chain value movement claimed without a real route.
9. INV-014: no privacy property claimed beyond the specific mechanism.
10. INV-015: submitted ≠ completed.
11. INV-016: final sprint hashes satisfy pool + own-contract validation once contracts are declared (DEC-PRISM-016).

---

## 3. Decisive End-to-End Proof (the thing everything must serve)

CANONICAL_STATE §10 defines two proofs. PRISM-7 and PRISM-8 exist to make the first one executable:

```text
Create Prism ID P on Starknet
→ prove control of Base account B
→ bind B to P
→ resolve(P, BASE) = B
→ revoke B
→ resolve(P, BASE) = NO_ACTIVE_DESTINATION
→ P still exists
```

This is the smallest proof that Prism is not a name-to-address record (ASM-PRISM-001 validation sequence). The sprint's second decisive proof (private balance → real STRK20 mainnet action → verifiable receipt) belongs to the STRK20 phases, not to PRISM-7/8 — but PRISM-7 introduces the contract surface that later carries the own-contract evidence requirement (INV-016).

Honest status: this proof is **X0 / NOT_IMPLEMENTED** everywhere it appears in the registers. Nothing in this run observed any code, test, or receipt that advances it.

---

## 4. Exact MVP Backend Scope

### PRISM-7 — PrismIdentityRegistry vertical slice (Linear: Todo)

In-scope (from issue definition + DEC-PRISM-001/002/003):

1. Smallest Cairo/Scarb/Starknet Foundry contract surface:
   - `create_identity` (authorized actor, once per identity);
   - identity read (deterministic);
   - storage layout sufficient for the later binding lifecycle (bind/revoke/resolve state), no more.
2. Canonical past-tense events starting with `PrismIdentityCreated`; events sufficient to reconstruct identity state.
3. Authorization allocated to controller/registry — never frontend or backend cache.
4. Tests: uniqueness, duplicate creation rejection, unauthorized controller mutation rejection, persistence independent of bindings.
5. Evidence: Foundry test output, build commit + artifact, deployment receipt when deployed, EVD-PRISM-004 update only after observed create/read result.

Out-of-scope for PRISM-7 (explicit): anonymizer/helper contract, portfolio/pricing/social metadata, bridge/solver routes, universal account abstraction, hidden backend authority, upgradeability complexity absent an evidenced constraint, guardians/delegation/recovery/inheritance/agent authority.

### PRISM-8 — Base ownership proof, binding, resolution, revocation (Linear: Todo)

In-scope (from issue definition + DEC-PRISM-002/003/004/005, ASM-PRISM-005):

1. Base ownership challenge construction + signature verification path (domain-bound, nonce-bound, expiry-bound, account-bound, Prism-ID-bound).
2. Acceptance of a verified binding into canonical Starknet registry state (offchain verification, onchain canonicalization — per ASM-PRISM-005).
3. `resolve(active binding)` and `revoke(binding)`.
4. Parent Prism ID preserved through replacement/revocation.
5. Explicit operation/error states: invalid signer, altered message, expiry, replay, stale binding, revoked binding.
6. Evidence: contract/unit/property tests; EVD-PRISM-005/006/007 updated only after observed results; transaction receipts + independent resolution checks if deployed.

Out-of-scope for PRISM-8: MPC/universal signer, bridge/cross-chain value movement, private Base execution, social username as authority key, silent rebind after account transfer.

### Shared backend constraints (both slices)

- Modular-monolith layering per SYSTEM_FOUNDRY §13 where offchain components are added; domain layer imports no web framework/RPC SDK/driver.
- Never assume DB commit + chain confirmation is atomic (SYSTEM_FOUNDRY §14).
- Operation lifecycle distinguishes submitted/confirming/confirmed/completed (INV-015).
- Capability/least-privilege rules (DEC-PRISM-018) apply to any wallet-touching code adjacent to these slices.
- Environment-scoped config: default dev/runtime SN_SEPOLIA per CON-PRISM-012 resolution; mainnet remains an explicit release gate.

---

## 5. Dependency Order

Evidence-gated ordering (each step produces evidence before the next expands):

```text
1. PRISM-7  PrismIdentityRegistry scaffold + tests        (EVD-PRISM-004 target)
     ↓ (registry surface accepts bindings)
2. PRISM-8  Base proof → bind → resolve → revoke          (EVD-PRISM-005/006/007 targets)
     ↓ (decisive identity proof passes FT-001..FT-004)
3. G1→G3 build gates close (AUDIT §13)                    ← PRISM-7 closes G1; PRISM-8 closes G2+G3
```

Parallel tracks that do NOT block PRISM-7/8 but share the calendar:

- Manual Ready-wallet gate (Phase 1) and G0 SN_MAIN reachability — human wallet actions, independent of identity slices (STRK20_INTEGRATION_PLAN §8–9).
- Phase 2 shield/private-balance and Phase 5 helper spike — separate scope; the helper (Phase 5) should reuse PRISM-7's Cairo toolchain but is not gated on PRISM-8.

Hard sequencing constraint inside PRISM-8: challenge/verification design precedes binding acceptance; binding acceptance precedes resolver semantics; revocation tests precede any claim that the decisive proof passes.

Calendar risk (inference from AUDIT §5): deadline 2026-08-31 with all decisive gates NOT_IMPLEMENTED as of 2026-08-20 audit. PRISM-7 before PRISM-8 is mandatory — PRISM-8 cannot accept bindings without PRISM-7's registry state.

---

## 6. Explicit Non-Goals (v0 sprint, binding on backend work)

From CANONICAL_STATE §12, DEC-PRISM-010/015, PRISM-7/8 issue non-goals:

- solver network; universal bridge; custom PrismZK proof system;
- private Base execution; live Solana integration;
- inheritance engine; guardian system; autonomous agent wallet;
- universal balance abstraction; all-token/all-DeFi portfolio indexing;
- shadow-account dependency (revisit only via CON-PRISM-011 reopen conditions);
- MPC/universal signer foundation (rejected alternative in DEC-PRISM-001/004);
- upgradeability/proxy complexity without evidenced need;
- backend as canonical authority for any protocol state;
- social handles as authorization keys;
- any STRK20 anonymizer/helper work inside PRISM-7/8 scope (separate phase, separate evidence rule).

---

## 7. Testable Acceptance Criteria

A criterion counts as met only with observed evidence recorded in EVIDENCE_LEDGER.md at its declared maturity. Local test pass alone = X2, never X4/X5.

### PRISM-7 acceptance set

| # | Criterion | Test shape | Min maturity |
|---|---|---|---|
| A7-1 | Authorized actor creates an identity exactly once; second create for same ID fails | Foundry test, positive + duplicate-negative | X2 (X5 if deployed + observed onchain) |
| A7-2 | Identity read is deterministic and unchanged by unrelated state | Foundry test | X2 |
| A7-3 | Non-controller mutation of identity/controller state is rejected | Foundry adversarial test | X2 |
| A7-4 | `PrismIdentityCreated` (+ lifecycle events) emitted; event stream reconstructs identity existence/state | Foundry test + replay check | X2 |
| A7-5 | Registry contains no portfolio/social/metadata fields; diff review confirms minimal surface | repo inspection vs scope list §4 | review gate |
| A7-6 | Build reproducible: scarb build + starknet-foundry test green on clean checkout | CI/local command record w/ commit SHA | X2 |
| A7-7 | EVD-PRISM-004 updated only after observed create/read against a live network (Sepolia acceptable per CON-PRISM-012) | ledger entry w/ tx hash + network | X3+ |

### PRISM-8 acceptance set (= falsification tests FT-001…FT-004 operationalized)

| # | Criterion | Test shape | Min maturity |
|---|---|---|---|
| A8-1 | Correct Base signer binds intended account to their Prism ID | unit/property test | X2 |
| A8-2 | Wrong signer rejected | FT-002 negative test | X2 |
| A8-3 | Any alteration of message fields (Prism ID, account, domain, nonce) fails verification | field-mutation matrix | X2 |
| A8-4 | Expired proof fails | time/expiry test | X2 |
| A8-5 | Replayed/consumed proof fails | FT-003 replay test | X2 |
| A8-6 | `resolve(P, BASE)` returns active binding pre-revocation | query test | X2 |
| A8-7 | After revoke: resolver returns NO_ACTIVE_DESTINATION and P remains readable (decisive proof complete) | FT-001 + FT-004 combined | X2 locally; X4/X5 requires deployed contract + independent resolution check |
| A8-8 | Binding canonical only after Starknet state transition (offchain verify ≠ canonical) | ASM-PRISM-005 validation seq | X2 |
| A8-9 | Error catalogue covers: invalid signer, altered message, expiry, replay, stale binding, revoked binding — each with stable error semantics | spec-vs-test crosswalk | review gate |

### Gate-level acceptance for this document

- [ ] Jason accepts/amends §4 scope + §6 non-goals (status → proposed).
- [ ] PRISM-7/PRISM-8 Linear descriptions reference these criteria as definition-of-done (or deltas are registered as decisions).
- [ ] First PRISM-7 test run executed on a clean checkout with commit SHA recorded (first real evidence movement).

---

## 8. Required Artifacts

Per FOUNDRY_PROTOCOL handoff envelopes + PRISM-7/8 evidence requirements:

Backend/contract (per slice):
- Contract source under a scoped path (e.g. `contracts/` or repo-equivalent), Scarb manifest, test tree.
- `PrismIdentityRegistry` operation spec rows (SYSTEM_FOUNDRY §12 contract format: caller, auth, storage reads/writes, events, revert codes, replay protection) — currently MISSING in repo; required before PRISM-8 acceptance, recommended before PRISM-7 code freeze.
- Event schema for `PrismIdentityCreated`, `ExecutionIdentityBound`, `BindingRevoked` (past tense, reconstructable).
- Test output artifacts with commit SHA + toolchain versions.
- Deployment receipt (network, address, deploy tx hash) when/if deployed — recorded in EVIDENCE_LEDGER.md, never inferred.

Control-plane updates (mandatory per AUDIT §17):
- `projects/prism/EVIDENCE_LEDGER.md` — new EVD entries using the yaml template.
- `projects/prism/AUDIT.md` — gate status changes (G1/G2/G3) + §4 claim table.
- `projects/prism/ASSUMPTIONS.md` — ASM-PRISM-001 and ASM-PRISM-005 status flips only on validation evidence.
- Root `strk20.json` — untouched by PRISM-7/8 unless a qualifying mainnet receipt genuinely exists (currently empty by design; do not populate from Sepolia work).

Missing-in-repo gap flagged honestly: FOUNDRY_PROTOCOL §13 recommends machine-readable companions (`foundry/domain-model.yaml`, `invariants.yaml`, `state-machines.yaml`). They do not exist. Not blocking PRISM-7 start, but PRISM-8's resolver semantics deserve at least `state-machines.yaml` for binding states before its code freezes.

---

## 9. Applicable Repository Gates

From FOUNDRY_PROTOCOL §12 + engine mode gates:

| Gate | Applies to | Status |
|---|---|---|
| owner-authority | this run | PASS — single primary owner (repository engine), read-only mode, no authority exceeded |
| protected-truth | every PRISM-7/8 change | ACTIVE — §2 invariants are hard constraints; violations route back to Product Truth, never patched downstream |
| evidence-status | every acceptance claim | ACTIVE — X-scale maturity enforced; "implemented" ≠ "evidenced" |
| artifact-completeness | gate closure | OPEN — contract spec + event schemas missing (§8) |
| Universal canonicalization gates | PRISM-7/8 outputs | OPEN until upstream handoff accepted, contradictions classified, assumptions registered, next-evidence step named |
| System canonicalization gate (SYSTEM_FOUNDRY §27) | PRISM-7/8 becoming canonical system truth | OPEN — most checkboxes currently unsatisfiable in-repo |
| Vertical-slice gate (SYSTEM_FOUNDRY §24) | after PRISM-8 | OPEN — success + rejected input + permission failure + stale-state conflict + dependency failure + retry + recovery must all be exercised |
| Hub-equivalent final-hash validation (INV-016, STARKNET_MAINNET_EVIDENCE_PROFILE) | strk20.json submissions only | N/A until mainnet receipts exist; `ok=pool=mine=true` required once contracts declared |
| Release gate G8 | sprint end | OPEN — public demo, video, README, ≥3 validated hashes, privacy-wording audit, no committed secrets |

Build hygiene gates carried forward from prior phases: `npm run typecheck`, `npm run build`, diff check (still passing at last recorded runs, EVD-PRISM-012/013); equivalent scarb/starknet-foundry checks newly apply to contract slices.

---

## 10. Contradictions & Reopening Requirements

Open items that directly touch PRISM-7/8:

1. **CON-PRISM-011 (OPEN)** — upstream WalletAccountV6 docs now expose `shadow_account_invoke` while DEC-PRISM-015 excludes shadow accounts from MVP. Requirement: keep exclusion during these slices; reopen DEC-PRISM-015 **only if** pinned-package verification (`starknet@10.4.0`) shows wallet-facing support AND shadow accounts materially strengthen the decisive proof. Do not silently absorb either direction into implementation.
2. **CON-PRISM-006 (OPEN)** — product authentication vs wallet authority. PRISM-8's binding flow must not conflate app-session auth with Base signature authority; closure requires one end-to-end authenticated session with real wallet execution.
3. **ASM-PRISM-001 (OPEN, High)** — registry sufficiency for differentiation. The decisive proof (§3) is its validation; failure would be a REOPEN-class event for the product itself.
4. **ASM-PRISM-005 (OPEN, High)** — offchain-verified/onchain-canonicalized Base control. Its validation sequence is embedded in A8-2…A8-8; rejection forces mechanism redesign at System layer, not a quiet workaround.
5. **Stale main branch (observation)** — `main` lacks the wallet + landing work; merging order and PR base selection are delivery decisions outside this gate's authority, but PRISM-7/8 branches should cut from the current working branch tip (`40d97fd`), not stale `main`.

Reopen triggers (any one forces upstream routing, ≥ REOPEN class):
- Starknet cannot provide required persistence/authority semantics (DEC-PRISM-001 reopen clause);
- a supported wallet path cannot express the required flow (DEC-PRISM-007 reopen clause);
- evidence contradicts the privacy model as implemented (INV-014 breach);
- hub validator logic changes such that own-contract strategy invalidates the helper plan (INV-016 dependency);
- deadline reality forces scope expansion beyond §6 non-goals — that is a Product Truth decision, never an implementation convenience.

Resolved-but-recorded constraints still binding: CON-PRISM-001 (one identity, many native identities), CON-PRISM-002 (no private-Base claims), CON-PRISM-012 (Sepolia default dev env; mainnet explicit gate).

---

## 11. Skill Handoff Recommendations

Per FOUNDRY_PROTOCOL typed handoffs, in order:

1. **system-integrity-engine (System Foundry)** — immediate next owner for PRISM-7/8 mechanism truth: contract operation specs, binding state machine (`active/revoked/...`, invalid transitions listed), error catalogue (A8-9), authority matrix rows for identity/binding/resolution. Consumes: ProductDefinition envelope from CANONICAL_STATE §1–§14 + protected decisions DEC-001…018. Produces: `SYSTEM_CANONICAL` artifacts / machine-readable companions (§8 gap).
2. **validation-evaluation-engine** — convert §7 criteria into the executable validation plan (T-ladder mapping: T4/T5 contract tests → FT-001..FT-004; T11 E2E decisive workflow).
3. **security-assurance-engine** — threat-model consult on the Base challenge path (replay, cross-domain signature reuse, nonce handling, front-running of bind) before PRISM-8 code freeze; required consult whenever privacy/security claims are made.
4. **delivery-execution-engine** — owns the merge-order decision (stale `main`), branch strategy for `agent/prism-7-registry`/`agent/prism-8-ownership`, and the countdown plan against 2026-08-31; also owns G8 release gate sequencing.
5. **interface-ecosystem-engine (deferred)** — API surface §33 of PRISM_DOCUMENTATION stays draft-only until the registry exists; do not expose endpoints ahead of canonical system truth.
6. **knowledge-evidence-presentation-engine** — privacy-copy audit (FT-007) applies to any README/docs language added alongside these slices.

---

## 12. Output Contract Summary (Product Foundry §output contract)

- Project/maturity: §1
- Primary owner + mode: header (repository engine / repository-drift-check)
- Canonical inputs: CANONICAL_STATE v0.1, DECISIONS v0.2, ASSUMPTIONS v0.1, CONTRADICTIONS v0.2, EVIDENCE_LEDGER v0.2, AUDIT 2026-08-20, PRISM_DOCUMENTATION v0.3, STRK20_INTEGRATION_PLAN v0.1, FOUNDRY stack v0.95, profiles ×4, Linear PRISM-7/8
- Protected decisions: §2
- Assumptions/evidence limits: §10; all runtime claims X0; nothing herein verifies deployment
- Findings/proposed decisions: §4–§7 (scope, order, criteria)
- Artifacts produced: this gate document only
- Change classification: **C1/C2 (status/gate work)** — no protected truth touched, no repo mutation
- Gate status: owner-authority PASS; protected-truth PRESERVED; evidence-status ENFORCED; artifact-completeness OPEN
- Unresolved risks: §10 items 1–5 + deadline exposure (AUDIT §5)
- Handoffs: §11
- **Status: DRAFT** — awaiting Jason's sign-off on §4/§6/§7 to become PROPOSED; canonicalization additionally requires the §7 gate-level checklist.
