# Starknet Sepolia LayerZero V2 OApp

This package is pinned to the published `@layerzerolabs/protocol-starknet-v2@1.2.33` Cairo sources. The vendored `cairo/vendor/layerzero` and `cairo/vendor/libs/*` directories are byte-for-byte extracted from the npm tarball (integrity: `sha512-j+7VWD+0+lYGEbRLH+ilpIvqLgBo7mi3uMDrT8rWRvAH4oQshdGH9QuUZjYb+YSADYsquU0VdK9g7xTgG8BuIg==`).

## Contract

`PrismLayerZeroStarknet` uses the official `OAppCoreComponent`, `ILayerZeroReceiver`, `IEndpointV2`, `MessagingParams`, `MessageReceipt`, and `Origin` types. Constructor arguments are `(endpoint, owner, native_token)` as required by the published OApp core initializer. It sends to Base Sepolia EID `40245` and accepts only source EID `40245`.

The application payload is exactly 16 bytes: `uint128` encoded big-endian using the official `ByteArrayTraitExt::append_u128`. Receive decoding uses the same package's `read_u128(0)` helper after exact length validation. The official receiver hook already enforces endpoint caller and configured peer; application state additionally records GUID consumption, key, source EID, counts, and events.

## Build gate

```sh
cd cairo
scarb build
```

The gate must be green before deployment. In this environment the official package currently cannot resolve its published OpenZeppelin dependency set: package `openzeppelin 2.0.0` requires `openzeppelin_utils >=2.0.0,<2.0.1`, but the configured Scarbs registry exposes no `openzeppelin_utils 2.0.0` (only 2.2.0). Attempting the build therefore fails in the official dependency (`INonces`, `ISNIP12Metadata`, and `UniversalDeployerABI` missing), before deployment code is compiled. Do not replace these interfaces or fake Endpoint behavior.

## Configuration order (after a green build)

1. Declare/deploy with the official Starknet Sepolia Endpoint V2 `0x0316d70a6e0445a58c486215fac8ead48d3db985acde27efca9130da4c675878`.
2. Read back `get_endpoint()` and `get_eid()`; require EID `40500`.
3. Set delegate and send/receive library plus ULN302/Executor configuration using official SDK/Endpoint APIs.
4. Set the Base Sepolia peer at EID `40245` as a left-padded `Bytes32` EVM address.
5. On Base, set the Starknet OApp peer at EID `40500` using the agreed Starknet `Bytes32` address.
6. Quote, send with explicit options, and independently read source receipt, destination event, `received(guid)`, `last_received_key`, and `last_received_src_eid`.

No signer, RPC secret, deployment, configuration transaction, or message broadcast is included or performed in this change.
