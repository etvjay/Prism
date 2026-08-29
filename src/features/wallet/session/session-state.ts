import {
  classifyStrk20Capability,
  classifyWalletEnvironment,
  getExpectedWalletEnvironment,
  type ExpectedWalletEnvironment,
  type WalletEnvironment,
} from "../../prism-strk20/domain/wallet-capability";
import { isEmptyProof, type Strk20CallAndProof } from "../../prism-strk20/domain/strk20-proof";
import { normalizeShadowAccountObservation } from "../../prism-strk20/domain/shadow-account";
import {
  WALLET_SESSION_ERROR_CODE,
  WalletSessionError,
} from "./errors";
import type { WalletSessionErrorCode } from "./errors";
import { assertNoSecretMaterial } from "./no-secrets";
import type {
  BaseProofSession,
  BaseProofState,
  CapabilityState,
  CapabilityStatus,
  ConsentState,
  NetworkStatus,
  PrivacyWalletSession,
  ReceiptFinality,
  ReceiptState,
  ReceiptStatus,
  SessionErrorState,
  SessionStatus,
  StarknetWalletSession,
  SubmissionState,
  WalletSessionContract,
  WalletVenue,
} from "./types";
import type { CapabilityResult, NormalizedReceipt } from "../../prism-strk20/domain/strk20-action-port";

const EMPTY_PROOF_STATE: BaseProofState = { status: "idle", scheme: null, digest: null };

function ensureFiniteNow(now: number): void {
  if (!Number.isFinite(now)) {
    throw new WalletSessionError(WALLET_SESSION_ERROR_CODE.STALE_STATE, "invalid_now");
  }
}

function bump<T extends WalletSessionContract>(session: T, now: number, patch: Record<string, unknown>): T {
  ensureFiniteNow(now);
  return {
    ...session,
    ...patch,
    version: session.version + 1,
    updatedAt: now,
  } as T;
}

function unknownCapability(): CapabilityState {
  return {
    status: "unknown",
    apiVersions: [],
    specs: [],
    supportsProofPreparation: false,
    supportsApproval: false,
    supportsSubmission: false,
    reason: null,
  };
}

function capabilityFromStatus(
  status: CapabilityStatus,
  input: {
    apiVersions?: readonly string[];
    specs?: readonly string[];
    supportsProofPreparation?: boolean;
    supportsApproval?: boolean;
    supportsSubmission?: boolean;
    reason?: string | null;
    shadowAccount?: CapabilityState["shadowAccount"];
  } = {},
): CapabilityState {
  return {
    status,
    apiVersions: [...(input.apiVersions ?? [])],
    specs: [...(input.specs ?? [])],
    supportsProofPreparation: input.supportsProofPreparation ?? status === "supported",
    supportsApproval: input.supportsApproval ?? status === "supported",
    supportsSubmission: input.supportsSubmission ?? status === "supported",
    reason: input.reason ?? null,
    ...(input.shadowAccount === undefined ? {} : { shadowAccount: input.shadowAccount }),
  };
}

function unknownNetwork(expectedChainId: string): {
  status: "unknown";
  chainId: null;
  expectedChainId: string;
} {
  return { status: "unknown", chainId: null, expectedChainId };
}

function emptyConsent(status: ConsentState["status"] = "unknown"): ConsentState {
  return { status, reason: null };
}

function emptySubmission(): SubmissionState {
  return { status: "idle", transactionHash: null, submittedAt: null };
}

function emptyReceipt(): ReceiptState {
  return {
    status: "not-requested",
    transactionHash: null,
    blockNumber: null,
    finality: null,
    observedAt: null,
  };
}

function emptyError(): null {
  return null;
}

function errorState(code: WalletSessionErrorCode, detail: string | null): SessionErrorState {
  return { code, detail };
}

