// Privacy guard for M4 consumer Wallet API route.
// Authority: STRK20_CONTEXT privacy truth table + STRK20_PRIVACY_PROFILE + INV-SYS-008 / INV-PRISM-011/014.
// Enforces: never request/store/log viewing keys; honest privacy copy; no SDK in consumer path.

import { Strk20Error, STRK20_ERROR_CODE } from "./errors";

const FORBIDDEN_KEY_PATTERNS = [/viewing.?key/i, /private.?key/i, /seed.?phrase/i, /mnemonic/i];
const FORBIDDEN_FIELDS = new Set(["viewingKey", "viewing_key", "privateKey", "private_key", "seedPhrase", "mnemonic"]);

/**
 * Guard: assert that no payload contains viewing/private key material.
 * Throws VIEWING_KEY_FORBIDDEN if violated. Never logs the value.
 */
function assertNoViewingKeyInternal(payload: unknown, context: string, seen: WeakSet<object>): void {
  if (payload === null || payload === undefined) return;
  if (typeof payload === "string") {
    for (const pat of FORBIDDEN_KEY_PATTERNS) {
      if (pat.test(payload)) {
        throw new Strk20Error(STRK20_ERROR_CODE.VIEWING_KEY_FORBIDDEN, `forbidden_pattern_in_${context}`);
      }
    }
    return;
  }
  if (typeof payload === "object") {
    if (seen.has(payload)) return;
    seen.add(payload);
    const obj = payload as Record<string, unknown>;
    for (const k of Object.keys(obj)) {
      if (FORBIDDEN_FIELDS.has(k)) {
        throw new Strk20Error(STRK20_ERROR_CODE.VIEWING_KEY_FORBIDDEN, `forbidden_field_${k}_in_${context}`);
      }
      // Recurse shallowly but do not log values
      const v = obj[k];
      if (typeof v === "string") {
        for (const pat of FORBIDDEN_KEY_PATTERNS) {
          if (pat.test(k) || pat.test(v)) {
            // Only expose field name, never value
            throw new Strk20Error(STRK20_ERROR_CODE.VIEWING_KEY_FORBIDDEN, `forbidden_key_material_in_${context}.${k}`);
          }
        }
      }
      if (typeof v === "object" && v !== null) {
        assertNoViewingKeyInternal(v, `${context}.${k}`, seen);
      }
    }
  }
}

export function assertNoViewingKey(payload: unknown, context = "unknown"): void {
  assertNoViewingKeyInternal(payload, context, new WeakSet<object>());
}

/**
 * Privacy copy guard: rejects overclaim wording.
 * Authority: STRK20_PRIVACY_PROFILE experience language + AUDIT FT-007.
 */
const OVERCLAIM_PATTERNS: RegExp[] = [
  /completely invisible/i,
  /private everywhere/i,
  /untraceable/i,
  /all amounts hidden/i,
  /zero metadata/i,
  /anonymous amount/i,
  /fully private.*swap/i,
  /invisible.*deposit/i,
  /private.*shield.*hides.*amount/i,
];

const ALLOWED_PHRASES = [
  "Private balance",
  "Send privately",
  "Private transfer",
  "Private on Starknet with STRK20",
  "Identity-private DeFi execution",
];

export function assertPrivacyCopy(copy: string): void {
  for (const pat of OVERCLAIM_PATTERNS) {
    if (pat.test(copy)) {
      throw new Strk20Error(STRK20_ERROR_CODE.PRIVACY_OVERCLAIM, `overclaim_pattern_${pat.source}`);
    }
  }
}

/**
 * Honest privacy truth per route (used for receipt/label generation).
 */
export const SHIELD_TRUTH = {
  publicFields: ["depositor_address", "token", "amount", "timing"],
  hiddenFields: [] as string[],
  note: "Shield deposit is not private; what happens after shielding can be private.",
} as const;

export const PRIVATE_TRANSFER_TRUTH = {
  publicFields: ["proof_artifacts", "nullifier", "encrypted_note_artifacts"] as string[],
  hiddenFields: ["sender", "recipient", "amount", "token_type", "spent_note_relation"] as string[],
  note: "Sender/recipient/amount/token hidden inside private note flow; proof artifacts remain public.",
} as const;

export const RECEIPT_TRUTH = {
  // Relayer sender is not attribution
  attributionField: "pool_event_first_key_topic1_depositor",
  forbiddenAttribution: "transaction_sender",
} as const;

export function getAllowedPhrases(): readonly string[] {
  return ALLOWED_PHRASES;
}
