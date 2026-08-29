// Unified verification ladder (V8.2) — EOA → EIP-1271 → ERC-6492.
//
// INV-SYS-009: no ecrecover-only shortcut. Wrong-signer failures (ERR-003)
// are distinct from tampered-challenge failures (ERR-012), malformed
// signatures and unsupported signature classes (both ERR-014 with distinct
// detail discriminators), and dependency failure (ERR-021).
//
// This module is pure domain logic: it consumes ports only.

import {
  alteredMessageError,
  dependencyError,
  invalidSignerError,
  PRISM_ERROR_CODE,
  PrismError,
  PRISM_ERROR_DETAIL,
  unsupportedSignatureError,
  type AlteredField,
} from "./errors";
import { renderSignableMessage } from "./challenge";
import {
  assertSupportedVenue,
  assertValidExecutionAccount,
  assertValidPrismId,
  isValidChainId,
  type EvmAddress,
} from "./identifiers";
import type { Hex } from "./hex";
import { classifySignature } from "./signature-class";
import type {
  ChallengeCrypto,
  OwnershipChallengeFields,
  SignatureClass,
  SmartWalletSignatureChecker,
  StoredOwnershipChallenge,
} from "./ports";
import { CHALLENGE_SCHEMA_VERSION as CURRENT_CHALLENGE_SCHEMA_VERSION } from "./ports";

/** The client echoes the challenge fields it signed; the server recomputes
 * the digest against its authoritative stored copy (CMD-B-02 / ERR-012). */
export interface PresentedChallengeFields extends OwnershipChallengeFields {
  nonce: Hex;
  expiresAt: number;
}

export interface VerificationOutcome {
  status: "valid";
  signatureClass: SignatureClass;
}

function diffPresentedFields(
  stored: StoredOwnershipChallenge,
  presented: PresentedChallengeFields,
): AlteredField[] {
  const altered: AlteredField[] = [];
  if (presented.chainId !== stored.chainId) altered.push("chain_id");
  if (presented.domain !== stored.domain) altered.push("domain");
  if (presented.venue !== stored.venue) altered.push("venue");
  if (
    typeof presented.executionAccount !== "string" ||
    presented.executionAccount.toLowerCase() !== stored.executionAccount
  ) altered.push("execution_account");
  if (presented.prismId !== stored.prismId) altered.push("prism_id");
  if (presented.nonce !== stored.nonce) altered.push("nonce");
  if (presented.expiresAt !== stored.expiresAt) altered.push("expiry");
  return altered;
}

/**
 * Validates that the presented challenge echoes the stored authoritative
 * fields faithfully, per CMD-B-02's error surface (ERR-003/006/012/013/014):
 * ANY deviation of the echoed binding fields — including structurally invalid
 * values — is tamper evidence and surfaces as ERR-012 with the altered field
 * list. Structural form checks remain as defense-in-depth behind the digest
 * comparison (they protect against issuer-side corruption, not client edits).
 */
export function assertPresentedFaithful(
  input: {
    stored: StoredOwnershipChallenge;
    presented: PresentedChallengeFields;
  },
): EvmAddress {
  if (input.stored.schemaVersion !== CURRENT_CHALLENGE_SCHEMA_VERSION) {
    throw new PrismError(PRISM_ERROR_CODE.ALTERED_MESSAGE, "altered_fields:schema_version");
  }
  if (
    typeof input.presented !== "object" ||
    input.presented === null ||
    typeof input.presented.expiresAt !== "number"
  ) {
    throw alteredMessageError(["expiry"]);
  }
  if (typeof input.presented.chainId !== "number") {
    throw alteredMessageError(["chain_id"]);
  }

  const alteredFields = diffPresentedFields(input.stored, input.presented);
  if (alteredFields.length > 0) {
    throw alteredMessageError(alteredFields);
  }

  if (input.presented.schemaVersion !== input.stored.schemaVersion) {
    throw new PrismError(PRISM_ERROR_CODE.ALTERED_MESSAGE, "altered_fields:schema_version");
  }

  // Defense-in-depth (unreachable while issuance validation holds).
  assertSupportedVenue(input.presented.venue);
  const expected = assertValidExecutionAccount(input.presented.executionAccount);
  assertValidPrismId(input.presented.prismId);
  if (!isValidChainId(input.presented.chainId)) {
    // A structurally invalid chain id cannot match any well-formed issued
    // challenge; it is tamper evidence, not a user-input error.
    throw new PrismError(PRISM_ERROR_CODE.ALTERED_MESSAGE, "altered_fields:chain_id");
  }
  return expected;
}

