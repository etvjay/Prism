import {
  WALLET_SESSION_ERROR_CODE,
  asProviderFailure,
  WalletSessionError,
} from "./errors";
import { assertNoSecretMaterial } from "./no-secrets";
import {
  applyPrivacyObservation,
  assertCanSubmitSession,
  assertReadyProof,
  assertSessionVenue,
  clearAuthorityState,
  createPrivacyWalletSession,
  markProofReady,
  markReceipt,
  markSubmissionStarted,
  markSubmitted,
  errorSession,
} from "./session-state";
import type {
  PrivacyAction,
  PrivacyPreparedAction,
  PrivacyWalletSession,
  PrivacyWalletSessionPort,
  WalletSessionAdapter,
} from "./types";

export interface PrivacyWalletSessionAdapterOptions {
  readonly expectedEnvironment?: string | null;
  /** Account identity is observed by the Starknet wallet adapter and injected here as a fact. */
  readonly accountAddress?: string | null;
}

function mapFailure(error: unknown, fallback: string): WalletSessionError {
  if (error instanceof WalletSessionError) return error;
  const mapped = asProviderFailure(error);
  return new WalletSessionError(mapped.code, mapped.detail ?? fallback);
}

/**
 * Adapter for the existing provider-injected STRK20 action port. It does not
 * create a provider, fabricate a proof, read balances, or store proof material.
 */
export class PrivacyWalletSessionAdapter implements WalletSessionAdapter<PrivacyWalletSession> {
  readonly venue = "privacy" as const;
  private readonly expectedEnvironment: string;
  private readonly accountAddress: string | null;
  /**
   * A provider may have broadcast before returning an error. Keep the
   * pre-submit session object fenced in this adapter so callers cannot retry
   * the same proof after an ambiguous submit result.
   */
  private readonly submissionFences = new WeakSet<object>();

  constructor(
    private readonly port: PrivacyWalletSessionPort,
    options: PrivacyWalletSessionAdapterOptions = {},
  ) {
    assertNoSecretMaterial(port, "privacy_port");
    assertNoSecretMaterial(options, "privacy_adapter_options");
    if (!port || typeof port.observeCapability !== "function") {
      throw new WalletSessionError(WALLET_SESSION_ERROR_CODE.PROVIDER_FAILURE, "privacy_capability_port_required");
    }
    if (typeof port.prepare !== "function" || typeof port.executeWithProof !== "function" || typeof port.observeReceipt !== "function") {
      throw new WalletSessionError(WALLET_SESSION_ERROR_CODE.PROVIDER_FAILURE, "privacy_action_port_incomplete");
    }
    this.expectedEnvironment = options.expectedEnvironment ?? "SN_SEPOLIA";
    this.accountAddress = options.accountAddress ?? null;
  }

  async connect(now: number): Promise<PrivacyWalletSession> {
    let session = createPrivacyWalletSession({
      now,
      expectedEnvironment: this.expectedEnvironment,
      accountAddress: this.accountAddress,
    });
    try {
      const observation = await this.port.observeCapability();
      return applyPrivacyObservation(session, observation, now);
    } catch (error) {
      const mapped = mapFailure(error, "privacy_connect_failed");
      session = errorSession(session, mapped.code, mapped.detail ?? "privacy_connect_failed", now);
      return session;
    }
  }

  async refresh(session: PrivacyWalletSession, now: number): Promise<PrivacyWalletSession> {
    assertSessionVenue(session, "privacy");
    try {
      return applyPrivacyObservation(session, await this.port.observeCapability(), now);
    } catch (error) {
      const mapped = mapFailure(error, "privacy_refresh_failed");
      return errorSession(session, mapped.code, mapped.detail ?? "privacy_refresh_failed", now);
    }
  }

  /** Prepare with simulate=false; only a real non-empty proof can produce proofReady. */
  async prepare(session: PrivacyWalletSession, actions: readonly PrivacyAction[], now: number): Promise<PrivacyPreparedAction> {
    assertSessionVenue(session, "privacy");
    assertCanSubmitSession(session);
    assertNoSecretMaterial(actions, "privacy_prepare_actions");
    try {
      const callAndProof = await this.port.prepare([...actions], { simulate: false });
      assertReadyProof(callAndProof);
      const next = markProofReady(session, now);
      return { session: next, callAndProof };
    } catch (error) {
      if (error instanceof WalletSessionError) throw error;
      throw mapFailure(error, "privacy_prepare_failed");
    }
  }

  /** Submit is deliberately two-phase: submitted has no receipt evidence yet. */
  async submit(
    session: PrivacyWalletSession,
    callAndProof: PrivacyPreparedAction["callAndProof"],
    now: number,
  ): Promise<PrivacyWalletSession> {
    assertSessionVenue(session, "privacy");
    if (this.submissionFences.has(session)) {
      throw new WalletSessionError(WALLET_SESSION_ERROR_CODE.SUBMISSION_REQUIRED, "submission_attempt_already_recorded");
    }
    assertCanSubmitSession(session);
    assertReadyProof(callAndProof);
    const submitting = markSubmissionStarted(session, now);
    this.submissionFences.add(session);
    try {
      const result = await this.port.executeWithProof(callAndProof.call, callAndProof.proof);
      return markSubmitted(submitting, result.transactionHash, now);
    } catch (error) {
      if (error instanceof WalletSessionError) throw error;
      throw mapFailure(error, "privacy_submit_failed");
    }
  }

  async observeReceipt(session: PrivacyWalletSession, now: number): Promise<PrivacyWalletSession> {
    assertSessionVenue(session, "privacy");
    const transactionHash = session.submission.transactionHash;
    if (!transactionHash) {
      throw new WalletSessionError(WALLET_SESSION_ERROR_CODE.RECEIPT_REQUIRED, "submitted_transaction_required");
    }
    try {
      const receipt = await this.port.observeReceipt(transactionHash);
      return markReceipt(session, receipt, now);
    } catch (error) {
      if (error instanceof WalletSessionError) throw error;
      throw mapFailure(error, "privacy_receipt_observation_failed");
    }
  }

  async disconnect(session: PrivacyWalletSession, now: number): Promise<PrivacyWalletSession> {
    assertSessionVenue(session, "privacy");
    return clearAuthorityState(session, now);
  }

  accountChanged(session: PrivacyWalletSession, now: number): PrivacyWalletSession {
    assertSessionVenue(session, "privacy");
    return clearAuthorityState(session, now);
  }
}

export { PrivacyWalletSessionAdapter as Strk20SessionAdapter };
