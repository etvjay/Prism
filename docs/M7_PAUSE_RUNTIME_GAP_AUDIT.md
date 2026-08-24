# M7 Pause Runtime Gap Audit

**Baseline:** verified `4c41910d016056f2bd390d60a06e8d267906f11f`
**Execution note:** parent-side descendant `291c053` (M2 reconciliation-only changes) landed while this lane was running; it does not touch the M7 Pause files below.
**Scope:** local M7 Pause runtime/code only; no deployment, broadcast, secrets, frontend, M8+, M9, or `strk20.json`
**Canonicalization:** none. D-P0-001 through D-P0-005 remain owner-gated.

## Closed local gaps

- Intent idempotency now compares authority-bearing fields (`initiator`, normalized `agentId`) in both memory and PostgreSQL adapters. Retries still ignore generated timestamps and server-generated intent IDs.
- Policy evaluation now emits a stable blocking `PAUSE-POLICY-001` result when the intent, plan, pause, and evaluated policy snapshots do not share a policy version. The application service rejects drift before verification mutates the pause.
- Settlement operation persistence is preflighted before the pause CAS. A storage failure cannot leave a pause in `RELEASED` without a durable operation row. A prepared operation is cancelled on a losing pause CAS when it is still unlinked and in `created`.
- Settlement operation IDs and idempotency fingerprints are checked before linking in both `PauseService` and `PauseSettlementBridge`; unrelated existing operation IDs fail closed.
- Adapter return values are checked for operation identity and a post-submit, non-completed lifecycle state. `submitted` remains distinct from `completed`.
- `InMemoryPauseStore` has an explicit deep snapshot/restore path so restart tests load intents, plans, pauses, checks, and decisions into a new store instance rather than reusing the same object.
- Pause REST routes preserve the Pause error catalogue/status and echo request/correlation headers on Pause command responses. Pause and receipt reads now map store failures to stable dependency errors. Vitest now resolves the repository `@/*` alias so route-boundary tests execute the actual route modules.
- PostgreSQL pause CAS updates include the immutable `plan_hash` predicate, matching the memory adapter's plan binding guard.
- Expiry sweepers ignore only expected concurrent CAS/terminal races; non-CAS store failures propagate instead of being reported as an empty successful sweep.

## Verification

The focused M7 suite includes lifecycle, restart/restore, CAS races, fail-closed UNKNOWN/policy drift, operation/receipt boundary, adapter, and REST route regressions. Final command results are recorded in the delegated worker report; no live PostgreSQL, chain adapter, transaction receipt, or independent network read was performed.

## Owner decisions intentionally preserved

- **D-P0-001:** required scope (all consequential actions vs risk-scoped vs action/venue allowlist).
- **D-P0-002:** release authority (user/controller/agent/quorum/operator fallback).
- **D-P0-003:** UNKNOWN handling (always blocking vs explicitly clearable escalation/configuration).
- **D-P0-004:** canonical pause TTL, sweep trigger, and expired-intent/version semantics.
- **D-P0-005:** MVP action class / first consequential vertical slice.

This patch does not select, imply, or canonicalize any of those decisions. Release remains governed; `RELEASED` is only a future operation link, and operation/receipt completion remains distinct.

## Evidence ceiling

The implementation and deterministic injected tests are controlled local evidence (**X2**). The PostgreSQL adapter remains unproven against a live database in this lane; settlement adapters remain fake/injected; no testnet settlement, receipt, independent readback, or P8 evidence is claimed.
