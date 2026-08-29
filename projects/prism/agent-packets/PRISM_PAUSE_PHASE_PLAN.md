# Prism Pause — Phased Implementation and Evidence Plan

**Status:** Proposed Product/System phase plan  
**Owner:** Prism / Jason  
**Change class:** C6 — new execution-control primitive and pre-settlement authority boundary  
**Date:** 2026-08-23  
**Canonicalization rule:** This plan does not silently add `PrismPause` to the canonical domain model. Product Truth, System Foundry, authority, and threat-model acceptance must pass before Phase 1 is treated as canonical.

---

## 0. Feature definition — supplied Product Truth

Prism Pause is Prism’s pre-settlement execution control layer.

When a payment or other consequential action is about to execute, Prism can hold it in a temporary, non-final state and check whether the action is actually consistent with the user’s identity, authority, intent, and policies.

The flow is:

```text
Intent → Pause → Verify → Release / Cancel / Escalate → Settlement
```

During the pause, Prism can ask things like:

- Is this the intended recipient?
- Is this address actually bound to that Prism identity?
- Is this the first time sending to this person or address?
- Is the amount unusual or above a configured threshold?
- Is the initiating agent authorized to do this?
- Is the chain, asset, contract, or route allowed?
- Does the simulated execution match the stated intent?
- Does this action require additional approval?

If everything passes, Prism releases the action. If something fails, it can cancel it. If the situation is ambiguous or exceeds authority, it can escalate for approval.

The key point is:

> Prism Pause creates a reversible boundary before irreversible execution.

It does not reverse transactions after blockchain finality. It delays finality until Prism has enough evidence that the action should proceed.

Within Prism, its role is very specific:

```text
Prism ID says who.
Authority says what is allowed.
Intent says what is being requested.
Pause decides whether this particular execution should proceed.
The execution adapter performs it on the destination chain.
```

Clean definition:

> Prism Pause is a programmable checkpoint between authorization and finality that lets Prism verify, stop, or escalate consequential actions before they settle.

---

## 1. Protected boundaries

Prism Pause must preserve these existing decisions and invariants:

```text
Starknet remains the canonical Prism identity root.
Base remains a native execution venue.
Authentication is not protocol authority.
A verified proof is not canonical settlement.
submitted != completed.
The backend never becomes canonical identity authority.
Pause never claims post-finality rollback.
STRK20 viewing keys remain wallet-owned.
```

### Pause is not

```text
A chain reorganization mechanism.
A transaction cancellation guarantee after broadcast.
A custodial hot-wallet approval service by default.
A replacement for native wallet signatures.
A universal policy oracle.
A promise that simulation predicts every future chain state.
A privacy claim by itself.
```

### Required vocabulary separation

```text
Intent       = what the user/agent says it wants to do.
ExecutionPlan= normalized route, calls, assets, limits, and destination.
Pause        = durable non-final checkpoint holding the plan.
Verification = checks performed against identity, authority, policy, route, and simulation.
Decision     = release, cancel, escalate, expire, or require-reapproval.
Settlement   = destination-chain execution after release.
Receipt      = observed result after settlement and reconciliation.
```

---

## 2. Proposed domain model

### `ExecutionIntent`

```yaml
intent_id: stable identifier
principal: Prism ID / authenticated actor reference
initiator: user | agent | service
purpose: payment | transfer | contract_call | private_action | other
requested_recipient: Prism ID | social principal | native address | contract
requested_asset: chain + token/asset
requested_amount: exact amount or bounded amount
requested_route: destination chain + contract + entrypoint/call summary
created_at: timestamp
expires_at: timestamp
client_idempotency_key: stable retry key
intent_version: monotonic version
```

### `ExecutionPlan`

```yaml
plan_hash: hash of canonical normalized plan
chain_id: exact destination chain
asset: exact token/asset contract
recipient: normalized destination/capability
calls: canonical call summary or calldata commitment
value_limits: max value / slippage / gas / fee constraints
policy_version: policy snapshot used for evaluation
simulation_ref: optional simulation artifact
```

