#!/usr/bin/env bash
set -euo pipefail

: "${BASE_SEPOLIA_RPC_URL:?set BASE_SEPOLIA_RPC_URL}"
: "${BASE_OAPP:?set BASE_OAPP to deployed PrismLayerZeroBase address}"
: "${STARKNET_OAPP_BYTES32:?set exact Starknet peer bytes32}"
: "${KEY:?set non-zero uint128 test key}"
: "${FEE_WEI:?set quote native fee in wei}"
OPTIONS="${OPTIONS:-0x}"

send_cmd=(cast send "$BASE_OAPP" 'send(uint128,bytes)' "$KEY" "$OPTIONS" --value "$FEE_WEI" --rpc-url "$BASE_SEPOLIA_RPC_URL" --private-key "${PRIVATE_KEY:?set PRIVATE_KEY only in the environment}")

if [[ "${LZ_BROADCAST:-0}" != 1 ]]; then
  printf '%q ' "${send_cmd[@]}"; printf '\n'
  printf 'dry-run only; set LZ_BROADCAST=1 to submit\n'
  exit 0
fi
"${send_cmd[@]}"
