#!/usr/bin/env bash
# LayerZero-only Starknet Sepolia operator boundary. No Hyperlane actions.
set -euo pipefail

require_testnet() {
  [[ "${STARKNET_NETWORK:-SN_SEPOLIA}" == SN_SEPOLIA ]] || { echo 'BLOCKED: STARKNET_NETWORK must be SN_SEPOLIA' >&2; exit 2; }
  [[ "${LZ_BROADCAST:-0}" == 0 || "${LZ_BROADCAST:-0}" == 1 ]] || { echo 'BLOCKED: LZ_BROADCAST must be 0 or 1' >&2; exit 2; }
  [[ -n "${STARKNET_RPC_URL:-}" && "${STARKNET_RPC_URL}" == https://* ]] || { echo 'BLOCKED: STARKNET_RPC_URL must be an explicit https URL' >&2; exit 2; }
  [[ "${STARKNET_RPC_URL}" != *invalid* ]] || { echo 'BLOCKED: placeholder RPC URL rejected' >&2; exit 2; }
  [[ -n "${STARKNET_ACCOUNT_FILE:-}" && -f "${STARKNET_ACCOUNT_FILE}" ]] || { echo 'BLOCKED: STARKNET_ACCOUNT_FILE missing' >&2; exit 2; }
  [[ "$(stat -c '%a' "$STARKNET_ACCOUNT_FILE")" == 600 ]] || { echo 'BLOCKED: Starknet account file must be mode 0600' >&2; exit 2; }
  : "${STARKNET_ACCOUNT_NAME:?set STARKNET_ACCOUNT_NAME}"
}

sn() { sncast "$@" --url "$STARKNET_RPC_URL" --account "$STARKNET_ACCOUNT_NAME"; }

require_testnet
: "${STARKNET_OAPP:?set deployed Starknet OApp address}"
case "${1:-}" in
  readback)
    sn call --contract-address "$STARKNET_OAPP" --function get_endpoint
    sn call --contract-address "$STARKNET_OAPP" --function get_peer --calldata 40245
    sn call --contract-address "$STARKNET_OAPP" --function get_eid
    sn call --contract-address "$STARKNET_OAPP" --function sent_count
    sn call --contract-address "$STARKNET_OAPP" --function received_count
    ;;
  quote)
    : "${KEY:?set non-zero uint128 KEY}"
    : "${OPTIONS:?set canonical ByteArray OPTIONS}"
    sn call --contract-address "$STARKNET_OAPP" --function quote --calldata "$KEY" "$OPTIONS" 0
    ;;
  send)
    : "${KEY:?set non-zero uint128 KEY}"
    : "${OPTIONS:?set canonical ByteArray OPTIONS}"
    : "${NATIVE_FEE:?set quoted native fee}"
    : "${REFUND_ADDRESS:?set Starknet refund ContractAddress}"
    args=(invoke --contract-address "$STARKNET_OAPP" --function send --calldata "$KEY" "$OPTIONS" "$NATIVE_FEE" 0 "$REFUND_ADDRESS")
    if [[ "${LZ_BROADCAST}" != 1 ]]; then
      printf '%q ' sncast "${args[@]}" --url "$STARKNET_RPC_URL" --account "$STARKNET_ACCOUNT_NAME"; printf '\n'
      echo 'dry-run only; set LZ_BROADCAST=1 after independent quote/config readback' >&2
    else
      sn "${args[@]}"
    fi
    ;;
  *)
    echo 'usage: layerzero-starknet-ops.sh {readback|quote|send}' >&2
    exit 2
    ;;
esac
