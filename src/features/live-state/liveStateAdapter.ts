/**
 * Typed read-only adapter boundary for live chain state.
 *
 * All chain reads stop here. The real reader performs read-only RPC/API
 * reads only (no broadcast, no signing, no spending); the blocked reader
 * returns fallback copy; the mock reader returns declared fixtures for tests.
 * Secret-material guards fail closed on every input/output.
 */

import { assertNoSecretMaterial } from "../wallet/session/no-secrets";
import { LIVE_STATE_FALLBACK_COPY, LIVE_STATE_IDS, type LiveStateSnapshot } from "./liveStateTypes";
import { mockLiveStateSnapshot } from "./mockLiveState";

/** Read-only port: public chain facts only, never keys/notes/proofs. */
export interface LiveStateReader {
  readonly kind: string;
  readLiveState(input: { accountAddress: string | null; consentGranted: boolean }): Promise<LiveStateSnapshot>;
}

function blockedSnapshot(reason: string, prismLabel = "Prism ID owner (no Prism ID selected)"): LiveStateSnapshot {
  const field = (label: string) => ({ label, status: "blocked" as const, value: null, fallback: reason });
  return {
    prismOwner: field(prismLabel),
    baseBinding: field("BASE binding"),
    strkBalance: field("STRK balance (connected account)"),
    baseEth: field("Base Sepolia ETH (bound EOA)"),
    privateBalance: {
      label: "Private balance (consent-gated)",
      status: "blocked",
      value: null,
      fallback: LIVE_STATE_FALLBACK_COPY["consent-required"] ?? reason,
    },
  };
}

function idleSnapshot(): LiveStateSnapshot {
  const reason = LIVE_STATE_FALLBACK_COPY["not-connected"] ?? "Connect to load.";
  return blockedSnapshot(reason);
}

/**
 * Default reader used by the demo: performs NO network call and returns
 * blocked/fallback copy for every live-dependent state. A future
 * RPC-backed reader can implement `LiveStateReader` behind this same port
 * using read-only calls only.
 */
export function createBlockedLiveStateReader(reason?: string): LiveStateReader {
  const fallback = reason ?? (LIVE_STATE_FALLBACK_COPY.blocked ?? "Unavailable.");
  return {
    kind: "blocked",
    readLiveState: (input) => {
      assertNoSecretMaterial(input, "live_state_read");
      if (!input.accountAddress) return Promise.resolve(idleSnapshot());
      return Promise.resolve(blockedSnapshot(fallback));
    },
  };
}

/** Declared-constants reader for tests and the demo preview path. */
export function createMockLiveStateReader(): LiveStateReader {
  return {
    kind: "mock",
    readLiveState: (input) => {
      assertNoSecretMaterial(input, "live_state_read");
      if (!input.accountAddress) return Promise.resolve(idleSnapshot());
      const full = mockLiveStateSnapshot();
      if (!input.consentGranted) {
        return Promise.resolve({
          ...full,
          privateBalance: {
            label: "Private balance (consent-gated)",
            status: "blocked",
            value: null,
            fallback: LIVE_STATE_FALLBACK_COPY["consent-required"] ?? "Consent required.",
          },
        });
      }
      return Promise.resolve(full);
    },
  };
}

/** Registry/owner/binding constants surfaced for display + tests. */
export const LIVE_STATE_CONSTANTS = LIVE_STATE_IDS;