function normalizeHex(value: unknown, context: string, maxDigits = 64): `0x${string}` {
  if (typeof value !== "string") {
    throw new WalletSessionError(WALLET_SESSION_ERROR_CODE.MALFORMED_OBSERVATION, `malformed_${context}`);
  }
  const normalized = value.trim().toLowerCase();
  const matcher = new RegExp(`^0x[0-9a-f]{1,${maxDigits}}$`);
  if (!matcher.test(normalized) || BigInt(normalized) === 0n) {
    throw new WalletSessionError(WALLET_SESSION_ERROR_CODE.MALFORMED_OBSERVATION, `malformed_${context}`);
  }
  return `0x${normalized.slice(2).padStart(maxDigits, "0")}` as `0x${string}`;
}

export function normalizeStarknetAddress(value: unknown): `0x${string}` {
  const normalized = normalizeHex(value, "starknet_account", 64);
  if (BigInt(normalized) >= (1n << 251n)) {
    throw new WalletSessionError(WALLET_SESSION_ERROR_CODE.MALFORMED_OBSERVATION, "starknet_account_out_of_range");
  }
  return normalized;
}

export function normalizeEvmAddress(value: unknown): `0x${string}` {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value.trim())) {
    throw new WalletSessionError(WALLET_SESSION_ERROR_CODE.MALFORMED_OBSERVATION, "malformed_base_account");
  }
  return value.trim().toLowerCase() as `0x${string}`;
}

export function normalizeTransactionHash(value: unknown): `0x${string}` {
  return normalizeHex(value, "transaction_hash", 64);
}

export function createStarknetWalletSession(input: {
  now: number;
  expectedEnvironment?: string | null;
  walletName?: string | null;
}): StarknetWalletSession {
  ensureFiniteNow(input.now);
  assertNoSecretMaterial(input, "create_starknet_session");
  const expectedEnvironment = getExpectedWalletEnvironment(input.expectedEnvironment ?? "SN_SEPOLIA");
  return {
    kind: "starknet-wallet",
    venue: "starknet",
    walletName: input.walletName ?? null,
    accountAddress: null,
    chainId: null,
    environment: "UNKNOWN",
    expectedEnvironment,
    network: unknownNetwork(expectedEnvironment),
    capability: unknownCapability(),
    privacyCapability: unknownCapability(),
    consent: emptyConsent(),
    submission: emptySubmission(),
    receipt: emptyReceipt(),
    status: "disconnected",
    version: 0,
    updatedAt: input.now,
    error: emptyError(),
  };
}

export function createBaseProofSession(input: {
  now: number;
  expectedChainId: string;
}): BaseProofSession {
  ensureFiniteNow(input.now);
  assertNoSecretMaterial(input, "create_base_session");
  if (!input.expectedChainId || input.expectedChainId.trim().length === 0) {
    throw new WalletSessionError(WALLET_SESSION_ERROR_CODE.NETWORK_UNKNOWN, "expected_chain_id_required");
  }
  return {
    kind: "base-proof",
    venue: "base",
    accountAddress: null,
    chainId: null,
    network: unknownNetwork(input.expectedChainId),
    capability: unknownCapability(),
    consent: emptyConsent(),
    proof: { ...EMPTY_PROOF_STATE },
    submission: emptySubmission(),
    receipt: emptyReceipt(),
    status: "disconnected",
    version: 0,
    updatedAt: input.now,
    error: emptyError(),
  };
}

export function createPrivacyWalletSession(input: {
  now: number;
  expectedEnvironment?: string | null;
  accountAddress?: string | null;
}): PrivacyWalletSession {
  ensureFiniteNow(input.now);
  assertNoSecretMaterial(input, "create_privacy_session");
  const expectedEnvironment = getExpectedWalletEnvironment(input.expectedEnvironment ?? "SN_SEPOLIA");
  return {
    kind: "privacy-wallet",
    venue: "privacy",
    accountAddress: input.accountAddress === undefined || input.accountAddress === null
      ? null
      : normalizeStarknetAddress(input.accountAddress),
    chainId: null,
    environment: "UNKNOWN",
    expectedEnvironment,
    network: unknownNetwork(expectedEnvironment),
    capability: unknownCapability(),
    consent: emptyConsent(),
    submission: emptySubmission(),
    receipt: emptyReceipt(),
    strk20State: null,
    proofReady: false,
    status: "disconnected",
    version: 0,
    updatedAt: input.now,
    error: emptyError(),
  };
}

