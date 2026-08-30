# LayerZero V2 bilateral operations (testnet only)

This is the LayerZero-only operational boundary for the two non-value Prism
OApps. It never invokes the Hyperlane deployment or relay scripts. All
broadcasts are intentionally fail-closed until the exact network and signer
inputs have passed the read-only gate.

## Protected-input gate

Run from this worktree:

```bash
python3 scripts/layerzero-preflight.py
```

The gate reads the `sn_testnet` entry from the protected Starknet RPC document,
probes `starknet_chainId`, and checks the exact protected account/signer paths
and `0600` modes. It does not print RPC URLs or private material. It also
requires an explicit `BASE_SEPOLIA_RPC_URL` in the process environment; public,
guessed, `rpc.invalid`, or placeholder endpoints are rejected.

## Starknet path

After a successful gate and a separately verified declaration/deployment, set
`STARKNET_RPC_URL` to the same protected value, `STARKNET_ACCOUNT_FILE` to the
protected account JSON, and `STARKNET_ACCOUNT_NAME=prism_sepolia_deployer`.
The LayerZero-only wrapper provides:

```bash
scripts/layerzero-starknet-ops.sh readback
scripts/layerzero-starknet-ops.sh quote  # KEY and canonical OPTIONS required
scripts/layerzero-starknet-ops.sh send   # quoted NATIVE_FEE and REFUND_ADDRESS required
```

`send` is dry-run unless `LZ_BROADCAST=1`. The contract's official Starknet
`MessagingFee` flow is preserved: native fee and LZ-token fee are passed as
separate values, and the package's OApp implementation remains responsible
for its fee-token approval flow. No local mock endpoint or synthetic fee is
used.

## Required safe configuration order

For each OApp, execute and read back each successful transaction before the
next step: delegate; send and receive ULN302 libraries; required LayerZero
Labs DVN and Executor ULN configuration; explicit enforced receive options;
then bilateral peers last. The Base side uses the official `setPeer`, library,
`setConfig`, `quote`, and `send` interfaces. The Starknet side uses the
vendored official Endpoint/OApp interfaces and SDK ABI. Never commit deployed
addresses, RPC URLs, fees, GUIDs, or transaction hashes to source.

## Blocking status at this checkout

No broadcast is claimed from this worktree. The read-only gate currently stops
because the protected Starknet RPC document is mode `0664` rather than `0600`,
and no explicit protected `BASE_SEPOLIA_RPC_URL` is present in the process.
The Base RPC is required before Base deployment/configuration or any message
send can be safely attempted. Consequently there is no honest source receipt,
GUID, DVN verification, Executor delivery, destination receipt, event,
second-provider agreement, or replay evidence yet.
