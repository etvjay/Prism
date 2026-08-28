// Domain boundary for Prism binding disclosure.
//
// A stored binding is deliberately discriminated by visibility:
// PUBLIC rows contain a public endpoint and no protected envelope; PRIVATE rows
// contain an opaque protected envelope and no endpoint plaintext. This module
// does not generate keys, encrypt, recover keys, or publish chain state.

import type { PrismId as IdentityPrismId } from "./identifiers";
import {
  PERSISTED_V0_BINDING_LIFECYCLE,
  PERSISTED_V0_BINDING_VISIBILITIES,
  type BindingLifecycle,
  type BindingVisibility as DomainBindingVisibility,
} from "../../prism-bindings/domain/types";

export type PrismId = IdentityPrismId;

export const BINDING_DISCLOSURE_SCHEMA_VERSION = 1;

/**
 * The higher-level binding model has three disclosure modes and three
 * lifecycles. The durable v0 table is intentionally narrower: it can only
 * represent a persistent PUBLIC or PRIVATE current projection. Keeping this
 * declaration next to the storage types makes the narrowing explicit instead
 * of allowing callers to silently coerce SELECTIVE/session state into v0.
 */
export const V0_PERSISTED_BINDING_VISIBILITIES = PERSISTED_V0_BINDING_VISIBILITIES;
export type V0PersistedBindingVisibility = (typeof V0_PERSISTED_BINDING_VISIBILITIES)[number];
export const V0_PERSISTED_BINDING_LIFECYCLE = PERSISTED_V0_BINDING_LIFECYCLE;
export type V0PersistedBindingLifecycle = typeof V0_PERSISTED_BINDING_LIFECYCLE;

export interface V0BindingPersistenceInput {
  readonly visibility: DomainBindingVisibility;
  readonly lifecycle: BindingLifecycle;
}

export type BindingId = string;
export type BindingVisibility = "PUBLIC" | "PRIVATE";
export type BindingStatus = "ACTIVE" | "REVOKED";
export type BindingChain = "STARKNET" | "BASE";
export type BindingEndpointKind = "ACCOUNT" | "STRK20_PRIVATE_CONTEXT";

export interface ExecutionEndpoint {
  readonly id: string;
  readonly chain: BindingChain;
  readonly chainId: string;
  readonly kind: BindingEndpointKind;
  /** Required for ordinary accounts; deliberately absent for context endpoints. */
  readonly address?: string;
}

/** Evidence supplied by an external key-management/recovery provider. */
export interface ProtectionEvidence {
  readonly encryptionAtRest: "PROVEN";
  readonly keyOwnership: "PROVEN";
  readonly recovery: "PROVEN";
  /** Opaque provider reference; never a key or credential. */
  readonly keyRef: string;
  readonly algorithm: string;
  readonly schemaVersion: number;
}

/** What the durable store is allowed to persist for a PRIVATE binding. */
export interface ProtectedEndpoint {
  readonly ciphertext: string;
  readonly evidence: ProtectionEvidence;
}

