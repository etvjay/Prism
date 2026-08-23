# M5 Closeout Protocol — Prism-Owned STRK20 Action / PrismClaim

**Status:** Proposed closeout protocol  
**Scope:** Phase M5 only; Phase 8 excluded  
**Evidence ceiling:** local helper tests are X2; M5 is not accepted until the selected route is observed through the STRK20 pool on SN_SEPOLIA.

## M5 closure rule

```text
M5 decision
+ Product Truth fit
+ first-party interface fit
+ System authority/state/error/event alignment
+ local contract/adversarial tests
+ real testnet pool integration
+ independent receipt/readback
+ Research/privacy claim review
+ AUDIT G6 gate
= M5 accepted
```

A helper passing `snforge` alone is not M5 acceptance.

---

## Decision fork

### Option A — PrismClaim

Product-native flow:

```text
human identifier
→ unresolved recipient
→ private claim
→ onboarding
→ persistent Prism identity
→ claim/refund
```

This is the stronger Prism narrative, but it is currently blocked by four missing decisions:

```text
D-M5-1  external-principal verification/attestation route
D-M5-2  Claim ↔ STRK20 pool composition and atomicity
D-M5-3  Claim authority/state/error/event model
D-M5-4  Claim privacy-visibility statement
```

To select Claim, all four must be accepted into Product/System/Research truth before implementation.

### Option B — Prism-owned application helper

Current artifact:

```text
PrismAllocationHelper
canonical privacy_invoke ABI
measured output delta
caller-scoped approval
atomic rollback tests
11/11 local Cairo tests
```

This is the faster technically specified route, but it must be tied to a real, meaningful Prism action and a real first-party-compatible pool target. The current vault-shaped test target is not itself live evidence.

## Recommended closure route

For a time-bounded, evidence-honest M5 closeout:

```text
select Option B for M5 implementation/evidence
record Claim as a deferred M5 re-entry, not as rejected Product Truth
choose one real Prism Home/private action and target protocol
prove it through the pool on SN_SEPOLIA
```

Do not call the generic local vault fixture the final Prism product action.

---

# M5.0 — Record the route decision

Create an append-only decision containing:

```yaml
decision_id: DEC-PRISM-M5-001
selected_route: HELPER | CLAIM
selected_action: exact product action
pool_route: first-party privacy_invoke-compatible path
mainnet_evidence_strategy: declared Prism contract involvement
claim_status: deferred | accepted | superseded
owner: Jason
```

If `selected_route: CLAIM`, D-M5-1..4 must be attached and accepted.

If `selected_route: HELPER`, the record must explicitly state:

```text
The helper is the selected current evidence route.
PrismClaim remains a future product-native route, not silently deleted.
The helper does not claim amount/timing privacy beyond the underlying route.
```

**Gate:** no code lane is accepted before this decision exists.

---

# M5.1 — Ratify the helper/action specification

For the selected helper, record:

```text
input token
output token
external protocol/application target
privacy_invoke ABI
pool caller semantics
output note semantics
approval direction
value conservation
failure rollback
public metadata
privacy property actually supported
```

Required privacy statement:

```text
The helper may hide the direct user linkage behind the pool/application action.
It does not automatically hide amount, timing, target protocol, or open-note amount.
```

Required authority statement:

```text
The helper is permissionless/stateless only where the first-party route permits it.
The pool remains the caller that receives the returned open-note deposit.
The helper cannot create canonical Prism identity state.
```

**Gate:** Product Foundry and System Foundry review pass; no invented ABI.

---

# M5.2 — Local contract acceptance

Required clean run:

```bash
scarb clean
scarb build
snforge test
```

Required tests:

```text
measured output delta
zero input/output token
zero amount
equal tokens
insufficient balance rollback
application-action rollback
caller-only output approval
foreign pull rejection
stateless repeated invocation
nonzero note token/amount
no storage/events/privacy overclaim
```

Current baseline:

```text
PrismAllocationHelper: 11/11 local tests
```

This closes local T4/T5 evidence only. It does not close M5.

---

# M5.3 — Testnet pool integration

Deploy the selected helper/action to SN_SEPOLIA only after M5.0/M5.1/M5.2.

Run a real supported pool invocation:

```text
wallet/pool prepares input
→ pool calls Prism helper via privacy_invoke
→ helper calls real application target
→ helper measures output
→ helper approves pool
→ pool credits returned note/output
```

Record:

```text
helper address
class hash
deployment receipt
pool transaction hash
application target transaction/effect
pool event
returned note/output
block number
execution status
```

Required negative live/fixture cases:

```text
application target revert
insufficient input
zero output
wrong caller
stranded output
replayed invocation
```

**Gate:** actual pool semantics observed; test double alone is insufficient.

---

# M5.4 — Independent evidence and reconciliation

Build and validate an evidence envelope containing:

```text
network: SN_SEPOLIA
contract/helper address
class hash
deploy tx
pool tx
application/action reference
block/status/events
independent RPC/explorer read
commit/spec versions
privacy limitations
```

The envelope must:

```text
remain X2 if independent read is absent
promote to X3 only after observed testnet receipt + independent read
never write strk20.json
```

Run the actual upstream validator where available. A local reimplementation of `ok/pool/mine` is not sufficient final evidence.

---

# M5.5 — Cross-Foundry acceptance

### Product Foundry

```text
action strengthens Prism Home/identity/financial coordination
not a generic DeFi transaction
user-facing meaning is explicit
```

### Research Foundry

```text
first-party route inspected
source freshness recorded
privacy claims bounded
unknowns/contradictions visible
```

### System Foundry

```text
authority matrix updated
state machine updated
error/event catalogue aligned
value conservation invariant recorded
pool/adapter boundary explicit
```

### Antagonist Foundry

```text
replay
stranded funds
unauthorized caller
output substitution
expiry/atomicity
privacy metadata leakage
validator mine=false path
```

### AUDIT

```text
G6 meaningful Prism-owned action
T4/T5 contract/adversarial
T9 ledger integration
T11 decisive workflow where applicable
T12 failure/recovery
EVD evidence row
```

---

# M5 acceptance states

```text
M5-DRAFT
  route proposed, no implementation claim

M5-BLOCKED
  required interface/authority/privacy decision missing

M5-X2-LOCAL
  selected code/tests green, no live pool evidence

M5-X3-TESTNET
  live pool action + receipt + independent read + review gates green

M5-ACCEPTED-FOR-MAINNET
  testnet route accepted, mainnet deployment/evidence packet ready
```

The only valid transition to `M5-ACCEPTED-FOR-MAINNET` is:

```text
M5-X3-TESTNET
+ Product/System/Research/Antagonist review
+ AUDIT G6 pass
+ mainnet validator rehearsal
```

---

# Stop criteria

Stop and reopen M5 if:

```text
Claim ABI or authority is invented
helper cannot be called by the real pool route
pool does not receive/credit the measured output
funds can strand on failure
output approval is not caller-scoped
privacy claim exceeds observed mechanism
upstream validator returns mine=false
three-hash strategy is impossible under declared contracts
M5 is being used to hide missing M4 wallet functionality
```

## Bottom line

The fastest honest M5 close is not “ship the existing helper because 11 tests pass.” It is:

```text
select helper route explicitly
choose a meaningful Prism action
prove its real pool integration on SN_SEPOLIA
record independent evidence
pass all Foundry/AUDIT/red-team gates
then prepare the SN_MAIN helper route
```
