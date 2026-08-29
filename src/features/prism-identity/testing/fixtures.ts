// Test/reference doubles and fixture helpers for the PRISM-8 offchain suite.
//
// FIXTURE PROVENANCE (honest):
// - EOA signatures are produced at test runtime by freshly generated secp256k1
//   keys (viem `generatePrivateKey`). No private key material is hard-coded,
//   persisted, or logged anywhere in this repository.
// - `LocalErc1271SemanticsChecker` is a clearly labeled deterministic TEST
//   DOUBLE standing in for on-chain EIP-1271 `isValidSignature`: it accepts a
//   signature only when it recovers to the owner registered for the account.
//   It implements the standard's accept/reject semantics locally; it makes NO
//   network calls and does not prove live Base behavior.
// - ERC-6492 wrappers are constructed with the standard layout
//   (abi.encode(owner, data, signature) || magic bytes) via the domain's own
//   parser-symmetric builder, round-trip tested.

import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { recoverMessageAddress } from "viem";
import type { Hex } from "../domain/hex";
import {
  parseErc6492Wrapper,
  buildErc6492Wrapper,
} from "../domain/signature-class";
import type {
  SmartWalletCheckInput,
  SmartWalletCheckResult,
  SmartWalletSignatureChecker,
} from "../domain/ports";
import type {
  IssuedChallengeView,
} from "../application/challenge-service";
import type { PresentedChallengeFields } from "../domain/verification";
import type { EvmAddress } from "../domain/identifiers";

/** Fresh random signer per call — keys exist only inside the running test. */
export function makeEoaSigner(): PrivateKeyAccount {
  return privateKeyToAccount(generatePrivateKey());
}

/**
 * Deterministic stand-in for an on-chain EIP-1271 validator. Register
 * (smart account → owner) pairs; `check` accepts exactly when the presented
 * signature recovers to the registered owner over the same message.
 */
export class LocalErc1271SemanticsChecker implements SmartWalletSignatureChecker {
  private readonly owners = new Map<string, EvmAddress>();
  private undeterminedReason: string | null = null;

  registerSmartAccount(account: EvmAddress, owner: EvmAddress): void {
    this.owners.set(account.toLowerCase(), owner.toLowerCase() as EvmAddress);
  }

  /** Failure-injection hook: next checks report undetermined (dependency). */
  failUndetermined(reason: string): void {
    this.undeterminedReason = reason;
  }

  async check(input: SmartWalletCheckInput): Promise<SmartWalletCheckResult> {
    if (this.undeterminedReason !== null) {
      return { status: "undetermined", reason: this.undeterminedReason };
    }
    const owner = this.owners.get(input.account.toLowerCase());
    if (!owner) return { status: "invalid" };

    let candidateSignature: Hex | null = input.signature;
    const wrapped = parseErc6492Wrapper(input.signature);
    if (wrapped) {
      candidateSignature = wrapped.innerSignature;
    }
    if (!candidateSignature) return { status: "invalid" };

    try {
      const recovered = (
        await recoverMessageAddress({
          message: input.message,
          signature: candidateSignature,
        })
      ).toLowerCase() as EvmAddress;
      return recovered === owner ? { status: "valid" } : { status: "invalid" };
    } catch {
      return { status: "invalid" };
    }
  }
}

/** Checker that always reports dependency-level indeterminacy. */
export class UndeterminedChecker implements SmartWalletSignatureChecker {
  constructor(private readonly reason = "rpc_unreachable") {}
  async check(): Promise<SmartWalletCheckResult> {
    return { status: "undetermined", reason: this.reason };
  }
}

/** Checker that throws like an unhandled transport failure. */
export class ThrowingChecker implements SmartWalletSignatureChecker {
  constructor(private readonly failure = new Error("connection reset")) {}
  async check(): Promise<SmartWalletCheckResult> {
    throw this.failure;
  }
}

/** Builds a standards-shaped ERC-6492 wrapper around a personal-signature. */
export function wrapAsUndeployed6492(input: {
  counterfactualAccount: EvmAddress;
  innerSignature: Hex;
}): Hex {
  return buildErc6492Wrapper({
    owner: input.counterfactualAccount,
    innerData: "0x",
    innerSignature: input.innerSignature,
  });
}

export function presentedFromIssued(view: IssuedChallengeView): PresentedChallengeFields {
  return {
    schemaVersion: view.schemaVersion,
    chainId: view.chainId,
    domain: view.domain,
    venue: view.venue as PresentedChallengeFields["venue"],
    executionAccount: view.executionAccount as PresentedChallengeFields["executionAccount"],
    prismId: view.prismId,
    nonce: view.nonce,
    expiresAt: view.expiresAt,
  };
}

export function mutatePresented(
  base: PresentedChallengeFields,
  patch: Partial<PresentedChallengeFields>,
): PresentedChallengeFields {
  return { ...base, ...patch } as PresentedChallengeFields;
}