export interface StoredBindingBase {
  readonly schemaVersion: number;
  readonly bindingId: BindingId;
  readonly prismId: PrismId;
  readonly status: BindingStatus;
  readonly version: number;
  /** True once PUBLIC, and never allowed to transition back to false. */
  readonly historicalPublic: boolean;
  readonly publiclyExposedAt: number | null;
  /** Time at which future Prism publication was hidden; not a history eraser. */
  readonly hiddenAt: number | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface PublicStoredBinding extends StoredBindingBase {
  readonly visibility: "PUBLIC";
  readonly endpoint: ExecutionEndpoint;
  readonly protectedEndpoint: null;
}

export interface PrivateStoredBinding extends StoredBindingBase {
  readonly visibility: "PRIVATE";
  readonly endpoint: null;
  readonly protectedEndpoint: ProtectedEndpoint;
}

export type StoredBinding = PublicStoredBinding | PrivateStoredBinding;

export interface HistoricalPublicWarning {
  readonly code: "HISTORICAL_PUBLIC_LINKAGE";
  readonly message: string;
}

/** Owner-facing view. Protected ciphertext and key metadata never cross it. */
export interface BindingView {
  readonly bindingId: BindingId;
  readonly prismId: PrismId;
  readonly visibility: BindingVisibility;
  readonly status: BindingStatus;
  readonly version: number;
  readonly endpoint: ExecutionEndpoint | null;
  readonly historicalPublic: boolean;
  readonly publiclyExposedAt: number | null;
  readonly hiddenAt: number | null;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly historicalPublicWarning: HistoricalPublicWarning | null;
}

/** Public resolution view. It has no PRIVATE variant by construction. */
export interface PublicBindingView {
  readonly bindingId: BindingId;
  readonly prismId: PrismId;
  readonly visibility: "PUBLIC";
  readonly status: "ACTIVE";
  readonly version: number;
  readonly endpoint: ExecutionEndpoint;
  readonly historicalPublic: true;
  readonly publiclyExposedAt: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/**
 * Future chain/publication adapters may depend on this type, but cannot accept
 * a PRIVATE record by construction. This slice intentionally does not wire a
 * publisher implementation.
 */
export type PublicBindingPublication = PublicBindingView;

export interface PublicBindingPublisher {
  publish(input: PublicBindingPublication): Promise<void>;
  revoke(input: { bindingId: BindingId; prismId: PrismId }): Promise<void>;
}

export interface BindingOwnerActor {
  readonly actorId: string;
  /** Opaque authorization context consumed only by the injected authorizer. */
  readonly authorizationContext?: unknown;
}

export type BindingOwnerOperation = "CREATE" | "READ" | "MAKE_PUBLIC" | "HIDE_PUBLIC" | "REVOKE";

export interface BindingOwnerAuthorizationPort {
  /** The service never infers ownership from actorId; this port is authoritative. */
  authorize(input: {
    prismId: PrismId;
    actor: BindingOwnerActor;
    operation: BindingOwnerOperation;
  }): Promise<{ authorized: boolean }>;
}

export type ProtectionReadiness =
  | { readonly status: "PROVEN"; readonly evidence: ProtectionEvidence }
  | { readonly status: "BLOCKED"; readonly reason: string };

/**
 * Typed key-management boundary. Implementations live outside this slice.
 * A provider must prove encryption at rest, key ownership, and recovery before
 * a private binding can be created, hidden, published, or read by an owner.
 */
export interface PrivateBindingProtectionPort {
  getReadiness(input: { prismId: PrismId; actor: BindingOwnerActor }): Promise<ProtectionReadiness>;
  protect(input: { bindingId: BindingId; prismId: PrismId; endpoint: ExecutionEndpoint }): Promise<ProtectedEndpoint>;
  reveal(input: {
    bindingId: BindingId;
    prismId: PrismId;
    protectedEndpoint: ProtectedEndpoint;
  }): Promise<{ endpoint: ExecutionEndpoint; evidence: ProtectionEvidence }>;
}

export interface BindingCompareAndSetInput {
  readonly bindingId: BindingId;
  readonly prismId: PrismId;
  readonly expectedVersion: number;
  readonly expectedVisibility: BindingVisibility;
  readonly expectedStatus: BindingStatus;
  /** Must be the same binding with version expectedVersion + 1. */
  readonly next: StoredBinding;
}

/** Durable store boundary. PostgreSQL is the production target. */
export interface BindingDisclosureStore {
  put(record: StoredBinding): Promise<void>;
  getById(bindingId: BindingId): Promise<StoredBinding | undefined>;
  listForIdentity(prismId: PrismId): Promise<readonly StoredBinding[]>;
  /** Returns only ACTIVE PUBLIC records; never returns private rows. */
  listPublicForIdentity(prismId: PrismId): Promise<readonly PublicStoredBinding[]>;
  /** Atomic version/visibility/status compare-and-set. */
  compareAndSet(input: BindingCompareAndSetInput): Promise<boolean>;
  close?(): Promise<void>;
  migrate?(): Promise<void>;
}

export const BINDING_ERROR_CODE = {
  INVALID_BINDING: "INVALID_BINDING",
  DUPLICATE_BINDING_ID: "DUPLICATE_BINDING_ID",
  BINDING_NOT_FOUND: "BINDING_NOT_FOUND",
  BINDING_REVOKED: "BINDING_REVOKED",
  NOT_PUBLIC: "NOT_PUBLIC",
  NOT_PRIVATE: "NOT_PRIVATE",
  OWNER_AUTHORIZATION_REQUIRED: "OWNER_AUTHORIZATION_REQUIRED",
  OWNER_NOT_AUTHORIZED: "OWNER_NOT_AUTHORIZED",
  OWNER_AUTHORIZATION_UNAVAILABLE: "OWNER_AUTHORIZATION_UNAVAILABLE",
  BLOCKED_BY_KEY_MANAGEMENT: "BLOCKED_BY_KEY_MANAGEMENT",
  SELECTIVE_UNSUPPORTED: "SELECTIVE_UNSUPPORTED",
  LIFECYCLE_UNSUPPORTED: "LIFECYCLE_UNSUPPORTED",
  PUBLIC_EXPOSURE_CONFIRMATION_REQUIRED: "PUBLIC_EXPOSURE_CONFIRMATION_REQUIRED",
  STALE_BINDING_VERSION: "STALE_BINDING_VERSION",
  STORE_UNAVAILABLE: "STORE_UNAVAILABLE",
} as const;

export type BindingErrorCode = (typeof BINDING_ERROR_CODE)[keyof typeof BINDING_ERROR_CODE];

export class BindingDisclosureError extends Error {
  readonly code: BindingErrorCode;
  readonly detail?: string;

