# Prism Core v1 Local Closeout Evidence

**Candidate:** `60460be3388c388472b83d7753d0c9d3d52970a3`
**Branch:** `core-v1-closeout`
**Verified at:** 2026-09-03
**Scope decision:** `DEC-PRISM-M0-002`
**Evidence ceiling:** X2 local implementation

## Scope

Core v1 covers Registry V2, Prism identity create/read, Base ownership proof and binding, resolve/revoke, pause/governance control, durable backend operations/reconciliation, and truthful Home/operation surfaces.

STRK20 remains an in-repository, first-class, hard-gated Prism product track. It is the next major product expansion represented in this repository, and it is not declared complete or mainnet-ready by Core v1. Vesu lending, LayerZero delivery, PrismChannel beyond the minimal relationship slice, shadow accounts, and broader private financial capabilities remain deferred. No deferred track is represented as complete here.

## Exact local gates

| Gate | Command/result |
|---|---|
| Focused production-factory hardening | `npm test -- src/application/__tests__/production-factory-hardening.test.ts` → `17 passed` |
| Full application suite | `npm test` → `146 test files passed`, `1 skipped`; `1394 tests passed`, `1 skipped` |
| TypeScript | `npm run typecheck` → pass |
| Production build | `npm run build` → Next.js 16.3.1, TypeScript pass, `11/11` static pages generated |
| PostgreSQL integration | **NOT RUN** → `40` gated integration tests skipped because `PRISM_POSTGRES_TEST_URL` is unset; `pg_isready` accepting is not test evidence |
| Target network | `node ops/target-network/validate.mjs` → pass; testnet accepted, mainnet release-gated |
| Starknet config/secrets | `node ops/starknet/validate.mjs` → pass; templates secret-free |
| Evidence validator | `node ops/evidence/validate.mjs --self-test` → pass; X2 fixture promotion and `strk20.json` guard verified |
| Mainnet validator | `node ops/release/validate-mainnet.mjs --self-test` → pass; missing figures and owner decision fail closed |
| Diff hygiene | `git diff --check` → pass |

## Contract gates on this scope

The Cairo contract counts below are carried-forward local fixture results from their
scoped lane records; this reconciliation reran the repository root `cairo/`
`scarb build` and `snforge test` (1 root workspace test passed), not each separate
contract-directory suite. They remain X2 local records and are not live evidence.

| Contract surface | Result |
|---|---:|
| `prism_identity_registry` | `38 passed, 0 failed` |
| `prism_identity_registry_v2` | `40 passed, 0 failed` |
| `prism_allocation_helper` | `11 passed, 0 failed` |
| `prism_vesu_lending_helper` | `16 passed, 0 failed` |
| Foundry escrow | `10 passed, 0 failed, 0 skipped` |

## Explicitly not proven

This local closeout does not establish:

- live Core v1 deployment;
- accepted deployment receipts or independent RPC readbacks;
- live Base proof/bind/resolve/revoke sequence;
- production authentication provider or managed PostgreSQL;
- production signer custody, funding, rollback, or independent security approval;
- live STRK20 wallet/prover access, pool action, privacy-state readback, or three qualifying mainnet transactions;
- mainnet readiness for Core v1 or any deferred feature.

`strk20.json` remains intentionally empty. No deployment, broadcast, push, credential access, or external mutation was performed by this closeout.
