// Application-side orchestration for a user-controlled Base proof session.
//
// The application port is injected explicitly. This module does not discover a
// global browser provider, hold a wallet, or send a Base transaction. It only
// carries the public challenge, account, network, signature, and verification
// response between the injected ports.

import { AppError, APP_ERROR_CODE } from "../../../application/errors";
import type { ChallengeProofApplicationPort } from "../../../application/ports";
import type { AppSession } from "../../../application/auth";
import type {
  AppErrorResponse,
  AppResponse,
  AppSuccessResponse,
  IssueChallengeData,
  SubmitProofData,
} from "../../../application/schemas";
import {
  BASE_PROOF_ERROR_CODE,
  BASE_SEPOLIA_CHAIN_ID,
  type BaseProofProviderPort,
  type BaseProofProviderFailure,
  type BaseProofProviderResult,
  type BaseSignedResult,
} from "./base-proof-adapter";

export interface BaseProofSessionInput {
  readonly session: AppSession;
  readonly prismId: string;
  readonly ttlSeconds?: number;
  readonly requestId?: string | null;
}

export interface VerifiedBaseProofSession {
  readonly status: "verified";
  readonly account: BaseSignedResult["account"];
  readonly chainId: typeof BASE_SEPOLIA_CHAIN_ID;
  readonly signature: BaseSignedResult["signature"];
  readonly challenge: AppSuccessResponse<IssueChallengeData>;
  readonly proof: AppSuccessResponse<SubmitProofData>;
}

export interface BaseProofApplicationError {
  readonly status: "application_error";
  readonly error: AppErrorResponse["error"];
}

export type BaseProofSessionOutcome =
  | VerifiedBaseProofSession
  | BaseProofApplicationError
  | (BaseProofProviderFailure & { readonly challenge?: IssueChallengeData });

export interface BaseProofSessionDeps {
  readonly provider: BaseProofProviderPort;
  readonly application: ChallengeProofApplicationPort;
}

/**
 * Coordinates the existing issue/verify application commands with an injected
 * public-only Base provider. The sequence ends at proof verification; it has no
 * bind, transaction, or settlement capability.
 */
export class BaseProofSession {
  constructor(private readonly deps: BaseProofSessionDeps) {}

  async prove(input: BaseProofSessionInput): Promise<BaseProofSessionOutcome> {
    const connected = await this.safeProviderCall("connect", () => this.deps.provider.connect());
    if (connected.status !== "connected") return asProviderFailure(connected, "connect");

    const issued = await this.safeApplicationCall(() =>
      this.deps.application.issueChallenge({
        headers: { requestId: input.requestId ?? null },
        session: input.session,
        payload: {
          prismId: input.prismId,
          venue: "BASE",
          executionAccount: connected.account,
          ...(input.ttlSeconds === undefined ? {} : { ttlSeconds: input.ttlSeconds }),
        },
      }),
    );
    if (issued === null) return applicationUnavailable("issue");
    if (!issued.ok) return { status: "application_error", error: issued.error };

    // The server is authoritative for the challenge network. A provider that
    // connected to Base Sepolia must never sign a challenge for another chain.
    if (issued.data.chainId !== BASE_SEPOLIA_CHAIN_ID) {
      return {
        status: "network_mismatch",
        code: BASE_PROOF_ERROR_CODE.NETWORK_MISMATCH,
        operation: "signMessage",
        detail: "wrong_network",
        account: connected.account,
        expectedChainId: BASE_SEPOLIA_CHAIN_ID,
        actualChainId: issued.data.chainId,
        actualChainIdHex: `0x${issued.data.chainId.toString(16)}`,
        challenge: issued.data,
      };
    }

    const signed = await this.safeProviderCall("signMessage", () =>
      this.deps.provider.signMessage({
        message: issued.data.messageToSign,
        expectedAccount: connected.account,
      }),
    );
    if (signed.status !== "signed") {
      return { ...asProviderFailure(signed, "signMessage"), challenge: issued.data };
    }

    const verified = await this.safeApplicationCall(() =>
      this.deps.application.submitProof({
        headers: { requestId: input.requestId ?? null },
        session: input.session,
        payload: {
          challengeId: issued.data.challengeId,
          presented: {
            schemaVersion: issued.data.schemaVersion,
            chainId: issued.data.chainId,
            domain: issued.data.domain,
            venue: issued.data.venue,
            executionAccount: issued.data.executionAccount,
            prismId: issued.data.prismId,
            nonce: issued.data.nonce,
            expiresAt: issued.data.expiresAt,
          },
          signature: signed.signature,
        },
      }),
    );
    if (verified === null) return applicationUnavailable("verify");
    if (!verified.ok) return { status: "application_error", error: verified.error };

    return {
      status: "verified",
      account: signed.account,
      chainId: signed.chainId,
      signature: signed.signature,
      challenge: issued,
      proof: verified,
    };
  }

  private async safeProviderCall<T extends BaseProofProviderResult>(
    operation: "connect" | "signMessage",
    call: () => Promise<T>,
  ): Promise<T | BaseProofProviderFailure> {
    try {
      return await call();
    } catch {
      return {
        status: "unknown",
        code: BASE_PROOF_ERROR_CODE.PROVIDER_UNKNOWN,
        operation,
        detail: "provider_request_failed",
      };
    }
  }

  private async safeApplicationCall<T>(
    call: () => Promise<AppResponse<T>>,
  ): Promise<AppResponse<T> | null> {
    try {
      return await call();
    } catch {
      return null;
    }
  }
}

/** Descriptive alias for callers that name the object an application adapter. */
export { BaseProofSession as BaseProofApplicationAdapter };

function applicationUnavailable(operation: "issue" | "verify"): BaseProofApplicationError {
  const error = new AppError(APP_ERROR_CODE.RPC_UNAVAILABLE, `challenge_application_unavailable:${operation}`);
  return { status: "application_error", error: error.toExternalShape() };
}

function asProviderFailure(
  result: BaseProofProviderResult,
  operation: "connect" | "signMessage",
): BaseProofProviderFailure {
  if (result.status !== "connected" && result.status !== "signed") return result;
  return {
    status: "unknown",
    code: BASE_PROOF_ERROR_CODE.PROVIDER_UNKNOWN,
    operation,
    detail: "provider_request_failed",
  };
}