  constructor(code: BindingErrorCode, detail?: string) {
    super(`[${code}]${detail ? ` ${detail}` : ""}`);
    this.name = "BindingDisclosureError";
    this.code = code;
    this.detail = detail;
  }
}

export function isBindingDisclosureError(value: unknown): value is BindingDisclosureError {
  return value instanceof BindingDisclosureError;
}

/**
 * Validate the boundary between the domain disclosure model and persisted v0.
 * SELECTIVE remains a valid domain concept, but it is deferred here rather
 * than being treated as PUBLIC or PRIVATE. Session/ephemeral lifecycle state
 * likewise needs a different (non-durable) store and cannot enter this table.
 */
export function assertV0PersistableBinding(input: V0BindingPersistenceInput): asserts input is V0BindingPersistenceInput & {
  readonly visibility: V0PersistedBindingVisibility;
  readonly lifecycle: V0PersistedBindingLifecycle;
} {
  if (input.visibility === "SELECTIVE") {
    throw new BindingDisclosureError(BINDING_ERROR_CODE.SELECTIVE_UNSUPPORTED, "selective_persistence_deferred");
  }
  if (input.visibility !== "PUBLIC" && input.visibility !== "PRIVATE") {
    throw new BindingDisclosureError(BINDING_ERROR_CODE.INVALID_BINDING, "unsupported_visibility");
  }
  if (input.lifecycle !== V0_PERSISTED_BINDING_LIFECYCLE) {
    throw new BindingDisclosureError(BINDING_ERROR_CODE.LIFECYCLE_UNSUPPORTED, "non_persistent_lifecycle_deferred");
  }
}

export function assertValidExecutionEndpoint(endpoint: ExecutionEndpoint): void {
  if (!endpoint || typeof endpoint !== "object") throw new BindingDisclosureError(BINDING_ERROR_CODE.INVALID_BINDING, "endpoint_required");
  if (typeof endpoint.id !== "string" || endpoint.id.trim().length === 0) throw new BindingDisclosureError(BINDING_ERROR_CODE.INVALID_BINDING, "endpoint_id_required");
  if (endpoint.chain !== "STARKNET" && endpoint.chain !== "BASE") throw new BindingDisclosureError(BINDING_ERROR_CODE.INVALID_BINDING, "unsupported_endpoint_chain");
  if (typeof endpoint.chainId !== "string" || endpoint.chainId.trim().length === 0) throw new BindingDisclosureError(BINDING_ERROR_CODE.INVALID_BINDING, "endpoint_chain_id_required");
  if (!["ACCOUNT", "STRK20_PRIVATE_CONTEXT"].includes(endpoint.kind)) {
    throw new BindingDisclosureError(BINDING_ERROR_CODE.INVALID_BINDING, "unsupported_endpoint_kind");
  }
  if (endpoint.kind === "ACCOUNT" && (typeof endpoint.address !== "string" || endpoint.address.trim().length === 0)) {
    throw new BindingDisclosureError(BINDING_ERROR_CODE.INVALID_BINDING, "account_address_required");
  }
}

export function assertProtectionEvidence(evidence: ProtectionEvidence): void {
  if (!evidence || evidence.encryptionAtRest !== "PROVEN" || evidence.keyOwnership !== "PROVEN" || evidence.recovery !== "PROVEN") {
    throw new BindingDisclosureError(BINDING_ERROR_CODE.BLOCKED_BY_KEY_MANAGEMENT, "protection_evidence_not_proven");
  }
  if (typeof evidence.keyRef !== "string" || evidence.keyRef.trim().length === 0) {
    throw new BindingDisclosureError(BINDING_ERROR_CODE.BLOCKED_BY_KEY_MANAGEMENT, "key_reference_missing");
  }
  if (typeof evidence.algorithm !== "string" || evidence.algorithm.trim().length === 0 || !Number.isSafeInteger(evidence.schemaVersion) || evidence.schemaVersion < 1) {
    throw new BindingDisclosureError(BINDING_ERROR_CODE.BLOCKED_BY_KEY_MANAGEMENT, "protection_metadata_invalid");
  }
}

export function assertProtectedEndpoint(protectedEndpoint: ProtectedEndpoint): void {
  if (!protectedEndpoint || typeof protectedEndpoint.ciphertext !== "string" || protectedEndpoint.ciphertext.trim().length === 0) {
    throw new BindingDisclosureError(BINDING_ERROR_CODE.INVALID_BINDING, "ciphertext_required");
  }
  assertProtectionEvidence(protectedEndpoint.evidence);
}

export function sameProtectionEvidence(left: ProtectionEvidence, right: ProtectionEvidence): boolean {
  return left.encryptionAtRest === right.encryptionAtRest
    && left.keyOwnership === right.keyOwnership
    && left.recovery === right.recovery
    && left.keyRef === right.keyRef
    && left.algorithm === right.algorithm
    && left.schemaVersion === right.schemaVersion;
}

export function assertStoredBinding(record: StoredBinding): void {
  if (!record || typeof record !== "object") throw new BindingDisclosureError(BINDING_ERROR_CODE.INVALID_BINDING, "record_required");
  if (record.schemaVersion !== BINDING_DISCLOSURE_SCHEMA_VERSION) throw new BindingDisclosureError(BINDING_ERROR_CODE.INVALID_BINDING, "unsupported_schema_version");
  if (typeof record.bindingId !== "string" || record.bindingId.trim().length === 0) throw new BindingDisclosureError(BINDING_ERROR_CODE.INVALID_BINDING, "binding_id_required");
  if (typeof record.prismId !== "string" || record.prismId.trim().length === 0) throw new BindingDisclosureError(BINDING_ERROR_CODE.INVALID_BINDING, "prism_id_required");
  if (record.status !== "ACTIVE" && record.status !== "REVOKED") throw new BindingDisclosureError(BINDING_ERROR_CODE.INVALID_BINDING, "invalid_status");
  if (!Number.isSafeInteger(record.version) || record.version < 0) throw new BindingDisclosureError(BINDING_ERROR_CODE.INVALID_BINDING, "invalid_version");
  for (const [name, value] of [["created_at", record.createdAt], ["updated_at", record.updatedAt]] as const) {
    if (!Number.isFinite(value)) throw new BindingDisclosureError(BINDING_ERROR_CODE.INVALID_BINDING, `${name}_invalid`);
  }
  if (record.historicalPublic) {
    if (record.publiclyExposedAt === null || !Number.isFinite(record.publiclyExposedAt)) throw new BindingDisclosureError(BINDING_ERROR_CODE.INVALID_BINDING, "historical_public_timestamp_required");
  } else if (record.publiclyExposedAt !== null) {
    throw new BindingDisclosureError(BINDING_ERROR_CODE.INVALID_BINDING, "unhistorical_public_timestamp");
  }
  if (record.hiddenAt !== null && !Number.isFinite(record.hiddenAt)) throw new BindingDisclosureError(BINDING_ERROR_CODE.INVALID_BINDING, "hidden_at_invalid");

  const runtimeVisibility = (record as unknown as { visibility?: unknown }).visibility;
  if (runtimeVisibility === "SELECTIVE") {
    throw new BindingDisclosureError(BINDING_ERROR_CODE.SELECTIVE_UNSUPPORTED, "selective_persistence_deferred");
  }
  if (runtimeVisibility !== "PUBLIC" && runtimeVisibility !== "PRIVATE") {
    throw new BindingDisclosureError(BINDING_ERROR_CODE.INVALID_BINDING, "invalid_visibility");
  }

  if (record.visibility === "PUBLIC") {
    if (!record.historicalPublic || record.protectedEndpoint !== null) throw new BindingDisclosureError(BINDING_ERROR_CODE.INVALID_BINDING, "public_boundary_invalid");
    assertValidExecutionEndpoint(record.endpoint);
    return;
  }

  if (record.endpoint !== null || record.protectedEndpoint === null) throw new BindingDisclosureError(BINDING_ERROR_CODE.INVALID_BINDING, "private_boundary_invalid");
  assertProtectedEndpoint(record.protectedEndpoint);
}

/** Convert only an ACTIVE PUBLIC stored record to the public projection. */
export function toPublicBindingView(record: StoredBinding): PublicBindingView {
  assertStoredBinding(record);
  if (record.visibility !== "PUBLIC" || record.status !== "ACTIVE") {
    throw new BindingDisclosureError(BINDING_ERROR_CODE.INVALID_BINDING, "not_active_public_binding");
  }
  return {
    bindingId: record.bindingId,
    prismId: record.prismId,
    visibility: "PUBLIC",
    status: "ACTIVE",
    version: record.version,
    endpoint: record.endpoint,
    historicalPublic: true,
    publiclyExposedAt: record.publiclyExposedAt!,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}
