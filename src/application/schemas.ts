// Transport-neutral request/response/error schemas.
// No HTTP framework imports. Every application command/query exposes
// typed Request and Response shapes; errors are stable APP_ERROR_CODE
// (see errors.ts) and include httpStatusHint for adapter mapping.
// Idempotency and expected-version are explicit at the boundary.

import type { Hex, OperationState } from "../features/prism-operations/domain/operation";
import type { PersistedOperation } from "../features/prism-operations/domain/operation-store";
import type { AppSession } from "./auth";
import type { BindingView, PublicBindingView } from "../features/prism-identity/domain/binding-disclosure";

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

// Helpers
export function ok<T>(data: T, operation?: AppSuccessResponse<T>["operation"], requestId?: string | null, watermark?: number | null): AppSuccessResponse<T> {
  return { ok: true, data, ...(operation ? { operation } : {}), ...(requestId ? { requestId } : {}), ...(watermark !== undefined ? { watermark } : {}) };
}
export function err(error: AppErrorResponse["error"], requestId?: string | null): AppErrorResponse {
  return { ok: false, error, ...(requestId ? { requestId } : {}) };
}
