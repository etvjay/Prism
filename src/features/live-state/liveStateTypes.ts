/**
 * Read-only live-state types.
 *
 * Every live-dependent field carries a `status` plus blocked/fallback copy.
 * No key, note, or proof material exists in any of these shapes — the
 * secret-material guards run at every adapter boundary.
 */

export type LiveFieldStatus = "idle" | "loading" | "live" | "blocked" | "unavailable";

export interface LiveField {
  readonly label: string;
  readonly status: LiveFieldStatus;
  /** Display value when status === "live"; null otherwise. */
  readonly value: string | null;
  /** Human-readable fallback/blocked copy for every non-live status. */
  readonly fallback: string;
}

export interface LiveStateSnapshot {
  readonly prismOwner: LiveField;
  readonly baseBinding: LiveField;
  readonly strkBalance: LiveField;
  readonly baseEth: LiveField;
  /** Private balance is consent-gated: blocked until a real consent grant. */
  readonly privateBalance: LiveField;
}

export const LIVE_STATE_FALLBACK_COPY: Record<string, string> = {
  "not-connected": "Connect a demo wallet to load public chain state. Nothing is read before connect.",
  loading: "Reading public chain state (read-only)…",
  blocked: "Live read is unavailable in this preview. Showing fallback copy — no value is claimed.",
  "consent-required":
    "Private balance is consent-gated. Grant consent to reveal it; denial keeps this slot blocked. No key, note, or proof is stored.",
};

export const LIVE_STATE_IDS = {
  prism: "prism:8",
  registryV2: "0x06f77be5c7bdfef252dd322481b4430a587b781df4f79d3b344808d125ec530d",
  owner: "0x47c0f8b01b9c7c75c669dc549bc305a0f2d796808117339a1c87730162b131c",
  boundBaseEoa: "0xCf3E2aFA1E8E92Af56b02fD6799EcDd77018De23",
} as const;