export function assertSessionVenue<T extends WalletSessionContract>(session: WalletSessionContract, venue: T["venue"]): asserts session is T {
  if (session.venue !== venue) {
    throw new WalletSessionError(
      WALLET_SESSION_ERROR_CODE.VENUE_MISMATCH,
      `venue_mismatch_expected_${venue}_got_${session.venue}`,
    );
  }
}

function statusFor<T extends WalletSessionContract>(session: T): SessionStatus {
  // An error is an explicit loss of authority evidence. Do not derive a
  // ready-looking status from facts that were present before the failure.
  if (session.error !== null) {
    return session.error.code === WALLET_SESSION_ERROR_CODE.CONSENT_DENIED
      ? "consent-required"
      : "unknown";
  }
  if (session.accountAddress === null) return "disconnected";
  if (session.network.status === "mismatch") return "wrong-network";
  if (session.network.status === "unknown") return "unknown";
  if (session.capability.status === "unknown") return "capability-unknown";
  if (session.consent.status === "required" || session.consent.status === "denied") return "consent-required";
  if (session.receipt.status === "confirmed") return "receipt-confirmed";
  if (session.receipt.status === "reverted") return "reverted";
  if (session.receipt.status === "unknown") return "unknown";
  if (session.submission.status === "awaiting-approval") return "awaiting-approval";
  if (session.submission.status === "submitting") return "submitting";
  if (session.submission.status === "submitted") return "processing";
  if (session.submission.status === "failed") return "unknown";
  if (session.capability.status === "unsupported") return "connected";
  return "ready";
}

export function deriveSessionStatus(session: WalletSessionContract): SessionStatus {
  return statusFor(session);
}

const ALLOWED_SESSION_TRANSITIONS: Readonly<Record<SessionStatus, readonly SessionStatus[]>> = {
  disconnected: ["connecting", "unknown"],
  connecting: ["connected", "wrong-network", "capability-unknown", "consent-required", "disconnected", "unknown"],
  connected: ["ready", "wrong-network", "capability-unknown", "consent-required", "disconnected", "unknown"],
  "wrong-network": ["connecting", "disconnected", "unknown"],
  "capability-unknown": ["connecting", "disconnected", "unknown"],
  "consent-required": ["ready", "awaiting-approval", "disconnected", "unknown"],
  ready: ["awaiting-approval", "submitting", "disconnected", "wrong-network", "capability-unknown", "unknown"],
  "awaiting-approval": ["submitting", "submitted", "disconnected", "unknown"],
  submitting: ["submitted", "disconnected", "unknown"],
  submitted: ["processing", "disconnected", "unknown"],
  processing: ["receipt-confirmed", "reverted", "unknown", "disconnected"],
  "receipt-confirmed": ["ready", "disconnected", "unknown"],
  reverted: ["ready", "disconnected", "unknown"],
  unknown: ["connecting", "disconnected", "unknown"],
};

/** Pure transition vocabulary shared by UI/prototype projections. */
export function canTransitionSession(from: SessionStatus, to: SessionStatus): boolean {
  return from === to || ALLOWED_SESSION_TRANSITIONS[from]?.includes(to) === true;
}

/** Alias matching the standalone prototype's state helper naming. */
export const canTransitionWalletSession = canTransitionSession;

/**
 * Apply only a legal presentation transition. Authority facts are still
 * required for terminal states; callers should prefer the receipt/submission
 * helpers below when changing those facts.
 */
