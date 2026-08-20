# Interface & Ecosystem Foundry
## Canonical Capability, API, SDK, MCP, Events, Payments, and Developer Trust Engine — v0.95

**Core question:** Which accepted system capabilities deserve durable external interfaces, and how should humans, applications, agents, protocols, and machines consume them safely?

**Maturity target:** 9.5/10 operational standard

---

# 1. Mandate

The Interface & Ecosystem Foundry turns canonical domain capabilities into durable external projections.

It owns:

- canonical capability registry;
- exposure decisions;
- API contracts;
- response/error semantics;
- SDK architecture;
- MCP resources/tools/prompts;
- events/webhooks;
- machine-payment adapters;
- authentication/scopes/entitlements;
- capability discovery;
- developer journey;
- versioning/deprecation;
- conformance testing.

It does **not** invent business capabilities because an SDK would look incomplete.

---

# 2. Required System Handoff

Cannot canonicalize until it has:

```text
Domain objects
Commands
Queries
Events
State machines
Authority matrix
Privacy classes
Economic actions
Irreversible actions
Idempotency rules
Async lifecycles
Error catalogue
Versioned schemas
```

---

# 3. Canonical Capability Object

Every externally meaningful capability is first defined independently of transport.

```yaml
capability_id: CAP-...
canonical_name: prism.identity.resolve
version: 1
stability: experimental|preview|stable|deprecated

purpose:
consumer_outcome:

classification: query|command|event|workflow
primary_actor:
secondary_actors: []

domain_object_refs: []
command_ref:
query_ref:
event_refs: []

inputs:
preconditions:
authorization:
object_authorization:
delegated_authority:
privacy_visibility:
commercial_entitlement:

result:
side_effects:
economic_consequence:
irreversible:
reversible:
idempotency:
latency:
async_lifecycle:

errors: []
rate_class:
price:
documentation:
examples:

eligible_surfaces:
  api: true|false
  sdk: true|false
  mcp_resource: true|false
  mcp_tool: true|false
  webhook: true|false
  payment_resource: true|false
  protocol_primitive: true|false
```

This is the canonical source for projections.

---

# 4. Capability Test

A capability is eligible for external exposure only if:

```text
[ ] creates durable external value
[ ] semantics can remain stable
[ ] authority is clear
[ ] object authorization is clear
[ ] privacy exposure is acceptable
[ ] result is observable
[ ] failures are documentable
[ ] retries are safe/protected
[ ] async lifecycle is representable
[ ] support obligation is justified
[ ] versioning path exists
```

Otherwise keep it internal.

---

# 5. Exposure Classification

Every system function must be classified:

```text
INTERNAL_IMPLEMENTATION
INTERNAL_SERVICE
PRIVATE_PARTNER
PUBLIC_API
SDK_WORKFLOW
AGENT_RESOURCE
AGENT_TOOL
PAID_MACHINE_RESOURCE
PROTOCOL_PRIMITIVE
```

Exposure decisions are explicit records:

```yaml
exposure_id:
capability_ref:
classification:
reason:
consumers:
risks:
support_obligation:
revisit_conditions:
```

---

# 6. Rejected Exposure Rules

Never expose merely because it exists:

- raw database CRUD;
- cache invalidation;
- reconciliation internals;
- arbitrary admin overrides;
- temporary workflow steps;
- prover/indexer implementation knobs;
- unrestricted contract calls;
- debug endpoints;
- raw private metadata.

---

# 7. Resource Contract

Resources define durable readable objects.

```yaml
resource_id:
canonical_identity:
representation_version:
visibility:
privacy:
authoritative_fields:
derived_fields:
links:
object_version:
freshness:
available_actions:
```

Every resource should communicate what can be done next.

---

# 8. API Operation Contract

Every HTTP operation defines:

```yaml
operation_id: API-...
capability_ref:
method:
route:
version:
stability:

authentication:
scopes:
object_authorization:
entitlement:

headers:
  request_id:
  idempotency_key:
  if_match:
  api_version:

request_schema:
response_schema:
validation:
idempotency:
optimistic_concurrency:
async_behavior:
errors:
pagination:
filtering:
sorting:
rate_limit:
privacy:
deprecation:
examples:
```

Machine-readable API specification is produced before server implementation.

---

# 9. Response Envelope

Success:

```json
{
  "data": {},
  "meta": {
    "request_id": "req_...",
    "authoritative_status": "active",
    "freshness": {
      "observed_at": "...",
      "source": "..."
    },
    "warnings": [],
    "next_actions": []
  },
  "links": {}
}
```

Use a lighter shape if product requirements warrant, but semantics must remain.

Every response should answer:

