// Provider-injected Wallet API boundary ports for M4 consumer route.
// Authority: STRK20_CONTEXT Wallet/API execution truths + wallet-api-route.md.
// Normal dapp flow uses Wallet API via starknet.js WalletAccountV6; no direct SDK.
// All I/O is injected; domain never imports starknet SDK directly.

import type { Hex } from "./receipt";

export type WalletEnvironment = "SN_MAIN" | "SN_SEPOLIA" | "UNKNOWN";

export interface CapabilityObservation {
  apiVersions: string[];
  specs: string[];
  chainId: string;
}

export interface PoolFeeObservation {
  fee: bigint;
  blockNumber: number | null;
}

export type ScreeningOutcome = "approved" | "rejected" | "unavailable";

export interface DepositObservation {
  txHash: Hex;
  executionStatus: "SUCCEEDED" | "REVERTED" | "RECEIVED";
  screening: ScreeningOutcome;
  blockNumber: number | null;
  receiptEvents?: { address: string; keys: string[] }[]; // minimal for pool check
}

export interface PrivateBalanceObservation {
  balances: { token: Hex; amount: bigint }[];
  // Consent-gated: wallet must have prompted user
  consent: "granted" | "denied" | "required";
}

export interface TransferObservation {
  txHash: Hex;
  executionStatus: "SUCCEEDED" | "REVERTED" | "RECEIVED";
  blockNumber: number | null;
}

/**
 * Narrow, provider-injected Wallet API port for normal consumer dapp.
 * Each method corresponds to a WalletAccountV6 action or a pool read.
 * Never exposes viewing keys, notes, or proofs to Prism app code.
 */
export interface Strk20WalletPort {
  // Capability detection — must be implemented via supportedWalletApi/supportedSpecs only
  observeCapability(): Promise<CapabilityObservation>;
  // Environment — via walletV6.requestChainId or account.provider.getChainId
  observeChainId(): Promise<string>;
  // Registration: wallet handles it; dapp only checks if registration is required
  isRegistered(): Promise<boolean>;
  // Fee: read from pool get_fee_amount via wallet or RPC reader (injected)
  observeFee(): Promise<PoolFeeObservation>;
  // ERC-20 approve step (first wallet prompt)
  requestApproval(params: { token: Hex; amount: bigint; spender: Hex }): Promise<Hex>;
  // Shield / deposit step (second prompt, screened)
  requestShield(params: { token: Hex; amount: bigint; quotedFee: bigint }): Promise<DepositObservation>;
  // Private balance — consent-gated; must not be called for feature detection
  requestPrivateBalances(params: { tokens: Hex[]; requireConsent: true }): Promise<PrivateBalanceObservation>;
  // Private transfer — wallet-mediated, relayer-submitted
  requestPrivateTransfer(params: { token: Hex; amount: bigint; recipient: Hex; quotedFee: bigint }): Promise<TransferObservation>;
  // Observe chain receipt for relayer non-attribution checks
  observeReceipt(txHash: Hex): Promise<DepositObservation | TransferObservation | null>;
}

/**
 * Transport-neutral Pool fee reader (alternative narrow port when wallet does not expose fee).
 */
export interface PoolFeeReader {
  getFeeAmount(): Promise<PoolFeeObservation>;
}

/**
 * Totally forbidden port — should never be implemented in consumer path.
 * Exists only to guard that SDK route is not wired accidentally.
 */
export interface ForbiddenSdkPort {
  // Any method that would require viewing key in clear is forbidden
  getViewingKey(): never;
  storeViewingKey(): never;
}
