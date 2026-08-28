# Prism v0 payment/claim persistence boundary

The request-payment and claimable-gift aggregates have their own stores because their lifecycle fields (payer approval, claim nullifier, expiry/refund and public redaction) do not map to the generic Starknet `OperationStore` schema. `OperationStore` remains the canonical owner of generic chain operations only; `operationId` is an optional linkage field and is not duplicated or used as payment/claim authority.

When `PRISM_POSTGRES_URL` (or `PRISM_POSTGRES_TEST_URL`) is configured, the HTTP runtime migrates and uses `prism_payment_requests`, `prism_claimable_gifts`, and `prism_claim_nullifiers`. Without that configuration, routes use memory adapters for local tests/development. No escrow contract, wallet, proof verifier, signing, broadcast, or live-chain adapter is created implicitly; those effects fail closed as `ERR-062`/`ERR-063`.

HTTP routes are mounted at:

- `POST /api/v1/payments/requests`
- `GET|POST /api/v1/payments/requests/:requestId` (`operation`: `view`, `approve`, `submit`)
- `POST /api/v1/gifts`
- `GET|POST /api/v1/gifts/:claimId` (`operation`: `fund`, `mark_claimable`, `claim`, `expire`, `refund`)

Responses use `{ ok, data|error, requestId }`; public projections omit memo/proof/private recipient material and serialize amounts as decimal strings.
