# System Foundry
## Canonical Domain, Authority, State, Failure, and Integration Engine — v0.95

**Core question:** What is the smallest coherent technical system that faithfully enforces accepted product truth?

**Maturity target:** 9.5/10 operational standard

---

# 1. Mandate

The System Foundry transforms canonical product truth into a secure, explicit, testable technical system before implementation expands.

It owns:

- canonical domain vocabulary;
- domain objects;
- state machines;
- invariants;
- authority allocation;
- smart-contract / ledger specifications;
- backend domain architecture;
- persistence semantics;
- async operation lifecycles;
- event contracts;
- error contracts;
- reconciliation;
- observability;
- stack decisions;
- testing architecture;
- vertical-slice integration.

It does **not** begin with code, database tables, REST endpoints, or framework selection.

---

# 2. Required Product Handoff

The System Foundry must refuse canonicalization if it cannot identify:

```text
primary user
painful moment
desired outcome
core primitive
product invariants
non-goals
trust model
privacy requirements
decisive proof
protected decisions
```

Missing technical detail may become an assumption.

Missing product truth may not be invented as a technical convenience.

---

# 3. Canonical System Artifacts

A mature System Foundry session should be able to produce:

```text
SYSTEM_CANONICAL.md
DOMAIN_MODEL.md
STATE_MACHINES.md
INVARIANTS.md
AUTHORITY_MATRIX.md
CONTRACT_SPEC.md
EVENT_CATALOGUE.md
ERROR_CATALOGUE.md
ASYNC_OPERATIONS.md
PERSISTENCE_MODEL.md
RECONCILIATION.md
OBSERVABILITY.md
TEST_ARCHITECTURE.md
STACK_DECISIONS.md
```

Recommended structured equivalents:

```text
domain-model.yaml
state-machines.yaml
invariants.yaml
authority-matrix.yaml
events.yaml
errors.yaml
operations.yaml
```

---

# 4. Domain Object Contract

Every meaningful object must be specified using:

```yaml
object_id: OBJ-...
name:
purpose:
canonical_identifier:
authority:
participants: []
visibility_class:
privacy_class:
persisted_fields: []
derived_fields: []
relationships: []
states: []
commands: []
queries: []
events: []
invariants: []
terminal_states: []
failure_states: []
versioning:
```

Do not use generic `Record`, `Item`, `Data`, or `Status` where a meaningful domain term exists.

---

# 5. State Machine Contract

Every lifecycle object requires an explicit transition table.

```yaml
state_machine_id: SM-...
object_ref: OBJ-...
initial_state:
terminal_states: []
states:
  - name:
    authoritative_meaning:
    visible_meaning:

transitions:
  - transition_id: TR-...
    from:
    to:
    command_ref:
    actor:
    authorization:
    preconditions: []
    expected_version:
    idempotency:
    retry:
    reversibility:
    state_changes: []
    external_effects: []
    emitted_events: []
    failure_codes: []
    compensation:
```

## Invalid transitions

Invalid transitions must be intentionally listed where meaningful.

Example:

```text
revoked → active
```

must not happen through a generic `PATCH`.

A reactivation mechanism, if valid, requires its own command and invariant review.

---

# 6. Command Contract

Commands request change.

Every command defines:

```yaml
command_id: CMD-...
name:
actor:
purpose:
target_object:
authorization:
privacy_class:
economic_consequence:
irreversible:
inputs:
preconditions:
expected_object_version:
idempotency_key:
state_transition:
side_effects:
async_operation:
events:
errors:
audit_requirements:
```

Command names should reflect intent:

```text
BindExecutionIdentity
RevokeBinding
ShieldAsset
```

not implementation mechanics:

```text
UpdateBindingRow
SetStatus
InsertTransfer
```

---

# 7. Query Contract

Queries support decisions.

```yaml
query_id: QRY-...
name:
purpose:
actor:
authorization:
target_object:
filters:
pagination:
freshness:
consistency:
privacy:
authoritative_fields:
derived_fields:
cache_policy:
errors:
```

A query must state whether returned data is:

```text
authoritative
indexed
cached
derived
estimated
```

---

# 8. Event Contract

Events describe completed facts.

```yaml
event_id: EVT-...
type:
past_tense_name:
source_authority:
object_ref:
schema_version:
event_key:
object_version:
correlation_id:
created_at:
payload:
privacy_class:
ordering:
uniqueness:
replay:
retention:
signature:
consumer_responsibilities:
```

Event examples:

```text
PrismIdentityCreated
ExecutionIdentityBound
BindingRevoked
PrivateTransferConfirmed
```

Avoid:

```text
BindingUpdated
DataChanged
```

when meaningful facts exist.

---

# 9. Invariant Contract

Every critical invariant uses:

```yaml
invariant_id: INV-...
statement:
why:
scope:
authoritative_enforcement:
secondary_validations: []
violating_commands: []
tests: []
severity:
monitoring_signal:
recovery_procedure:
evidence_required:
```

