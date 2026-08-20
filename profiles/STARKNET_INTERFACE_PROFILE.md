# Starknet Interface Profile

**Profile type:** Interface & Ecosystem Foundry specialization  
**Project:** Prism

## Goal

Expose Prism capabilities in Prism vocabulary while keeping Starknet mechanics behind explicit adapters unless a low-level developer surface deliberately requires them.

## Canonical translation boundary

External Prism consumers should prefer:

```text
PrismID
Binding
Resolution
PrivateBalance
Operation
Receipt
```

over raw chain mechanics such as:

```text
felt252
calldata arrays
class hashes
raw RPC payloads
wallet-standard internals
note discovery implementation
```

## Capability examples

```text
prism.identity.create
prism.identity.read
prism.binding.create
prism.binding.revoke
prism.identity.resolve
prism.portfolio.read
prism.private.balance.read
prism.private.transfer.prepare
prism.private.invoke.prepare
```

These are canonical capabilities first; HTTP, SDK, MCP, and frontend clients are projections.

## Operation semantics

Any chain-changing command that is asynchronous should return or create an explicit operation lifecycle rather than treating submission as completion.

Example:

```text
awaiting_authorization
→ submitted
→ confirming
→ confirmed
→ reconciled/completed
```

## Error translation

Do not expose raw Starknet/RPC exceptions directly.

Map them into stable domain errors while preserving a safe technical cause/reference for debugging.

Examples:

```text
wallet_capability_unavailable
transaction_reverted
stale_binding
binding_revoked
rpc_unavailable
privacy_wallet_required
```

## Privacy boundary

Public APIs must never return viewing keys, private signing material, seed phrases, or hidden note material beyond what the canonical privacy integration explicitly permits.

Authentication, Prism authorization, privacy visibility, and commercial/payment entitlement are separate concerns.

## Network configuration

Network should be explicit in developer environments and receipts.

```text
mainnet = SN_MAIN
```

Do not infer mainnet/testnet from a contract address alone when an explicit environment can be carried.

## Low-level escape hatch

A future advanced SDK may expose Starknet transaction details for expert consumers, but it must be clearly separated from the default Prism domain SDK and must not redefine public domain vocabulary.
