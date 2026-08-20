# Prism — Live Build Audit
## STRK20 Private Sprint / Research Foundry Control Document

**Audit date:** 2026-08-20  
**Project:** Prism  
**Repository:** `etvjay/Prism`  
**Sprint:** STRK20 Private Sprint  
**Current outcome:** `PASS_WITH_LIMITATIONS — BUILD APPROVED, EVIDENCE NOT YET EARNED`

---

# 1. Audit Purpose

This document governs whether Prism's product, architecture, integration, privacy claims, and sprint evidence remain aligned with verified reality.

The audit distinguishes:

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

Implementation is never treated as proof merely because it exists.

---

# 2. Research Foundry Loop

```text
RESEARCH
→ EXPERIMENT
→ BUILD
→ EVIDENCE
```

Extended lifecycle:

```text
INTAKE
→ FRAME
→ DECOMPOSE
→ PLAN
→ ACQUIRE
→ EXTRACT
→ VERIFY
→ MAP
→ BENCHMARK
→ OPPOSE
→ TEST
→ SYNTHESIZE
→ REPRESENT
→ AUDIT
→ DELIVER
→ ARCHIVE
```

---

# 3. Status Vocabulary

Item status is one of:

```text
PASS
FAIL
NOT_IMPLEMENTED
BLOCKED
```

Overall outcome is one of:

```text
PASS
PASS_WITH_LIMITATIONS
INSUFFICIENT_EVIDENCE
RESEARCH_REQUIRES_REFRAMING
```

Only `PASS` is treated as proven.

---

# 4. Evidence Maturity

```text
X0 = hypothesis
X1 = fixture/mock
X2 = local controlled
X3 = realistic/testnet
X4 = repeated/reproduced
X5 = mainnet/production independently verifiable
```

A higher level is not inferred from a lower one.

A transaction receipt can prove execution occurred without proving every privacy property of that execution.

---

# 5. Canonical Prism Claims

## CLM-PRISM-001 — Persistent identity

**Claim**  
A Prism ID persists independently of replaceable venue execution identities.

**Target evidence:** `X5`

**Decisive falsification test:**

```text
create P
bind B
revoke B
resolve(P, BASE) fails
P still exists
```

**Current:** `NOT_IMPLEMENTED / X0`

---

## CLM-PRISM-002 — Verified execution-identity binding

**Claim**  
An external execution identity cannot be canonically bound without evidence of control.

**Target:** `X4` minimum, `X5` desirable.

**Negative test:** unrelated Base signer attempts to bind another account.

**Current:** `NOT_IMPLEMENTED / X0`

---

## CLM-PRISM-003 — Resolution

**Claim**  
A Prism ID resolves to the currently active venue destination and never returns a revoked binding as active.

**Target:** `X4`.

**Current:** `NOT_IMPLEMENTED / X0`

---

## CLM-PRISM-004 — Unified financial home

**Claim**  
Prism can display real Starknet and Base financial state as one coherent user-facing portfolio without pretending the underlying chains share one ledger.

**Target:** `X4`.

**Current:** `NOT_IMPLEMENTED / X0`

---

## CLM-STRK20-001 — Private balance

**Claim**  
Prism can surface a real STRK20 shielded/private balance through a supported integration route.

**Target:** `X5`.

**Current:** `NOT_IMPLEMENTED / X0`

---

## CLM-STRK20-002 — Private transfer

**Claim**  
Prism can execute a real STRK20 private transfer on Starknet mainnet.

**Target:** `X5`.

**Current:** `NOT_IMPLEMENTED / X0`

---

## CLM-STRK20-003 — Private application action

**Claim**  
Prism can perform a meaningful application-specific private action using the supported STRK20 anonymizer / `privacy_invoke` mechanism.

**Target:** `X5`.

**Current:** `NOT_IMPLEMENTED / X0`

---

## CLM-PRISM-005 — Identity-addressed receive

**Claim**  
A sender can use Prism identity resolution to obtain the correct active destination for a supported venue.

**Target:** `X4`.

**Current:** `NOT_IMPLEMENTED / X0`

---

## CLM-PRISM-006 — Dust Recovery

**Claim**  
Prism can identify economically recoverable fragmented balances and prepare a valid recovery route.

**Target:** `X3+` if included.

**Current:** `NOT_IMPLEMENTED / optional`

