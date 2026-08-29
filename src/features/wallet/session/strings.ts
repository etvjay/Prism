import type { CapabilitySlot, SessionUiState } from "./selectors";

export const SESSION_STRINGS = {
  eyebrow: "Wallet session",
  title: "Verify a Starknet wallet session.",
  sessionState: "Session state",
  wallet: "Wallet",
  account: "Account",
  network: "Network",
  receipt: "Receipt",
  connect: "Connect",
  connectWallet: "Connect wallet",
  discoveredWallets: "Discovered Starknet wallets",
  checkingCapabilities: "Capabilities are being checked",
  observedCapabilities: "Observed wallet capabilities",
  unknownNetwork: "Unknown network",
  detecting: "Detecting…",
  connecting: "Connecting…",
  notSupported: "Not supported",
  continue: "Continue",
  reviewSign: "Review & sign",
  preparingProof: "Preparing proof…",
  awaitingApproval: "Awaiting approval…",
  processing: "Processing…",
  viewExplorer: "View on explorer",
  tryAgain: "Try again",
  reconnect: "Reconnect",
  disconnect: "Disconnect",
  confirmDisconnect: "Confirm disconnect",
  copyAddress: "Copy address",
  viewFullAddress: "View full address",
  hideFullAddress: "Hide full address",
  copied: "Copied",
  noWallet: "No Starknet wallet was found.",
  walletRpcUnavailable: "Wallet connection is unavailable until the Starknet RPC is configured.",
  connectionFailed: "The wallet state could not be read. Reconnect to refresh.",
  networkSwitchFailed: "The wallet did not switch networks.",
  consentDenied: "Connection consent was not granted.",
} as const;

export const SESSION_STATE_LABELS: Record<SessionUiState, string> = {
  disconnected: "Disconnected",
  discovering: "Discovering",
  connecting: "Connecting",
  "capability-unknown": "Capability unknown",
  unsupported: "Unsupported",
  "wrong-network": "Wrong network",
  ready: "Ready",
  "consent-required": "Consent required",
  "proof-preparing": "Proof preparing",
  "awaiting-approval": "Awaiting approval",
  submitted: "Submitted",
  processing: "Processing",
  "receipt-confirmed": "Receipt confirmed",
  reverted: "Reverted",
  unknown: "Unknown",
};

export const SESSION_STATE_GLYPHS: Record<SessionUiState, string> = {
  disconnected: "?",
  discovering: "?",
  connecting: "?",
  "capability-unknown": "?",
  unsupported: "!",
  "wrong-network": "!",
  ready: "OK",
  "consent-required": "!",
  "proof-preparing": "?",
  "awaiting-approval": "?",
  submitted: "?",
  processing: "?",
  "receipt-confirmed": "✓",
  reverted: "!",
  unknown: "?",
};

export function statusLine(
  state: SessionUiState,
  facts: {
    readonly environment: string;
    readonly chainId: string | null;
    readonly expectedEnvironment: string;
    readonly capabilitySummary: string;
    readonly blockNumber: number | null;
    readonly reason: string | null;
  },
): string {
  switch (state) {
    case "disconnected":
      return "No wallet connected.";
    case "discovering":
      return "Looking for a Starknet wallet.";
    case "connecting":
      return "Approve the connection in your wallet.";
    case "capability-unknown":
      return "Connected. Checking capabilities…";
    case "unsupported":
      return "This wallet does not expose the capabilities this app needs.";
    case "wrong-network":
      return `Connected on ${facts.environment}. This app runs on ${facts.expectedEnvironment}.`;
    case "ready":
      return `Wallet ready. ${facts.capabilitySummary || "Required capabilities observed."}`;
    case "consent-required":
      return "Sign the session consent to continue.";
    case "proof-preparing":
      return "Building the zero-knowledge proof in your wallet.";
    case "awaiting-approval":
      return "Approve the proof submission in your wallet.";
    case "submitted":
      return "Proof submitted. Waiting for confirmation.";
    case "processing":
      return "Confirming on-chain.";
    case "receipt-confirmed":
      return facts.blockNumber === null ? "Receipt confirmed." : `Confirmed in block ${facts.blockNumber}.`;
    case "reverted":
      return facts.reason ? `Transaction reverted: ${facts.reason}.` : "Transaction reverted.";
    case "unknown":
      return "Wallet state is unclear. Reconnect to refresh.";
    default:
      return "Wallet state is unclear. Reconnect to refresh.";
  }
}

export function ctaLabel(state: SessionUiState, expectedEnvironment: string): string {
  switch (state) {
    case "discovering":
      return SESSION_STRINGS.detecting;
    case "connecting":
      return SESSION_STRINGS.connecting;
    case "unsupported":
      return SESSION_STRINGS.notSupported;
    case "wrong-network":
      return `Switch to ${expectedEnvironment}`;
    case "ready":
    case "submitted":
    case "receipt-confirmed":
      return SESSION_STRINGS.continue;
    case "consent-required":
      return SESSION_STRINGS.reviewSign;
    case "proof-preparing":
      return SESSION_STRINGS.preparingProof;
    case "awaiting-approval":
      return SESSION_STRINGS.awaitingApproval;
    case "processing":
      return SESSION_STRINGS.processing;
    case "reverted":
      return SESSION_STRINGS.tryAgain;
    case "unknown":
      return SESSION_STRINGS.reconnect;
    case "disconnected":
    case "capability-unknown":
    default:
      return SESSION_STRINGS.connectWallet;
  }
}

export function capabilitySummary(capabilities: readonly CapabilitySlot[]): string {
  return capabilities
    .filter((capability) => capability.status === "supported")
    .map((capability) => capability.label)
    .join(", ");
}

export function capabilityGlyph(status: CapabilitySlot["status"]): string {
  if (status === "supported") return "OK";
  if (status === "unsupported") return "!";
  return "?";
}
