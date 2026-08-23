# Prism Contract & Operation Spec — PRISM-7 / PRISM-8
## System Foundry Package v0.1 (authority: System Foundry; status: proposed)

Machine-readable companion: `operations.yaml`. Format follows SYSTEM_FOUNDRY §6/§12. These are specifications, not code; Cairo implementation belongs to the implementation run.

---

# 1. Contract boundary checklist (SYSTEM_FOUNDRY §12 answers)

- Which truth must be independently enforceable? Identity existence, controller authority, binding status, revocation, digest single-use.
- Which state must survive backend failure? All registry state (it is onchain); challenge nonces are recoverable-by-TTL.
- Which behavior requires atomicity? bind = digest-consume + binding-create in one Starknet tx (sequencer atomicity gives this for free).
- What should NOT be onchain for privacy? Social linkage, handles, balances, any metadata beyond INV-SYS-008's field list.
- What is cheaper/safer offchain? Base signature verification (ladder), nonce management, resolution caching under staleness bounds.
- Which events reconstruct canonical history? `PrismIdentityCreated`, `ExecutionIdentityBound`, `BindingRevoked` — replay of these three alone rebuilds full identity/binding state.

---

# 2. Registry operations (Starknet contract)

## OP-7-01 — create_identity(controller) → prism_id

```yaml
operation: OP-7-01 create_identity
purpose: Create a persistent PrismIdentity owned by caller
caller: any Starknet account
authorization: caller becomes controller of the new identity; creation once per allocated id
reads: [id_counter, caller validity]
writes: [identities[new_prism_id] = {controller=caller, created_at_block, version=0}, id_counter+1]
asset_movements: none
outputs: prism_id
events: [EVT-PRISM-IDENTITY-CREATED]
revert_codes: [ERR-003 internal allocation collision — treated as unreachable, panic]
replay_protection: n/a (fresh key each call)
uniqueness: prism_id globally unique by construction (counter)
privacy_behavior: stores no metadata beyond controller + block
pause_behavior: no pause mechanism in sprint scope (minimalism rule)
upgrade_impact: immutable deployment assumed; no proxy
migration_impact: none
gas_execution_notes: minimal storage; no arrays per identity at PRISM-7 (bindings live under their own keys)
```

## OP-7-02 — get_identity(prism_id) → {controller, created_at_block, version} | ERR-010

```yaml
operation: OP-7-02 get_identity
purpose: Deterministic identity read
caller: anyone
authorization: public read
reads: [identities[prism_id]]
writes: []
asset_movements: none
outputs: view struct or NOT_FOUND
events: []
revert_codes: []          # returns not-found flag rather than reverting, for cheap existence probes
replay_protection: n/a
uniqueness: n/a
privacy_behavior: reveals only canonical fields
pause_behavior: n/a
upgrade_impact: n/a
migration_impact: n/a
gas_execution_notes: view function
```

## OP-8-01 — bind_execution_identity(prism_id, venue, execution_account, proof_digest)

```yaml
operation: OP-8-01 bind_execution_identity
purpose: Accept a verified Base ownership proof as a canonical ACTIVE binding
caller: identity.controller                       # per DEC-PRISM-SYS-001 (ACCEPTED — Option A)
authorization: require_caller == identities[prism_id].controller
reads: [identities[prism_id], bindings[(prism_id,venue,execution_account)], consumed_digests[proof_digest]]
writes:
  - bindings[(prism_id,venue,execution_account)] = {ACTIVE, bound_at_block}
  - consumed_digests[proof_digest] = true         # placement ACCEPTED under DEC-PRISM-SYS-001 (Option A)
asset_movements: none
outputs: success; emits event
events: [EVT-EXECUTION-IDENTITY-BOUND]
revert_codes:
  - ERR-002 identity_not_found
  - ERR-004 not_controller                        # caller ≠ controller
  - ERR-007 proof_digest_already_consumed         # replay (FT-003)
  - ERR-008 binding_already_active                # duplicate active same-key
  - ERR-001 invalid_venue                         # enum check
  - ERR-005 invalid_execution_account             # zero-address class guard
replay_protection: digest single-use onchain + nonce store offchain
uniqueness: (prism_id, venue, execution_account) unique while ACTIVE; re-bind after revoke allowed with fresh digest (new binding fact)
privacy_behavior: fields limited to INV-SYS-008 list
pause_behavior: none
upgrade_impact: immutable
migration_impact: none
gas_execution_notes: two storage writes + one map set; well within normal invoke cost
note: |
  The registry deliberately does NOT re-verify the Base signature onchain.
  It trusts that whoever presents a fresh, unconsumed digest went through the
  verifier, AND that the tx signer is the controller. This dual-gate IS the
  proposed trust model. Cross-ID exclusivity is intentionally NOT enforced
  (DECISION_REQUIRED DEC-PRISM-SYS-002).
```

