# Backend runtime / Pause / identity lane restart

**Baseline:** `1a835bdc87efeb4db90bd315a1b0eb286e1a97ee`
**Verification HEAD:** `e9319bb` (main, 2026-09-03)
**Ceiling:** X2 local controlled implementation — no live signing, broadcast, receipt, or deployment is claimed.

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

### Independently tested locally — current repo (2026-09-03, `e9319bb`)

**Without `PRISM_POSTGRES_TEST_URL` (default, no secrets):**

```text
npm test
→ 140 passed files, 7 skipped (147 total)
→ 1355 passed tests, 40 skipped (1395 total)
```

The 40 skipped are the gated PostgreSQL/live tiers (honest NOT RUN, not failures):

| Suite (skipped) | Tests | Gate |
|---|---|---|
| `src/features/prism-identity/__tests__/postgres-ownership-proof-store.integration.test.ts` | 8 | `PRISM_POSTGRES_TEST_URL` required |
| `src/features/prism-identity/__tests__/postgres-binding-disclosure-store.integration.test.ts` | 6 | `PRISM_POSTGRES_TEST_URL` required |
| `src/features/prism-operations/__tests__/postgres-operation-store.integration.test.ts` | 10 | `PRISM_POSTGRES_TEST_URL` required |
| `src/features/prism-operations/__tests__/postgres-event-projection.integration.test.ts` | 5 | `PRISM_POSTGRES_TEST_URL` required |
| `src/features/prism-pause/__tests__/postgres-pause-store.integration.test.ts` | 8 | `PRISM_POSTGRES_TEST_URL` required |
| `src/features/prism-payments/__tests__/postgres-recovery.integration.test.ts` | 2 | `PRISM_POSTGRES_TEST_URL` required |
| `src/application/__tests__/factory-live-projection.integration.test.ts` | 1 | `PRISM_POSTGRES_TEST_URL` + `STARKNET_RPC_URL` + `STARKNET_REGISTRY_ADDRESS` + `STARKNET_REGISTRY_VERSION` + network |
| **Total** | **40** | |

Focused runtime/Pause/reconciliation sanity (no DB required):

```text
npx vitest run src/application/__tests__/runtime-profile.test.ts src/application/__tests__/factory-postgres-gating.test.ts src/features/prism-operations/__tests__/event-projection-coordinator.test.ts src/features/prism-operations/__tests__/reconciliation-worker.test.ts src/features/prism-operations/__tests__/recovery-policy.test.ts src/features/prism-pause/__tests__/m7-settlement-durability.test.ts src/features/prism-pause/__tests__/p6-transport-sdk.test.ts src/features/prism-pause/__tests__/p7-adversarial-closeout.test.ts
→ 8 passed files; 76 passed tests
```

All static validators at this HEAD:

```text
node ops/target-network/validate.mjs  → PASS (manifest ACCEPTED, mainnet RELEASE_GATED_PROPOSED)
node ops/starknet/validate.mjs        → PASS (templates secret-free)
node ops/evidence/validate.mjs --self-test → PASS
node ops/release/validate-mainnet.mjs --self-test → PASS
npm run typecheck                     → PASS
```

**With disposable local PostgreSQL (same HEAD, out-of-band URL, no prod credentials):**

A local disposable database already existed (`prism_test` on `127.0.0.1:5432`, roles `prism_test`/`prism_test_user`). The previous lane reported a local socket as `ubuntu` via libpq peer/SCRAM failing with `client password must be a string` and no ability to create a disposable DB for `ubuntu`. On this host the blocker was reproduced (TCP without password → SCRAM failure; peer auth requires OS user == DB user) and then cleared by running the suites against the existing disposable database with an explicit connection string supplied out-of-band:

```text
PRISM_POSTGRES_TEST_URL=postgresql://prism_test:***@127.0.0.1:5432/prism_test npm test
→ 146 passed files, 1 skipped (147 total)
→ 1394 passed tests, 1 skipped (1395 total)
```

Decomposed: 39 PostgreSQL integration tests moved from skipped to passed; 1 test remains skipped:

