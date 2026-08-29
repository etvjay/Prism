// Typed SDK request/response shapes — mirrors application schemas but transport-friendly.
// No raw felt/calldata requirement: callers provide Prism vocabulary only.

export type PrismId = string;
export type Venue = "BASE";
export type PortfolioData = import("../features/prism-portfolio/domain/types").ConnectedPortfolio;
export type PortfolioBranchData = import("../features/prism-portfolio/domain/types").PortfolioBranch;
export type PortfolioBranchState = import("../features/prism-portfolio/domain/types").PortfolioBranchState;
export type PortfolioVenue = import("../features/prism-portfolio/domain/types").PortfolioVenue;
export type PortfolioPrivacyConsent = import("../features/prism-portfolio/domain/types").PrivacyWalletConsentStatus;
export type Hex = `0x${string}`;
export type OperationState =
  | "created"
  | "awaiting_authorization"
  | "ready"
  | "submitted"
  | "processing"
  | "confirming"
  | "confirmed"
  | "indexed"
  | "reconciled"
  | "completed"
  | "failed_retryable"
  | "failed_terminal"
  | "reverted"
  | "expired"
  | "cancelled"
  | "requires_attention";

export interface SdkError {
  readonly code: string;
  readonly name: string;
  readonly category: string;
  readonly retryable: string;
  readonly userAction: string;
  readonly httpStatusHint: number;
  readonly detail?: string;
}

export interface SdkResponse<T> {
  readonly ok: boolean;
  readonly data?: T;
  readonly error?: SdkError;
  readonly requestId?: string | null;
  readonly operation?: { operationId: string; state: OperationState; version: number };
  readonly watermark?: number | null;
}

export interface IdentityData {
  readonly prismId: string;
  readonly controller: string | null;
  readonly exists: boolean;
  readonly watermark?: number | null;
}

export type BindingVisibility = "PUBLIC" | "PRIVATE";
export type BindingStatus = "ACTIVE" | "REVOKED";

export interface BindingEndpointData {
  readonly id: string;
  readonly chain: "STARKNET" | "BASE";
  readonly chainId: string;
  readonly kind: "ACCOUNT" | "STRK20_PRIVATE_CONTEXT";
  readonly address?: string;
}

export interface PublicBindingData {
  readonly bindingId: string;
  readonly prismId: string;
  readonly visibility: "PUBLIC";
  readonly status: "ACTIVE";
  readonly version: number;
  readonly endpoint: BindingEndpointData;
  readonly historicalPublic: true;
  readonly publiclyExposedAt: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** Owner/private audience response. It is never returned by the public list. */
export interface OwnerPrivateBindingData {
  readonly bindingId: string;
  readonly prismId: string;
  readonly visibility: "PRIVATE";
  readonly status: BindingStatus;
  readonly version: number;
  readonly endpoint: BindingEndpointData;
  readonly historicalPublic: boolean;
  readonly publiclyExposedAt: number | null;
  readonly hiddenAt: number | null;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly historicalPublicWarning: { readonly code: string; readonly message: string } | null;
}

export interface ResolveData {
  readonly prismId: string;
  readonly venue: string;
  readonly executionAccount: string | null;
  readonly exists: boolean;
  readonly watermark?: number | null;
}

export interface OperationData {
  readonly id: string;
  readonly kind: string;
  readonly state: OperationState;
  readonly version: number;
  readonly txHash: string | null;
  readonly errorCode: string | null;
  readonly errorDetail: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly correlationId: string | null;
  readonly reconciliationWatermark: number | null;
}

export interface ReceiptData {
  readonly receiptId: string;
  readonly operationId: string;
  readonly kind: string;
  readonly state: OperationState;
  readonly txHash: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly watermark: number | null;
  readonly errorCode: string | null;
  readonly errorDetail: string | null;
  readonly correlationId: string | null;
}

export type IntentPurpose = "payment" | "transfer" | "contract_call" | "private_action" | "other";

export interface IntentData {
  readonly intentId: string;
  readonly prismId: string;
  readonly purpose: IntentPurpose;
  readonly planHash: string;
  readonly venue: string | null;
  readonly executionAccount: string | null;
  readonly createdAt: number;
}

export interface PauseData {
  readonly pauseId: string;
  readonly intentId: string;
  readonly planHash: string;
  readonly state: string;
  readonly version: number;
  readonly reasonCodes: readonly string[];
  readonly riskLevel: string;
  readonly approvalScopeHash: string | null;
  readonly settlementOperationId: string | null;
  readonly correlationId: string | null;
  readonly requiredApprovalCount: number;
  readonly expiresAt: number | null;
  // No raw calldata/felt: callers provide only prism vocabulary (planHash etc.)
}

export interface AppSession {
  readonly sessionId: string;
  readonly userId: string;
  readonly issuedAt: number;
  readonly expiresAt?: number | null;
}