### `ExecutionPause`

```yaml
pause_id: stable identifier
intent_id: parent intent
plan_hash: immutable plan binding
state: PAUSED | VERIFYING | RELEASE_READY | CANCELLED | ESCALATED | EXPIRED | RELEASED
reason_codes: deterministic check outcomes
risk_level: LOW | MEDIUM | HIGH | UNKNOWN
created_at: timestamp
expires_at: timestamp
last_verified_at: timestamp
required_approval_count: integer
approval_scope_hash: exact plan/decision binding
settlement_operation_id: set only after release
```

### `PauseDecision`

```yaml
decision_id: stable identifier
pause_id: parent pause
kind: RELEASE | CANCEL | ESCALATE | EXPIRE | REVERIFY
actor: policy_engine | user | controller | authorized_agent | operator
policy_version: policy snapshot
plan_hash: exact plan approved/rejected
reason_codes: deterministic reasons
created_at: timestamp
expires_at: timestamp
```

No pause decision may authorize a different plan than the one verified. Any material plan mutation invalidates the decision and returns the pause to `VERIFYING`.

---

## 3. Proposed state machine

```text
INTENT_CREATED
      │ normalize + validate
      ▼
PAUSED
      │ checks begin
      ▼
VERIFYING
   ┌──┼──────────────┬──────────────┐
   │  │              │              │
   ▼  ▼              ▼              ▼
RELEASE_READY  CANCELLED      ESCALATED      EXPIRED
   │                             │
   │ approval / recheck          │ additional approval
   └───────────────┬─────────────┘
                   ▼
                RELEASED
                   │ operation created before broadcast
                   ▼
              SETTLEMENT_OPERATION
                   │
                   ▼
     submitted → processing → confirming → confirmed
                   │                         │
                   │                         ▼
                   │                    indexed → reconciled → completed
                   ▼
                reverted / failed / requires_attention
```

### Illegal transitions

```text
CANCELLED → RELEASED
EXPIRED → RELEASED
RELEASED → CANCELLED
SETTLED → CANCELLED
PAUSE_APPROVAL(plan_hash A) → RELEASE(plan_hash B)
RELEASE_READY after plan mutation without re-verification
```

### State semantics

- `PAUSED` means no destination-chain transaction has been broadcast.
- `RELEASE_READY` means checks passed but release has not necessarily occurred.
- `ESCALATED` means automatic release is forbidden until the required authority approves the exact plan.
- `RELEASED` means the settlement operation was created; it does not mean settlement succeeded.
- `COMPLETED` remains the existing reconciled operation state, never an optimistic UI label.

---

## 4. Authority model

| Concern | Authority | Never authoritative |
|---|---|---|
| Prism identity/controller | Starknet registry | Pause service, UI, cache |
| Base ownership proof | EOA → EIP-1271 → ERC-6492 verifier | Pause flag alone |
| User intent | signed/consented intent request | inferred UI click without binding |
| Policy | user-owned policy snapshot + system constraints | mutable global default during pause |
| Recipient binding | canonical registry/resolver | stale address book |
| Simulation result | injected chain simulator/RPC | generic “looks safe” score |
| Release authority | user/controller/authorized agent per policy | backend operator by default |
| Settlement state | destination chain + reconciliation | pause service claim |
| Privacy claim | underlying protocol evidence | “paused” label |

### Agent authority

An agent may propose an intent only within an explicit authority scope:

```text
agent_id
principal / Prism ID
allowed chains
allowed assets
allowed contracts/entrypoints
amount ceiling
frequency/rate limit
recipient constraints
approval threshold
expiry
revocation state
```

An agent that exceeds scope must produce `ESCALATED`, never silently downgrade to user authority.

---

## 5. Verification check matrix

Every check returns a typed result, not a boolean-only score.