```text
6 PostgreSQL suites passed (39 tests):
  postgres-ownership-proof-store.integration  8/8
  postgres-binding-disclosure-store.integration 6/6
  postgres-operation-store.integration       10/10
  postgres-event-projection.integration      5/5
  postgres-pause-store.integration           8/8
  postgres-recovery.integration              2/2

1 suite still skipped (1 test):
  factory-live-projection.integration — requires live Starknet RPC/registry in addition to Postgres
```

This run proves on a real PostgreSQL instance (not pg-mem): idempotent migrations, CAS single-winner races across independent `Pool` connections, duplicate-key rejection, restart/reopen durability, checkpoint/event-projection ordering and `(tx_hash,event_index)` scoping, and fail-closed unreachable-endpoint behavior. The URL/value is not committed; it was injected out-of-band via `PRISM_POSTGRES_TEST_URL` and the pool password was set locally via `sudo -u postgres` for this host only. No production URL, secret, or `strk20.json` value was written.

The earlier counts in this document (`55 files / 585 passed / 37 skipped` and `5 files / 37 tests` gated) were accurate for the baseline’s smaller suite; the current totals above supersede them for `e9319bb`.

### Live / external evidence not observed

- No Starknet signing, broadcast, transaction receipt, independent RPC readback, indexer readback, or settlement execution was performed.
- No testnet/mainnet deployment or production runtime restart was performed.
- No live `STARKNET_RPC_URL` / `STARKNET_REGISTRY_ADDRESS` / `STARKNET_REGISTRY_VERSION` was configured, so `factory-live-projection.integration.test.ts` (1 test) remains gated and makes no live claim.

### Blocked (remains OPEN for live)

- **PostgreSQL production profiles:** `TESTNET` → `prism_testnet` and `MAINNET` → `prism_mainnet` require explicit `PRISM_POSTGRES_TESTNET_URL` / `PRISM_POSTGRES_MAINNET_URL` out-of-band. The local disposable run above validates the adapter/migration/CAS logic but does not provision production databases, schemas, or `PRISM_POSTGRES_MIGRATION_VERSION` assertions.
- **Live Starknet projection:** the `factory-live-projection` vertical (application factory → Starknet read/indexer → Postgres projection) requires an authorized `STARKNET_RPC_URL`, `STARKNET_REGISTRY_ADDRESS`, network, and registry version. No live RPC is configured in this lane.
- **Live identity and settlement evidence:** still requires authorized wallet/provider credentials, network configuration, broadcasts, receipts, and independent reads. The Pause settlement adapters remain fake/injected locally; P8 evidence is not claimed.

## Verification commands (exact, at `e9319bb`)

```text
# Default (honest skipped tiers — no secrets needed)
npm test
→ 140 passed files, 7 skipped; 1355 passed, 40 skipped

# Disposable local Postgres integration (no prod credentials, disposable DB only)
PRISM_POSTGRES_TEST_URL=postgresql://prism_test:***@127.0.0.1:5432/prism_test npm test
→ 146 passed files, 1 skipped; 1394 passed, 1 skipped

# Focused runtime/Pause/identity lane (no DB)
npx vitest run src/application/__tests__/runtime-profile.test.ts src/application/__tests__/factory-postgres-gating.test.ts src/features/prism-operations/__tests__/event-projection-coordinator.test.ts src/features/prism-operations/__tests__/reconciliation-worker.test.ts src/features/prism-operations/__tests__/recovery-policy.test.ts src/features/prism-pause/__tests__/m7-settlement-durability.test.ts src/features/prism-pause/__tests__/p6-transport-sdk.test.ts src/features/prism-pause/__tests__/p7-adversarial-closeout.test.ts
→ 8 passed files; 76 passed tests

# Static validators
node ops/target-network/validate.mjs
node ops/starknet/validate.mjs
node ops/evidence/validate.mjs --self-test
node ops/release/validate-mainnet.mjs --self-test
npm run typecheck
```

The maturity ceiling remains **X2 local controlled implementation** (disposable-DB run is still X2 — it is not X3 testnet/mainnet). This artifact does not claim live signing, receipts, settlement, or deployment. Live PostgreSQL production wiring and live Starknet projection remain gated as documented above.
