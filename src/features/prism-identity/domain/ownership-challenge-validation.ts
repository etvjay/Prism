import { CHALLENGE_SCHEMA_VERSION, type SignatureClass, type StoredOwnershipChallenge } from "./ports";
import { isValidChainId } from "./identifiers";

const SIGNATURE_CLASSES: readonly SignatureClass[] = ["EOA", "EIP1271", "ERC6492"];
const CHALLENGE_STATES = ["ISSUED", "VERIFIED", "REJECTED", "EXPIRED"] as const;

export function isSignatureClass(value: unknown): value is SignatureClass {
  return typeof value === "string" && (SIGNATURE_CLASSES as readonly string[]).includes(value);
}

export function hasVerifiedEvidence(record: Pick<StoredOwnershipChallenge, "verifiedAt" | "verifiedSignatureClass">): boolean {
  return (
    Number.isSafeInteger(record.verifiedAt) &&
    (record.verifiedAt as number) >= 0 &&
    isSignatureClass(record.verifiedSignatureClass)
  );
}

/**
 * Validate the durable challenge representation before it can become a source
 * of proof authority. The challenge payload is schema v2; the durable-store
 * schema version is tracked separately by each adapter's metadata table.
 */
export function assertStoredOwnershipChallenge(record: StoredOwnershipChallenge): void {
  if (!record || typeof record !== "object") {
    throw new Error("invalid_record:challenge_required");
  }
  if (record.schemaVersion !== CHALLENGE_SCHEMA_VERSION) {
    throw new Error(`invalid_record:schema_version_${String(record.schemaVersion)}_requires_${CHALLENGE_SCHEMA_VERSION}`);
  }
  if (!(CHALLENGE_STATES as readonly string[]).includes(record.state)) {
    throw new Error(`invalid_record:state_${String(record.state)}`);
  }
  if (record.nonceState !== "UNUSED" && record.nonceState !== "CONSUMED") {
    throw new Error(`invalid_record:nonce_state_${String(record.nonceState)}`);
  }
  if (!isValidChainId(record.chainId)) {
    throw new Error("invalid_record:chain_id");
  }
  if (record.bindingUseState !== undefined && record.bindingUseState !== "UNUSED" && record.bindingUseState !== "CONSUMED") {
    throw new Error("invalid_record:binding_use_state");
  }
  if (record.verifiedAt !== undefined && (!Number.isSafeInteger(record.verifiedAt) || record.verifiedAt < 0)) {
    throw new Error("invalid_record:verified_at");
  }
  if (record.verifiedSignatureClass !== undefined && !isSignatureClass(record.verifiedSignatureClass)) {
    throw new Error("invalid_record:verified_signature_class");
  }
  if (record.state === "VERIFIED" && !hasVerifiedEvidence(record)) {
    throw new Error("invalid_record:VERIFIED_requires_verified_at_and_verified_signature_class");
  }
}

export function assertVerifiedEvidencePatch(patch: Pick<StoredOwnershipChallenge, "verifiedAt" | "verifiedSignatureClass">): void {
  if (!hasVerifiedEvidence(patch)) {
    throw new Error("invalid_record:VERIFIED_requires_verified_at_and_verified_signature_class");
  }
}
