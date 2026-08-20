# Prism — Live Build Audit
## STRK20 Private Sprint / Research Foundry Control Document

**Audit date:** 2026-08-20  
**Project:** Prism  
**Repository:** `etvjay/Prism`  
**Sprint:** STRK20 Private Sprint  
**Current outcome:** `PASS_WITH_LIMITATIONS — BUILD APPROVED, EVIDENCE NOT YET EARNED`

---

# 1. Audit Purpose

This document governs whether Prism's product, architecture, STRK20 integration, privacy claims, and sprint evidence remain aligned with verified reality.

```text
FACT
OBSERVATION
INFERENCE
HYPOTHESIS
DECISION
IMPLEMENTATION
DEPLOYMENT
EVIDENCE
```

Implementation is not proof merely because it exists.

---

# 2. Research Foundry Loop

```text
RESEARCH → EXPERIMENT → BUILD → EVIDENCE
```

Evidence may reopen a mechanism or decision; downstream convenience may not silently redefine Product truth.

---

# 3. Evidence Maturity

```text
X0 hypothesis
X1 fixture/mock
X2 local controlled
X3 realistic/testnet
X4 repeated/reproduced
X5 mainnet/production independently verifiable
```

A transaction hash proves execution facts only. It does not automatically prove a privacy claim.

---

# 4. Canonical Prism Claims

| Claim | Target | Current |
|---|---:|---|
| Persistent Prism ID survives venue-account replacement/revocation | X5 | X0 / NOT_IMPLEMENTED |
| External account cannot bind without proof of control | X4+ | X0 / NOT_IMPLEMENTED |
| Active venue destination resolves; revoked destination does not | X4 | X0 / NOT_IMPLEMENTED |
| Real Starknet + Base financial state appears coherently | X4 | X0 / NOT_IMPLEMENTED |
| Real STRK20 private balance is surfaced through supported wallet route | X5 | X0 / NOT_IMPLEMENTED |
| Real private transfer executes on SN_MAIN | X5 | X0 / NOT_IMPLEMENTED |
| Meaningful Prism-owned pool-integrated private action executes on SN_MAIN | X5 | X0 / NOT_IMPLEMENTED |
| ≥3 final hashes satisfy current hub validation | X5 | X0 / NOT_IMPLEMENTED |

---

# 5. Hackathon Compliance

## Registration

```text
Public Prism repo                      PASS
Repository has code                   PASS
Open-source license                   PASS
Root strk20.json                      PASS
Prism present in upstream registry    PASS
```

The upstream sprint `registry.json` currently contains `https://github.com/etvjay/Prism` with Telegram `JayDeculein`.

## Still required

```text
public live demo              NOT_IMPLEMENTED
3-minute demo video           NOT_IMPLEMENTED
≥3 final qualifying hashes   NOT_IMPLEMENTED
deployed contract evidence   NOT_IMPLEMENTED
```

Deadline: **2026-08-31 23:59 UTC**.

---

# 6. G0 — Mainnet Reachability

Network:

```text
SN_MAIN
```

Canonical pool:

```text
0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a
```

G0 closes when a user-controlled supported wallet performs a small real mainnet pool interaction and the successful pool receipt is recorded.

**Status:** `NOT_IMPLEMENTED`

G0 is preparatory engineering evidence. It does **not** have to be one of the final three scoring hashes.

---

# 7. Current Integration Route

Normal Prism user flow:

```text
get-starknet 6.0.3
→ starknet.js 10.4.0 / WalletAccountV6
→ Privacy Wallet API 0.10.3
→ privacy-enabled wallet
→ STRK20 pool
```

Rules:

- Prism never receives the user's viewing key.
- Capability detection uses Wallet API/spec version checks at or above the current stable v0.10.3 threshold, not a private-balance read.
- Private-balance reads are requested only because Private Balance is an intentional product feature.
- Direct Privacy SDK is reserved for controlled-key/advanced routes, not the ordinary consumer dapp.
- The browser UI must show the observed Starknet environment and block private-action readiness when it does not match the configured target.
- Wallet account/network changes are re-read through the current Wallet Standard event surface; stale authority state must not remain visible.

---

# 8. Current STRK20 Runtime Truth

## Shield

Public:

```text
depositor
token
amount
timing
```

Deposit screening is protocol-enforced.

UX must account for:

```text
ERC-20 approve
→ pool deposit
```

and explain the two wallet prompts.

## Note maturity

