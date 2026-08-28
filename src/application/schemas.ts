// Transport-neutral request/response/error schemas.
// No HTTP framework imports. Every application command/query exposes
// typed Request and Response shapes; errors are stable APP_ERROR_CODE
// (see errors.ts) and include httpStatusHint for adapter mapping.
// Idempotency and expected-version are explicit at the boundary.

import type { Hex, OperationState } from "../features/prism-operations/domain/operation";
import type { PersistedOperation } from "../features/prism-operations/domain/operation-store";
import type { AppSession } from "./auth";
import type { BindingView, PublicBindingView } from "../features/prism-identity/domain/binding-disclosure";
import type { AliasLookupResult } from "../features/prism-resolution/application/alias-lookup-service";
import type { ResolutionContinuityResult } from "../features/prism-resolution/application/continuity-service";
import type { ResolutionDiff } from "../features/prism-resolution/domain/risks";
import type { ResolutionSnapshot } from "../features/prism-resolution/domain/snapshot";
import type { ConnectedPortfolio, PrivacyWalletConsent } from "../features/prism-portfolio/domain";
import type {
  ConsentStatus,
  PrivacyActionExecution,
  PrivacyActionKind,
  PrivacyActionPhase,
  PrivacyActionState,
  ProofStatus,
  RegistrationStatus,
} from "../features/prism-strk20/application/privacy-action-service";

// ---------------------------------------------------------------------------
// Envelope primitives
// ---------------------------------------------------------------------------

/** Common headers carried with every app request — neutral to HTTP/gRPC/queue. */
export interface AppRequestHeaders {
  /** Client-generated request id; server echoes for tracing. */
  readonly requestId?: string | null;
  /** Idempotency key: stable key for exactly-once create semantics (CMD-7-01, bind, revoke). */
  readonly idempotencyKey?: string | null;
  /** For mutate transitions: optimistic CAS version guard (SYSTEM_FOUNDRY §18). */
  readonly expectedVersion?: number | null;
  /** Correlation id for observability chain (AUTHORITY_MATRIX §5). */
  readonly correlationId?: string | null;
}

/** Transport-neutral envelope for a command request. */
export interface AppCommandRequest<TPayload> {
  readonly headers: AppRequestHeaders;
  /** App-session authentication — distinct from execution authority (CON-PRISM-006). */
  readonly session: AppSession;
  readonly payload: TPayload;
}

/** Success response envelope — carries operation linkage where chain-touching. */
export interface AppSuccessResponse<TData> {
  readonly ok: true;
  readonly data: TData;
  /** Present when the command is chain-touching: persisted operation id. */
  readonly operation?: {
    readonly operationId: string;
    readonly state: OperationState;
    readonly version: number;
  };
  readonly requestId?: string | null;
  readonly watermark?: number | null;
}

/** Error response envelope — stable ERR codes only. */
export interface AppErrorResponse {
  readonly ok: false;
  readonly error: {
    readonly code: string;
    readonly name: string;
    readonly category: string;
    readonly retryable: string;
    readonly userAction: string;
    readonly httpStatusHint: number;
    readonly detail?: string;
  };
  readonly requestId?: string | null;
}

export type AppResponse<T> = AppSuccessResponse<T> | AppErrorResponse;

// ---------------------------------------------------------------------------
// Command payloads — each maps to a System artifact (see INTEGRATION_AUDIT.md)
// ---------------------------------------------------------------------------

export interface IssueChallengePayload {
  readonly prismId: string;
  readonly venue: string;
  readonly executionAccount: string;
  readonly ttlSeconds?: number;
}
export interface IssueChallengeData {
  readonly challengeId: Hex;
  readonly digest: Hex;
  readonly messageToSign: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly domain: string;
  readonly venue: string;
  readonly executionAccount: string;
  readonly prismId: string;
  readonly nonce: Hex;
  readonly chainId: number;
  readonly schemaVersion: number;
}

export interface SubmitProofPayload {
  readonly challengeId: Hex;
  /** Client-echoed challenge fields presented with the signature (ERR-012 gate). */
  readonly presented: {
    readonly domain: string;
    readonly venue: string;
    readonly executionAccount: string;
    readonly prismId: string;
    readonly chainId: number;
    readonly schemaVersion: number;
    readonly nonce: Hex;
    readonly expiresAt: number;
  };
  readonly signature: Hex;
}
export interface SubmitProofData {
  readonly status: "verified";
  readonly signatureClass: string;
  readonly digest: Hex;
  readonly verifiedAt: number;
}

// Chain-touching: operation_id returned BEFORE eventual chain submission.
export interface CreateIdentityPayload {
  /** Idempotency key handled at boundary; duplicated key+same fingerprint is benign (ERR-023 conflict on mismatch). */
  readonly kind?: string;
  /** Starknet controller that will own the Prism ID — execution authority, not session. */
  readonly controllerAddress?: string | null;
}
export interface CreateIdentityData {
  readonly operationId: string;
  readonly state: OperationState;
  readonly prismId?: string | null; // filled only after chain confirmation; never inferred pre-chain
}

