# PRISM-8 — V8.3 Canonical Binding Slice Implementation Report

- **Branch**: `agent/backend-v83-final` (isolated worktree)
- **Session date**: 2026-08-23
- **Status**: implemented, locally verified — **X2 evidence level only**
- **Decision basis**: DEC-PRISM-SYS-001 (ACCEPTED — Option A, owner Jason, 2026-08-23)

## 1. Scope statement

This change implements **only** the V8.3 on-chain canonical binding slice of
`PrismIdentityRegistry`:

| Packet item | Status |
|---|---|
| Canonical binding storage keyed `(prism_id, venue, execution_account)` with ACTIVE/REVOKED state, block timestamps, per-key binding_version | ✅ implemented |
| Consumed proof-digest storage (single-use forever) | ✅ implemented |
| `bind_execution_identity(prism_id, venue, execution_account, proof_digest)` | ✅ implemented |
| `resolve(prism_id, venue)` → `ActiveDestination | NoActiveDestination` | ✅ implemented |
| `revoke_binding(prism_id, venue, execution_account)` (ERR-011 idempotent, irreversible) | ✅ implemented |
| Events: `PrismIdentityCreated` (preserved), `ExecutionIdentityBound`, `BindingRevoked` | ✅ implemented |
| snforge TDD coverage (V8.3 acceptance set) | ✅ implemented |

Explicitly **NOT** implemented (scope guard, unchanged):

- No proxy / upgradeability (SD-002 immutable posture preserved)
- No Base signature re-verification onchain (DEC-PRISM-SYS-001: registry consumes the digest; the backend verifier is the trusted proof validator)
- No social metadata, balances, bridge/value movement, controller rotation, cross-ID exclusivity (DEC-PRISM-SYS-002 unresolved), or reactivation

## 2. DEC-PRISM-SYS-001 enforcement in code

```text
caller == identities[prism_id].controller        -> ERR-004 otherwise
venue == 'BASE'                                  -> ERR-001 otherwise
execution_account != 0                           -> ERR-005 otherwise
bindings[key] not already ACTIVE                 -> ERR-008 otherwise
consumed_digests[proof_digest] == false          -> ERR-007 otherwise
=> canonical ACTIVE write + digest consume + ExecutionIdentityBound emit,
   all in one Starknet tx (INV-SYS-003: VERIFIED != ACTIVE)
```

## 3. Storage shape

- `id_counter`, `identities[prism_id]` — PRISM-7, unchanged behavior
- `bindings[(felt252, felt252, ContractAddress)] -> Binding { active, bound_at_block, revoked_at_block, binding_version }`
- `consumed_digests[felt252] -> bool` — never cleared (INV-SYS-004)
- `active_destinations[(prism_id, venue)] -> ContractAddress` — O(1) deterministic resolution pointer; written on bind, cleared on revoke iff it still names the revoked account (stale pointers cannot survive their own revocation)

`resolve` returns the typed enum `Resolution::ActiveDestination(account)` or
`Resolution::NoActiveDestination`; REVOKED state is never returned as active.

## 4. Verification (exact output)

Toolchain: scarb 2.20.0 / cairo 2.20.0 / snforge 0.63.0.

```
$ scarb clean && scarb build && snforge test
Compiling prism_identity_registry v0.1.0 (...)
    Finished `dev` profile target(s) in 2 seconds
...
Tests: 26 passed, 0 failed, 0 ignored, 0 filtered out
```

V8.3 suite (`tests/test_prism_v83.cairo`, 19 tests):

| Test | Covers |
|---|---|
| test_7_authorized_create_succeeds_and_read_is_deterministic | OP-7-01/02 baseline preserved |
| test_7_unknown_identity_reads_not_found | ERR-010 flag read |
| test_8_bind_success_emits_event_and_records_active_binding | A8-1 bind success + event payload + INV-SYS-003 |
| test_8_bind_unknown_identity_reverts | ERR-002 |
| test_8_bind_wrong_controller_reverts | ERR-004 / INV-SYS-002 |
| test_8_bind_invalid_venue_reverts | ERR-001 |
| test_8_bind_zero_execution_account_reverts | ERR-005 |
| test_8_bind_duplicate_active_reverts | ERR-008 |
| test_8_consumed_digest_replay_reverts_on_same_key | ERR-007 / INV-SYS-004 / FT-003 |
| test_8_consumed_digest_replay_reverts_across_identities | ERR-007 global single-use |
| test_8_revoke_success_emits_event_and_flips_resolution | OP-8-03 + EVT-BINDING-REVOKED + INV-SYS-007 |
| test_8_revoke_missing_binding_reverts | ERR-009 |
| test_8_revoke_is_idempotent_no_duplicate_event | ERR-011 benign success, no duplicate event |
| test_8_revoked_state_never_returns_to_active_without_new_fact | INV-SYS-006 no reactivation |
| test_8_rebind_after_revoke_with_fresh_digest_creates_version_two | uniqueness note: rebind = new binding fact, version 2 |
| test_8_revoke_wrong_controller_reverts | ERR-004 on revoke path |
| test_8_revoke_unknown_identity_reverts | ERR-002 on revoke path |
| test_8_resolve_sentinel_for_unknown_and_unbound | OP-8-02 sentinel semantics |
| test_prism_id_persists_through_binding_lifecycle | identity untouched by binding mutations |

