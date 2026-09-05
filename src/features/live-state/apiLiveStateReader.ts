/**
 * API-backed `LiveStateReader`: fetches read-only chain facts from the
 * server-side `GET /api/v1/livestate` route and maps them onto the
 * `LiveStateSnapshot` port.
 *
 * The client never sees RPC URLs — only the same-origin route. Any fetch,
 * HTTP, or shape failure falls back to the blocked reader (fail-closed
 * fallback copy, claiming no value). The private-balance slot stays
 * consent-gated: blocked until a real consent grant, and even then blocked
 * with honest copy because this route serves public state only.
 */

import { assertNoSecretMaterial } from "../wallet/session/no-secrets";
import { createBlockedLiveStateReader, type LiveStateReader } from "./liveStateAdapter";
import { LIVE_STATE_FALLBACK_COPY, type LiveStateSnapshot } from "./liveStateTypes";

export interface ApiLiveStateReaderOptions {
  /** Same-origin endpoint. Defaults to `/api/v1/livestate`. */
  endpoint?: string;
  /** Canonical prism id suffix. Defaults to `"8"`. */
  prismId?: string;
  /** Injectable fetch for tests. Defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
}

interface ApiLiveStateData {
  prismId?: unknown;
  registry?: unknown;
  owner?: unknown;
  baseBinding?: unknown;
  strkBalance?: { status?: unknown; display?: unknown } | null;
  baseEth?: { status?: unknown; display?: unknown } | null;
}

function asDisplay(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function shorten(hex: string): string {
  if (hex.length <= 12) return hex;
  return `${hex.slice(0, 6)}…${hex.slice(-4)}`;
}

export function createApiLiveStateReader(options?: ApiLiveStateReaderOptions): LiveStateReader {
  const endpoint = options?.endpoint ?? "/api/v1/livestate";
  const prismId = options?.prismId ?? "8";
  const fetchImpl = options?.fetchImpl ?? fetch;
  const blocked = createBlockedLiveStateReader();

  return {
    kind: "api",
    readLiveState: async (input) => {
      assertNoSecretMaterial(input, "live_state_read");
      if (!input.accountAddress) return blocked.readLiveState(input);

      let data: ApiLiveStateData | null = null;
      try {
        const res = await fetchImpl(`${endpoint}?prismId=${encodeURIComponent(prismId)}&accountAddress=${encodeURIComponent(input.accountAddress)}`, {
          cache: "no-store",
        });
        if (!res.ok) return blocked.readLiveState(input);
        const json = (await res.json()) as { ok?: unknown; data?: ApiLiveStateData };
        if (json.ok !== true || typeof json.data !== "object" || json.data === null) {
          return blocked.readLiveState(input);
        }
        data = json.data;
      } catch {
        return blocked.readLiveState(input);
      }
      assertNoSecretMaterial(data, "live_state_api_response");

      const owner = typeof data.owner === "string" ? data.owner : null;
      const registry = typeof data.registry === "string" ? data.registry : null;
      const binding = typeof data.baseBinding === "string" ? data.baseBinding : null;
      if (!owner) return blocked.readLiveState(input);

      const unavailable = LIVE_STATE_FALLBACK_COPY.blocked ?? "Unavailable.";
      const strkDisplay = data.strkBalance ? asDisplay(data.strkBalance.display) : null;
      const ethDisplay = data.baseEth ? asDisplay(data.baseEth.display) : null;

      const snapshot: LiveStateSnapshot = {
        prismOwner: {
          label: "Prism ID owner (prism:8)",
          status: "live",
          value: registry ? `${owner} · registry ${shorten(registry)}` : owner,
          fallback: "",
        },
        baseBinding:
          binding !== null
            ? { label: "BASE binding", status: "live", value: `Bound · ${binding} (Base Sepolia)`, fallback: "" }
            : { label: "BASE binding", status: "blocked", value: null, fallback: unavailable },
        strkBalance:
          strkDisplay !== null
            ? { label: "STRK balance (connected account)", status: "live", value: strkDisplay, fallback: "" }
            : { label: "STRK balance (connected account)", status: "unavailable", value: null, fallback: unavailable },
        baseEth:
          ethDisplay !== null
            ? { label: "Base Sepolia ETH (bound EOA)", status: "live", value: ethDisplay, fallback: "" }
            : { label: "Base Sepolia ETH (bound EOA)", status: "unavailable", value: null, fallback: unavailable },
        privateBalance: {
          label: "Private balance (consent-gated)",
          status: "blocked",
          value: null,
          fallback:
            (!input.consentGranted
              ? LIVE_STATE_FALLBACK_COPY["consent-required"]
              : LIVE_STATE_FALLBACK_COPY.blocked) ?? unavailable,
        },
      };
      return snapshot;
    },
  };
}