export interface BindPayload {
  readonly prismId: string;
  readonly venue: string;
  readonly executionAccount: string;
  readonly proofDigest: Hex;
  /** Challenge record reference; legacy clients may omit it and are resolved by digest. */
  readonly challengeId?: Hex;
  /** Optional echoed challenge fields; when present they must match the stored record exactly. */
  readonly chainId?: number;
  readonly expiresAt?: number;
  /** Starknet controller address that signs the binding tx — must equal identity.controller (ERR-004). */
  readonly controllerAddress: string;
}
export interface BindData {
  readonly operationId: string;
  readonly state: OperationState;
}

export interface RevokePayload {
  readonly prismId: string;
  readonly venue: string;
  readonly executionAccount: string;
  readonly controllerAddress: string;
}
export interface RevokeData {
  readonly operationId: string;
  readonly state: OperationState;
}

// ---------------------------------------------------------------------------
// Query payloads — read-only, never mutate canonical state
// ---------------------------------------------------------------------------

export interface GetIdentityQuery {
  readonly prismId: string;
}
export interface GetIdentityData {
  readonly prismId: string;
  readonly controller: string | null;
  readonly exists: boolean;
  readonly watermark?: number | null;
}

export interface ResolveQuery {
  readonly prismId: string;
  readonly venue: string;
}
export interface ResolveData {
  readonly prismId: string;
  readonly venue: string;
  /** Active destination or null = NO_ACTIVE_DESTINATION (INV-SYS-007). */
  readonly executionAccount: string | null;
  readonly exists: boolean;
  readonly watermark?: number | null;
}

// ---------------------------------------------------------------------------
// Provider-neutral alias and resolution-continuity queries
// ---------------------------------------------------------------------------

export interface AliasLookupQuery {
  readonly provider: string;
  readonly value: string;
}
export type AliasLookupData = AliasLookupResult;

export type ResolutionContinuityIdentifier =
  | { readonly kind: "prism-id"; readonly prismId: string }
  | { readonly kind: "external-alias"; readonly alias: { readonly provider: string; readonly value: string } };

export interface ResolutionContinuityQuery {
  readonly identifier: ResolutionContinuityIdentifier;
  readonly venue: string;
  readonly purpose?: string;
}

/** Transport projection renames internal snapshot fields to previous/current. */
export type ResolutionContinuityData = Omit<ResolutionContinuityResult, "previousSnapshot" | "snapshot" | "diff"> & {
  readonly previous: ResolutionSnapshot | null;
  readonly current: ResolutionSnapshot | null;
  readonly diff: ResolutionDiff | null;
};

// ---------------------------------------------------------------------------
// Binding disclosure queries — audience is explicit at the route boundary.
// ---------------------------------------------------------------------------

export interface ListPublicBindingsQuery {
  readonly prismId: string;
}

export interface ListOwnerPrivateBindingsPayload {
  readonly prismId: string;
}

export type ListPublicBindingsData = readonly PublicBindingView[];
export type ListOwnerPrivateBindingsData = readonly BindingView[];

// ---------------------------------------------------------------------------
// Operation query
// ---------------------------------------------------------------------------

export interface GetOperationQuery {
  readonly operationId: string;
}
export type GetOperationData = PersistedOperation | null;

// ---------------------------------------------------------------------------
// Connected portfolio read — derived, source/freshness-bearing projection
// ---------------------------------------------------------------------------

export interface PortfolioQuery {
  readonly prismId: string;
  /** Private STRK20 balances are requested only with explicit wallet consent. */
  readonly privacyWalletConsent?: PrivacyWalletConsent | null;
}

export type PortfolioData = ConnectedPortfolio;

// ---------------------------------------------------------------------------
// STRK20 action / privacy-receipt transport
// ---------------------------------------------------------------------------

/**
 * Transport operation for the wallet-mediated STRK20 lifecycle. Raw actions,
 * proofs, calldata, notes, keys, and provider responses are intentionally not
 * part of this schema. Decimal quantities remain strings at this boundary.
 */
export type Strk20ActionTransportOperation = "create" | "prepare" | "submit" | "observe_receipt";

export interface Strk20ActionPayload {
  readonly actionId: string;
  readonly prismId?: string | null;
  readonly kind: PrivacyActionKind;
  readonly execution?: PrivacyActionExecution;
  readonly walletSessionRef?: string | null;
  readonly expectedChainId?: string | null;
  readonly quotedFee?: string | null;
  readonly requireConsent?: boolean;
  /** Wallet-mediated action inputs; never a proof/call/calldata payload. */
  readonly token?: string | null;
  readonly amount?: string | null;
  readonly recipient?: string | null;
  readonly spender?: string | null;
  readonly consentTokens?: readonly string[];
  /** The body form is accepted for SDK callers; HTTP headers remain preferred. */
  readonly idempotencyKey?: string | null;
  readonly operation?: Strk20ActionTransportOperation;
}

