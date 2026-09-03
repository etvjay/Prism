# Mainnet signer/funding preflight (operator template)

This is a **recording template**, not a credential store. Do not commit private keys,
keystore contents, RPC URLs containing credentials, seed phrases, or wallet export data.
A blank or placeholder field is an open gate; never infer a funded or authorized state.

## Environment contract

```yaml
release_track: core_v1
environment: SN_MAIN
base_network: Base Mainnet
base_chain_id: 8453
starknet_rpc_env: STARKNET_RPC_URL
base_rpc_env: BASE_RPC_URL
signer_ref: null                 # protected path or secret-manager reference only
wallet_provider: null
prover_provider: null
```

For the current Core v1 proposal, the required contract identity is
`PrismIdentityRegistry`. STRK20 wallet/prover evidence belongs to the separate
`strk20_submission` track in the same Prism repository and must not be silently
substituted into or omitted from that track.

## Authorization and ownership

```yaml
owner_decision_id: null
owner_decision_status: PROPOSED   # must be ACCEPTED for a live broadcast
selected_environment: null       # exact literal: SN_MAIN+Base Mainnet
approved_scope: null              # exact networks, contracts, actions, and time window
approved_by: null
approved_at: null
```

## Public preflight evidence (no secrets)

Record public identifiers only. `submitted` is not `accepted`, and a provider's success
label is not an independent read.

```yaml
starknet:
  deployer_address: null
  account_contract_status: null
  funding_asset: STRK
  funding_amount: null
  funding_provider: null
  funding_tx_hash: null
  funding_receipt_status: null
  funding_block: null
  funding_independent_read:
    provider: null
    address_match: false
    amount_match: false
    verified_at: null
base:
  submitter_address: null
  funding_asset: ETH
  funding_amount: null
  funding_provider: null
  funding_tx_hash: null
  funding_receipt_status: null
  funding_block: null
  funding_independent_read:
    provider: null
    address_match: false
    amount_match: false
    verified_at: null
wallet_prover:
  wallet_address: null
  wallet_provider: null
  prover_provider: null
  proof_id: null
  receipt_tx_hash: null
  receipt_status: null
  receipt_block: null
  independent_read:
    provider: null
    address_match: false
    verified_at: null
```

## Required operator checks

- [ ] Exact SN_MAIN/Base Mainnet identity and chain ID checked from the selected profile.
- [ ] Protected signer references resolve without printing or reading secret material into the repo.
- [ ] Account/wallet addresses were independently read from the intended providers.
- [ ] Funding receipt status, block, recipient, and amount were independently read back.
- [ ] A dry-run was captured before any live action; no live broadcast is authorized by this template.
- [ ] Wallet and prover evidence includes an accepted receipt and a different-provider readback.
- [ ] The final release packet passes `node ops/release/validate-mainnet.mjs <packet.json>`.

Until every item is checked and the owner decision is `ACCEPTED`, the release status is
`NOT_MAINNET_READY`. This template does not authorize deployment or mutate `strk20.json`.
