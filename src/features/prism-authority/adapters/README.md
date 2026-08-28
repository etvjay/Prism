# Base Sepolia SessionGrant adapter

`SessionGrant` is the provider-neutral Prism authority object. The ERC-7715 and ERC-7710 shapes are an adapter boundary, not the security model.

## Security boundary

A grant accepted by `BaseSepoliaErc7715Adapter` must bind all of these facts:

- Base Sepolia chain ID (`84532`);
- delegator account (`from`) and delegate smart-account (`to`);
- target contract and function-selector allowlists;
- per-asset per-call and aggregate spend limits;
- maximum call count and validity window;
- unique replay keys and terminal revocation/exhaustion state.

The domain guard applies these constraints before an ERC-4337 submission. A
`BaseSepoliaPermissionModule` is still required to map the target, selector,
asset, spend, expiry, call-count, replay, and revocation constraints into the
wallet's concrete permission/rule and ERC-7710 caveat encoding. The adapter
never invents a module address or rule type, and it never treats a local policy
pass as proof of onchain enforcement.

## Provider and account detection

The wallet boundary calls `wallet_getSupportedExecutionPermissions` before
request, list, or revoke. A missing method is `unsupported`; a missing request
interface, transport error, or malformed capability response is
`provider_unavailable`. No request is inferred from a successful ordinary
EIP-1193 connection.

The account and bundler boundaries are injected and typed. Redemption requires
both, encodes the ERC-7710 `redeemDelegations` call through the injected module,
wraps it in the injected smart-account call encoder, and submits it through the
injected ERC-4337 bundler. The result is a user-operation hash only. Receipt,
execution, finality, deployment, and revocation readback remain separate
observations.

## Current evidence ceiling

This implementation and its deterministic Vitest fixtures are **X2 local
readiness**. No MetaMask Smart Accounts Kit session, Base Sepolia deployment,
wallet approval, bundler submission, receipt, or independent onchain readback
is claimed. A separately authorized Base Sepolia session and independent
readback are required before promoting live enforcement evidence.

Starknet is not implicitly supported by this adapter. A venue-native Starknet
adapter remains a separate integration decision.