/** Frontend lifecycle vocabulary. Internal M4/M5 states remain private to the adapter. */
export type Strk20LifecycleState =
  | "consent-required"
  | "awaiting-approval"
  | "submitted"
  | "processing"
  | "receipt-confirmed"
  | "reverted"
  | "unknown"
  | "unavailable"
  | "requires-attention";

export interface Strk20CapabilityData {
  readonly capable: boolean;
  readonly status: "supported" | "unsupported" | "unknown";
  readonly apiVersions: readonly string[];
  readonly specs: readonly string[];
  readonly chainId: string;
  readonly environment: "SN_MAIN" | "SN_SEPOLIA" | "UNKNOWN";
  readonly mismatch: boolean;
  readonly expected: "SN_MAIN" | "SN_SEPOLIA";
}

export interface Strk20FeeData {
  readonly fee: string;
  readonly blockNumber: number | null;
  readonly quotedFee: string;
}

export interface Strk20ReceiptData {
  readonly transactionHash: string;
  readonly executionStatus: "SUCCEEDED" | "REVERTED" | "RECEIVED" | "PENDING" | "UNKNOWN";
  readonly finalityStatus: "ACCEPTED_ON_L2" | "ACCEPTED_ON_L1" | "RECEIVED" | "PENDING" | "UNKNOWN";
  readonly blockNumber: number | null;
  readonly poolEventFound: boolean;
}

/** JSON-safe action lifecycle view. There is deliberately no proof/call body. */
export interface Strk20ActionData {
  readonly id: string;
  readonly actionId: string;
  readonly kind: PrivacyActionKind;
  readonly execution: PrivacyActionExecution;
  /** Frontend state; the internal M4/M5 state is not a completion claim. */
  readonly state: Strk20LifecycleState;
  /** Internal state vocabulary retained only for diagnostics/integration. */
  readonly sourceState: PrivacyActionState;
  readonly phase: PrivacyActionPhase;
  readonly version: number;
  readonly updatedAt: number;
  readonly capability: Strk20CapabilityData | null;
  readonly registration: { readonly status: RegistrationStatus };
  readonly fee: Strk20FeeData | null;
  readonly consent: { readonly status: ConsentStatus };
  readonly proof: { readonly status: ProofStatus; readonly call: null };
  readonly submissionAttempted: boolean;
  readonly approvalTransactionHash: string | null;
  readonly transactionHash: string | null;
  readonly receipt: Strk20ReceiptData | null;
  readonly terminal: boolean;
  readonly errorCode: string | null;
  readonly errorDetail: string | null;
}

export interface GetStrk20ActionQuery {
  readonly actionId: string;
}

export type PrivacyReceiptMechanism =
  | "NONE"
  | "PRISM_DISCLOSURE_CONTROL"
  | "STRK20_PRIVATE_TRANSFER"
  | "STRK20_PRIVATE_INVOKE"
  | "STRK20_SHADOW_ACCOUNT";

export type PrivacyReceiptObservationStatus = "UNOBSERVED" | "PENDING" | "OBSERVED" | "UNAVAILABLE";
export type PrivacyReceiptEvidenceSource = "NONE" | "WALLET_DECLARED_API" | "PROVIDER_RECEIPT" | "CANONICAL_CHAIN_READBACK";

/** Policy-filtered receipt projection; raw chain/provider material is absent. */
export interface PrivacyReceiptData {
  readonly receiptId: string;
  readonly actionId: string;
  readonly mechanism: PrivacyReceiptMechanism;
  readonly observationStatus: PrivacyReceiptObservationStatus;
  readonly evidenceSource: PrivacyReceiptEvidenceSource;
  readonly protectedProperties: readonly string[];
  readonly publicProperties: readonly string[];
  readonly limitations: readonly string[];
  readonly transactionHash?: string;
  readonly blockNumber?: number;
}

export interface GetPrivacyReceiptQuery {
  readonly receiptId: string;
}

// Helpers
export function ok<T>(data: T, operation?: AppSuccessResponse<T>["operation"], requestId?: string | null, watermark?: number | null): AppSuccessResponse<T> {
  return { ok: true, data, ...(operation ? { operation } : {}), ...(requestId ? { requestId } : {}), ...(watermark !== undefined ? { watermark } : {}) };
}
export function err(error: AppErrorResponse["error"], requestId?: string | null): AppErrorResponse {
  return { ok: false, error, ...(requestId ? { requestId } : {}) };
}
