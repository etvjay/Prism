# Prism System Canonical — PRISM-7 / PRISM-8
## System Foundry Package v0.1

```yaml
artifact_id: SYS-PRISM-78
artifact_type: system
version: 0.2
status: canonical            # DEC-PRISM-SYS-001 accepted (Option A) by owner Jason, 2026-08-23; V8.3 implementation is now unblocked and remains in progress
authority: System Foundry
created_at: 2026-08-22
updated_at: 2026-08-23
supersedes: null
depends_on:
  - projects/prism/CANONICAL_STATE.md@v0.1
  - projects/prism/DECISIONS.md@v0.2
  - projects/prism/ASSUMPTIONS.md@v0.1
  - projects/prism/CONTRADICTIONS.md@v0.2
  - projects/prism/EVIDENCE_LEDGER.md@v0.2
  - projects/prism/system-inputs/PRODUCT_BACKEND_GATE.md@2026-08-22
  - projects/prism/system-inputs/RESEARCH_BACKEND_GATE.md@2026-08-22
decision_refs:
  - DEC-PRISM-001..018 (all acknowledged, none mutated)
  - DEC-PRISM-SYS-001 (ACCEPTED — Option A, owner Jason, 2026-08-23; see DECISIONS.md)
evidence_refs:
  - EVD-PRISM-004..007 (all X0 — this package creates no evidence)
```

---

# 0. Run classification

This is a **specification / canonicalization run, not an implementation run**.

- No application code written. No dependencies installed. No contracts deployed. No evidence fabricated.
- All runtime claims remain X0 as recorded in `EVIDENCE_LEDGER.md`. Nothing here moves any ledger row.
- Scope is exactly **PRISM-7** (PrismIdentityRegistry vertical slice) and **PRISM-8** (Base ownership proof → bind → resolve → revoke). STRK20 phases, PrismClaim, PrismChannel, portfolio, and social principals are out of scope and are not modeled beyond naming their exclusion.

---

# 1. Product handoff acceptance (System Foundry §2 gate)

The System Foundry must refuse canonicalization without the Product handoff. It is present and accepted:

| Required item | Value | Source |
|---|---|---|
| primary user | Person managing assets across multiple venues who must reason about disconnected addresses/accounts | CANONICAL_STATE §2 |
| painful moment | Manual decisions about which address represents them, what is current, what is private, what survives rotation | CANONICAL_STATE §3 |
| desired outcome | One persistent financial home; native chain authority preserved; privacy truthfully represented | CANONICAL_STATE §4 |
| core primitive | `PrismIdentity` — persistent ID independent of any execution address | CANONICAL_STATE §5 |
| product invariants | INV-PRISM-001…016 | docs/PRISM_DOCUMENTATION_V0_3.md §29 |
| non-goals | Solver/bridge/PrismZK/private-Base/Solana/inheritance/guardian/agent-wallet/universal-balance/shadow accounts/MPC signer | CANONICAL_STATE §12; DEC-PRISM-010/015 |
| trust model | Starknet is the canonical identity root; backend mirrors, never owns | DEC-PRISM-001; docs v0.3 §6–7 |
| privacy requirements | Private only where the mechanism proves it; no registry metadata; no viewing keys | DEC-PRISM-006/013; INV-PRISM-011/014 |
| decisive proof | create P → prove Base control → bind → resolve=B → revoke → NO_ACTIVE_DESTINATION → P exists | CANONICAL_STATE §10 |
| protected decisions | DEC-PRISM-001…018 | DECISIONS.md v0.2 |

**All protected decisions are acknowledged and preserved. This package mutates none of them.** It added DEC-PRISM-SYS-001 (now ACCEPTED — Option A, owner Jason, 2026-08-23; recorded append-only in `DECISIONS.md`) and registers system-layer assumptions, per FOUNDRY_PROTOCOL change classes:

- `STRENGTHEN` (flagged for owner acceptance, per RESEARCH_BACKEND_GATE §11): EIP-1271/ERC-6492 coverage is now a hard requirement of the Base ownership proof.
- `EXTEND` (this package): machine-readable system companions now exist in-repo.