```text
What happened?
What state is true now?
How fresh is this?
What remains processing?
What can I do next?
What warning matters?
How do I correlate this?
```

---

# 10. Error Contract

```json
{
  "error": {
    "code": "binding_revoked",
    "category": "conflict",
    "message": "This execution identity is no longer active.",
    "retryable": false,
    "details": {},
    "recovery_actions": [
      {
        "action": "resolve_another_venue"
      }
    ],
    "request_id": "req_..."
  }
}
```

Requirements:

- stable machine code;
- safe human message;
- no raw internal exception;
- retryability explicit;
- recovery explicit where possible.

---

# 11. Operation Resource

Async commands return an Operation, not fake completion.

```yaml
operation_id:
capability_ref:
status:
created_at:
updated_at:
object_ref:
request_id:
idempotency_key:
progress:
remaining_steps:
result:
error:
links:
```

Status follows System lifecycle.

SDK/MCP/UI should consume the same lifecycle semantics.

---

# 12. Idempotency & Concurrency Contract

For each command:

```text
idempotency required?
scope?
retention?
body fingerprint?
same key + different body?
response replay?
```

Optimistic concurrency:

```text
object version
ETag
If-Match
expected_version
```

Stale updates become structured conflicts.

---

# 13. Pagination Contract

Choose one deliberately:

```text
cursor
keyset
offset
```

For externally mutable datasets, prefer cursor/keyset unless requirements say otherwise.

Specify:

```text
ordering
stable cursor semantics
page size limits
filter interaction
snapshot consistency
```

---

# 14. Authentication, Authorization, Entitlement Separation

Never conflate:

```text
authentication
role authorization
object authorization
delegated authority
privacy visibility
commercial entitlement
payment verification
```

Example:

```text
Payment successful
≠
authorized to revoke another user's binding
```

---

# 15. Scope Design

Scopes should use domain actions:

```text
identity:read
identity:resolve
binding:create
binding:revoke
portfolio:read
private_transfer:prepare
```

Avoid only:

```text
read
write
admin
```

when domain distinctions matter.

---

# 16. SDK Architecture

Two layers:

```text
Generated Transport
        +
Handcrafted Domain SDK
```

## Generated transport

Owns:

- HTTP;
- serialization;
- generated types;
- low-level endpoint parity.

## Domain SDK

Owns:

- intent-oriented methods;
- domain types;
- typed errors;
- pagination helpers;
- operation waiting;
- idempotency helpers;
- webhook verification;
- sandbox fixtures;
- environment configuration.

Example:

```ts
await prism.identities.resolve(...)
```

not:

```ts
await client.get("/v1/resolve/...")
```

for normal developer usage.

---

# 17. SDK Safety Rules

SDK must not:

- silently sign;
- silently submit value movement;
- silently retry unsafe commands;
- hide operation lifecycle;
- hide fees/payment;
- reinterpret errors differently from API;
- mutate caller-provided amounts through display rounding.

Sensitive methods should require explicit options/confirmation patterns where language conventions allow.

---

# 18. MCP Projection

Do not map endpoint-for-endpoint.

## Resource

Use for readable state:

```text
prism://identity/{id}
prism://portfolio/{id}
```

## Tool

Use for explicit actions where model invocation is appropriate.

Every tool:

```yaml
tool_name:
capability_ref:
description:
appropriate_use:
prohibited_use:
input_schema:
output_schema:
resource_links:
authorization:
side_effects:
economic_consequence:
reversibility:
cost:
confirmation_required:
operation_lifecycle:
errors:
```

## Prompt

Use for user-invoked workflows, not hidden authority expansion.

---

# 19. Agent Safety Classification

Every MCP/agent capability gets:

```text
A0 read-only public
A1 read-only private
A2 reversible mutation
A3 financially consequential
A4 destructive/authority-changing
A5 prohibited for autonomous invocation
```

A3–A4 should generally require explicit human control.

Secrets/payment credentials should never be collected through model-visible free-form inputs.

---

# 20. Events & Webhooks

Canonical envelope:

```json
{
  "id": "evt_...",
  "type": "binding.revoked.v1",
  "schema_version": 1,
  "created_at": "...",
  "object": {
    "type": "binding",
    "id": "..."
  },
  "object_version": 4,
  "correlation_id": "op_...",
  "data": {},
  "delivery": {
    "attempt": 1
  }
}
```

Define:

- signature algorithm;
- timestamp tolerance;
- replay endpoint;
- retention;
- retry schedule;
- max attempts;
- deduplication key;
- ordering guarantee;
- current-state retrieval.

Consumers must not assume global ordering unless promised.

---

# 21. Payment Surface

Payment is an adapter around access, not domain authority.

For every paid capability define:

