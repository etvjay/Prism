# STRK20 Provider Configuration Request

Prism is integrating the provider-injected WalletAccountV6 STRK20 route. Please provide the following configuration and compatibility details for each supported network.

## Networks

- Starknet Sepolia (`SN_SEPOLIA`)
- Starknet Mainnet (`SN_MAIN`)

## Required endpoints

For each network, please provide the exact HTTPS endpoint and whether it is public, authenticated, wallet-session-bound, or IP-restricted:

1. `PROVING_SERVICE_URL`
   - Proof-generation endpoint used by WalletAccountV6/STRK20.
   - Required request/response API version.
   - Authentication mechanism, if any.
   - Expected proof-generation timeout and retry semantics.
   - Supported proving block/anchor rules.

2. `INDEXER_URL`
   - Private-note and private-state discovery endpoint.
   - API version and health endpoint.
   - Freshness/watermark semantics.
   - Required account/session binding.
   - Whether note discovery includes OpenNoteDeposit results and maturity state.

## Wallet compatibility

Please confirm:

- supported Wallet API versions;
- supported STRK20 specification versions;
- exact `WalletAccountV6` method names and action schema;
- whether the wallet internally resolves `OPEN` and `${openNoteIds[N]}` placeholders;
- whether `strk20PrepareInvoke()` performs proof generation remotely or locally;
- whether `strk20InvokeTransaction()` requires the proving and indexer services to be configured separately;
- exact error codes for registration, fee lookup, prover rejection, timeout, and user rejection.

## Network contract facts

For each network, please confirm the independently verifiable public values:

- privacy pool address;
- `get_fee_amount()` entrypoint and return serialization;
- registration procedure and read method;
- STRK token address;
- supported vToken/helper route, if applicable;
- receipt/event readback requirements;
- note maturity rule and block-count semantics.

## Operational requirements

Please also provide:

- service status/health URLs;
- rate limits;
- maintenance/failure behavior;
- whether Sepolia and Mainnet data or proving services are isolated;
- whether browser clients may call the endpoints directly;
- whether a backend proxy is required;
- data-retention and privacy properties of submitted proof jobs or indexer queries.

## Evidence required for acceptance

Prism will not promote STRK20 privacy readiness from endpoint availability alone. Acceptance requires:

```text
WalletAccountV6 authorization/prover session
→ successful prepare/proof
→ one submitted transaction
→ accepted receipt
→ pool event
→ helper event
→ OpenNoteDeposit observation
→ private note/token/amount readback
→ maturity observation
→ independent RPC read
```

Please do not send private keys, viewing keys, seed phrases, wallet passwords, or credential-bearing URLs in chat. Credential-bearing endpoints should be exchanged through the approved protected channel and represented in Prism configuration as redacted references.