---

# 2. The contradiction this run reconciles

**Product intent is sufficient; implementation-grade system artifacts are missing.**

- Sufficient: PRISM-7/8 scope, acceptance criteria (A7-1…A7-7, A8-1…A8-9), falsification tests (FT-001…FT-004), invariants, authority map, and non-goals are fully specified in-canon (PRODUCT_BACKEND_GATE §2/§4/§6/§7).
- Missing: no domain model, no binding state machine, no contract operation specs (caller/auth/reads/writes/revert codes/replay), no event schemas, no error catalogue, no machine-readable companions (confirmed OPEN in PRODUCT_BACKEND_GATE §8/§9 artifact-completeness gate).
- Resolution: this package supplies exactly the missing artifacts, scoped to PRISM-7/8, derived by projection from accepted product truth — inventing no product decisions.

---

# 3. Artifact index

Human-readable authority (markdown is authoritative; YAML companions make conformance checkable — FOUNDRY_PROTOCOL §13):

| Artifact | File |
|---|---|
| System canonical (this file) | `SYSTEM_CANONICAL.md` |
| Domain objects | `DOMAIN_MODEL.md` + `domain-model.yaml` |
| State machines | `STATE_MACHINES.md` + `state-machines.yaml` |
| Invariants | `INVARIANTS.md` + `invariants.yaml` |
| Authority matrix + trust boundaries | `AUTHORITY_MATRIX.md` + `authority-matrix.yaml` |
| Contract & backend operation specs | `CONTRACT_SPEC.md` + `operations.yaml` |
| Event catalogue | `EVENT_CATALOGUE.md` + `events.yaml` |
| Error catalogue | `ERROR_CATALOGUE.md` + `errors.yaml` |
| Test architecture | `TEST_ARCHITECTURE.md` |
| Stack decisions | `STACK_DECISIONS.md` |

Persistence model, reconciliation rules, and observability chain are embedded in `CONTRACT_SPEC.md` (§5), `STATE_MACHINES.md` (§4), and `AUTHORITY_MATRIX.md` (§4) respectively — kept inline because PRISM-7/8 is a single contract plus a single backend service; separate files would be ceremony, not truth.

---

# 4. Scope

## PRISM-7 — PrismIdentityRegistry (precedes PRISM-8; hard ordering)

On-chain (Starknet) registry surface: `create_identity`, identity read, controller state, storage for the binding lifecycle, canonical events starting with `PrismIdentityCreated`. No binding logic in PRISM-7.

## PRISM-8 — Base proof / bind / resolve / revoke

Off-chain challenge service + Base signature verification ladder (EOA → EIP-1271 → ERC-6492), binding acceptance into registry state via the user's Starknet controller, `resolve`, `revoke`, and the full decisive sequence.

**Ordering rule (binding):** PRISM-8 cannot accept bindings without PRISM-7's registry state. No PRISM-8 implementation begins before PRISM-7's registry surface passes its acceptance set at X2. This mirrors PRODUCT_BACKEND_GATE §5 and AUDIT gates G1 → G2 → G3.

---

# 5. DECIDED — DEC-PRISM-SYS-001 (Option A, ACCEPTED)

**Status: ACCEPTED (owner Jason, 2026-08-23). Canonical. The PRISM-8 V8.3 binding slice is implemented in `contracts/prism_identity_registry` and verified at evidence level X2 (snforge local execution only — no contract/runtime/deployment evidence is claimed here; see `agent-packets/V8_3_IMPLEMENTATION_REPORT.md`).**

## The question

Where does trust for a cross-chain (Base) ownership proof come from when the Starknet registry accepts the binding? The repo canon says "offchain verification, onchain canonicalization" (ASM-PRISM-005) but **no artifact specifies the mechanism** that keeps this trust-minimized (RESEARCH_BACKEND_GATE U2 / Q8.3, support level E0).

## Accepted decision (Option A)