```yaml
check_id:
status: PASS | FAIL | UNKNOWN | NOT_APPLICABLE
severity: INFO | WARNING | BLOCKING
reason_code: stable code
observed_value: redacted/public-safe value
expected_value: policy-derived value
source: registry | proof_verifier | policy | simulator | route_adapter
checked_at: timestamp
```

### Required checks

#### Identity and recipient

```text
PAUSE-IDENTITY-001  initiating principal maps to the expected Prism ID
PAUSE-RECIPIENT-001 requested recipient resolves to the intended capability
PAUSE-RECIPIENT-002 native destination is currently bound and not revoked
PAUSE-RECIPIENT-003 first-time recipient/address policy
```

#### Amount and frequency

```text
PAUSE-RISK-001 amount below configured ceiling
PAUSE-RISK-002 unusual amount / deviation from user baseline
PAUSE-RISK-003 frequency/rate limit
PAUSE-RISK-004 fee and slippage within policy
```

#### Authority and route

```text
PAUSE-AUTH-001 initiator/session is valid
PAUSE-AUTH-002 agent scope covers this exact action
PAUSE-AUTH-003 additional approval threshold
PAUSE-ROUTE-001 destination chain is allowed
PAUSE-ROUTE-002 asset/token is allowed
PAUSE-ROUTE-003 contract and entrypoint are allowed
PAUSE-ROUTE-004 route is not revoked or stale
```

#### Intent integrity and simulation

```text
PAUSE-INTENT-001 normalized plan matches the submitted intent
PAUSE-INTENT-002 calldata/value/recipient match the plan hash
PAUSE-SIM-001 simulation succeeds
PAUSE-SIM-002 simulated recipient/value/token effects match intent
PAUSE-SIM-003 simulation freshness is within the configured window
PAUSE-SIM-004 unknown simulation result blocks auto-release or escalates
```

No automatic release may occur when a blocking check is `FAIL` or `UNKNOWN`.

---

## 6. Implementation phases

### Phase P0 — Product/System canonicalization

**Goal:** accept Prism Pause as a governed primitive without changing existing Product Truth silently.

**Artifacts:**

```text
PRISM_PAUSE_PHASE_PLAN.md
Product Truth addition / decision record
DOMAIN_MODEL amendment proposal
STATE_MACHINES amendment proposal
AUTHORITY_MATRIX amendment proposal
ERROR_CATALOGUE additions
```

**Decisions required:**

- Is Pause required for all consequential actions or only high-risk actions?
- Who may release: user, controller, agent, quorum, or operator?
- Is `UNKNOWN` always blocking, or can policy explicitly escalate it?
- What is the default pause expiry?
- What is the minimum supported action class for MVP?

**Gate:** no implementation canonicalization until these decisions are accepted.

---

### Phase P1 — Intent and normalized execution plan

**Goal:** create a canonical, hash-bound intent before any pause exists.

**Implement:**

```text
ExecutionIntent domain object
ExecutionPlan canonical serialization
plan_hash / policy_version / intent_version
idempotency and expiry
recipient/asset/chain normalization
```

**Tests:**

```text
same intent → same plan hash
changed recipient/value/chain → different hash
malformed asset/chain/call → rejected
expired intent → not pausable
duplicate idempotency key → same intent, no duplicate pause
```

**Exit evidence:** X2 pure domain tests and serialization vectors.

---

### Phase P2 — Durable Pause store and lifecycle

**Goal:** make the reversible boundary durable across restart and concurrency.

**Implement:**

```text
execution_intents
execution_plans
execution_pauses
pause_checks
pause_decisions
approval_records
policy_versions
```

Use PostgreSQL as production persistence with:

```text
CAS/version checks
unique intent idempotency
unique active pause per intent version
plan_hash binding
expiry index
append-only decision history
```

**Tests:**

```text
restart preserves PAUSED/ESCALATED state
concurrent release → exactly one winner
cancel vs release race → canonical CAS result
expired pause cannot release
changed plan invalidates previous approval
```