export function transitionSession<T extends WalletSessionContract>(session: T, to: SessionStatus, now: number): T {
  ensureFiniteNow(now);
  if (!canTransitionSession(session.status, to)) {
    throw new WalletSessionError(
      WALLET_SESSION_ERROR_CODE.ILLEGAL_TRANSITION,
      `illegal_session_transition:${session.status}->${to}`,
    );
  }
  if (to === "receipt-confirmed" && session.receipt.status !== "confirmed") {
    throw new WalletSessionError(WALLET_SESSION_ERROR_CODE.RECEIPT_REQUIRED, "confirmed_receipt_required");
  }
  if (to === "submitted" && session.submission.status !== "submitted") {
    throw new WalletSessionError(WALLET_SESSION_ERROR_CODE.SUBMISSION_REQUIRED, "submitted_fact_required");
  }
  if (to === "submitting" && session.submission.status !== "submitting") {
    throw new WalletSessionError(WALLET_SESSION_ERROR_CODE.SUBMISSION_REQUIRED, "submitting_fact_required");
  }
  if (to === "processing" && (session.submission.status !== "submitted" || session.receipt.status !== "pending")) {
    throw new WalletSessionError(WALLET_SESSION_ERROR_CODE.RECEIPT_REQUIRED, "pending_receipt_fact_required");
  }
  return bump(session, now, { status: to });
}

function declaredWalletApiCapability(apiVersions: readonly string[], specs: readonly string[]): CapabilityState {
  const values = [...apiVersions, ...specs];
  if (values.length === 0 || values.some((value) => typeof value !== "string" || value.trim().length === 0)) {
    return capabilityFromStatus("unknown", { reason: "capability_observation_unknown" });
  }
  return capabilityFromStatus("supported", {
    apiVersions,
    specs,
    supportsProofPreparation: true,
    supportsApproval: true,
    supportsSubmission: true,
  });
}

function networkForStarknet(chainId: string, expected: ExpectedWalletEnvironment): {
  environment: WalletEnvironment;
  network: StarknetWalletSession["network"];
} {
  const environment = classifyWalletEnvironment(chainId, { mainnet: "SN_MAIN", sepolia: "SN_SEPOLIA" });
  return {
    environment,
    network: {
      status: environment === "UNKNOWN" ? "unknown" : environment === expected ? "expected" : "mismatch",
      chainId,
      expectedChainId: expected,
    },
  };
}

export function applyStarknetObservation(
  session: StarknetWalletSession,
  input: {
    accountAddress: string;
    chainId: string;
    apiVersions: readonly string[];
    specs: readonly string[];
    walletName?: string | null;
  },
  now: number,
): StarknetWalletSession {
  assertSessionVenue(session, "starknet");
  ensureFiniteNow(now);
  assertNoSecretMaterial(input, "starknet_observation");
  const accountAddress = normalizeStarknetAddress(input.accountAddress);
  if (typeof input.chainId !== "string" || input.chainId.trim().length === 0) {
    throw new WalletSessionError(WALLET_SESSION_ERROR_CODE.NETWORK_UNKNOWN, "chain_id_observation_unknown");
  }
  const apiVersions = [...input.apiVersions];
  const specs = [...input.specs];
  const capability = declaredWalletApiCapability(apiVersions, specs);
  const privacyStatus = classifyStrk20Capability(apiVersions, specs);
  const privacyCapability = capabilityFromStatus(privacyStatus, {
    apiVersions,
    specs,
    supportsProofPreparation: privacyStatus === "supported",
    supportsApproval: privacyStatus === "supported",
    supportsSubmission: privacyStatus === "supported",
    reason: privacyStatus === "unknown" ? "strk20_capability_unknown" : null,
  });
  const networkFacts = networkForStarknet(input.chainId, session.expectedEnvironment);
  const next: StarknetWalletSession = {
    ...session,
    accountAddress,
    chainId: input.chainId,
    walletName: input.walletName ?? session.walletName,
    environment: networkFacts.environment,
    network: networkFacts.network,
    capability,
    privacyCapability,
    consent: session.consent.status === "unknown" ? emptyConsent("not-required") : session.consent,
    error: null,
  };
  return bump(next, now, { status: statusFor(next) });
}

