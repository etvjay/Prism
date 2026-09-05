/**
 * Declared mock fixtures for the read-only live-state surface.
 *
 * All values are constants matching the X3 live facts (EVD-PRISM-005/006):
 * prism:8 on SN_SEPOLIA registry V2, deployer owner, bound Base Sepolia EOA.
 * No RPC call, no signing, no broadcast happens here — the mock implements
 * the `LiveStateReader` port so tests run the real read path deterministically.
 */

import { LIVE_STATE_IDS, type LiveStateSnapshot } from "./liveStateTypes";

export const MOCK_LIVE_STRK_BALANCE = "1,250.00 STRK";
export const MOCK_LIVE_BASE_ETH_BALANCE = "0.042 Base Sepolia ETH";
export const MOCK_LIVE_PRIVATE_BALANCE = "420.00 STRK (shielded preview)";

export function mockLiveStateSnapshot(): LiveStateSnapshot {
  return {
    prismOwner: {
      label: "Prism ID owner (prism:8)",
      status: "live",
      value: `${LIVE_STATE_IDS.owner} · registry ${shorten(LIVE_STATE_IDS.registryV2)}`,
      fallback: "",
    },
    baseBinding: {
      label: "BASE binding",
      status: "live",
      value: `Bound · ${LIVE_STATE_IDS.boundBaseEoa} (Base Sepolia)`,
      fallback: "",
    },
    strkBalance: {
      label: "STRK balance (connected account)",
      status: "live",
      value: MOCK_LIVE_STRK_BALANCE,
      fallback: "",
    },
    baseEth: {
      label: "Base Sepolia ETH (bound EOA)",
      status: "live",
      value: MOCK_LIVE_BASE_ETH_BALANCE,
      fallback: "",
    },
    privateBalance: {
      label: "Private balance (consent-gated)",
      status: "live",
      value: MOCK_LIVE_PRIVATE_BALANCE,
      fallback: "",
    },
  };
}

function shorten(hex: string): string {
  if (hex.length <= 12) return hex;
  return `${hex.slice(0, 6)}…${hex.slice(-4)}`;
}
