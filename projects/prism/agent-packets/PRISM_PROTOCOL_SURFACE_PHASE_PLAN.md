# Prism Protocol Surface and PrismChannel Testnet Phases

**Status:** Proposed implementation/testnet phase plan  
**Date:** 2026-08-23  
**Purpose:** define the API, REST, SDK, MCP, and minimal PrismChannel surfaces required before a credible testnet/mainnet release.

## Decision summary

```text
REST/API: mandatory before mainnet.
SDK: mandatory before mainnet.
MCP: recommended before mainnet when agent-mediated actions or Prism Pause
     are part of the product promise; MCP must be a thin adapter, not a
     second authority path.
PrismChannel: included in the testnet path as a minimal relationship/payment
              vertical slice; no full messenger is required for first mainnet.
```

## Canonical authority flow

Every surface must converge on one backend/application path:

```text
REST client ─┐
SDK client  ─┼→ Prism API/application service
MCP client  ─┘            │
                          ▼
                    Prism Pause
                          │
                          ▼
                    OperationStore
                          │
                          ▼
                execution adapter / chain
```

No SDK or MCP method may bypass:

```text
identity authority
Base proof verification
Pause policy
approval requirements
operation lifecycle
reconciliation
```

MCP must never hold or request:

```text
Starknet private keys
Base private keys
STRK20 viewing keys
seed phrases
wallet passwords
```

---

# Phase S0 — Protocol contract and authority freeze

### Work

- define the public API vocabulary without raw-chain leakage;
- define versioning and backward compatibility;
- define authentication versus execution authority;
- define idempotency and correlation headers;
- define Pause/approval semantics for all write operations;
- define PrismChannel as a relationship capability, not a chat product;
- write OpenAPI and typed domain schemas;
- record stable error and operation-state mappings.

### Exit gate

```text
OpenAPI contract reviewed
SDK type model reviewed
MCP tool model reviewed
authority matrix aligned
Pause boundary aligned
no direct-client chain bypass
```

---

# Phase S1 — Real REST/API runtime

### Purpose

Turn the current transport-neutral handlers into a running, environment-aware service.

### Required routes

```http
POST /v1/identity
GET  /v1/identity/:prism_id

POST /v1/identity/:prism_id/bindings
POST /v1/identity/:prism_id/bindings/:id/revoke
GET  /v1/resolve/:identifier

POST /v1/intents
POST /v1/intents/:id/pause
POST /v1/pauses/:id/verify
POST /v1/pauses/:id/release
POST /v1/pauses/:id/cancel
POST /v1/pauses/:id/escalate
POST /v1/pauses/:id/approve
GET  /v1/pauses/:id

GET  /v1/operations/:id
GET  /v1/receipts/:id

POST /v1/channels
GET  /v1/channels/:id
POST /v1/channels/:id/messages
```

The Channel routes are testnet-scope only until the channel model is accepted.

### Required behavior

```text
operation row before broadcast
stable error codes
idempotency key enforcement
request/correlation/operation IDs
watermark on canonical resolution responses
submitted != completed
no raw stack/error leakage
```

### Exit evidence

```text
OpenAPI contract tests
real local server tests
PostgreSQL integration
auth/authority separation tests
Pause release/cancel/escalation tests
```

---

# Phase S2 — TypeScript SDK

### Purpose

Give frontend, integrations, and agents a stable Prism vocabulary instead of raw calldata/felts.

### Desired API

```ts
prism.identities.create()
prism.identities.get()
prism.identities.resolve()

prism.bindings.create()
prism.bindings.revoke()

prism.intents.create()
prism.pauses.get()
prism.pauses.verify()
prism.pauses.release()
prism.pauses.cancel()
prism.pauses.approve()

prism.operations.get()
prism.receipts.get()

prism.channels.create()
prism.channels.get()
prism.channels.sendMemo()
```

### SDK rules

```text
typed request/response schemas
runtime version negotiation
idempotency helpers
operation polling/subscription helper
watermark-aware resolve result
explicit privacy labels
no viewing-key access
no raw chain submission bypass
```