/**
 * Runs the full check for one proof submission: faithful-echo validation then
 * the signature ladder over the canonical signable message.
 */
export async function verifyChallengeSignature(
  input: {
    stored: StoredOwnershipChallenge;
    presented: PresentedChallengeFields;
    signature: Hex;
  },
  deps: {
    crypto: ChallengeCrypto;
    checker: SmartWalletSignatureChecker;
  },
): Promise<VerificationOutcome> {
  const expected = assertPresentedFaithful({
    stored: input.stored,
    presented: input.presented,
  });

  const message = renderSignableMessage({
    schemaVersion: input.stored.schemaVersion,
    chainId: input.stored.chainId,
    domain: input.stored.domain,
    venue: input.stored.venue,
    executionAccount: input.stored.executionAccount,
    prismId: input.stored.prismId,
    nonce: input.stored.nonce,
    issuedAt: input.stored.issuedAt,
    expiresAt: input.stored.expiresAt,
  });

  return runLadder({ signature: input.signature, message, expected }, deps);
}

/** The signature ladder proper: classification + EOA recovery + EIP-1271 /
 * ERC-6492 port checks over an already-validated challenge. */
export async function runLadder(
  input: { signature: Hex; message: string; expected: EvmAddress },
  deps: { crypto: ChallengeCrypto; checker: SmartWalletSignatureChecker },
): Promise<VerificationOutcome> {
  const classified = classifySignature(input.signature);

  switch (classified.kind) {
    case "unclassified":
      throw unsupportedSignatureError(classified.reason);

    case "eoa_candidate": {
      const recovered = await deps.crypto.recoverPersonalSignAddress({
        message: input.message,
        signature: input.signature,
      });
      if (!recovered) {
        throw unsupportedSignatureError(PRISM_ERROR_DETAIL.MALFORMED_SIGNATURE);
      }
      if (recovered === input.expected) {
        return { status: "valid", signatureClass: "EOA" };
      }
      // Fall through: deployed smart wallets may emit ECDSA-layout blobs that
      // must be judged by isValidSignature, never by recovery alone.
      return checkSmartWallet(
        deps.checker,
        { account: input.expected, message: input.message, signature: input.signature },
        "EIP1271",
        `recovered_mismatch:${recovered}`,
      );
    }

    case "erc6492": {
      if (classified.parsed.owner !== input.expected) {
        throw invalidSignerError(`wrapper_owner_mismatch:${classified.parsed.owner}`);
      }
      // The full wrapped bytes go to the port: validators unwrap per ERC-6492.
      return checkSmartWallet(
        deps.checker,
        { account: input.expected, message: input.message, signature: input.signature },
        "ERC6492",
        "wrapped_inner_signature_rejected",
      );
    }
  }
}

async function checkSmartWallet(
  checker: SmartWalletSignatureChecker,
  request: { account: EvmAddress; message: string; signature: Hex },
  validClass: SignatureClass,
  rejectionDetail: string,
): Promise<VerificationOutcome> {
  let result;
  try {
    result = await checker.check(request);
  } catch (failure) {
    // Port implementations should map transport failures to undetermined
    // themselves; a thrown error is treated the same way — explicitly.
    throw dependencyError(`${PRISM_ERROR_DETAIL.SIGNATURE_CHECKER_UNAVAILABLE}:${summarize(failure)}`);
  }
  if (result.status === "valid") {
    return { status: "valid", signatureClass: validClass };
  }
  if (result.status === "undetermined") {
    throw dependencyError(`signature_checker_unavailable:${result.reason}`);
  }
  throw invalidSignerError(rejectionDetail);
}

function summarize(failure: unknown): string {
  if (failure instanceof Error && failure.message.length > 0) {
    return failure.message.split("\n")[0].slice(0, 120).replace(/[0-9a-fx]{16,}/gi, "<opaque>");
  }
  return "unspecified_failure";
}
