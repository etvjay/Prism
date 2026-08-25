import type {
  CapabilityResult,
  NormalizedReceipt,
  Strk20Action,
} from "../../prism-strk20/domain/strk20-action-port";
import type { Strk20ActionPort } from "../../prism-strk20/adapters/wallet-strk20-action-adapter";
import type { Strk20CallAndProof, Strk20Proof } from "../../prism-strk20/domain/strk20-proof";
import type { Strk20State } from "../../prism-strk20/domain/strk20-state";
import type { ExpectedWalletEnvironment, WalletEnvironment } from "../../prism-strk20/domain/wallet-capability";
import type { WalletSessionErrorCode } from "./errors";

export type WalletVenue = "starknet" | "base" | "privacy";

/** User-visible status is derived from the more precise state dimensions below. */
export type SessionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "wrong-network"
  | "capability-unknown"
  | "consent-required"
  | "awaiting-approval"
  | "submitting"
  | "submitted"
  | "processing"
  | "receipt-confirmed"
  | "reverted"
  | "unknown"
  | "ready";

export const SESSION_STATUSES: readonly SessionStatus[] = [
  "disconnected",
  "connecting",
  "connected",
  "wrong-network",
  "capability-unknown",
  "consent-required",
  "awaiting-approval",
  "submitting",
  "submitted",
  "processing",
  "receipt-confirmed",
  "reverted",
  "unknown",
  "ready",
] as const;

export type CapabilityStatus = "unknown" | "unsupported" | "supported";
export const CAPABILITY_STATUSES: readonly CapabilityStatus[] = ["unknown", "unsupported", "supported"] as const;

export interface CapabilityState {
  readonly status: CapabilityStatus;
  /** Declared versions/specs only; never a balance, key, note, or proof payload. */
  readonly apiVersions: readonly string[];
  readonly specs: readonly string[];
  readonly supportsProofPreparation: boolean;
  readonly supportsApproval: boolean;
  readonly supportsSubmission: boolean;
  readonly reason: string | null;
}

export type NetworkStatus = "unknown" | "expected" | "mismatch";
export const NETWORK_STATUSES: readonly NetworkStatus[] = ["unknown", "expected", "mismatch"] as const;

export interface NetworkState {
  readonly status: NetworkStatus;
  readonly chainId: string | null;
  readonly expectedChainId: string;
}

export type ConsentStatus = "unknown" | "not-required" | "required" | "granted" | "denied";
export const CONSENT_STATUSES: readonly ConsentStatus[] = [
  "unknown",
  "not-required",
  "required",
  "granted",
  "denied",
] as const;

export interface ConsentState {
  readonly status: ConsentStatus;
  readonly reason: string | null;
}

export type SubmissionStatus = "idle" | "awaiting-approval" | "submitting" | "submitted" | "failed";
export const SUBMISSION_STATUSES: readonly SubmissionStatus[] = [
  "idle",
  "awaiting-approval",
  "submitting",
  "submitted",
  "failed",
] as const;

export interface SubmissionState {
  readonly status: SubmissionStatus;
  readonly transactionHash: `0x${string}` | null;
  readonly submittedAt: number | null;
}

export type ReceiptStatus = "not-requested" | "pending" | "confirmed" | "reverted" | "unknown";
export const RECEIPT_STATUSES: readonly ReceiptStatus[] = [
  "not-requested",
  "pending",
  "confirmed",
  "reverted",
  "unknown",
] as const;

export type ReceiptFinality = "ACCEPTED_ON_L2" | "ACCEPTED_ON_L1" | "RECEIVED" | "PENDING" | "UNKNOWN";

export interface ReceiptState {
  readonly status: ReceiptStatus;
  readonly transactionHash: `0x${string}` | null;
  readonly blockNumber: number | null;
  readonly finality: ReceiptFinality | null;
  readonly observedAt: number | null;
}

export interface SessionErrorState {
  readonly code: WalletSessionErrorCode;
  readonly detail: string | null;
}

export interface BaseProofState {
  readonly status: "idle" | "requested" | "signed" | "denied" | "unknown";
  /** Metadata only. The signature itself is returned to the caller and not retained. */
  readonly scheme: "personal_sign" | "eth_sign" | null;
  readonly digest: string | null;
}

interface SessionRecord {
  readonly accountAddress: string | null;
  readonly chainId: string | null;
  readonly network: NetworkState;
  readonly capability: CapabilityState;
  readonly consent: ConsentState;
  readonly submission: SubmissionState;
  readonly receipt: ReceiptState;
  readonly status: SessionStatus;
  readonly version: number;
  readonly updatedAt: number;
  readonly error: SessionErrorState | null;
}

/** Starknet Wallet API authority: account/network/API and optional STRK20 capability. */
export interface StarknetWalletSession extends SessionRecord {
  readonly kind: "starknet-wallet";
  readonly venue: "starknet";
  readonly walletName: string | null;
  readonly environment: WalletEnvironment;
  readonly expectedEnvironment: ExpectedWalletEnvironment;
  readonly privacyCapability: CapabilityState;
}

/** Base authority: EIP-1193 account/network and signMessage proof consent only. */
export interface BaseProofSession extends SessionRecord {
  readonly kind: "base-proof";
  readonly venue: "base";
  readonly proof: BaseProofState;
}

/** Privacy authority: Wallet API/STRK20 action and receipt state. */
export interface PrivacyWalletSession extends SessionRecord {
  readonly kind: "privacy-wallet";
  readonly venue: "privacy";
  readonly environment: WalletEnvironment;
  readonly expectedEnvironment: ExpectedWalletEnvironment;
  /** Reuses the STRK20 flow vocabulary; no second privacy state machine is invented here. */
  readonly strk20State: Strk20State | null;
  /** Proof material is held by the injected Wallet API adapter, never by session state. */
  readonly proofReady: boolean;
}

export type WalletSessionContract = StarknetWalletSession | BaseProofSession | PrivacyWalletSession;

export interface WalletSessionAdapter<TSession extends WalletSessionContract> {
  readonly venue: TSession["venue"];
  connect(now: number): Promise<TSession>;
  disconnect(session: TSession, now: number): Promise<TSession>;
  accountChanged(session: TSession, now: number): TSession;
}

/** Narrow adapter boundary around the existing STRK20 action port. */
export type PrivacyWalletSessionPort = Pick<
  Strk20ActionPort,
  "observeCapability" | "prepare" | "executeWithProof" | "observeReceipt"
>;

export type PrivacyPreparedAction = {
  readonly session: PrivacyWalletSession;
  readonly callAndProof: Strk20CallAndProof;
};

export type BaseSignedMessage = {
  readonly session: BaseProofSession;
  /** The signature is ephemeral output, not retained in `session`. */
  readonly signature: string;
};

export type StarknetCapabilityObservation = {
  readonly walletName?: string;
  readonly accountAddress: string;
  readonly chainId: string;
  readonly apiVersions: readonly string[];
  readonly specs: readonly string[];
};

export type PrivacyCapabilityObservation = CapabilityResult;

export type PrivacyReceiptObservation = NormalizedReceipt;

/** Keeps the proof type visible to adapter consumers without adding it to session state. */
export type PrivacyProof = Strk20Proof;
export type PrivacyAction = Strk20Action;