export function applyBaseObservation(
  session: BaseProofSession,
  input: { accountAddress: string; chainId: string },
  now: number,
): BaseProofSession {
  assertSessionVenue(session, "base");
  ensureFiniteNow(now);
  assertNoSecretMaterial(input, "base_observation");
  const accountAddress = normalizeEvmAddress(input.accountAddress);
  if (typeof input.chainId !== "string" || input.chainId.trim().length === 0) {
    throw new WalletSessionError(WALLET_SESSION_ERROR_CODE.NETWORK_UNKNOWN, "chain_id_observation_unknown");
  }
  const networkStatus: NetworkStatus =
    input.chainId.trim().toLowerCase() === session.network.expectedChainId.trim().toLowerCase()
      ? "expected"
      : "mismatch";
  const next: BaseProofSession = {
    ...session,
    accountAddress,
    chainId: input.chainId,
    network: { status: networkStatus, chainId: input.chainId, expectedChainId: session.network.expectedChainId },
    capability: capabilityFromStatus("supported", {
      supportsProofPreparation: false,
      supportsApproval: true,
      supportsSubmission: false,
    }),
    consent: session.consent.status === "unknown" ? emptyConsent("not-required") : session.consent,
    error: null,
  };
  return bump(next, now, { status: statusFor(next) });
}

export function markBaseProofSigned(
  session: BaseProofSession,
  now: number,
  scheme: BaseProofState["scheme"] = "personal_sign",
): BaseProofSession {
  assertSessionVenue(session, "base");
  ensureFiniteNow(now);
  if (session.status === "unknown" || session.error !== null) {
    throw new WalletSessionError(WALLET_SESSION_ERROR_CODE.STALE_STATE, "unknown_session_not_sign_ready");
  }
  if (session.accountAddress === null || session.network.status !== "expected") {
    throw new WalletSessionError(WALLET_SESSION_ERROR_CODE.NETWORK_MISMATCH, "ready_base_session_required");
  }
  const next: BaseProofSession = {
    ...session,
    proof: { status: "signed", scheme, digest: null },
    consent: { status: "granted", reason: null },
    error: null,
  };
  return bump(next, now, { status: statusFor(next) });
}

export function applyPrivacyObservation(
  session: PrivacyWalletSession,
  observation: CapabilityResult,
  now: number,
): PrivacyWalletSession {
  assertSessionVenue(session, "privacy");
  ensureFiniteNow(now);
  assertNoSecretMaterial(observation, "privacy_observation");
  if (typeof observation.chainId !== "string" || observation.chainId.trim().length === 0) {
    throw new WalletSessionError(WALLET_SESSION_ERROR_CODE.NETWORK_UNKNOWN, "chain_id_observation_unknown");
  }
  const apiVersions = Array.isArray(observation.apiVersions) && observation.apiVersions.every((value) => typeof value === "string")
    ? [...observation.apiVersions]
    : [];
  const specs = Array.isArray(observation.specs) && observation.specs.every((value) => typeof value === "string")
    ? [...observation.specs]
    : [];
  const declaredStatus = observation.capabilityStatus;
  const derivedStatus = classifyStrk20Capability(apiVersions, specs);
  const status: CapabilityStatus = observation.capable === (derivedStatus === "supported")
    && declaredStatus === derivedStatus
    && (declaredStatus === "supported" || declaredStatus === "unsupported" || declaredStatus === "unknown")
    ? declaredStatus
    : "unknown";
  const expected = session.expectedEnvironment;
  const environment = observation.environment === "SN_MAIN" || observation.environment === "SN_SEPOLIA"
    ? observation.environment
    : "UNKNOWN";
  const shadowAccount = normalizeShadowAccountObservation(observation.shadowAccount);
  const networkStatus = environment === "UNKNOWN"
    ? "unknown"
    : observation.mismatch === true || environment !== expected
      ? "mismatch"
      : "expected";
  const strk20State = networkStatus === "mismatch"
    ? "mismatch"
    : networkStatus === "unknown" || status === "unknown" || status === "unsupported"
      ? "capability_unknown"
      : session.strk20State;
  const next: PrivacyWalletSession = {
    ...session,
    chainId: observation.chainId,
    environment,
    network: { status: networkStatus, chainId: observation.chainId, expectedChainId: expected },
    capability: capabilityFromStatus(status, {
      apiVersions,
      specs,
      supportsProofPreparation: observation.capable === true && status === "supported",
      supportsApproval: observation.capable === true && status === "supported",
      supportsSubmission: observation.capable === true && status === "supported",
      reason: status === "unknown" ? "strk20_capability_unknown" : null,
      ...(shadowAccount === undefined ? {} : { shadowAccount }),
    }),
    consent: session.consent.status === "unknown" ? emptyConsent("not-required") : session.consent,
    strk20State,
    error: null,
  };
  return bump(next, now, { status: statusFor(next) });
}