## OP-8-02 — resolve(prism_id, venue) → execution_account | NO_ACTIVE_DESTINATION

```yaml
operation: OP-8-02 resolve
purpose: Authoritative resolution of an identifier to its ACTIVE destination
caller: anyone
authorization: public read
reads: [bindings[(prism_id,venue,*)) status]
writes: []
asset_movements: none
outputs: ACTIVE account | NO_ACTIVE_DESTINATION sentinel
events: []
revert_codes: []          # never reverts for missing/revoked — returns sentinel (INV-PRISM-004 semantics)
replay_protection: n/a
uniqueness: at most one ACTIVE binding per (prism_id,venue); a new binding requires revocation of the current destination first (RT-01 shadow-active divergence closed by the contract invariant); cross-ID account exclusivity remains unresolved under DEC-PRISM-SYS-002
privacy_behavior: exposes only what is already public
pause_behavior: n/a
upgrade_impact: n/a
migration_impact: n/a
gas_execution_notes: view
```

## OP-8-03 — revoke_binding(prism_id, venue, execution_account)

```yaml
operation: OP-8-03 revoke_binding
purpose: Terminate an ACTIVE binding; preserve parent identity
caller: identity.controller
authorization: require_caller == controller
reads: [bindings[key], identities[prism_id]]
writes: [bindings[key].status = REVOKED, revoked_at_block]
asset_movements: none
outputs: success or already-revoked fact
events: [EVT-BINDING-REVOKED]
revert_codes:
  - ERR-002 identity_not_found
  - ERR-004 not_controller
  - ERR-009 binding_not_found
replay_protection: n/a (status transition is naturally single-path)
uniqueness: n/a
privacy_behavior: no payload beyond key
pause_behavior: none
upgrade_impact: immutable
migration_impact: none
gas_execution_notes: single write
```

---

# 3. Backend operations (off-chain)

## CMD-7-01 CreateIdentity — backend flow wrapper

```yaml
command_id: CMD-7-01
name: CreateIdentity
actor: user via Prism app (wallet signs)
purpose: Allocate a Prism ID on Starknet
target_object: OBJ-PRISM-001
authorization: user's own Starknet wallet signature
economic_consequence: gas only
irreversible: yes (existence)
inputs: []
preconditions: [wallet connected]
expected_object_version: n/a
idempotency_key: client-generated request id; server dedupes before broadcast; chain-level uniqueness by counter makes duplicates harmless-but-distinct — client retry MUST reuse request id to avoid double identity creation costs
state_transition: null → ACTIVE
side_effects: [indexer watches for EVT-PRISM-IDENTITY-CREATED]
async_operation: SM-PRISM-003 lifecycle
events: [EVT-PRISM-IDENTITY-CREATED onchain]
errors: [ERR-020 wallet_rejected, ERR-021 rpc_unavailable, ERR-022 timeout_unknown_status]
audit_requirements: operation record + tx hash correlation
```

## CMD-B-01 IssueChallenge