### Exit evidence

```text
SDK contract tests against REST server
replay/idempotency tests
operation-state mapping tests
Pause plan-hash/approval binding tests
```

---

# Phase S3 — MCP adapter

### Purpose

Expose Prism to authorized agents without creating an alternative authority system.

### Initial MCP tools

```text
prism_resolve
prism_get_identity
prism_get_connections
prism_create_intent
prism_inspect_pause
prism_request_pause_verification
prism_request_approval
prism_get_operation
prism_get_receipt
prism_create_channel
prism_send_channel_memo
```

### MCP write boundary

Agent tools may:

```text
read canonical/derived state
create an intent
create a pause
request verification
request escalation/approval
read operation state
```

Agent tools may not autonomously:

```text
bypass Pause
change policy scope
release beyond authority
sign with user keys
read viewing keys
mark settlement completed
```

MCP should call the same REST/API or application service used by the SDK. It must not duplicate chain adapters or policy logic.

### Exit evidence

```text
tool schemas validated
agent outside authority → escalation/block
plan mutation → re-verification
MCP and REST produce identical operation semantics
no secrets/viewing-key access
```

---

# Phase S4 — PrismChannel minimal testnet slice

### Purpose

Validate the relationship capability without expanding scope into a general messenger.

### Testnet MVP

```text
create/accept channel between two Prism IDs
establish separate communication-key commitments
send one encrypted payment memo or receipt reference
read/decrypt through authorized channel participant
revoke/archive channel
verify no plaintext relationship/payment metadata is placed onchain
```

### Channel object

```yaml
channel_id
participants
key_commitments
created_at
status: PROPOSED | ACCEPTED | ACTIVE | ARCHIVED | REVOKED
policy
```

### Message object

```yaml
message_id
channel_id
ciphertext
content_type: payment_memo | receipt | claim_invitation | authorization_request
created_at
reply_to?
payment_ref?
claim_ref?
receipt_ref?
```

### Explicit non-goals

```text
no full chat application
no public social graph
no plaintext messages onchain
no channel-based payment authority
no automatic wallet signing
no STRK20 viewing-key handling
no implicit delegation
```

### Testnet gates

```text
T8 API contract
T10 product operation state
T11 channel/payment memo vertical slice
T12 revocation/restart/key-boundary tests
privacy metadata review
independent testnet readback of commitments/status
```

### Exit evidence

```text
channel creation/acceptance receipts
message ciphertext/commitment evidence
revocation/archive evidence
key-separation review
no-plaintext scan
testnet X3 envelope
```

---

# Phase S5 — Integrated testnet rehearsal

Run the surfaces together:

```text
SDK or MCP creates Intent
→ REST/API creates Pause
→ Pause verifies recipient/authority/policy
→ release creates Operation
→ chain adapter submits
→ reconciliation updates state
→ Activity/receipt returns observed result
→ PrismChannel carries the payment memo/receipt reference
```

The same testnet rehearsal must include:

```text
identity create/read
Base bind/resolve/revoke
STRK20 wallet route when selected
Pause release/cancel/escalate
Channel create/send/revoke
independent reads
restart/failure/retry
```

---

# Phase S6 — Mainnet surface hardening

Before mainnet:

```text
REST API version pinned
SDK version pinned
MCP schemas pinned
OpenAPI published
auth/rate limits/observability reviewed
Pause policy and approval model reviewed
Channel testnet evidence accepted
privacy wording audited
no secret/viewing-key path
```

PrismChannel remains non-blocking for the first mainnet release unless the release claim explicitly promises it. If included in the release claim, S4/S5 evidence becomes a mainnet gate.

## Recommended order

```text
S0 contract/authority
→ S1 REST/API
→ S2 SDK
→ S3 MCP
→ S4 minimal PrismChannel testnet slice
→ S5 integrated testnet rehearsal
→ S6 mainnet hardening
```

S1 and S2 are mandatory before mainnet. S3 should be completed before mainnet when agents/Pause are part of the product promise. S4 is now included in the testnet path, but does not imply a full messaging product.