Fresh notes generally mature for roughly ten blocks before ordinary later spending.

Prism must present a truthful maturing/pending state.

## Private transfer

Protected within the supported note-to-note path:

```text
sender
recipient
amount
token type
spent-note relation
```

## Open notes

Open-note ownership can be hidden while the note amount is public.

## Private DeFi / application execution

Potentially public:

```text
amount
timing
protocol/action
open-note amount
```

Useful privacy property:

```text
direct user identity ↔ public action linkage hidden under supported threat model
```

## Composition leakage

Bundling a public deposit with the transfer it funds makes depositor + amount + timing directly correlatable. Prior shielding provides a stronger unlinkability story at the cost of another pool operation, fee, and maturity wait.

## Fees

Read current pool fee from `get_fee_amount`; never hard-code a historical fee. `MAX` and minimum useful transaction sizes must reserve the fee.

## Relayers

Private transaction sender may be a rotating/shared relayer. Do not attribute activity using transaction sender.

## Base

Ordinary Base execution is public.

---

# 9. Shadow-Account Status Audit

Earlier sprint-facing material described sub-accounts as coming soon.

Current SDK evidence is more specific:

```text
SDK route:
  release-candidate implementation exists
  renamed SubAccount → ShadowAccount in 0.14.3-RC.5

Wallet API route:
  equivalent normal-dapp capability not currently exposed
```

**Decision:** exclude shadow accounts from sprint-critical MVP. This is a route/scope decision, not a claim that the SDK feature is absent.

---

# 10. Hub Validator Audit — Critical

The current upstream `scripts/build-projects.mjs` validates each hash in `strk20.json.transactions`.

Each hash must:

```text
exist on Starknet mainnet
have execution_status == SUCCEEDED
contain an event from the canonical STRK20 pool
```

If `strk20.json.contracts` contains any project contracts, **every selected hash** must additionally involve at least one declared project contract.

Current project-involvement check accepts:

```text
receipt event from a declared project contract
OR
declared project address present in transaction calldata
```

This corrects the earlier weaker interpretation that only one transaction needed to use Prism code.

### Consequence

After Prism declares contracts:

```text
ordinary shield                may fail final evidence eligibility
ordinary private transfer      may fail final evidence eligibility
Prism helper-mediated action   can satisfy pool + mine checks
```

The final evidence path must therefore be designed around a meaningful Prism-owned pool-integrated contract.

---

# 11. Application-Contract Strategy

Do not build an anonymizer merely for a scoring checkbox.

Before custom Cairo:

1. check the target protocol for a current first-party private path;
2. inspect the closest public StarkWare anonymizer reference;
3. choose the smallest action that strengthens Prism's financial-home product;
4. verify it can generate genuine pool transactions involving Prism code.

Current candidate spike:

> **Private capital allocation from the Prism Home**, potentially adapting the current public Vesu lending anonymizer reference.

Possible lifecycle:

```text
private allocation/deposit through Prism helper
→ unwind/withdraw through Prism helper
→ second distinct allocation/action through Prism helper
```

**Status:** implementation proposal, not yet canonical mechanism.

A generic AVNU private swap is not sufficient reason to build a Prism swap helper because AVNU currently has a first-party private route. First-party convenience and hackathon own-contract evidence must be evaluated separately.

---

# 12. Falsification Tests

## FT-001 — Identity persistence

```text
Create P
Bind B
Resolve P→B
Revoke B
Resolve fails
Read P succeeds
```

## FT-002 — Unauthorized binding

Unrelated Base signer cannot bind another account.

## FT-003 — Replay

Expired/consumed Base control proof fails.

## FT-004 — Revoked resolution

Resolver never returns revoked binding as active.

## FT-005 — Private balance lifecycle

```text
shield
→ confirmed
→ maturing
→ available
→ refresh/reconnect
→ correct private balance
```

## FT-006 — Helper atomicity

Force Prism helper action to revert. Expected: supported atomic rollback, no stranded value.

## FT-007 — Privacy copy

Every private label is checked against actual observer visibility.

## FT-008 — Hub-equivalent final-hash validation

For every hash selected for `strk20.json`:

```text
ok == true
pool == true
mine == true   # once contracts declared
```

---

# 13. Build Gates

## G0 — Mainnet pool reachability
`NOT_IMPLEMENTED`

## G1 — PrismIdentityRegistry
Pass on create/read + identity invariants.
`NOT_IMPLEMENTED`

