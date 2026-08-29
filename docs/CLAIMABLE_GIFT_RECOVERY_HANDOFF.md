# Claimable gift recovery handoff

Status: locally implemented and tested (X2 only). No live chain, deployment, funding, signing, or broadcast evidence is claimed.

## Durable states and provenance

`created -> funded -> claimable -> claim_submitting -> claim_submitted|claim_unknown -> claimed` and `claimable -> expired -> refund_submitting -> refund_submitted|refund_unknown -> refunded`.

`claim_submitting` and `refund_submitting` are durable pre-provider-call fences. A row in either state means recovery attention is required before retrying; callers must not issue a second external submission. The persisted `claimSubmissionHash` / `refundSubmissionHash` is the only admissible submission identity. Final `succeeded` or `reverted` observations must match it exactly (case-insensitive hex equality).

Every reconciliation receipt must carry:

- `chainId` equal to Base Sepolia `84532`;
- the explicit escrow contract address;
- `operationId` equal to `claimId` and `action` equal to `claim` or `refund`;
- `providerVerification.kind = provider_verified` with provider and verification time.

Missing or contradictory provenance, including an unrelated successful transaction, is rejected with `RECEIPT_MISMATCH`. A successful receipt also requires a non-negative final block. Provider `pending`/`unknown` observations never terminalize.

Repeated identical observations are no-ops: the stored version does not increment. Different observations remain protected by the store CAS/version fence. PostgreSQL persists submission hashes and pre-submit fences and reads them back after reopening.

If claim submission returns a final-looking result but final persistence fails, the durable fence remains the recovery anchor. A best-effort hash persistence is attempted; if that also fails, `claim_submitting` plus its fence is an explicit recovery-attention state rather than an apparently successful claim.

## Public API boundary

Public projections contain lifecycle metadata and final transaction hashes only. They do not expose submission fences, raw proof, signatures, verifier output, or private recovery material. Reconciliation provenance is an internal/provider adapter contract and is not returned by public gift routes.

## Evidence provenance and gates

The focused unit and adapter tests are controlled local evidence (X2). PostgreSQL integration tests are conditional on `PRISM_POSTGRES_TEST_URL`; skipped means no PostgreSQL evidence, never pass. Testnet receipts, independent RPC readback, owner decisions, Chromium E2E, Foundry gates, and deployment remain separate gates and are not established by this document.