Invariant categories:

- domain;
- authorization;
- economic;
- accounting;
- privacy;
- replay;
- lifecycle;
- consistency;
- availability/safety.

---

# 10. Authority Matrix

Every behavior gets exactly one primary authority.

| Behavior | Primary authority | Secondary validation | Never authoritative |
|---|---|---|---|
| economic ownership | contract/ledger when required | backend indexer | frontend |
| identity lifecycle | canonical registry/domain | API validation | UI cache |
| authentication | auth provider / credential verifier | backend session | client labels |
| object authorization | domain/contract | API middleware | frontend hiding |
| price display | market-data adapter | cache | contract unless designed so |
| operation status | workflow + ledger reconciliation | frontend subscription | optimistic UI |

Competing authorities must be resolved before implementation.

---

# 11. Trust & Information Boundary Map

For every actor/component define:

```yaml
principal:
can_authenticate_as:
can_authorize:
can_read:
can_write:
can_derive:
must_not_know:
can_move_value:
can_override:
failure_impact:
compromise_boundary:
```

Explicitly separate:

```text
authentication
authorization
delegation
privacy visibility
commercial entitlement
economic authority
administration
```

---

# 12. Smart Contract / Ledger Specification

For every operation:

```yaml
operation:
purpose:
caller:
authorization:
inputs:
preconditions:
storage_reads:
storage_writes:
asset_movements:
outputs:
events:
revert_codes:
replay_protection:
uniqueness:
privacy_behavior:
pause_behavior:
upgrade_impact:
migration_impact:
gas_execution_notes:
```

Contract boundary checklist:

- Which truth must be independently enforceable?
- Which state must survive backend failure?
- Which behavior requires atomicity?
- Which data should **not** be onchain for privacy?
- Which computations are cheaper/safer offchain?
- Which events reconstruct canonical history?

Do not add a contract because decentralization looks impressive.

---

# 13. Backend Architecture

Prefer a modular monolith until evidence justifies service separation.

Recommended layers:

```text
domain/
application/
ports/
adapters/
infrastructure/
transport/
workers/
```

## Domain layer

Must not import:

```text
web framework
database driver
RPC SDK
cloud SDK
notification provider
```

## Application layer

Coordinates use cases and transactions.

## Ports

Explicit interfaces for:

```text
ledger
database
indexer
auth
pricing
notifications
payments
```

## Adapters

Replaceable implementations.

---

# 14. Transaction Boundaries

For every command specify:

- database transaction boundary;
- ledger submission boundary;
- external API boundary;
- what can atomically commit;
- what cannot;
- compensation path;
- durable operation record.

Never assume:

```text
DB commit + blockchain confirmation
```

is one atomic transaction.

---

# 15. Async Operation Model

Long-running work must produce an Operation resource.

Canonical lifecycle:

```text
created
→ awaiting_authorization
→ ready
→ submitted
→ processing
→ confirming
→ confirmed
→ indexed
→ reconciled
→ completed
```

Failure branches:

```text
failed_retryable
failed_terminal
reverted
expired
cancelled
requires_attention
```

Each state defines:

```text
authoritative source
user-visible meaning
retryability
timeout
next actions
```

Never equate `submitted` with `completed`.

---

# 16. Error Catalogue

Every error is a stable domain contract.

```yaml
error_code: ERR-...
name:
category:
safe_message:
trigger:
retryable:
user_action:
operator_action:
http_mapping:
contract_mapping:
privacy_notes:
logging_level:
```

Categories:

```text
validation
authentication
authorization
conflict
stale_state
rate_limit
dependency
economic
privacy
replay
not_found
unsupported
internal
```

Raw stack traces are not external errors.

---

# 17. Persistence Model

Classify every field/table:

```text
AUTHORITATIVE_APP_STATE
LEDGER_INDEX
CACHE
DERIVED
AUDIT
WORKFLOW
EPHEMERAL
```

Define:

- primary keys;
- business uniqueness;
- object version;
- transaction boundaries;
- concurrency strategy;
- retention;
- encryption;
- PII/privacy;
- backup;
- migrations.

Do not mirror contract storage blindly.

Persist application concepts.

---

# 18. Concurrency & Optimistic Control

Every mutable lifecycle object needs a concurrency strategy.

Options:

```text
expected_version
ETag / If-Match
unique command key
ledger nonce/nullifier
database lock
serializable transaction
```

Specify which applies.

Stale state should become a structured conflict, not silent overwrite.

---

# 19. Idempotency

Every externally retriable command must define:

```text
idempotency scope
key format
request fingerprint
retention window
same-key/same-body behavior
same-key/different-body behavior
result replay behavior
```

Unsafe automatic retry is forbidden.

---

# 20. Reconciliation

Assume divergence.

Reconcile:

- submitted but unknown transactions;
- confirmed but unindexed transactions;
- missed events;
- duplicate events;
- reorgs/reverts;
- stale caches;
- backend restart;
- worker crash;
- partial external workflow;
- contract upgrade.