```yaml
command_id: CMD-B-01
name: IssueChallenge
actor: authenticated app user
purpose: Obtain domain/nonce/expiry-bound Base ownership challenge
target_object: OBJ-PRISM-005
authorization: product session (distinct from signing authority — CON-PRISM-006 separation)
economic_consequence: none
irreversible: no
inputs: [prism_id, venue=BASE, execution_account]
preconditions: [identity exists (read), execution_account well-formed]
expected_object_version: n/a
idempotency_key: new nonce per call (intentionally not idempotent — challenges are cheap, reuse is a replay hazard)
state_transition: → ISSUED
side_effects: [nonce stored server-side with TTL]
async_operation: none (synchronous)
events: []
errors: [ERR-010 identity_not_found, ERR-005 invalid_execution_account]
audit_requirements: issuance log WITHOUT linking session→prism_id beyond operational need (privacy minimization, docs v0.3 §9 posture)
```

## CMD-B-02 SubmitProof

```yaml
command_id: CMD-B-02
name: SubmitProof
actor: user's Base wallet signature, submitted through app
purpose: Verify ladder-valid ownership proof against the issued challenge
target_object: OBJ-PRISM-005
authorization: cryptographic — ladder result must be VALID
economic_consequence: none
irreversible: verification consumes the nonce atomically (INV-SYS-010)
inputs: [challenge_id, signature]
preconditions: [nonce UNUSED, unexpired]
expected_object_version: challenge state ISSUED
idempotency_key: nonce — second submission fails ERR-006 even with valid signature
state_transition: ISSUED → VERIFIED | REJECTED(reason) ; later CONSUMED | EXPIRED
side_effects: [verification_result records signature class EOA|EIP1271|ERC6492]
async_operation: none for verify; the subsequent bind is async
events: []
errors:
  - ERR-003 invalid_signer            # ladder returned invalid/wrong account
  - ERR-012 altered_message           # digest mismatch vs challenge fields (INV-SYS-011)
  - ERR-013 proof_expired             # TTL passed
  - ERR-006 nonce_already_used        # replay at service layer
  - ERR-014 unsupported_signature_class  # ladder could not classify (e.g. exotic 1271 failure)
audit_requirements: rejection-reason histogram; fixture-corpus parity in tests
```

## QRY-7-01 GetIdentity / QRY-8-01 ResolveDestination

```yaml
query_id: QRY-8-01
name: ResolveDestination
purpose: resolve(identifier, venue) for counterparties and UI
actor: anyone
authorization: public
target_object: Binding projection
filters: [identifier, venue]
pagination: n/a
freshness: bounded staleness — served watermark within confirmed_block − K; K small constant; stale-active forbidden (INV-SYS-007)
consistency: read-your-writes for ops the user just executed (op-aware cache bypass)
privacy: returns destination only; no graph enumeration endpoints exist in slice
authoritative_fields: [execution_account, status]
derived_fields: [none exposed as authoritative]
cache_policy: key (identifier, venue); invalidate on observed REVOKED/BIND events; watermark check every serve
errors: [ERR-010 when identifier unknown — mapped to NO_ACTIVE_DESTINATION + reason=UNKNOWN_IDENTIFIER distinction preserved internally]
```

---

# 4. Persistence classification (SYSTEM_FOUNDRY §17)

```text
AUTHORITATIVE_APP_STATE   challenge/nonces, operation rows        (backend DB)
LEDGER_INDEX              indexer tables keyed (tx_hash,event_idx) (derivable, rebuildable)
CACHE                     resolution views w/ watermarks          (disposable)
DERIVED                   activity projections                    (rebuildable)
AUDIT                     op event log, reconciliation records    (append-only)
WORKFLOW                  SM-PRISM-003 op state                   (durable across restarts)
EPHEMERAL                 in-flight verification context          (TTL'd)
```

Canonical protocol state lives ONLY in the registry. Every backend table above is classified disposable-or-auditable; none is authoritative for identity truth.

---

# 5. Transaction boundaries

- DB commit + chain confirmation are NEVER one transaction (SYSTEM_FOUNDRY §14). Pattern: durable op row → broadcast → poll → reconcile.
- Compensation paths: none needed on revert (no partial state). Recovery = honest op-state correction.
```