export function grantConsent<T extends WalletSessionContract>(session: T, now: number): T {
  ensureFiniteNow(now);
  if (session.status === "unknown" || session.error !== null) {
    throw new WalletSessionError(WALLET_SESSION_ERROR_CODE.STALE_STATE, "unknown_session_not_consent_ready");
  }
  if (session.accountAddress === null) {
    throw new WalletSessionError(WALLET_SESSION_ERROR_CODE.CONSENT_REQUIRED, "connected_account_required");
  }
  const next = {
    ...session,
    consent: { status: "granted", reason: null },
    error: null,
  } as T;
  return bump(next, now, { status: statusFor(next) });
}

export function denyConsent<T extends WalletSessionContract>(session: T, now: number, reason = "user_denied_consent"): T {
  ensureFiniteNow(now);
  const next = {
    ...session,
    consent: { status: "denied", reason },
    error: errorState(WALLET_SESSION_ERROR_CODE.CONSENT_DENIED, "user_denied_consent"),
  } as T;
  return bump(next, now, { status: "consent-required" });
}

export function requireConsent<T extends WalletSessionContract>(session: T, now: number, reason = "explicit_consent_required"): T {
  ensureFiniteNow(now);
  const next = {
    ...session,
    consent: { status: "required", reason },
    error: null,
  } as T;
  return bump(next, now, { status: "consent-required" });
}

export function canSubmitSession(session: WalletSessionContract): boolean {
  if (session.status === "unknown" || session.error !== null) return false;
  if (session.accountAddress === null) return false;
  if (session.network.status !== "expected") return false;
  if (session.capability.status !== "supported") return false;
  if (session.submission.status === "submitted" || session.submission.status === "submitting") return false;
  if (session.venue === "privacy" && session.consent.status !== "granted") return false;
  return true;
}

export function assertCanSubmitSession(session: WalletSessionContract): void {
  if (session.status === "unknown" || session.error !== null) {
    throw new WalletSessionError(WALLET_SESSION_ERROR_CODE.STALE_STATE, "unknown_session_not_submit_ready");
  }
  if (session.accountAddress === null) {
    throw new WalletSessionError(WALLET_SESSION_ERROR_CODE.PROVIDER_DISCONNECTED, "connected_account_required");
  }
  if (session.network.status === "unknown") {
    throw new WalletSessionError(WALLET_SESSION_ERROR_CODE.NETWORK_UNKNOWN, "network_observation_required");
  }
  if (session.network.status === "mismatch") {
    throw new WalletSessionError(WALLET_SESSION_ERROR_CODE.NETWORK_MISMATCH, "expected_network_required");
  }
  if (session.capability.status === "unknown") {
    throw new WalletSessionError(WALLET_SESSION_ERROR_CODE.CAPABILITY_UNKNOWN, "capability_observation_required");
  }
  if (session.capability.status !== "supported") {
    throw new WalletSessionError(WALLET_SESSION_ERROR_CODE.CAPABILITY_UNKNOWN, "required_capability_unsupported");
  }
  if (session.venue === "privacy" && session.consent.status !== "granted") {
    throw new WalletSessionError(WALLET_SESSION_ERROR_CODE.CONSENT_REQUIRED, "explicit_consent_required");
  }
  if (session.submission.status === "submitted" || session.submission.status === "submitting") {
    throw new WalletSessionError(WALLET_SESSION_ERROR_CODE.SUBMISSION_REQUIRED, "submission_already_recorded");
  }
}

