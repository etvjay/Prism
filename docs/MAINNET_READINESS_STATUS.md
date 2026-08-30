# Prism Mainnet Readiness Status

**Status: CLOSE IN ENGINEERING, NOT YET MAINNET READY**
**As of:** 2026-08-30
**Candidate:** `701fae1`

## Summary

Prism's backend and release scaffolding are now substantially prepared for a controlled mainnet decision. Testnet remains the default operational environment, while mainnet is isolated behind an explicit fail-closed configuration and evidence gate.

The remaining blockers are live-network and release-evidence requirements, not an unbounded backend implementation gap.

## Verified engineering state

- Full application suite: **1,327 passed, 40 skipped**.
- TypeScript typecheck: **passed**.
- Next.js production build: **passed**.
- Local PostgreSQL integration: **39 passed, 1 skipped**.
- PostgreSQL testnet/mainnet profiles are isolated by explicit environment and schema.
- API, SDK, and MCP boundaries enforce versioning, pause binding fields, rate-limit responses, and secret-input rejection.
- Pause approval-scope, plan, policy-version, CAS, replay, and durability checks are implemented and tested.
- Mainnet configuration is typed, figure-driven, and fail-closed.
- `strk20.json` remains intentionally untouched and empty.

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

1. Owner-approved mainnet release decision.
2. Exact SN_MAIN and Base Mainnet Registry/helper/OApp addresses.
3. Class hashes, deployment blocks, constructor parameters, ABI/schema versions, and immutable contract set.
4. Approved signer, funding, fee-reserve, and dry-run evidence.
5. Actual mainnet deployments with accepted receipts and independent RPC readbacks.
6. Supported-wallet STRK20 pool readiness and fee observation.
7. Complete Prism-owned privacy route, including Wallet API/prover authorization, pool/helper execution, private-note readback, maturity, conservation, and independent verification.
8. Fresh Base Mainnet identity/binding proof, resolve, revoke, replay, expiry, and alteration evidence.
9. Production auth integration, route review, telemetry export, retention, alerting, and schema parity validation.
10. Three qualifying final submissions independently rechecked with `ok=true`, `pool=true`, and `mine=true` where applicable.

## Separate testnet blockers

- Privacy remains `BLOCKED_BY_EXTERNAL_PRIVACY_PROVIDER` until a real Wallet API/prover session is available.
- Identity has selected live testnet observations, but fresh repeated/adversarial signing evidence remains open.
- Live backend projection, reconciliation, restart/recovery, and settlement evidence remain open.
- LayerZero remains `LZ_BILATERAL_BLOCKED_EXACTLY`: source/DVN evidence exists for one direction, but destination execution and independent destination readback are absent; the reverse packet is not indexed by the observed Scan path.

No packets were resent or manually executed.

## Honest readiness statement

```text
Engineering preparation: substantially complete
Testnet evidence: partial
Mainnet configuration: prepared, fail-closed
Mainnet deployment: not performed
Mainnet readiness: BLOCKED pending external evidence and approval
```

This status is intended to give reviewers a precise picture of proximity without presenting local tests or scaffolding as mainnet proof.
