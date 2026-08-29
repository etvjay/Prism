# LayerZero V2 Base Sepolia slice

This directory is intentionally separate from the existing Hyperlane contracts.

## Verified network constants

Verified against the official LayerZero deployment page on 2026-08-29:

| Item | Value |
|---|---|
| Base Sepolia chain ID | `84532` |
| Base Sepolia LayerZero EID | `40245` |
| Starknet Sepolia LayerZero EID | `40500` (remote peer; address is non-EVM `bytes32`) |
| Base Sepolia Endpoint V2 | `0x6EDCE65403992e310A62460808c4b910D972f10f` |
| Base Sepolia SendUln302 | `0xC1868e054425D378095A003EcbA3823a5D0135C9` |
| Base Sepolia ReceiveUln302 | `0x12523de19dc41c91F7d2093E0CFbB76b17012C8d` |
| Base Sepolia Executor | `0x8A3D588D9f6AC041476b094f97FF94ec30169d3D` |
| BitGo DVN | `0xdf04abb599c7b37dd5ffc0f8e94f6898120874ef` |
| Horizen DVN | `0xb1b2319767b86800c4cfe8623a72c00d9d90cfb6` |
| LayerZero Labs DVN | `0xe1a12515f9ab2764b887bf60b923ca494ebbb2d6` |
| Nethermind DVN | `0xd9222cc3ccd1df7c070d700ea377d4ada2b86eb5` |
| P2P DVN | `0x63ef73671245d1a290f2a675be9d906090f72a8d` |

Official source: <https://docs.layerzero.network/v2/deployments/chains/base-sepolia>
OApp API source: <https://docs.layerzero.network/v2/developers/evm/oapp/overview>

The Starknet OApp address and its LayerZero DVN/Executor configuration are not
invented here: they must be supplied after the Starknet side is deployed and
LayerZero confirms the supported pathway. Set the Base peer with:

```bash
cast send "$BASE_OAPP" \
  "setPeer(uint32,bytes32)" 40500 "$STARKNET_OAPP_BYTES32" \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" --private-key "$DEPLOYER_PRIVATE_KEY"
```

`STARKNET_OAPP_BYTES32` must be the exact Starknet OApp identifier encoded as
LayerZero's `bytes32` peer value; do not left/right-pad by guesswork.

## Payload and invariants

`PrismLayerZeroBase` sends a non-value application payload that is exactly 16
bytes: `abi.encodePacked(uint128(key))`, big-endian. LayerZero native value is
used only for the messaging fee. The receiver path retains official OApp
Endpoint-caller and peer checks, additionally requires source EID `40500`,
rejects malformed/zero payloads, and consumes each GUID once. Readback is
available through `receivedCount`, `lastReceivedKey`, `lastReceivedSrcEid`,
and `lastReceivedGuid`, plus the receive event.

## Deploy (dry-run by default)

No deployment or broadcast was performed. With Foundry dependencies available:

```bash
forge script script/DeployPrismLayerZeroBase.s.sol \
  --rpc-url "$BASE_SEPOLIA_RPC_URL"
```

Only add `--broadcast` after verifying constructor compatibility, funded fee
payment, and the Starknet peer/configuration. The script uses `PRIVATE_KEY`
only through Foundry's environment reader and never logs it.

## Submit a test payload

`scripts/layerzero-base-submit.sh` performs quote, then sends only when
`LZ_BROADCAST=1`; otherwise it prints the exact `cast` commands without
executing a state-changing transaction. Required variables are documented in
the script. It uses empty options by default; production/testnet delivery
should use a quoted Executor receive-gas option appropriate for the Starknet
receiver.

## Dependencies

The Solidity imports are official LayerZero V2 OApp/protocol contracts and
OpenZeppelin contracts. Install the pinned repository dependencies in `lib/`
(or initialize the git submodules if your checkout uses them) before running
Foundry. No credentials are committed.