**Exit evidence:** T7 durable integration and failure/restart report.

---

### Phase P3 — Verification and policy engine

**Goal:** evaluate whether a paused execution is consistent with identity, authority, intent, and policy.

**Implement as pure policy first:**

```text
RecipientBindingCheck
FirstUseCheck
AmountThresholdCheck
AgentAuthorityCheck
RouteAllowlistCheck
PolicyVersionCheck
IntentPlanMatchCheck
SimulationMatchCheck
AdditionalApprovalCheck
```

Each policy returns typed results and stable reason codes.

**Hard rule:** no opaque risk score may replace the individual check results.

**Tests:**

```text
intended recipient passes
unbound/revoked recipient blocks
first recipient escalates when configured
amount above threshold escalates/blocks
agent outside scope blocks
wrong chain/asset/contract blocks
plan mutation invalidates release readiness
UNKNOWN simulator result escalates
```

**Exit evidence:** policy matrix + antagonist/red-team report.

---

### Phase P4 — Release, cancel, escalate, and approval authority

**Goal:** implement the actual decision boundary before settlement.

**Commands:**

```text
pause
verify
release
cancel
escalate
approve_escalation
expire
reverify
```

**Release requirements:**

```text
pause state == RELEASE_READY
plan_hash unchanged
policy_version still valid
approval scope matches exact plan
no expired check
required authority present
settlement operation created before broadcast
```

**Cancel requirements:**

```text
pause not released
actor authorized to cancel
reason recorded
no settlement tx exists
```

**Escalation requirements:**

```text
reason codes visible
required approver class explicit
approval expires
approval binds exact plan_hash
approval cannot be replayed for another intent
```

**Exit evidence:** T8 API contracts, CAS race tests, stable error catalogue.

---

### Phase P5 — Execution adapter and settlement integration

**Goal:** connect `RELEASED` Pause decisions to existing chain operation adapters without conflating release with settlement.

**Implement:**

```text
PauseReleasePort
StarknetExecutionAdapter
BaseExecutionAdapter
STRK20WalletActionAdapter
SimulationPort
SettlementOperation bridge
```

**Required sequence:**

```text
Pause RELEASED
→ create Operation row
→ attach plan_hash / pause_id
→ submit destination-chain transaction
→ reconcile through existing operation state machine
```

**Never:**

```text
Pause RELEASED → COMPLETED
simulation succeeded → COMPLETED
wallet accepted → SETTLED
```

**Exit evidence:** T9/T12 adapter tests and one testnet release-to-operation flow.

---

### Phase P6 — Product/API vertical slice

**Goal:** make Pause visible in the product where it protects a real action.

**MVP action recommendation:**

```text
Base payment or transfer to a resolved Prism destination
```

Why first:

```text
uses existing Prism ID / Base binding primitive
exercises recipient correctness
exercises first-use and amount policy
does not require STRK20 viewing-key access
```

**UI states:**

```text
Preparing intent
Paused — checking
Release ready
Needs approval
Cancelled — reason
Escalated — approver required
Released — submitting
Submitted / confirming / confirmed / reconciled
```

**Surfaces:**

```text
Send
Activity / receipt
Connections / recipient binding
Home summary of paused actions
```

**API additions:**

```text
POST /v1/intents
POST /v1/intents/:id/pause
POST /v1/pauses/:id/verify
POST /v1/pauses/:id/release
POST /v1/pauses/:id/cancel
POST /v1/pauses/:id/escalate
POST /v1/pauses/:id/approve
GET  /v1/pauses/:id
GET  /v1/intents/:id
```

**Exit evidence:** live transport contract + frontend state test; no fake settlement.

---

### Phase P7 — Security, red-team, and observability

**Goal:** prove Pause cannot become a bypass or false-safety label.

**Attacks:**

```text
plan mutation after approval
recipient swap between verify/release
chainId mismatch
asset/contract substitution
agent scope escalation
approval replay
stale simulation
simulation omission
pause expiry race
cancel/release race
worker restart while paused
backend compromise attempting release
```

