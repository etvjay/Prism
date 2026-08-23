# Prism Authority Matrix — PRISM-7 / PRISM-8
## System Foundry Package v0.1 (authority: System Foundry; status: proposed)

Machine-readable companion: `authority-matrix.yaml`.

---

# 1. Primary authority per behavior

Every critical rule has exactly one primary authority. "Never authoritative" is binding.

| # | Behavior | Primary authority | Secondary validation | Never authoritative |
|---|---|---|---|---|
| A1 | Prism identity existence & read | Starknet `PrismIdentityRegistry` | backend indexer | frontend, backend cache |
| A2 | Controller state | Registry (caller checks) | backend relay pre-checks | UI session |
| A3 | Binding lifecycle (create/revoke status) | Registry | indexer events | optimistic UI |
| A4 | Base ownership proof validity | Backend verifier implementing EOA→1271→6492 ladder (ACCEPTED — DEC-PRISM-SYS-001, Option A; onchain only consumes the digest) | registry digest single-use check | frontend wallet messages alone |
| A5 | Canonical acceptance of a Base proof | Registry state transition | operation reconciliation | backend "verified" flag |
| A6 | Resolution result | Registry canonical state (or indexer under INV-SYS-007 staleness bound) | cache watermark re-check | any cached value past its watermark |
| A7 | Base balances / public activity | Base RPC/explorer | derived portfolio layer | Prism registry |
| A8 | Operation UX status | SM-PRISM-003 workflow + ledger reconciliation | frontend subscription | optimistic UI |
| A9 | Privacy claims | Underlying mechanism evidence (DEC-PRISM-013) | FT-007 copy audit | marketing copy |

Competing-authority note: A4 is the one row where authority is deliberately split (verify offchain, accept onchain). That split **is** DEC-PRISM-SYS-001 and is now ACCEPTED (Option A, owner Jason, 2026-08-23; see DECISIONS.md).

---

# 2. Authorization model

```text
CreateIdentity      caller: any Starknet account        constraint: once per prism_id (id allocated by registry)
BindExecutionIdentity   caller: identity.controller     + verified proof digest unconsumed
RevokeBinding       caller: identity.controller
resolve             caller: anyone                      read-only
get_identity        caller: anyone                      read-only
```

Product authentication (email/passkey/session) never substitutes for controller signature (CON-PRISM-006) and vice versa. The backend may refuse to relay; it can never authorize.

---

# 3. Trust & information boundary map

```yaml
- principal: user_controller (Starknet account)
  can_authenticate_as: identity controller via Starknet signature
  can_authorize: [bind, revoke, future controller rotation]
  can_read: [all registry state]
  can_write: [registry protected state]
  can_derive: []
  must_not_know: []                        # it's the user's own state
  can_move_value: none in this slice       # registry holds no approvals (INV-SYS-012)
  can_override: nothing canonical
  failure_impact: lost keys = lost mutation authority (identity persists; rotation out of scope)
  compromise_boundary: full control of that identity's bindings

- principal: backend_service
  can_authenticate_as: itself (relayer/verifier role only)
  can_authorize: NOTHING canonical          # issues challenges, verifies proofs, relays txs
  can_read: [chain state, challenge store]
  can_write: [challenge/nonces, operation records, caches/indexes]  # never registry state directly
  can_derive: [resolution views, activity feeds]
  must_not_know: [user private keys, viewing keys, session↔binding linkage beyond operational need]
  can_move_value: none
  can_override: none — trusted verifier for PROOF VALIDITY only (DEC-PRISM-SYS-001, ACCEPTED — Option A)
  failure_impact: binds/revokes unavailable; resolution degrades to canonical reads; no integrity loss to canonical state
  compromise_boundary: can issue fraudulent VERIFIED results → mitigated ONLY by controller still signing the bind tx; attacker cannot bind without the user's Starknet key

- principal: base_wallet (EOA or ERC-4337 account)
  can_authenticate_as: owner of execution_account (via ladder-valid signature)
  can_authorize: one OwnershipProof over one challenge
  can_read: [own challenge]
  can_write: []
  must_not_know: [Starknet controller key]
  can_move_value: none in this slice
  can_override: none
  failure_impact: cannot complete bind flow
  compromise_boundary: bindings for that execution_account

- principal: starknet_sequencer
  can_authenticate_as: n/a (infrastructure)
  can_authorize: transaction ordering/finality
  can_write: canonical ordering of registry transitions
  must_not_know: n/a
  failure_impact: liveness only; no safety impact to accepted state semantics
  compromise_boundary: reorg/finality assumptions — reconciliation rules cover divergence
```

Explicit separation maintained: authentication ≠ authorization ≠ delegation ≠ privacy visibility ≠ commercial entitlement ≠ economic authority ≠ administration (SYSTEM_FOUNDRY §11).

---

# 4. Reconciliation rules

Assume divergence between chain, RPC, indexer, cache, and backend DB (STARKNET_SYSTEM_PROFILE rule).

| Divergence case | Canonical authority | Detection | Repair action | Operator visibility | User visibility | Audit entry |
|---|---|---|---|---|---|---|
| submitted but unknown tx | chain RPC re-query | op stuck in submitted > timeout | re-poll by tx hash; mark failed_retryable after N misses | op dashboard | "still processing" honest label | op event log |
| confirmed but unindexed | chain receipt | indexer lag watermark behind | replay events from block range | lag metric | none (state already correct at source) | reconciliation record |
| missed/duplicate indexer events | chain receipts as ground truth | sequence-gap scan | idempotent re-index keyed by (tx_hash, event_index) | gap alert | none | recon record |
| stale cache shows ACTIVE for revoked binding | registry state | watermark comparison at serve time | invalidate; serve NO_ACTIVE_DESTINATION | staleness metric | correct result served | recon record |
| backend restart mid-operation | durable operation row | startup sweep of non-terminal ops | resume polling from last recorded tx hash | recovery counter | operation resumes truthful state | recovery log |
| worker crash after verify before submit | challenge store (digest unused) | VERIFIED ops with no submitted tx | expire gracefully; user retries with fresh challenge if TTL passed | crash-recovery metric | "restart binding" prompt | recovery log |
| contract upgrade | n/a — out of scope | — | no upgrade path exists in sprint scope; deployment is immutable-by-default | — | — | — |

Rule of record: derived state is repaired toward canonical truth; canonical truth is never edited to match derived state.

---

# 5. Observability correlation chain

```text
user_action_id → request_id → command_id → operation_id → db_tx_id
             → chain_tx_hash → event_id → reconciliation_id → served_state_version
```

The system must answer "why does this user see this state?" without manual guesswork (SYSTEM_FOUNDRY §21). Minimum implementation obligations:

- every chain-touching command creates an Operation resource before submission;
- every Operation stores its chain_tx_hash once broadcast;
- resolution responses carry the block watermark they were computed against;
- error responses carry stable ERR codes (ERROR_CATALOGUE), never raw stack traces.
