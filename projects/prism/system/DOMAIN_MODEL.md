# Prism Domain Model — PRISM-7 / PRISM-8
## System Foundry Package v0.1 (authority: System Foundry; status: proposed)

Machine-readable companion: `domain-model.yaml`. IDs follow FOUNDRY_PROTOCOL §4.

---

# 1. Canonical vocabulary

| Term | Meaning | Never means |
|---|---|---|
| **PrismID** | Persistent protocol identity, e.g. `prism:P7F21`. Exists on Starknet only via the registry | Any address, handle, or username |
| **Controller** | Starknet account currently authorized to mutate protected identity state (bind/revoke/set-controller) | The backend; a session credential |
| **ExecutionIdentity** | Venue-native account that acts on one chain (e.g. a Base address) | A Prism ID; a controller |
| **Binding** | Registry record connecting a Prism ID to an ExecutionIdentity on a venue, with lifecycle state | A social link; a portfolio entry |
| **Resolution** | Read projection: `(identifier, venue) → ACTIVE destination | NO_ACTIVE_DESTINATION` | A write path; a cache authority |
| **OwnershipProof** | Signed, single-use Base challenge proving control of an ExecutionIdentity | Canonical state itself |

Identity ≠ controller ≠ execution identity is DEC-PRISM-003 and is structural here.

---

# 2. Domain objects

## OBJ-PRISM-001 — PrismIdentity

```yaml
object_id: OBJ-PRISM-001
name: PrismIdentity
purpose: Persistent cross-venue identity root owned by the user
canonical_identifier: prism_id (registry counter / felt252-derived canonical id)
authority: Starknet PrismIdentityRegistry
participants: [controller]
visibility_class: public_onchain
privacy_class: pseudonymous          # no social/metadata fields stored (RESEARCH gate ban #10)
persisted_fields:
  - prism_id
  - controller (Starknet account address)
  - created_at_block
  - identity_version
derived_fields: []                   # resolver output is derived at query time, not persisted on identity
relationships:
  - has_many: Binding (OBJ-PRISM-003)
states: [ACTIVE]                     # creation is once-only; PRISM-7/8 defines no deletion/terminal state
commands: [CreateIdentity (CMD-7-01), SetController (deferred — see §4)]
queries: [GetIdentity (QRY-7-01)]
events: [EVT-PRISM-IDENTITY-CREATED]
invariants: [INV-SYS-001, INV-SYS-002, INV-SYS-005]
terminal_states: []                  # none in scope — revoke destroys bindings, never identities (INV-PRISM-002)
failure_states: []
versioning: identity_version increments only on controller change; binding mutations do NOT touch it
```

`SetController` is named but **out of sprint scope** (controller rotation is future work per STARKNET_SYSTEM_PROFILE MVP rule); it exists in the model only so storage layout reserves controller as a mutable field without implying rotation ships now.

## OBJ-PRISM-002 — Controller

```yaml
object_id: OBJ-PRISM-002
name: Controller
purpose: Current mutation authority over one PrismIdentity
canonical_identifier: starknet contract-account address
authority: itself (Starknet signature validity)
participants: []
visibility_class: public_onchain
privacy_class: pseudonymous
persisted_fields: [address (inside OBJ-PRISM-001)]   # not a separate object onchain
derived_fields: []
relationships: [authorizes OBJ-PRISM-001, authorizes Binding transitions]
states: [AUTHORIZED]
commands: [all bind/revoke commands execute FROM this principal]
queries: []
events: []                           # controller changes emit nothing in scope (rotation out of scope)
invariants: [INV-SYS-002]
terminal_states: []
failure_states: []
versioning: n/a
```

## OBJ-PRISM-003 — Binding