## G2 — Base ownership proof + binding
Pass valid owner + invalid owner + replay/expiry tests.
`NOT_IMPLEMENTED`

## G3 — Resolution + revocation
Pass decisive Prism proof.
`NOT_IMPLEMENTED`

## G4 — Unified Home
Real Starknet/Base data with truthful states.
`NOT_IMPLEMENTED`

## G5 — STRK20 wallet product path
Wallet capability + intentional balance + shield + private transfer.
`NOT_IMPLEMENTED`

## G6 — Prism-owned private application action
Meaningful helper deployed/tested and used through the pool.
`NOT_IMPLEMENTED`

## G7 — Final evidence set
At least three hashes satisfying the current pool + own-contract validator logic.
`NOT_IMPLEMENTED`

## G8 — Release
Public demo + 3-minute video + complete `strk20.json` + README + no secrets.
`NOT_IMPLEMENTED`

---

# 14. Evidence Strategy

Preparatory evidence:

```text
G0 small shield / pool reachability
```

Final submission evidence after contracts are declared:

```text
Tx A — meaningful pool action through Prism helper
Tx B — reverse/second lifecycle action through Prism helper
Tx C — another real supported pool action through Prism helper
```

Do not add a hash to `strk20.json` until hub-equivalent verification passes.

---

# 15. Primary Risks

| Risk | Severity | Mitigation |
|---|---:|---|
| Supported wallet/mainnet path fails | Critical | G0 immediately |
| Custom helper becomes too large | Critical | spike smallest meaningful action early |
| Final hashes touch pool but not declared Prism code | Critical | hub-equivalent validator before inclusion |
| Prism degrades into address book | High | bind/resolve/revoke/persist decisive proof |
| UI shows submission as completion | High | explicit operation lifecycle |
| Deposit UX looks like duplicate tx | High | explain approve + deposit substates |
| Fresh notes treated as immediately spendable | High | maturity state |
| Privacy copy overclaims amounts/timing | High | privacy profile + runtime audit |
| Shadow-account scope creep | Medium | excluded from MVP |
| Too many venues/features | High | Starknet + Base only |

---

# 16. Current Build Order

```text
1. G0 mainnet pool smoke test as soon as user wallet is ready
2. wallet connection + capability vertical slice
3. PrismIdentityRegistry scaffold in parallel
4. shield/private balance lifecycle
5. Base proof + binding + resolver/revoke
6. private transfer
7. Prism-owned helper spike + tests
8. deploy helper and earn three qualifying mainnet receipts
9. unify Home / Activity / receipts
10. demo + release hardening
```

The current root `STRK20_INTEGRATION_PLAN.md` governs the implementation phases.

---

# 16A. Phase 1 Implementation Checkpoint

The wallet/capability code path is implemented and headlessly verified. This changes implementation state, not runtime evidence maturity.

```text
capability threshold corrected to >= 0.10.3
explicit SN_MAIN / SN_SEPOLIA / UNKNOWN state
wrong-network state
account/network change re-read
wallet-standard disconnect
```

```text
TypeScript check        PASS
Next production build   PASS
diff check              PASS
manual Ready observation PENDING
G0 mainnet evidence      NOT_IMPLEMENTED
```

The exact commit and manual result belong in the phase record and evidence ledger after observation.

---

# 17. Evidence Maintenance Rule

Every meaningful runtime milestone updates:

```text
projects/prism/EVIDENCE_LEDGER.md
projects/prism/AUDIT.md
```

Update root `strk20.json` only when the evidence actually exists and has passed final eligibility checks.

---

# 18. Current Verdict

```text
Research grounding                 PASS
Product coherence                  PASS
Foundry/Profile structure          PASS
Current STRK20 source refresh      PASS
Registration upstream              PASS
Repository setup                   PASS
Current integration plan           PASS
Wallet implementation              NOT_IMPLEMENTED
Prism identity implementation      NOT_IMPLEMENTED
Base binding                       NOT_IMPLEMENTED
G0 mainnet evidence                NOT_IMPLEMENTED
Project helper                     NOT_IMPLEMENTED
Final three mainnet receipts       NOT_IMPLEMENTED
Public demo                        NOT_IMPLEMENTED
```

Overall:

> **PASS_WITH_LIMITATIONS — BUILD APPROVED, EVIDENCE NOT YET EARNED**

The methodology is no longer the bottleneck. Execution and evidence are.

---

**Governing principle:**  
**Research → Experiment → Build → Evidence. Build only what can become evidence before the deadline.**