```text
DEC-PRISM-SYS-001 (ACCEPTED)
decision:    Backend verifies the Base ownership proof (viem-style ladder:
             EOA ecrecover → EIP-1271 isValidSignature → ERC-6492 unwrap).
             The user's Starknet controller signs the binding transaction.
             The registry enforces controller authorization and onchain
             single-use consumption of the proof digest. The binding becomes
             canonical ONLY at the Starknet state transition.
status:      accepted
reason:      Keeps authority with keys the user controls; consistent with
             DEC-PRISM-001 (Starknet root) and DEC-PRISM-004 (venue-native
             authorization); avoids heavy on-Starknet EVM signature
             verification (likely out of sprint scope).
alternatives_rejected:
  - on-Starknet verification of Base signatures (heavy; sprint risk)
  - light-client/attestation route (out of scope)
consequences:
  - the backend is a TRUSTED VERIFIER for proof validity (not for identity
    state); this must be stated plainly, never marketed as trustless
  - registry authorization model: bind/revoke caller MUST be the controller
  - onchain replay protection via consumed-proof-digest map
flip_cost:   HIGH — changing later reworks registry authorization, replay
             protection, and the error catalogue
reopen_if:   a supported wallet path cannot express controller-signed
             binding; or evidence shows backend-verifier trust breaks a
             protected invariant
```

## Downstream semantics that depended on this decision (now resolved by acceptance)

| Location | Dependency if DEC-PRISM-SYS-001 is NOT accepted |
|---|---|
| CONTRACT_SPEC OP-8-01 | bind authorization = controller-only; proof digest recorded but not consumed onchain |
| AUTHORITY_MATRIX row A4 | "Base ownership proof validity" primary authority = backend verifier |
| INVARIANTS INV-SYS-003 / INV-SYS-004 | canonical-only-after-transition; digest single-use placement |
| ERROR_CATALOGUE ERR-007 / ERR-009 | replay/not-controller errors assume this mechanism |
| STACK_DECISIONS SD-004 | viem unified verification dependency |
| Prohibited claims | "trustless/permissionless" stays banned until this DEC is accepted AND evidenced. The DEC is now accepted, but no onchain evidence exists — the ban remains in force at X2. |

If Jason selects a different option, affected artifacts are amended via a superseding decision — never silently.

## Second decision — DEC-PRISM-SYS-002 (non-blocking)

**Account exclusivity across Prism IDs:** canon does not state whether one Base account may be ACTIVE-bound to two different Prism IDs simultaneously. This package models resolution keyed by `(prism_id, venue)` and does NOT enforce cross-ID account exclusivity (no canon supports inventing it). Flagged because it affects resolver semantics and counterparty trust. Default while unresolved: allow, observe, revisit when Product truth lands.

---

# 6. System canonicalization gate (SYSTEM_FOUNDRY §27)

```text
[x] product handoff accepted                     (§1)
[x] canonical vocabulary defined                 (DOMAIN_MODEL.md)
[x] domain objects defined                       (DOMAIN_MODEL.md, OBJ-PRISM-001..005)
[x] decisive state machines complete             (STATE_MACHINES.md, SM-PRISM-001..003)
[x] critical invariants registered               (INVARIANTS.md, INV-SYS-001..012)
[x] primary authority assigned per critical rule (AUTHORITY_MATRIX.md)
[x] trust/information boundaries mapped          (AUTHORITY_MATRIX.md §3)
[x] contract operations specified                (CONTRACT_SPEC.md, OP-7-*, OP-8-*, OP-B-*)
[x] async workflows explicit                     (STATE_MACHINES.md SM-PRISM-003)
[x] errors structured                            (ERROR_CATALOGUE.md)
[x] persistence classified                       (CONTRACT_SPEC.md §5)
[x] reconciliation defined                       (AUTHORITY_MATRIX.md §4)
[x] observability chain defined                  (AUTHORITY_MATRIX.md §5)
[ ] vertical-slice contract EXECUTED             (defined in TEST_ARCHITECTURE.md §5; execution is implementation-run work — OPEN by design)
[x] testing ladder mapped to invariants          (TEST_ARCHITECTURE.md)
[x] unresolved assumptions registered            (§5 + ASM-SYS-001..003 below)
[x] next evidence spike named                    (§7)
```

