# Backend runtime / Pause / identity lane restart

**Baseline:** `1a835bdc87efeb4db90bd315a1b0eb286e1a97ee`

## Outcome

The restart audit found the requested local surfaces already implemented on the baseline: explicit TESTNET/MAINNET PostgreSQL profile selection and schema isolation, durable operation persistence and CAS, scoped event projection/checkpoints with replay-safe reconstruction, restart recovery, receipt/reconciliation lifecycle guards, Pause plan/approval binding and authorization boundaries, typed SDK forwarding of Pause hashes/settlement operation IDs, and identity/binding projection evidence validators.

No additional source fix was justified in this lane. This report is the bounded audit artifact; pre-existing worktree edits were intentionally left untouched.

## Evidence separation

### Implemented locally (X2 ceiling)

- Runtime profile validation is fail-closed for profile, URL, schema, network, registry version, and migration-version mismatches.
- Operation rows persist tx hash, submission fence, attempts, authoritative source, reconciliation watermark/metadata, and use expected-version CAS.
- Event projection persists events before checkpoint advancement, keys replay by scoped `(tx_hash,event_index)`, and reconstructs through bounded keyset pages.
- Reconciliation keeps `submitted` distinct from `completed`, rejects unknown/reverted evidence appropriately, and resumes non-terminal rows on worker startup.
- Pause transitions bind plan/policy/approval scope, enforce CAS, keep `RELEASED` distinct from settlement completion, and route authority through the configured resolver.
- SDK Pause methods forward `planHash`, `approvalScopeHash`, `settlementOperationId`, policy version, session, and expected-version fields without raw chain calldata.
- Identity/binding discovery uses scoped projection candidates plus canonical readback and keeps candidate status `UNKNOWN` when lifecycle status is not authoritative.

### Independently tested locally

- Focused runtime/Pause/reconciliation suite: **8 files, 76 tests passed**.
- Broader operations/Pause/identity/application suite: **55 files passed, 5 skipped; 585 passed, 37 skipped**.
- PostgreSQL integration tier without a URL: **5 files skipped, 37 tests skipped** (skipped is not pass evidence).
- `pg_isready` observed the local PostgreSQL server accepting connections.

### Live / external evidence not observed

- No Starknet signing, broadcast, transaction receipt, independent RPC readback, indexer readback, or settlement execution was performed.
- No testnet/mainnet deployment or production runtime restart was performed.

### Blocked

- Local PostgreSQL integration could not be promoted from gated tests: no `PRISM_POSTGRES_TEST_URL` was configured. A local socket was reachable via `psql` as `ubuntu`, but the test process's libpq connection path selected SCRAM and failed with `client password must be a string`; creating a disposable database was also denied for the `ubuntu` role. The integration suites therefore remain skipped/blocked, not passed.
- Live identity and settlement evidence still requires authorized wallet/provider credentials, network configuration, broadcasts, receipts, and independent reads.

## Verification commands

```text
npx vitest run src/application/__tests__/runtime-profile.test.ts src/application/__tests__/factory-postgres-gating.test.ts src/features/prism-operations/__tests__/event-projection-coordinator.test.ts src/features/prism-operations/__tests__/reconciliation-worker.test.ts src/features/prism-operations/__tests__/recovery-policy.test.ts src/features/prism-pause/__tests__/m7-settlement-durability.test.ts src/features/prism-pause/__tests__/p6-transport-sdk.test.ts src/features/prism-pause/__tests__/p7-adversarial-closeout.test.ts
→ 8 passed files; 76 passed tests

npx vitest run src/features/prism-operations src/features/prism-pause src/features/prism-identity src/application/__tests__/runtime-profile.test.ts src/application/__tests__/factory-postgres-gating.test.ts
→ 55 passed files, 5 skipped; 585 passed, 37 skipped
```

The maturity ceiling remains **X2 local controlled implementation**. This artifact does not claim live signing, receipts, settlement, or deployment.