For each reconciliation rule define:

```text
canonical authority
detection
repair action
operator visibility
user visibility
audit entry
```

---

# 21. Observability Trace

Every decisive action should share a correlation chain:

```text
user_action_id
→ request_id
→ command_id
→ operation_id
→ db_tx_id
→ chain_tx_hash
→ event_id
→ reconciliation_id
→ frontend_state_version
```

The system must answer:

> Why does this user see this state?

without manual guesswork.

---

# 22. Security Review Matrix

Review at minimum:

### Authentication
Can identity be spoofed?

### Authorization
Can an authenticated actor exceed authority?

### Object ownership
Can actor A mutate actor B's object?

### Replay
Can an old authorization be reused?

### State conflict
Can stale commands overwrite newer state?

### Economic safety
Can retries double-spend or double-charge?

### Privacy
Can logs/indexes/events leak protected relationships?

### Administration
Can operators bypass product invariants?

### Upgrade
Can migration invalidate authority or accounting?

### Dependency compromise
What happens if RPC/indexer/auth/payment provider fails or lies?

---

# 23. Architecture Spike Contract

High-risk assumptions get a bounded spike:

```yaml
spike_id: SPIKE-...
question:
assumption_ref:
minimal_implementation:
success_criterion:
failure_criterion:
scope_limit:
evidence_output:
decision_affected:
production_code_policy: discard_by_default
```

A spike is not a hidden production foundation.

---

# 24. Vertical Slice Gate

Before horizontal expansion, complete one decisive workflow across:

```text
frontend
authentication
API
domain validation
authorization
persistence
contract/ledger
operation lifecycle
indexing
reconciliation
frontend update
```

Must include:

- success;
- rejected input;
- permission failure;
- stale-state conflict;
- dependency failure;
- retry;
- recovery.

---

# 25. Testing Ladder

## T1 Domain
Pure business rules.

## T2 State Machine
All legal/illegal transitions.

## T3 Property
Replay, monotonicity, accounting, invariant fuzzing.

## T4 Contract Unit
Storage/authorization/revert/events.

## T5 Contract Adversarial
Replay/front-running/role abuse/edge values.

## T6 Backend
Use-case behavior.

## T7 Database Integration
Transactions, uniqueness, locking, migrations.

## T8 API Contract
Schema/errors/idempotency/concurrency.

## T9 Ledger Integration
Backend ↔ contract.

## T10 Frontend Integration
Typed client ↔ API state.

## T11 E2E
Complete decisive workflow.

## T12 Failure/Recovery
RPC outage, indexer lag, duplicate event, restart.

## T13 Upgrade/Migration
Old/new schema and contract compatibility.

## T14 Performance
Only where requirements justify.

Tests derive from specifications, not from implementation convenience.

---

# 26. System Slop Audit

Reject:

- database-shaped domain;
- generic CRUD lifecycle;
- duplicated rules;
- multiple authorities;
- hidden retries;
- missing idempotency;
- synchronous blockchain assumptions;
- DB-complete before ledger-confirmed;
- generic `500` errors;
- unversioned events;
- permanent mocks;
- contract events insufficient to reconstruct important state;
- upgradeability without migration reasoning;
- framework types leaking into domain;
- backend paths that bypass contract invariants.

---

# 27. System Canonicalization Gate

System may be declared canonical only when:

```text
[ ] product handoff accepted
[ ] canonical vocabulary defined
[ ] domain objects defined
[ ] decisive state machines complete
[ ] critical invariants registered
[ ] primary authority assigned for every critical rule
[ ] trust/information boundaries mapped
[ ] contract operations specified
[ ] async workflows explicit
[ ] errors structured
[ ] persistence classified
[ ] reconciliation defined
[ ] observability chain defined
[ ] vertical-slice contract defined
[ ] testing ladder mapped to invariants
[ ] unresolved assumptions registered
[ ] next evidence spike named
```

---

# 28. Command Modes

- `System Handoff Audit`
- `Domain Model`
- `State Machine Pass`
- `Invariant Pass`
- `Authority Map`
- `Trust Boundary`
- `Contract Spec`
- `Backend Architecture`
- `Persistence Model`
- `Operation Model`
- `API Spec`
- `Event Model`
- `Failure Model`
- `Reconciliation Pass`
- `Stack Fit`
- `Architecture Spike`
- `Vertical Slice`
- `Integration Audit`
- `Security Pass`
- `Test Architecture`
- `Backend Slop Audit`
- `System Drift Check`
- `Canonicalize System`

---

# 29. Session Output

Every substantial System session ends with:

```text
Canonical domain version:
Objects changed:
State machines changed:
Invariants changed:
Authority changes:
Contract/API/event changes:
Errors added:
Assumptions added:
Contradictions raised:
Tests required:
Evidence produced:
Next vertical-slice/spike:
```

---

**System Foundry maxim:**  
**Every important state must have one meaning, one authority, one transition path, and one way to prove it.**
