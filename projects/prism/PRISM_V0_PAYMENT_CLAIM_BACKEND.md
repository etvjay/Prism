# Prism v0 payment/claim persistence boundary

The request-payment and claimable-gift aggregates have their own stores because their lifecycle fields (payer approval, claim nullifier, expiry/refund and public redaction) do not map to the generic Starknet `OperationStore` schema. `OperationStore` remains the canonical owner of generic chain operations only; `operationId` is an optional linkage field and is not duplicated or used as payment/claim authority.

When `PRISM_POSTGRES_URL` (or `PRISM_POSTGRES_TEST_URL`) is configured, the HTTP runtime migrates and uses `prism_payment_requests`, `prism_claimable_gifts`, and `prism_claim_nullifiers`. Without that configuration, routes use memory adapters for local tests/development. No escrow contract, wallet, proof verifier, signing, broadcast, or live-chain adapter is created implicitly; those effects fail closed as `ERR-062`/`ERR-063`.

HTTP routes are mounted at:

- `POST /api/v1/payments/requests`
- `GET|POST /api/v1/payments/requests/:requestId` (`operation`: `view`, `approve`, `submit`)
- `POST /api/v1/gifts`
- `GET|POST /api/v1/gifts/:claimId` (`operation`: `fund`, `mark_claimable`, `claim`, `expire`, `refund`)

Responses use `{ ok, data|error, requestId }`; public projections omit memo/proof/private recipient material and serialize amounts as decimal strings.

## HTTP handoff contract

The mounted routes are intended for authenticated workflow callers for writes
and public-safe projection readers for reads. They expose lifecycle state only;
an app session, request claim, actor/address field, or HTTP success does not
become wallet, controller, payer, recipient, signing, funding, escrow, or
settlement authority. Payment transitions are explicit (`approve`, `submit`)
and gift transitions are explicit (`fund`, `mark_claimable`, `claim`, `expire`,
`refund`). `submitted`, `unknown`, and `unavailable` remain distinct from
terminal success and must not be collapsed in frontend state.

Only the allow-listed public projection crosses HTTP: identifiers, lifecycle
state, decimal-string amounts, asset/chain metadata, expiry, and correlation
metadata where applicable. Memo plaintext, proofs, calldata, nullifiers,
private recipient material, credentials, provider URLs or raw output, raw
exception text, viewing/private keys, connection strings, and internal store
diagnostics are forbidden fields. Local memory adapters are test/development
only; configured Postgres is required for the durable runtime.

Base escrow is not implemented in this slice and remains blocked by the absent
EVM toolchain. No escrow contract, signing adapter, funding flow, broadcast, or
live receipt is implied. These mounted routes are X2 local implementation and
integration evidence only; unavailable dependencies fail closed with typed
`ERR-062`/`ERR-063` responses.
