import type {
  CapabilityStatus,
  PrivacyWalletSession,
  ReceiptStatus,
  StarknetWalletSession,
} from "./types";
import type { SessionReducerState } from "./reducer";

export const SESSION_UI_STATES = [
  "disconnected",
  "discovering",
  "connecting",
  "capability-unknown",
  "unsupported",
  "wrong-network",
  "ready",
  "consent-required",
  "proof-preparing",
  "awaiting-approval",
  "submitted",
  "processing",
  "receipt-confirmed",
  "reverted",
  "unknown",
] as const;

export type SessionUiState = (typeof SESSION_UI_STATES)[number];

export interface CapabilitySlot {
  readonly id: "supportedWalletApi" | "supportedSpecs" | "strk20";
  readonly label: "supportedWalletApi" | "supportedSpecs" | "strk20";
  readonly status: CapabilityStatus;
}

export interface ReceiptProjection {
  readonly status: Extract<ReceiptStatus, "pending" | "confirmed" | "reverted">;
  readonly transactionHash: `0x${string}`;
  readonly blockNumber: number | null;
  readonly reason: string | null;
}

export interface SessionSnapshot {
  readonly state: SessionUiState;
  readonly session: StarknetWalletSession;
  readonly operation: PrivacyWalletSession | null;
  readonly capabilities: readonly CapabilitySlot[];
  readonly receipt: ReceiptProjection | null;
}

function sameAccount(left: string | null, right: string | null): boolean {
  return left !== null && right !== null && left.toLowerCase() === right.toLowerCase();
}

function selectOperationState(
  operation: PrivacyWalletSession | null,
  accountAddress: string | null,
): SessionUiState | null {
  if (!operation || !sameAccount(operation.accountAddress, accountAddress)) return null;
  if (operation.error !== null && operation.error.code !== "CONSENT_DENIED") return "unknown";
  if (operation.consent.status === "required" || operation.consent.status === "denied") return "consent-required";
  if (operation.strk20State === "proving" && !operation.proofReady) return "proof-preparing";
  if (operation.receipt.status === "confirmed") return "receipt-confirmed";
  if (operation.receipt.status === "reverted") return "reverted";
  if (operation.receipt.status === "unknown") return "unknown";
  if (operation.submission.status === "awaiting-approval" || operation.submission.status === "submitting") {
    return "awaiting-approval";
  }
  if (operation.submission.status === "submitted") {
    if (operation.receipt.status === "not-requested") return "submitted";
    if (operation.receipt.status === "pending") return "processing";
  }
  if (operation.status === "awaiting-approval") return "awaiting-approval";
  if (operation.status === "processing" && operation.submission.transactionHash !== null) return "processing";
  if (operation.status === "receipt-confirmed") return "receipt-confirmed";
  if (operation.status === "reverted") return "reverted";
  if (operation.status === "unknown") return "unknown";
  return null;
}

export function selectSessionState(state: SessionReducerState): SessionUiState {
  if (state.phase === "discovering") return "discovering";
  if (state.phase === "connecting") return "connecting";
  if (state.phase === "refreshing") {
    return state.session.accountAddress === null ? "unknown" : "capability-unknown";
  }

  const operationState = selectOperationState(state.operation, state.session.accountAddress);
  if (operationState !== null) return operationState;

  switch (state.session.status) {
    case "disconnected":
      return "disconnected";
    case "connecting":
      return "connecting";
    case "wrong-network":
      return "wrong-network";
    case "capability-unknown":
      return "capability-unknown";
    case "consent-required":
      return "consent-required";
    case "awaiting-approval":
      return "awaiting-approval";
    case "submitting":
      return "awaiting-approval";
    case "submitted":
      return state.session.submission.transactionHash === null ? "unknown" : "submitted";
    case "processing":
      return state.session.submission.transactionHash === null ? "unknown" : "processing";
    case "receipt-confirmed":
      return "receipt-confirmed";
    case "reverted":
      return "reverted";
    case "unknown":
      return "unknown";
    case "connected":
      if (state.session.privacyCapability.status === "unknown") return "capability-unknown";
      if (state.session.privacyCapability.status === "unsupported") return "unsupported";
      return "ready";
    case "ready":
      if (state.session.privacyCapability.status === "unknown") return "capability-unknown";
      if (state.session.privacyCapability.status === "unsupported") return "unsupported";
      return "ready";
    default:
      return "unknown";
  }
}

export function selectCapabilities(session: StarknetWalletSession): readonly CapabilitySlot[] {
  if (session.accountAddress === null || session.privacyCapability.status === "unknown") return [];
  return [
    {
      id: "supportedWalletApi",
      label: "supportedWalletApi",
      status: session.capability.apiVersions.length > 0 ? "supported" : "unknown",
    },
    {
      id: "supportedSpecs",
      label: "supportedSpecs",
      status: session.capability.specs.length > 0 ? "supported" : "unknown",
    },
    {
      id: "strk20",
      label: "strk20",
      status: session.privacyCapability.status,
    },
  ];
}

export function selectReceipt(operation: PrivacyWalletSession | null): ReceiptProjection | null {
  if (!operation) return null;
  const transactionHash = operation.receipt.transactionHash ?? operation.submission.transactionHash;
  if (transactionHash === null) return null;
  let status: ReceiptProjection["status"] | null = null;
  if (operation.receipt.status === "confirmed") status = "confirmed";
  else if (operation.receipt.status === "reverted") status = "reverted";
  else if (operation.receipt.status === "pending" || operation.submission.status === "submitted") status = "pending";
  if (status === null) return null;
  return {
    status,
    transactionHash,
    blockNumber: operation.receipt.blockNumber,
    reason: operation.error?.detail ?? null,
  };
}

export function selectSessionSnapshot(state: SessionReducerState): SessionSnapshot {
  return {
    state: selectSessionState(state),
    session: state.session,
    operation: state.operation,
    capabilities: selectCapabilities(state.session),
    receipt: selectReceipt(state.operation),
  };
}

export function formatObservedAddress(address: string | null): string | null {
  if (address === null || !/^0x[0-9a-fA-F]+$/.test(address)) return null;
  const normalized = address.toLowerCase();
  if (normalized.length <= 12) return normalized;
  return `${normalized.slice(0, 6)}…${normalized.slice(-4)}`;
}

export function formatObservedHash(hash: string): string {
  const normalized = hash.toLowerCase();
  if (normalized.length <= 12) return normalized;
  return `${normalized.slice(0, 6)}…${normalized.slice(-4)}`;
}

export function environmentLabel(environment: StarknetWalletSession["environment"]): string {
  if (environment === "SN_MAIN") return "Starknet Mainnet";
  if (environment === "SN_SEPOLIA") return "Starknet Sepolia";
  return "Unknown network";
}
