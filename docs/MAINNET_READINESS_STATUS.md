# Prism Mainnet Readiness Status

**Status: CORE V1 PREPARED, NOT YET MAINNET READY**
**As of:** 2026-09-03
**Candidate:** `core-v1-closeout` @ `60460be3388c388472b83d7753d0c9d3d52970a3` (verified locally; freeze a clean exact HEAD with `git rev-parse HEAD` before any live action)

## Summary

Prism Core v1 is locally closed as a bounded engineering candidate. The larger Prism direction remains in this repository, with STRK20 as the next first-class privacy expansion and Vesu, LayerZero, and Channel as later tracks. Testnet remains the default operational environment, while mainnet is isolated behind an explicit fail-closed configuration and evidence gate.

The remaining blockers are owner approval, protected credentials, live-network execution, and independent release evidence. They are not an authorization to broadcast.

## Verified engineering state

- Core v1 application suite: **1,394 passed, 1 skipped**.
- TypeScript typecheck: **passed**.
- Next.js production build: **passed**.
- PostgreSQL integration: **NOT RUN — 40 gated tests skipped** because `PRISM_POSTGRES_TEST_URL` is unset. A local `pg_isready` response is not PostgreSQL test evidence.
- PostgreSQL testnet/mainnet profiles are isolated by explicit environment and schema.
- API, SDK, and MCP boundaries enforce versioning, pause binding fields, redacted error/secret-input handling, and fail-closed guards; production HTTP rate limiting is not implemented or verified here.
- Pause approval-scope, plan, policy-version, CAS, replay, and durability checks are implemented and tested locally at X2.
- Mainnet release packet validation is typed, figure-driven, and fail-closed; mainnet runtime figures remain unobserved and unconfigured.
- `strk20.json` remains intentionally untouched and empty.
- The proposed Core v1 mainnet contract set is explicit: `PrismIdentityRegistry` only. Deferred tracks must not be silently included.

## Local closeout map

The current evidence is split by claim. These records are local or separately scoped
testnet evidence; none promotes the mainnet release:

| Surface | Local record | Honest ceiling/status |
|---|---|---|
| Core v1 implementation and release preparation | `projects/prism/CORE_V1_CLOSEOUT_EVIDENCE.md` | X2 overall; no mainnet readiness |
| Observed identity/testnet facets | `projects/prism/M1_LIVE_IDENTITY_EVIDENCE.md`, `projects/prism/EVIDENCE_LEDGER.md` | X3 only for named SN_SEPOLIA facets (`EVD-PRISM-004`, `EVD-PRISM-014`) |
| Wallet/proof boundary | `BACKEND_PHASE_M4_WALLET_PROOF_CLOSEOUT.md` | X2; `BLOCKED_BY_EXTERNAL_WALLET` |
| STRK20/M5 privacy boundary | `PRIVACY_INVOKE_UI_BLOCKER.md`, `projects/prism/M5_LOCAL_BOUNDARY_CLOSEOUT.md`, `projects/prism/M5_E2E_RUNNER_EVIDENCE.md` | X2 plus a narrow helper→Vesu X3 leg; full route blocked |
| Runtime/Pause/PostgreSQL/reconciliation | `docs/BACKEND_RUNTIME_PAUSE_IDENTITY_LANE_RESTART.md` | X2; gated PostgreSQL/repeated runtime evidence remains open |
| Mainnet release gate | `ops/release/mainnet-release-packet.template.json`, `ops/release/READINESS_CHECKLIST.md` | `NOT_MAINNET_READY`; null/empty fields are intentional |

## Mainnet preparation model

```text
TESTNET
  SN_SEPOLIA + BASE_SEPOLIA
  default operational profile
  isolated testnet PostgreSQL profile/schema

MAINNET
  SN_MAIN + BASE_MAINNET
  explicit release-gated profile
  isolated mainnet PostgreSQL profile/schema
  requires exact figures and independent validation
```

Mainnet cannot become runnable through missing values, placeholders, cross-network values, or an unaccepted release packet.

## Remaining release gates

1. Owner-approved mainnet release decision naming the exact Core v1 scope and explicit required contract identities.
2. Exact SN_MAIN and Base Mainnet Registry figures for the selected scope. Deferred helper/OApp addresses remain out of the Core v1 set.
3. Class hash, deployment block, constructor parameters, ABI/schema versions, and immutable contract set for every required Core v1 contract.
4. Approved signer, funding, fee-reserve, and dry-run evidence.
5. Actual mainnet deployments with accepted receipts and independent RPC readbacks.
6. Fresh Base Mainnet identity/binding proof, resolve, revoke, replay, expiry, and alteration evidence.
7. Production auth integration, route review, telemetry export, retention, alerting, and schema parity validation.
8. Separately, if submitting to the STRK20 sprint, a supported-wallet/prover privacy route, pool execution, private-state readback, conservation, and independent verification.
9. Three qualifying final STRK20 submissions independently rechecked with `ok=true`, `pool=true`, and `mine=true` where applicable.

## Separate testnet blockers

- Privacy remains `BLOCKED_BY_EXTERNAL_PRIVACY_PROVIDER` until a real Wallet API/prover session is available. This is a visible in-repository STRK20 gate, not a deleted product surface.
- Core v1 overall preparation remains X2; separately recorded testnet identity/projection facets reach X3, while repeated/restart/reconciliation and mainnet signing evidence remain open.
- One testnet factory→PostgreSQL projection observation exists in the ledger; repeated backend projection, reconciliation, restart/recovery, and settlement evidence remain open.
- LayerZero remains `LZ_BILATERAL_BLOCKED_EXACTLY`: source/DVN evidence exists for one direction, but destination execution and independent destination readback are absent; the reverse packet is not indexed by the observed Scan path.

No packets were resent or manually executed.

## Honest readiness statement

```text
Core v1 engineering preparation: locally complete
Testnet evidence: selected identity/projection facets X3; overall release preparation ceiling X2
Mainnet configuration: prepared, fail-closed
Mainnet deployment: not performed
Mainnet readiness: BLOCKED pending external evidence and approval
```

This status is intended to give reviewers a precise picture of proximity without presenting local tests or scaffolding as mainnet proof.