PRISM-7 regression suite (`tests/test_prism7.cairo`, 7 tests): all still pass —
existing `create_identity`/`get_identity` behavior and `PrismIdentityCreated`
event are preserved byte-for-byte.

## 5. Evidence level

All claims above are **X2 (local verification only)**: snforge local execution.
No deployment, no testnet/mainnet transactions, no indexer runs, no runtime
evidence. `EVIDENCE_LEDGER.md` was deliberately NOT modified; no ledger row has
moved. The prohibited-claims list (SYSTEM_CANONICAL §8) remains in force — in
particular no "trustless/permissionless" claim is made.

## 6. Remaining production / evidence risks

1. **SD-008 chainId-v2 hardening (UNRESOLVED, pre-deployment gate)**: challenge
   serialization must bind an explicit chainId so proofs cannot be replayed
   across networks. Offchain service work exists (commit e8886af) but is not
   canonicalized into SD-005's envelope spec nor covered by cross-network fixtures.
2. **Trusted backend verifier**: per DEC-PRISM-SYS-001 the backend is a trusted
   verifier for proof validity. Its ladder (EOA→EIP-1271→ERC-6492) is offchain
   X2-verified only; onchain trust reduces to digest freshness + controller signature.
3. **DEC-PRISM-SYS-002 unresolved**: cross-ID account exclusivity is not
   enforced; one Base account may be ACTIVE-bound to two Prism IDs.
4. **No runtime/deployment evidence**: registry is undeclared/undeployed;
   EVD rows for PRISM-7/8 remain X0 until real chain runs occur.
5. **Immutable deployment**: bugs require redeploy + re-bind (SD-002 consequence).
6. **Live Base verification ladder**: no live/forknet EIP-1271/ERC-6492 pass exists;
   the ladder remains X2-offchain only. No live Base verification claim is made.

## 7. Spec reconciliation performed in this packet

Only dependent System artifacts with stale DEC-PRISM-SYS-001 status were touched
(md + yaml companions); DECISIONS.md, AUDIT.md, EVIDENCE_LEDGER.md, CANONICAL_STATE.md,
and all frontend files were NOT modified:

| Artifact | Change |
|---|---|
| `system/authority-matrix.yaml` | decision_refs `_PROPOSED` → `_ACCEPTED` (A4, A5) |
| `system/invariants.yaml` | decision_refs `_PROPOSED` → `_ACCEPTED` (INV-SYS-003/004) |
| `system/domain-model.yaml` | digest-semantics ref → `_ACCEPTED_digest_semantics` |
| `system/operations.yaml` | OP-8-01 caller note + refs → ACCEPTED |
| `system/AUTHORITY_MATRIX.md` | A4 row, competing-authority note, can_override note → ACCEPTED |
| `system/DOMAIN_MODEL.md` | Binding/OwnershipProof authority lines + digest DECISION_REQUIRED → DECIDED |
| `system/INVARIANTS.md` | INV-SYS-003/004 notes → ACCEPTED |
| `system/STATE_MACHINES.md` | bind precondition → ACCEPTED |
| `system/CONTRACT_SPEC.md` | OP-8-01 caller comment → per accepted decision |
| `system/STACK_DECISIONS.md` | SD-004 depends_on → ACCEPTED |
| `system/ERROR_CATALOGUE.md` | DECISION_REQUIRED block → DECIDED |
| `system/SYSTEM_CANONICAL.md` | §5 status + gate status + footer unresolved list updated to X2-implemented; SD-008 named as open pre-deployment gate |
| `agent-packets/BACKEND_PRODUCTION_READINESS_PACKET.md` | §7.1 blocker resolved; WP-0/WP-5 marked done at X2; runtime X0 rows unchanged |
| `system-inputs/PRISM7_CROSSWALK.md` | §8 storage-reservation risk marked resolved by V8.3 |

DEC-PRISM-SYS-002 (cross-ID exclusivity) remains PROPOSED/unresolved everywhere.
chainId-v2 hardening (e8886af, uncanonicalized into SD-005) remains an explicit
open pre-deployment gate.

## Session footer

- Model: ox-alpha (Hermes 0x Alpha)
- Date: 2026-08-23
- Branch: `agent/backend-v83-final`
- Verification: scarb clean && scarb build && snforge test → 26 passed / 0 failed (local only)