export function markProofReady(session: PrivacyWalletSession, now: number): PrivacyWalletSession {
  assertSessionVenue(session, "privacy");
  assertCanSubmitSession(session);
  const next: PrivacyWalletSession = { ...session, proofReady: true };
  return bump(next, now, { status: "awaiting-approval" });
}

export function markSubmissionStarted(session: PrivacyWalletSession, now: number): PrivacyWalletSession {
  assertSessionVenue(session, "privacy");
  assertCanSubmitSession(session);
  if (!session.proofReady) {
    throw new WalletSessionError(WALLET_SESSION_ERROR_CODE.PROOF_REQUIRED, "prepared_proof_required");
  }
  const next: PrivacyWalletSession = {
    ...session,
    submission: { status: "submitting", transactionHash: null, submittedAt: null },
    error: null,
  };
  return bump(next, now, { status: "submitting" });
}

export function markSubmitted(
  session: PrivacyWalletSession,
  transactionHash: unknown,
  now: number,
): PrivacyWalletSession {
  assertSessionVenue(session, "privacy");
  ensureFiniteNow(now);
  const hash = normalizeTransactionHash(transactionHash);
  if (session.submission.status !== "submitting") {
    throw new WalletSessionError(WALLET_SESSION_ERROR_CODE.ILLEGAL_TRANSITION, "submission_must_be_started");
  }
  const next: PrivacyWalletSession = {
    ...session,
    proofReady: false,
    submission: { status: "submitted", transactionHash: hash, submittedAt: now },
    receipt: { status: "pending", transactionHash: hash, blockNumber: null, finality: "PENDING", observedAt: null },
    error: null,
  };
  return bump(next, now, { status: "processing" });
}

function hasPoolEventEvidence(receipt: NormalizedReceipt): boolean {
  // `poolEventFound` is a derived adapter fact, not standalone completion
  // evidence. Require the event collection to carry at least one concrete
  // event as well, so a lying/partial adapter cannot promote an event-less
  // receipt by setting the boolean alone.
  return receipt.poolEventFound === true
    && Array.isArray(receipt.events)
    && receipt.events.some((event) => event && typeof event.address === "string" && event.address.trim().length > 0);
}

function receiptStateFromObservation(receipt: NormalizedReceipt, now: number): ReceiptState {
  const confirmed = receipt.executionStatus === "SUCCEEDED"
    && (receipt.finalityStatus === "ACCEPTED_ON_L1" || receipt.finalityStatus === "ACCEPTED_ON_L2")
    && receipt.blockNumber !== null
    && hasPoolEventEvidence(receipt);
  const reverted = receipt.executionStatus === "REVERTED";
  const pending = receipt.executionStatus === "RECEIVED" || receipt.executionStatus === "PENDING";
  const status: ReceiptStatus = confirmed ? "confirmed" : reverted ? "reverted" : pending ? "pending" : "unknown";
  return {
    status,
    transactionHash: normalizeTransactionHash(receipt.transactionHash),
    blockNumber: receipt.blockNumber,
    finality: receipt.finalityStatus as ReceiptFinality,
    observedAt: now,
  };
}

export function markReceipt(
  session: PrivacyWalletSession,
  receipt: NormalizedReceipt | null,
  now: number,
): PrivacyWalletSession {
  assertSessionVenue(session, "privacy");
  ensureFiniteNow(now);
  const submittedHash = session.submission.transactionHash;
  if (!submittedHash) {
    throw new WalletSessionError(WALLET_SESSION_ERROR_CODE.RECEIPT_REQUIRED, "submitted_transaction_required");
  }
  if (receipt === null) {
    const pending: PrivacyWalletSession = {
      ...session,
      receipt: { status: "pending", transactionHash: submittedHash, blockNumber: null, finality: "PENDING", observedAt: now },
      error: null,
    };
    return bump(pending, now, { status: "processing" });
  }
  assertNoSecretMaterial(receipt, "privacy_receipt");
  const observedHash = normalizeTransactionHash(receipt.transactionHash);
  if (observedHash !== submittedHash) {
    throw new WalletSessionError(WALLET_SESSION_ERROR_CODE.RECEIPT_MISMATCH, "receipt_transaction_hash_mismatch");
  }
  const receiptState = receiptStateFromObservation(receipt, now);
  const next: PrivacyWalletSession = { ...session, receipt: receiptState, error: null };
  return bump(next, now, { status: statusFor(next) });
}