```yaml
payment_resource_id:
capability_ref:
unit_of_value:
price:
currency:
payment_adapter:
challenge_ttl:
request_binding:
body_hash_binding:
payer_authority:
recipient:
challenge_id:
replay_protection:
idempotency:
entitlement_duration:
receipt:
refund_policy:
delivery_failure_behavior:
```

State model:

```text
challenge_created
→ payment_verified
→ entitlement_granted
→ product_operation_started
→ product_operation_completed
→ resource_delivered
```

These states are distinct.

---

# 22. Payment Adapter Strategy

Choose one payment model based on distribution need:

```text
account billing
prepaid credits
subscription
x402
MPP
other adapter
```

Do not implement multiple protocols to look interoperable.

Add a second adapter only when a real consumer/channel requires it.

---

# 23. Capability Catalogue

Machine-readable catalogue:

```yaml
catalogue_version:
capabilities:
  - capability_id:
    description:
    version:
    stability:
    actors:
    auth:
    surfaces:
    pricing:
    side_effects:
    idempotency:
    docs:
    examples:
```

Use it to drive:

- docs;
- SDK reference;
- MCP registration;
- partner catalogue;
- permission manifest;
- payment discovery;
- conformance tests.

---

# 24. Developer Journey Gate

Canonical builder journey:

```text
Discover
→ Authenticate
→ Sandbox
→ Query
→ Command
→ Observe Operation
→ Receive Event
→ Handle Error
→ Production
```

Required artifacts:

```text
quickstart
runnable example
sandbox
fixtures
API reference
SDK guide
MCP catalogue
error catalogue
event guide
payment guide if applicable
lifecycle diagrams
changelog
migration guide
```

---

# 25. Versioning & Compatibility

Version:

- API descriptions;
- resource schemas;
- command schemas;
- errors;
- events;
- signed payloads;
- SDKs;
- MCP tools;
- payment adapters.

Stability levels:

```text
experimental
preview
stable
deprecated
sunset
```

Breaking changes require:

```text
decision record
migration guide
support window
compatibility matrix
conformance update
consumer notice
```

Never silently change field meaning.

---

# 26. Conformance Suite

Derive from capability registry and contracts.

Tests:

```text
schema
authn
authz
object access
privacy visibility
idempotency
concurrency
pagination
errors
async lifecycle
event signature
event replay
SDK/API parity
MCP/capability parity
payment challenge binding
payment replay
receipt verification
delivery after payment
version compatibility
deprecation behavior
```

External integrators should be able to run a subset against sandbox.

---

# 27. Interface Slop Audit

Detect:

- database-shaped APIs;
- one endpoint per internal function;
- generic CRUD lifecycle;
- inconsistent vocabulary;
- hidden side effects;
- undocumented errors;
- missing idempotency;
- mechanically generated MCP tools;
- prose-only MCP output;
- SDK semantic divergence;
- payment mixed into domain logic;
- payment treated as authorization;
- experimental internals made public;
- fictional examples;
- success-only docs;
- no sandbox;
- no replay;
- no deprecation path.

Apply:

```text
Capability Test
Projection Test
Misuse Test
Agent Test
Payment Test
Failure Test
Privacy Test
Evolution Test
Ecosystem Test
```

---

# 28. Interface Canonicalization Gate

```text
[ ] System handoff accepted
[ ] capability registry defined
[ ] exposure audit complete
[ ] auth/authz/entitlement separated
[ ] response model defined
[ ] error catalogue mapped
[ ] async operations explicit
[ ] idempotency/concurrency defined
[ ] event/webhook semantics defined
[ ] SDK layers defined
[ ] MCP projection justified
[ ] payment model justified if used
[ ] catalogue discoverable
[ ] version/deprecation policy defined
[ ] conformance suite derivable
[ ] developer journey complete enough for release
```

---

# 29. Command Modes

- `Ecosystem Handoff Audit`
- `Capability Map`
- `Exposure Audit`
- `API Contract`
- `Response Model`
- `Authorization Surface`
- `SDK Architect`
- `MCP Projection`
- `Agent Safety`
- `Payment Surface`
- `Event Surface`
- `Capability Catalogue`
- `Developer Journey`
- `Conformance Suite`
- `Interface Slop Audit`
- `Ecosystem Drift Check`
- `Canonicalize Ecosystem`

---

# 30. Session Output

```text
Capability registry version:
Capabilities added/changed:
Exposures added/rejected:
API changes:
Error/response changes:
SDK changes:
MCP changes:
Event changes:
Payment changes:
Compatibility impact:
Conformance changes:
Assumptions:
Next integration evidence step:
```

---

**Interface & Ecosystem maxim:**  
**Expose durable capabilities, not implementation accidents.**
