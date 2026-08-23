# Prism Event Catalogue — PRISM-7 / PRISM-8
## System Foundry Package v0.1 (authority: System Foundry; status: proposed)

Machine-readable companion: `events.yaml`. Format follows SYSTEM_FOUNDRY §8.

Canonical rule: events are past-tense completed facts; replaying the three canonical events alone reconstructs full identity + binding state (Q7.3). No generic `RecordUpdated`/`DataChanged` events exist.

---

## EVT-PRISM-IDENTITY-CREATED

```yaml
event_id: EVT-PRISM-IDENTITY-CREATED
type: onchain (Starknet event)
past_tense_name: PrismIdentityCreated
source_authority: PrismIdentityRegistry (OP-7-01)
object_ref: OBJ-PRISM-001
schema_version: 1
event_key: prism_id
object_version: 0 (identity_version at creation)
correlation_id: tx_hash + event_index
created_at: block timestamp
payload: {prism_id, controller}
privacy_class: pseudonymous — no metadata beyond the two fields (INV-SYS-008)
ordering: by (block_number, transaction_hash, event_index)
uniqueness: prism_id once ever
replay: idempotent by event_key
retention: permanent (chain)
signature: n/a — chain-authenticated
consumer_responsibilities: indexer creates identity projection; must not enrich with social data
```

## EVT-EXECUTION-IDENTITY-BOUND

```yaml
event_id: EVT-EXECUTION-IDENTITY-BOUND
type: onchain
past_tense_name: ExecutionIdentityBound
source_authority: PrismIdentityRegistry (OP-8-01)
object_ref: OBJ-PRISM-003
schema_version: 1
event_key: (prism_id, venue, execution_account) + bound_at_block
object_version: binding sequence number per key
correlation_id: tx_hash + event_index; links to proof_digest for audit
created_at: block timestamp
payload: {prism_id, venue, execution_account, proof_digest}
privacy_class: public by v0 design (Base bindings are public linkage; CON-PRISM-002 acknowledged)
ordering: chain order
uniqueness: digest once ever (INV-SYS-004)
replay: idempotent by event_key + digest check
retention: permanent
signature: n/a
consumer_responsibilities: invalidate resolution caches for (prism_id, venue); update op state
```

## EVT-BINDING-REVOKED

```yaml
event_id: EVT-BINDING-REVOKED
type: onchain
past_tense_name: BindingRevoked
source_authority: PrismIdentityRegistry (OP-8-03)
object_ref: OBJ-PRISM-003
schema_version: 1
event_key: (prism_id, venue, execution_account) + revoked_at_block
object_version: increments binding version
correlation_id: tx_hash + event_index
created_at: block timestamp
payload: {prism_id, venue, execution_account}
privacy_class: public
ordering: chain order
uniqueness: once per binding instance
replay: idempotent
retention: permanent
signature: n/a
consumer_responsibilities: resolution must flip to NO_ACTIVE_DESTINATION; identity projection MUST NOT be deleted or mutated (INV-SYS-006)
```

---

## Reconstruction guarantee (testable)

```text
empty state
  + replay(PrismIdentityCreated)*
  + replay(ExecutionIdentityBound)*
  + replay(BindingRevoked)*
= complete canonical identity/binding state
```

This is TEST-7-3-1 and gates PRISM-7 acceptance (A7-4). Off-chain backend events (operation logs) are audit trails, never canonical, and are not part of this catalogue.
