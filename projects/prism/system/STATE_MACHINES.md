# Prism State Machines — PRISM-7 / PRISM-8
## System Foundry Package v0.1 (authority: System Foundry; status: proposed)

Machine-readable companion: `state-machines.yaml`. Contract format follows SYSTEM_FOUNDRY §5.

---

# SM-PRISM-001 — OwnershipProof lifecycle (off-chain)

```text
              IssueChallenge
                    │
                    ▼
               ISSUED ──────────────► EXPIRED            (expiry passes unused)
                    │
          SubmitProof (verify)
        ┌───────────┼─────────────┐
        ▼           ▼             ▼
    VERIFIED     REJECTED     REJECTED ...           (each failure reason → distinct ERR code)
        │
  BindExecutionIdentity tx confirmed on Starknet
        │
        ▼
     CONSUMED                                     (terminal — replay fails forever)
```

| State | Authoritative meaning | User-visible meaning | Retryable? | Timeout |
|---|---|---|---|---|
| ISSUED | Nonce live server-side; challenge unproven | "Confirm in your Base wallet" | n/a | challenge_ttl (spec: ≤10 min) |
| VERIFIED | Signature valid per ladder; digest not yet consumed | "Verified — sign the binding in Starknet" | bind step only | until expiry |
| CONSUMED | proof_digest burned onchain with the binding | "Bound" | no | terminal |
| EXPIRED | TTL passed without use | "Challenge expired — restart" | restart only | terminal |
| REJECTED | Verification failed (specific ERR-0xx) | specific, honest error | new challenge only | terminal |

Never present VERIFIED as bound: **verified ≠ canonical** (INV-SYS-003; ASM-PRISM-005 validation clause).

---

# SM-PRISM-002 — Binding lifecycle (canonical, on Starknet)

```text
   (does not exist)
        │ BindExecutionIdentity  [controller-signed; verified proof; fresh digest]
        ▼
      ACTIVE ─────────────────► REVOKED
        (resolve = account)      (resolve = NO_ACTIVE_DESTINATION;
        │                        parent PrismIdentity unchanged)
        │
        ✗ REVOKED → ACTIVE is an INTENTIONALLY INVALID TRANSITION.
          No command reactivates a revoked binding. Re-binding the same
          account creates a NEW binding with a NEW proof. (INV-SYS-006)
```

## Transitions

```yaml
- transition_id: TR-8-01
  from: null
  to: ACTIVE
  command_ref: CMD-8-01
  actor: controller (Starknet signer) presenting a verified Base ownership proof
  authorization: caller == identity.controller (registry-enforced)
  preconditions:
    - PrismIdentity exists and is ACTIVE
    - proof verified by backend within expiry window (ACCEPTED — Option A, DEC-PRISM-SYS-001)
    - proof_digest not previously consumed onchain
    - venue enum contains BASE
  expected_version: none needed — bindings are append-only facts; uniqueness enforced by key
  idempotency: proof_digest single-use makes exact replay revert; same-key/same-body resubmission after confirmation returns existing binding
  retry: safe only via idempotent client retry of the SAME signed tx; never re-sign over changed state silently
  reversibility: only forward, via TR-8-02
  state_changes: [create Binding row ACTIVE, mark proof_digest consumed]
  external_effects: [Base-side nothing — verification was offchain]
  emitted_events: [EVT-EXECUTION-IDENTITY-BOUND]
  failure_codes: [ERR-001, ERR-002, ERR-004, ERR-005, ERR-006, ERR-007, ERR-008, ERR-010]
  compensation: none required — failed tx leaves no state

- transition_id: TR-8-02
  from: ACTIVE
  to: REVOKED
  command_ref: CMD-8-02
  actor: controller
  authorization: caller == identity.controller
  preconditions: [binding exists and status == ACTIVE]
  expected_version: block-time ordering (Starknet serializes); stale revoke after concurrent revoke is a no-op returning success-or-ERR-011 per contract mapping
  idempotency: revoking an already-REVOKED binding does NOT fail the decisive flow — it returns the already-revoked fact (ERR-011 semantics defined in ERROR_CATALOGUE)
  retry: safe
  reversibility: IRREVERSIBLE in scope (no reactivation path exists)
  state_changes: [status=REVOKED, revoked_at_block set]
  external_effects: []
  emitted_events: [EVT-BINDING-REVOKED]
  failure_codes: [ERR-002, ERR-004, ERR-011]
  compensation: n/a
```

**Invalid transitions (intentional, tested):** `REVOKED → ACTIVE` via any path; `ACTIVE → ACTIVE` duplicate bind with same digest; any transition where caller ≠ controller.

---

# SM-PRISM-003 — Operation lifecycle (backend wrapper for every chain-touching user action)

Canonical model from SYSTEM_FOUNDRY §15 / docs v0.3 §35 / STARKNET_SYSTEM_PROFILE transaction-truth rule:

```text
created → awaiting_authorization → ready → submitted → processing
        → confirming → confirmed → indexed → reconciled → completed
```

Failure branches: `failed_retryable | failed_terminal | reverted | expired | cancelled | requires_attention`.

Rules that are invariants here:

- `submitted ≠ completed` everywhere (INV-SYS-005 / INV-PRISM-015). A timeout after submission proves nothing.
- Each state names its authoritative source:

| State | Authoritative source |
|---|---|
| created…ready | backend operation record |
| submitted/processing/confirming | Starknet RPC tx status (mempool/accepted L2 pending semantics respected) |
| confirmed | Starknet execution_status SUCCEEDED at finality |
| indexed/reconciled | registry event observed by indexer AND matched to operation |
| completed | reconciliation complete; receipt issued |
| reverted | tx executed but REVERTED — map contract revert code to ERR catalogue entry |

- The decisive-proof sequence (bind → resolve → revoke → resolve) must surface these states honestly; FT-001 evidence records each hop's operation state.

---

# Ordering & concurrency notes

- Starknet sequencer ordering is authoritative for conflicting binds/revokes; the backend never resolves races itself.
- Backend nonce store for challenges uses atomic consume-on-verify (single-use); two concurrent verifications of one nonce yield exactly one VERIFIED (INV-SYS-010).
- Stale-state conflicts surface as structured errors (ERR-0xx), never silent overwrite (SYSTEM_FOUNDRY §18).