---

# 6. Hackathon Compliance Audit

## Registration

- Public Prism repository exists: `PASS`
- Repository contains code: `PASS`
- Registration fork exists: `PASS`
- Registry entry added without modifying another entry: `PASS`
- Upstream registration PR opened: `PASS`

## Submission manifest

Root `strk20.json`: `PASS`

Current fields:

```json
{
  "transactions": [],
  "contracts": [],
  "demo_video": "",
  "demo_url": ""
}
```

Mainnet receipts: `NOT_IMPLEMENTED`

Deployed contracts: `NOT_IMPLEMENTED`

Demo video: `NOT_IMPLEMENTED`

Public demo: `NOT_IMPLEMENTED`

---

# 7. Mainnet Gate G0

**Requirement:** prove real STRK20 mainnet reachability before deep private-feature implementation.

Network:

```text
SN_MAIN
```

Canonical STRK20 pool:

```text
0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a
```

Success condition:

- successful mainnet transaction;
- touches the STRK20 pool;
- receipt can be independently verified;
- build commit recorded;
- evidence ledger updated.

**Status:** `NOT_IMPLEMENTED`

**Priority:** Critical / immediate.

---

# 8. Privacy Truth Table

Privacy claims are constrained by `profiles/STRK20_PRIVACY_PROFILE.md`.

## Shield

Publicly observable includes, at minimum for the public deposit leg:

```text
depositor
asset/token
amount
```

Do not describe shielding itself as hiding the deposit amount or depositor.

## Private note transfer

The intended protected relationship includes:

```text
sender
recipient
amount
```

subject to protocol metadata and observer assumptions documented by STRK20.

## Anonymized private DeFi / application execution

Do not promise full invisibility.

Potentially observable/correlatable information may include:

```text
amount
timing
destination protocol action
```

The useful property is unlinking the public execution identity from the originating private note/user under the supported threat model.

## Base

Ordinary Base execution remains public.

**Forbidden claim:** "Prism makes every chain private."

---

# 9. Architecture Decision Audit

## D1 — Starknet canonical identity root

**Status:** `PASS` as product/system decision; implementation evidence pending.

## D2 — Other chains remain native execution venues

**Status:** `PASS`.

## D3 — Wallet API first for normal STRK20 dapp flow

**Status:** `PASS` as current integration decision; mainnet compatibility still needs evidence.

## D4 — No dependency on unshipped private subaccounts

**Status:** `PASS`.

## D5 — Frontend/backend co-equal

**Status:** `PASS` as delivery rule.

## D6 — Base is the only external venue required for decisive MVP proof

**Status:** `PASS`.

## D7 — Prism is not an intent network or solver network

**Status:** `PASS`.

---

# 10. Novelty / Overlap Audit

Prism must not collapse into any of the following:

```text
ENS-style naming only
cross-chain privacy bridge only
universal balance abstraction
privacy wallet clone
intent solver network
MPC signer controlling every chain
portfolio aggregator only
```

Closest overlap risks:

- identifier-addressed payments;
- private account/portfolio concepts;
- cross-chain privacy hub;
- privacy wallets.

Prism's distinguishing product primitive must remain:

> **Persistent identity above replaceable native execution identities, with receiver/owner-controlled resolution and venue-specific privacy/execution truth.**

---

# 11. Falsification Tests

## FT-001 — Identity survives venue revocation

```text
Create P
Bind B
Resolve P→B
Revoke B
Resolve must fail
Read P must succeed
```

## FT-002 — Unauthorized binding

An unrelated Base account attempts to prove/bind control of another address.

Expected: reject.

## FT-003 — Replay ownership proof

Reuse an expired or consumed ownership challenge.

Expected: reject.

## FT-004 — Revoked resolver state

Resolver is queried after revocation.

Expected: never return revoked destination as active.

## FT-005 — Private-balance reconstruction

```text
shield
→ private balance changes
→ refresh/reconnect
→ same canonical private balance reconstructed
```

## FT-006 — Private action revert safety

Cause the Prism anonymizer/helper action to revert.

Expected: operation rolls back according to STRK20 semantics; no stranded value.

## FT-007 — Product privacy copy

Compare every private-state/action label against actual observer visibility.

Expected: no stronger claim than evidence supports.

---

# 12. Risk Register