export function clearAuthorityState<T extends WalletSessionContract>(session: T, now: number): T {
  ensureFiniteNow(now);
  if (session.venue === "starknet") {
    const next: StarknetWalletSession = {
      ...session,
      accountAddress: null,
      chainId: null,
      environment: "UNKNOWN",
      network: unknownNetwork(session.expectedEnvironment),
      capability: unknownCapability(),
      privacyCapability: unknownCapability(),
      consent: emptyConsent(),
      submission: emptySubmission(),
      receipt: emptyReceipt(),
      status: "disconnected",
      error: null,
    };
    return bump(next, now, { status: "disconnected" }) as T;
  }
  if (session.venue === "base") {
    const next: BaseProofSession = {
      ...session,
      accountAddress: null,
      chainId: null,
      network: unknownNetwork(session.network.expectedChainId),
      capability: unknownCapability(),
      consent: emptyConsent(),
      proof: { ...EMPTY_PROOF_STATE },
      submission: emptySubmission(),
      receipt: emptyReceipt(),
      status: "disconnected",
      error: null,
    };
    return bump(next, now, { status: "disconnected" }) as T;
  }
  const next: PrivacyWalletSession = {
    ...session,
    accountAddress: null,
    chainId: null,
    environment: "UNKNOWN",
    network: unknownNetwork(session.expectedEnvironment),
    capability: unknownCapability(),
    consent: emptyConsent(),
    submission: emptySubmission(),
    receipt: emptyReceipt(),
    strk20State: null,
    proofReady: false,
    status: "disconnected",
    error: null,
  };
  return bump(next, now, { status: "disconnected" }) as T;
}

export function resetForAccountChange<T extends WalletSessionContract>(
  session: T,
  accountAddress: unknown,
  now: number,
): T {
  ensureFiniteNow(now);
  assertNoSecretMaterial({ accountAddress }, "account_change");
  // Validate the new observation even though it is intentionally not retained.
  if (session.venue === "base") normalizeEvmAddress(accountAddress);
  else normalizeStarknetAddress(accountAddress);
  return clearAuthorityState(session, now);
}

export function disconnected<T extends WalletSessionContract>(session: T, now: number): T {
  return clearAuthorityState(session, now);
}

/** The simulated/empty proof from `simulate=true` is never accepted here. */
export function assertReadyProof(callAndProof: Strk20CallAndProof): void {
  assertNoSecretMaterial(callAndProof, "privacy_proof");
  if (isEmptyProof(callAndProof.proof)) {
    throw new WalletSessionError(WALLET_SESSION_ERROR_CODE.PROOF_REQUIRED, "simulated_proof_not_submittable");
  }
}

/** Useful for adapter tests and consumers that need an explicit state label. */
export function isTerminalReceipt(status: ReceiptStatus): boolean {
  return status === "confirmed" || status === "reverted";
}

/** Error projection for adapter catches; raw provider messages never enter state. */
export function errorSession<T extends WalletSessionContract>(
  session: T,
  code: WalletSessionErrorCode,
  detail: string,
  now: number,
  status: SessionStatus = "unknown",
): T {
  ensureFiniteNow(now);
  // Provider failures invalidate every fact derived from that provider. Clear
  // first, then attach only the safe error projection; never carry an old
  // account, capability, consent, submission, receipt, or proof forward.
  const cleared = clearAuthorityState(session, now);
  const next = {
    ...cleared,
    ...(code === WALLET_SESSION_ERROR_CODE.CONSENT_DENIED
      ? { consent: { status: "denied", reason: "user_denied_consent" } }
      : {}),
    error: errorState(code, detail),
  } as T;
  return bump(next, now, { status });
}

// Keep the imported shape part of this module's public type surface for callers
// that only import state contracts.
export type { CapabilityResult, NormalizedReceipt };
export type { WalletVenue };
