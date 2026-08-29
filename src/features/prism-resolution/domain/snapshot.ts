// Durable resolution snapshot model.
//
// A snapshot is a comparison baseline, not canonical identity state. Canonical
// Prism identity and binding truth remain in their authoritative registry; this
// record stores the last observed, scoped resolution for continuity decisions.

import type { ExternalAlias } from "../../../integrations/identity-alias/types";
import type { PrismId } from "../../prism-identity/domain/identifiers";

export type ResolutionBindingStatus = "ACTIVE" | "REVOKED" | "NO_ACTIVE_DESTINATION" | "UNKNOWN";
export type ResolutionVisibility = "PUBLIC" | "PRIVATE" | "SELECTIVE" | "UNKNOWN";

export interface ResolutionDestination {
  readonly chain: string;
  readonly address: string;
}

export interface ResolutionSnapshotKey {
  readonly prismId: PrismId;
  readonly venue: string;
  readonly purpose: string;
}

export type ResolutionSnapshotLookupKey = ResolutionSnapshotKey | string;

export interface ResolutionSnapshot {
  /** Deterministic key derived from prismId + venue + purpose. */
  readonly key: string;
  readonly prismId: PrismId;
  readonly venue: string;
  readonly purpose: string;
  /** External alias evidence, never a Prism ID. */
  readonly alias: ExternalAlias | null;
  readonly externalSubject: string | null;
  readonly destination: ResolutionDestination | null;
  readonly bindingStatus: ResolutionBindingStatus;
  readonly visibility: ResolutionVisibility;
  readonly watermark: number | null;
  readonly observedAt: number;
  /** Monotonic durable version, starting at 1. */
  readonly version: number;
}

export function resolutionSnapshotKey(input: ResolutionSnapshotKey): string {
  validateKey(input);
  return JSON.stringify([input.prismId, input.venue, input.purpose]);
}

export function parseResolutionSnapshotKey(input: ResolutionSnapshotLookupKey): ResolutionSnapshotKey {
  if (typeof input !== "string") {
    validateKey(input);
    return input;
  }
  try {
    const parsed: unknown = JSON.parse(input);
    if (!Array.isArray(parsed) || parsed.length !== 3 || parsed.some((value) => typeof value !== "string")) {
      throw new Error("invalid_snapshot_key");
    }
    const key = { prismId: parsed[0], venue: parsed[1], purpose: parsed[2] } as ResolutionSnapshotKey;
    validateKey(key);
    return key;
  } catch (cause) {
    throw new Error(cause instanceof Error ? cause.message : "invalid_snapshot_key");
  }
}

export function validateKey(input: ResolutionSnapshotKey): void {
  if (!input || typeof input !== "object") throw new Error("resolution_snapshot_key_required");
  for (const [field, value] of Object.entries(input)) {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error(`resolution_snapshot_${field}_required`);
    }
  }
}

export function validateResolutionSnapshot(snapshot: ResolutionSnapshot): void {
  if (!snapshot || typeof snapshot !== "object") throw new Error("resolution_snapshot_required");
  validateKey({ prismId: snapshot.prismId, venue: snapshot.venue, purpose: snapshot.purpose });
  if (snapshot.key !== resolutionSnapshotKey({ prismId: snapshot.prismId, venue: snapshot.venue, purpose: snapshot.purpose })) throw new Error("resolution_snapshot_key_mismatch");
  if (!["ACTIVE", "REVOKED", "NO_ACTIVE_DESTINATION", "UNKNOWN"].includes(snapshot.bindingStatus)) {
    throw new Error("resolution_snapshot_binding_status_invalid");
  }
  if (!["PUBLIC", "PRIVATE", "SELECTIVE", "UNKNOWN"].includes(snapshot.visibility)) {
    throw new Error("resolution_snapshot_visibility_invalid");
  }
  if (snapshot.alias !== null) {
    if (typeof snapshot.alias.provider !== "string" || snapshot.alias.provider.trim().length === 0) {
      throw new Error("resolution_snapshot_alias_provider_required");
    }
    if (typeof snapshot.alias.value !== "string" || snapshot.alias.value.trim().length === 0) {
      throw new Error("resolution_snapshot_alias_value_required");
    }
  }
  if (snapshot.externalSubject !== null && (typeof snapshot.externalSubject !== "string" || snapshot.externalSubject.trim().length === 0)) {
    throw new Error("resolution_snapshot_subject_invalid");
  }
  if (snapshot.destination !== null) {
    if (typeof snapshot.destination.chain !== "string" || snapshot.destination.chain.trim().length === 0) {
      throw new Error("resolution_snapshot_destination_chain_required");
    }
    if (typeof snapshot.destination.address !== "string" || snapshot.destination.address.trim().length === 0) {
      throw new Error("resolution_snapshot_destination_address_required");
    }
  }
  if (!Number.isSafeInteger(snapshot.observedAt) || snapshot.observedAt < 0) throw new Error("resolution_snapshot_observed_at_invalid");
  if (!Number.isSafeInteger(snapshot.version) || snapshot.version < 1) throw new Error("resolution_snapshot_version_invalid");
  if (snapshot.watermark !== null && (!Number.isSafeInteger(snapshot.watermark) || snapshot.watermark < 0)) {
    throw new Error("resolution_snapshot_watermark_invalid");
  }
}

export function cloneResolutionSnapshot(snapshot: ResolutionSnapshot): ResolutionSnapshot {
  return {
    ...snapshot,
    alias: snapshot.alias ? { ...snapshot.alias } : null,
    destination: snapshot.destination ? { ...snapshot.destination } : null,
  };
}

export type ResolutionSnapshotStoreErrorCode = "snapshot_version_conflict" | "snapshot_store_unavailable" | "snapshot_store_invalid";

export class ResolutionSnapshotStoreError extends Error {
  readonly code: ResolutionSnapshotStoreErrorCode;
  constructor(code: ResolutionSnapshotStoreErrorCode, message: string, cause?: unknown) {
    super(`[${code}] ${message}${cause instanceof Error ? `: ${cause.message}` : ""}`);
    this.name = "ResolutionSnapshotStoreError";
    this.code = code;
  }
}

/** Durable, scoped snapshot port. Implementations must not return shared mutable objects. */
export interface ResolutionSnapshotStore {
  get(key: ResolutionSnapshotLookupKey): Promise<ResolutionSnapshot | null>;
  /** expectedVersion null means create-only; otherwise update only that version. */
  save(snapshot: ResolutionSnapshot, expectedVersion: number | null): Promise<ResolutionSnapshot>;
  /** Optional descriptive aliases implemented by the bundled adapters. */
  getLatest?(key: ResolutionSnapshotLookupKey): Promise<ResolutionSnapshot | null>;
  put?(snapshot: ResolutionSnapshot, expectedVersion: number | null): Promise<ResolutionSnapshot>;
  upsert?(snapshot: ResolutionSnapshot, expectedVersion: number | null): Promise<ResolutionSnapshot>;
}
