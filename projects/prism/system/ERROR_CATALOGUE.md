# Prism Error Catalogue — PRISM-7 / PRISM-8
## System Foundry Package v0.1 (authority: System Foundry; status: proposed)

**DECIDED:** ERR-004 (not_controller), ERR-007 (proof_digest_already_consumed), and ERR-009's placement assume the acceptance-trust mechanism of DEC-PRISM-SYS-001 (ACCEPTED — Option A, 2026-08-23): backend verifies, controller signs, registry consumes the digest onchain. Any change to this mechanism is amended via a superseding decision — never silently.

Machine-readable companion: `errors.yaml`. Format follows SYSTEM_FOUNDRY §16.

Rules: stable codes across API + contract mapping; raw stack traces are never external errors; every error names retryability and user action; distinct causes get distinct codes (A8-9).

---

| Code | Name | Category | Trigger | Retryable | User action | Contract/HTTP mapping |
|---|---|---|---|---|---|---|
| ERR-001 | invalid_venue | validation | venue enum lacks value | no | use supported venue | contract revert / 422 |
| ERR-002 | identity_not_found | not_found | prism_id unknown to registry | no | check identifier | contract revert / 404 |
| ERR-003 | invalid_signer | authentication | verification ladder returns invalid or account mismatch (FT-002) | no — new challenge | reconnect wallet, restart flow | offchain verify result / 401 |
| ERR-004 | not_controller | authorization | registry caller ≠ identity.controller | no | sign with controller account | contract revert / 403 |
| ERR-005 | invalid_execution_account | validation | zero/malformed Base address | no | correct input | contract revert / 422 |
| ERR-006 | nonce_already_used | replay | challenge nonce consumed (INV-SYS-010, FT-003 service layer) | no — new challenge | restart binding flow | verify layer / 409 |
| ERR-007 | proof_digest_already_consumed | replay | digest map hit onchain (INV-SYS-004) | no — new proof | restart binding flow | contract revert / 409 |
| ERR-008 | binding_already_active | conflict | duplicate ACTIVE bind same key | no | resolve current binding first | contract revert / 409 |
| ERR-009 | binding_not_found | not_found | revoke target missing | no | check binding exists | contract revert / 404 |
| ERR-010 | identity_not_found_read | not_found | read/resolve on unknown id | no | n/a | view return / 404 |
| ERR-011 | binding_already_revoked | stale_state | revoke on REVOKED binding | benign — returns existing fact | none needed | view/revert-free success path / 200-with-state |
| ERR-012 | altered_message | validation | recomputed digest ≠ signed digest (INV-SYS-011, A8-3 matrix) | no — new challenge | restart flow | verify layer / 400 |
| ERR-013 | proof_expired | stale_state | TTL exceeded pre-verify | new challenge | restart flow | verify layer / 410 |
| ERR-014 | unsupported_signature_class | unsupported | ladder cannot classify signature | no | use supported wallet type | verify layer / 422 |
| ERR-020 | wallet_rejected | authentication | user denied wallet prompt | yes | retry | client / 401-ish UX state |
| ERR-021 | rpc_unavailable | dependency | RPC provider failure | yes backoff | wait/retry | 503 |
| ERR-022 | timeout_unknown_status | stale_state | submitted but unconfirmed past window (never reported as failed-onchain) | poll-only | honest "still processing" | 202-with-op-state |
| ERR-023 | stale_state_conflict | stale_state | served cache below watermark / op version conflict | re-read | refresh | 409 |

Notes:
- ERR-011 is deliberately non-failing: revoking an already-revoked binding must not break the decisive flow (idempotent semantics, TR-8-02).
- ERR-022 enforces "a timeout after submission does not prove failure" (docs v0.3 §35).
- Every contract-mapped code above appears in an operation's `revert_codes` and at least one test asserts it (validated cross-document).