```yaml
object_id: OBJ-PRISM-003
name: Binding
purpose: Canonical link from a Prism ID to a venue-native execution identity
canonical_identifier: (prism_id, venue=BASE, execution_account)
authority: Starknet PrismIdentityRegistry (status), backend verifier (proof validity only, PROPOSED under DEC-PRISM-SYS-001)
participants: [controller, base_execution_account_owner (same human), challenge_service]
visibility_class: public_onchain     # v0 Base bindings are public by design (CON-PRISM-002)
privacy_class: linkage_sensitive     # minimal fields only; no handles/social data (INV-PRISM-008..010)
persisted_fields:
  - prism_id
  - venue (enum: BASE; extensible)
  - execution_account (Base address)
  - status (ACTIVE | REVOKED)
  - bound_at_block
  - revoked_at_block (null while ACTIVE)
  - proof_digest (see note)
derived_fields: [resolution_result (computed at read time from status)]
relationships:
  - belongs_to: PrismIdentity
  - references: ExecutionIdentity
states: [ACTIVE, REVOKED]            # see SM-PRISM-002
commands: [BindExecutionIdentity (CMD-8-01), RevokeBinding (CMD-8-02)]
queries: [ResolveDestination (QRY-8-01)]
events: [EVT-EXECUTION-IDENTITY-BOUND, EVT-BINDING-REVOKED]
invariants: [INV-SYS-003, INV-SYS-004, INV-SYS-006, INV-SYS-007, INV-SYS-008]
terminal_states: [REVOKED]           # intentional invalid transition: REVOKED → ACTIVE (reactivation needs its own command + review; none exists in scope)
failure_states: []
versioning: monotonic block/tx position; no mutable payload after acceptance except status
```

**DECISION_REQUIRED (DEC-PRISM-SYS-001):** `proof_digest` semantics — keccak256 of the canonical challenge bytes, recorded and consumed single-use ONCHAIN at bind time (recommended). If the owner rejects the recommendation, digest consumption moves off-chain and ERR-007 replay guarantees weaken to service-level only.

**DECISION_REQUIRED (DEC-PRISM-SYS-002):** cross-ID account exclusivity is NOT enforced — the same Base account may be ACTIVE-bound to two Prism IDs unless Product truth says otherwise. Resolution keys on `(prism_id, venue)` so this does not corrupt resolution for either ID.

## OBJ-PRISM-004 — ExecutionIdentity

```yaml
object_id: OBJ-PRISM-004
name: ExecutionIdentity
purpose: Venue-native account performing actions on one chain
canonical_identifier: venue + native address (e.g. BASE + 0x83A…)
authority: the venue itself (Base validates its own signatures)
participants: []
visibility_class: public
privacy_class: public                # ordinary Base activity is public (DEC-PRISM-006)
persisted_fields: []                 # offchain concept; appears inside Binding only
derived_fields: []
relationships: [referenced_by Binding]
states: []                           # no independent lifecycle in scope
commands: []
queries: []
events: []
invariants: [INV-SYS-009]
terminal_states: []
failure_states: []
versioning: n/a
```

## OBJ-PRISM-005 — OwnershipProof

```yaml
object_id: OBJ-PRISM-005
name: OwnershipProof
purpose: Single-use evidence that the caller controls a Base execution account
canonical_identifier: proof_digest = keccak256(canonical challenge bytes)
authority: challenge_service issues nonce; backend verifies; registry consumes digest (PROPOSED split, DEC-PRISM-SYS-001)
participants: [challenge_service, backend_verifier, base_wallet]
visibility_class: private_until_used # challenge/nonce are server-side; digest becomes public at bind tx
privacy_class: internal
persisted_fields:
  - challenge fields: domain, venue, execution_account, prism_id, nonce, expiry
  - nonce_state (UNUSED | CONSUMED | EXPIRED) — server side
  - verification_result (signature class used: EOA | EIP1271 | ERC6492)
derived_fields: [proof_digest]
relationships: [targets OBJ-PRISM-003 via CMD-8-01]
states: [ISSUED, VERIFIED, REJECTED, CONSUMED, EXPIRED]   # SM-PRISM-001
commands: [IssueChallenge (CMD-B-01), SubmitProof (CMD-B-02)]
queries: []
events: []                           # backend events are logs, not canonical events
invariants: [INV-SYS-004, INV-SYS-010, INV-SYS-011, INV-SYS-012]
terminal_states: [CONSUMED, EXPIRED, REJECTED]
failure_states: [REJECTED]
versioning: schema_version on challenge format; bump on any field change
```

---

# 3. Objects deliberately excluded (non-goals made structural)

Guardian, Successor, Delegation, AgentAuthority, RecoveryPolicy, InheritancePolicy, SelectiveDisclosureProof, PrivateBindingProof, PrismClaim, PrismChannel, ChannelMessage, ExternalPrincipal, Portfolio, PrivateBalance — all deferred in docs v0.3 §28 or excluded by CANONICAL_STATE §12 / DEC-PRISM-015. Their absence here is a constraint, not an oversight; adding any of them to PRISM-7/8 is drift ≥ D3.