**Observability:**

```text
intent_id
plan_hash
pause_id
check_id/reason_code
policy_version
approval_id
operation_id
chain_tx_hash
event/reconciliation id
```

**Privacy review:**

```text
no viewing keys
no seed/private keys
no unnecessary intent metadata in public chain calls
no public graph expansion from pause records
```

**Exit evidence:** antagonist report, threat model, T12 failure matrix, audit packet.

---

### Phase P8 — SN_SEPOLIA testnet evidence

**Goal:** observe Pause before a real testnet settlement.

**Sequence:**

```text
create intent
→ pause
→ verify recipient/authority/policy/simulation
→ release
→ Starknet/Base adapter submits
→ reconcile operation
→ independent receipt/read
```

Required evidence:

```text
intent and plan hashes
pause checks and decisions
policy version
settlement tx hash
receipt/status
independent second read
failure/cancel/escalation case
```

**Maturity:** X3 only after observed testnet execution and independent readback.

---

### Phase P9 — Mainnet and STRK20 release

**Goal:** use Pause in a product-native mainnet action without overclaiming privacy.

Candidates:

```text
Base payment/transfer checkpoint
PrismClaim creation/claim checkpoint
STRK20 private application action checkpoint
```

The STRK20 route must still follow the official wallet/anonymizer boundary. The Wallet API is the normal dapp route; a project-owned anonymizer is an additional app-specific route, not a substitute for the wallet's private-key/viewing-key responsibilities.

**Release gates:**

```text
SN_MAIN target accepted separately
real pool interaction
successful receipt
declared Prism contract involvement where applicable
independent validation
public demo/video/documentation
```

**Maturity:** X4/X5 only after repeated, independently verifiable mainnet evidence.

---

## 7. Phase dependency graph

```text
P0 Product/System decision
        │
        ▼
P1 Intent/Plan ───► P2 Durable Pause
        │                 │
        └──────────► P3 Verification/Policy
                          │
                          ▼
                  P4 Release/Cancel/Escalate
                          │
                          ▼
                  P5 Settlement adapters
                          │
             ┌────────────┴────────────┐
             ▼                         ▼
       P6 Product/API              P7 Red-team
             │                         │
             └────────────┬────────────┘
                          ▼
                    P8 Testnet
                          │
                          ▼
                    P9 Mainnet
```

Do not start P5 with a policy engine that cannot produce reasoned check results. Do not start P9 from local Pause tests.

## 8. Recommended first vertical slice

The smallest high-value slice is:

```text
User creates a Base payment intent to a Prism-resolved destination
→ Prism Pause holds it
→ verifies recipient binding, first-use policy, amount threshold,
  agent/session authority, chain/asset allowlist, and plan hash
→ user sees the decision
→ release creates the existing Operation before broadcast
→ Base adapter submits
→ reconciliation reports settlement honestly
```

This slice proves the new primitive without requiring PrismClaim, PrismChannel, or STRK20 viewing-key access.

## 9. Acceptance equation

```text
Product Truth accepted
+ Pause state machine
+ durable CAS persistence
+ typed verification checks
+ explicit release/cancel/escalate authority
+ settlement adapter boundary
+ truthful UI/API states
+ red-team/failure gates
+ testnet evidence
= Prism Pause phase accepted
```

A green policy unit suite alone is not acceptance.

## 10. Current support relationship

Current Prism implementations provide useful prerequisites:

```text
Prism ID / registry authority
Base proof/binding boundary
operation lifecycle
reconciliation/watermarks
transport-neutral handlers
```

They do not yet provide:

```text
ExecutionIntent
ExecutionPlan
ExecutionPause persistence
policy/check engine
release/cancel/escalate commands
simulation boundary
Pause UI/API
```

Therefore Prism Pause should begin at **P0**, then P1–P4 before being coupled to live settlement adapters.
