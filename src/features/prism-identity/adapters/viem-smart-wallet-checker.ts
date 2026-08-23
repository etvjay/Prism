// viem-backed SmartWalletSignatureChecker adapter (port:
// SmartWalletSignatureChecker).
//
// Delegates to viem's universal verifyMessage, which performs the EIP-1271
// isValidSignature call for deployed accounts and the ERC-6492 unwrap-and-
// simulate path for undeployed (counterfactual) accounts. It never accepts on
// ecrecover alone: this port is only invoked after the EOA branch failed to
// match, so any acceptance here comes from contract-level validation.
//
// LIVE-CHAIN LIMITATION (stated honestly): transport behavior against real
// Base RPC endpoints is not exercised by this slice's tests; tests cover the
// mapping logic with deterministic client doubles. A passing local fixture
// does not prove live Base compatibility.

import type { PublicClient } from "viem";
import type {
  SmartWalletCheckInput,
  SmartWalletCheckResult,
  SmartWalletSignatureChecker,
} from "../domain/ports";

function isRevertLike(message: string): boolean {
  const lowered = message.toLowerCase();
  return lowered.includes("revert") || lowered.includes("execution reverted") || lowered.includes("call failed");
}

export class ViemSmartWalletChecker implements SmartWalletSignatureChecker {
  private readonly client: PublicClient;

  constructor(client: PublicClient) {
    this.client = client;
  }

  async check(input: SmartWalletCheckInput): Promise<SmartWalletCheckResult> {
    try {
      const valid = await this.client.verifyMessage({
        address: input.account,
        message: input.message,
        signature: input.signature,
      });
      return { status: valid ? "valid" : "invalid" };
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : String(failure);
      // A deterministic onchain revert is an answer ("no"), not an outage;
      // anything else is a dependency failure and must surface as ERR-021.
      if (isRevertLike(message)) {
        return { status: "invalid" };
      }
      return {
        status: "undetermined",
        reason: message.split("\n")[0].slice(0, 120).replace(/[0-9a-fx]{16,}/gi, "<opaque>"),
      };
    }
  }
}
