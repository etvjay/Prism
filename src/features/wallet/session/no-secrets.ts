import { WALLET_SESSION_ERROR_CODE, WalletSessionError } from "./errors";

// Keys and values that must never cross the session boundary. This guard is
// intentionally stricter than the STRK20 viewing-key guard because a session
// snapshot must not retain RPC credentials either.
const SECRET_FIELD_PATTERN = /(?:private|viewing)[_-]?key|seed[_-]?phrase|mnemonic|rpc[_-]?url|password|credential|secret/i;
const SECRET_VALUE_PATTERN = /(?:private|viewing)[\s_-]?key|seed[\s_-]?phrase|mnemonic/i;

function assertNoSecretMaterialInternal(value: unknown, context: string, seen: WeakSet<object>): void {
  if (value === null || value === undefined) return;
  if (typeof value === "string") {
    if (SECRET_VALUE_PATTERN.test(value)) {
      throw new WalletSessionError(
        WALLET_SESSION_ERROR_CODE.SECRET_FORBIDDEN,
        `secret_material_in_${context}`,
      );
    }
    return;
  }
  if (typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_FIELD_PATTERN.test(key)) {
      throw new WalletSessionError(
        WALLET_SESSION_ERROR_CODE.SECRET_FORBIDDEN,
        `forbidden_field_${key}_in_${context}`,
      );
    }
    assertNoSecretMaterialInternal(child, `${context}.${key}`, seen);
  }
}

/**
 * Fail closed without logging or interpolating the offending value.
 * Functions/classes are not traversed; only enumerable provider/config data is
 * inspected so injected SDK objects remain usable at the adapter seam.
 */
export function assertNoSecretMaterial(value: unknown, context = "session"): void {
  assertNoSecretMaterialInternal(value, context, new WeakSet<object>());
}

export function containsSecretField(value: unknown): boolean {
  try {
    assertNoSecretMaterial(value);
    return false;
  } catch (error) {
    if (error instanceof WalletSessionError && error.code === WALLET_SESSION_ERROR_CODE.SECRET_FORBIDDEN) {
      return true;
    }
    throw error;
  }
}