**Gate status: CANONICAL (v0.2)** — every specification checkbox is closed or explicitly tracked open. (a) DEC-PRISM-SYS-001 was ACCEPTED by the owner (Option A, 2026-08-23). (b) Vertical-slice execution: PRISM-7 executed previously; PRISM-8 V8.3 bind/resolve/revoke/digest-single-use implementation and tests are complete at evidence level X2 (snforge only). Deployment, runtime, and mainnet verification remain open pre-deployment gates (including SD-008 chainId-v2 hardening).

## Assumptions registered by this package (to migrate into ASSUMPTIONS.md by owner)

```yaml
- assumption_id: ASM-SYS-001
  statement: >
    The minimal Cairo registry can express create/read/bind/revoke/resolve with
    required authorization semantics inside sprint scope (RESEARCH_BACKEND_GATE A1).
  risk: critical
  validation: smallest Scarb + snforge suite before any UI coupling (TEST-7.1)
  status: open
- assumption_id: ASM-SYS-002
  statement: >
    Base ownership proofs must handle contract wallets via EIP-1271 and undeployed
    accounts via ERC-6492; naive ecrecover-only design silently rejects ERC-4337
    Base Accounts (RESEARCH_BACKEND_GATE A2/U1).
  risk: critical
  validation: TEST-8.2 ladder fixtures
  status: open
- assumption_id: ASM-SYS-003
  statement: >
    Challenge binding fields (domain, nonce, expiry, account, prism_id) can be made
    tamper-evident end-to-end with server-side single-use nonce consumption
    (RESEARCH_BACKEND_GATE A3).
  risk: high
  validation: TEST-8.1
  status: open
```

---

# 7. Next evidence-producing step

```text
V7.1 (parallel-safe, unblocked): smallest Scarb/Starknet Foundry scaffold +
     empty-suite green run, recorded with commit SHA — first movement of
     EVD-PRISM-004 off X0.
V8.0 (owner, BLOCKING): accept or amend DEC-PRISM-SYS-001.
V8.1–V8.2 (unblocked by DEC): challenge service + verification ladder
     (pure offchain, per RESEARCH_BACKEND_GATE §11 verdict).
```

---

# 8. Prohibited claims carried into all PRISM-7/8 work

From RESEARCH_BACKEND_GATE §7, binding on this package and every downstream consumer:

1. No blanket privacy claims (DEC-PRISM-013).
2. No private-Base implication (CON-PRISM-002).
3. No Prism ID = address conflation.
4. No "trustless / fully decentralized / permissionless" while DEC-PRISM-SYS-001 is unresolved.
5. Submitted ≠ completed anywhere in lifecycles.
6. A tx hash is not proof of a privacy property.
7. No shadow accounts / guardians / delegation / recovery / inheritance / agent authority in this slice.
8. No solver/bridge functionality or implication.
9. No silent pin upgrades (`next`-tagged deps).
10. No social/viewing-key/linkage metadata in the registry.
11. No ledger row moves without observed results.
12. No "untraceable / invisible / zero metadata" vocabulary.

---

# 9. Session footer (FOUNDRY_PROTOCOL §17)

```text
Canonical artifacts updated: projects/prism/system/* (17 files, created)
Decisions created: DEC-PRISM-SYS-001 (ACCEPTED — Option A, owner Jason, 2026-08-23), DEC-PRISM-SYS-002 (PROPOSED, non-blocking, unresolved)
Decisions superseded: 0
Assumptions added: ASM-SYS-001..003 (pending owner migration into ASSUMPTIONS.md)
Contradictions added: 0 (U1/U2 from RESEARCH_BACKEND_GATE are modeled, not new)
Evidence added: none — all runtime rows remain X0
Maturity changes: none
Drift detected: none (package is a projection of accepted product truth)
Unresolved questions: DEC-PRISM-SYS-002 (non-blocking; cross-ID exclusivity) — DEC-PRISM-SYS-001 was ACCEPTED (Option A, 2026-08-23); SD-008 chainId-v2 hardening remains an open pre-deployment gate
Next evidence-producing step: V7.1 scaffold tests + V8.0 owner decision
```