| Risk | Severity | Current mitigation |
|---|---:|---|
| Wallet/API path fails on mainnet | Critical | G0 immediately |
| Meaningful anonymizer too large for sprint | Critical | build smallest real helper early |
| Prism degrades into address book | High | decisive bind/revoke/persist proof |
| External ownership proof replay | High | nonce/expiry/domain binding |
| UI presents submitted as completed | High | System/Experience lifecycle contract |
| Privacy marketing overclaims | High | STRK20 privacy profile + Evidence audit |
| Too many chains dilute MVP | High | Starknet + Base only |
| Portfolio indexing consumes sprint | Medium | simple real reads first |
| Dust recovery becomes bridge project | Medium | keep optional; execution via external route |

---

# 13. Build Gates

## G0 — Mainnet STRK20 reachability

Status: `NOT_IMPLEMENTED`

## G1 — Prism identity contract

Pass when:

```text
create identity
read identity
unique identifier invariant
controller authority enforced
```

Status: `NOT_IMPLEMENTED`

## G2 — Base ownership proof + binding

Pass when owner succeeds and unrelated signer/replay fails.

Status: `NOT_IMPLEMENTED`

## G3 — Resolution + revocation

Pass when decisive product proof passes.

Status: `NOT_IMPLEMENTED`

## G4 — Unified Home

Pass when real Starknet/Base state is shown truthfully in one product surface.

Status: `NOT_IMPLEMENTED`

## G5 — STRK20 product integration

Pass when private balance + real private action are working through the supported path.

Status: `NOT_IMPLEMENTED`

## G6 — Mainnet evidence set

Pass when at least three qualifying STRK20-pool mainnet receipts are recorded and at least one uses Prism's deployed contract where applicable.

Status: `NOT_IMPLEMENTED`

## G7 — Demo/release

Pass when:

```text
public demo works
3-minute video exists
README accurately explains architecture/privacy
strk20.json complete
no secrets committed
```

Status: `NOT_IMPLEMENTED`

---

# 14. Recommended Evidence Set

Strong sprint evidence target:

```text
Tx 1 — shield / pool entry
Tx 2 — real private transfer or second meaningful pool action
Tx 3 — Prism application-specific privacy_invoke action through Prism contract
```

If Prism deploys contracts, submitted evidence should demonstrate real use of those contracts where applicable.

---

# 15. Scoring Strategy

## STRK20 integration depth

Maximize through meaningful supported private functionality, not merely wallet connection.

## Working mainnet product

Prioritize reproducible mainnet flows and receipts before secondary features.

## Innovation

Demonstrate persistent Prism identity + revocable venue resolution as the product primitive, with STRK20 as private financial execution rather than the entire identity.

## Docs / open source

Keep Foundry → Profile → Project structure current and make privacy/evidence limitations explicit.

---

# 16. Immediate Build Order

```text
1. G0 mainnet pool reachability
2. Prism identity contract
3. Base control proof + binding
4. resolver + revoke
5. unified Home with real balances
6. STRK20 private balance/action path
7. meaningful privacy_invoke helper
8. collect mainnet evidence continuously
9. demo + submission hardening
```

Frontend and backend proceed as vertical slices rather than isolated phases.

---

# 17. Evidence Maintenance Rule

Every meaningful implementation milestone must update:

```text
projects/prism/EVIDENCE_LEDGER.md
projects/prism/AUDIT.md
strk20.json   # only when submission evidence exists
```

A successful runtime result should record:

```text
claim
build commit
environment
input/action
result
transaction/deployment if applicable
limitations
maturity change
```

---

# 18. Current Verdict

```text
Research grounding      PASS
Product coherence       PASS
Methodology structure   PASS
Starknet profiles       PASS
Sprint registration     PASS
Repository setup        PASS
Identity implementation NOT_IMPLEMENTED
Base binding             NOT_IMPLEMENTED
STRK20 mainnet evidence  NOT_IMPLEMENTED
Public demo              NOT_IMPLEMENTED
```

Overall:

> **PASS_WITH_LIMITATIONS — BUILD APPROVED, EVIDENCE NOT YET EARNED**

The project should now spend effort on execution and evidence rather than further Foundry design unless runtime evidence exposes a contradiction.

---

**Governing principle:**  
**Research → Experiment → Build → Evidence. Build only what can become evidence before the deadline.**
