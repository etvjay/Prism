// Continuity-aware resolution application service.
//
// Flow:
// identifier -> external alias provider -> explicit Prism association ->
// current binding resolution -> durable snapshot comparison -> typed risks.
//
// This service never turns an alias string into a Prism ID. Provider failures,
// association failures, resolution failures, and snapshot failures all return
// a blocking result rather than an optimistic destination.

import {
  normalizeExternalAlias,
  isExplicitAliasAssociationResult,
  type AliasProviderStatus,
  type ExternalAlias,
  type ExternalAliasResolution,
  type IdentityAliasAssociationPort,
  type IdentityAliasProvider,
} from "../../../integrations/identity-alias/types";
import { assertValidPrismId, type PrismId } from "../../prism-identity/domain/identifiers";
import {
  diffResolution,
  providerRisk,
  RESOLUTION_RISK_CODE,
  risksFromDiff,
  type ResolutionRisk,
  type ResolutionRiskCode,
} from "../domain/risks";
import {
  resolutionSnapshotKey,
  ResolutionSnapshotStoreError,
  type ResolutionBindingStatus,
  type ResolutionDestination,
  type ResolutionSnapshot,
  type ResolutionSnapshotStore,
  type ResolutionVisibility,
} from "../domain/snapshot";

export type ResolutionIdentifier =
  | { readonly kind: "prism-id"; readonly prismId: PrismId }
  | { readonly kind: "external-alias"; readonly alias: ExternalAlias };

export interface ResolutionDestinationObservation {
  readonly executionAccount: string | null;
  readonly chain?: string | null;
  readonly bindingStatus?: ResolutionBindingStatus;
  readonly visibility?: ResolutionVisibility;
  readonly watermark?: number | null;
}

export interface ResolutionDestinationResolver {
  resolve(prismId: PrismId, venue: string): Promise<ResolutionDestinationObservation>;
}

export interface ResolutionContinuityServiceOptions {
  readonly aliasProvider?: IdentityAliasProvider | null;
  readonly aliasAssociation?: IdentityAliasAssociationPort | null;
  readonly destinationResolver: ResolutionDestinationResolver;
  readonly snapshotStore: ResolutionSnapshotStore;
  readonly now?: (() => number) | { now(): number };
}

export interface ResolutionRequest {
  readonly identifier: ResolutionIdentifier;
  readonly venue: string;
  readonly purpose?: string;
}

export type ResolutionContinuityStatus = "RESOLVED" | "NO_ACTIVE_DESTINATION" | "BLOCKED";

export interface ResolutionContinuityResult {
  readonly status: ResolutionContinuityStatus;
  readonly blocked: boolean;
  /** Null for a blocked alias provider/association path. */
  readonly prismId: PrismId | null;
  readonly alias: ExternalAlias | null;
  readonly externalSubject: string | null;
  readonly executionAccount: string | null;
  readonly destination: ResolutionDestination | null;
  readonly providerStatus: AliasProviderStatus | null;
  readonly previousSnapshot: ResolutionSnapshot | null;
  readonly snapshot: ResolutionSnapshot | null;
  readonly diff: ReturnType<typeof diffResolution> | null;
  readonly risks: readonly ResolutionRisk[];
  readonly detail: string | null;
}

function normalizeScopePart(value: string | undefined, field: string, fallback: string): string {
  const candidate = (value ?? fallback).trim();
  if (candidate.length === 0) throw new Error(`${field}_required`);
  return candidate.toUpperCase();
}

function normalizePurpose(value: string | undefined): string {
  const purpose = (value ?? "default").trim().toLowerCase();
  if (purpose.length === 0) throw new Error("purpose_required");
  return purpose;
}

function normalizeAddress(value: string): string {
  const address = value.trim().toLowerCase();
  if (address.length === 0) throw new Error("execution_account_required");
  return address;
}

function readNow(source: ResolutionContinuityServiceOptions["now"]): number {
  const value = typeof source === "function" ? source() : source?.now() ?? Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("resolution_observed_at_invalid");
  return value;
}

function providerRiskCode(status: AliasProviderStatus): ResolutionRiskCode {
  switch (status) {
    case "BLOCKED_BY_INTERFACE_EVIDENCE":
      return RESOLUTION_RISK_CODE.ALIAS_PROVIDER_INTERFACE_BLOCKED;
    case "UNAVAILABLE":
      return RESOLUTION_RISK_CODE.ALIAS_PROVIDER_UNAVAILABLE;
    case "INVALID_RESPONSE":
    case "INVALID_REQUEST":
      return RESOLUTION_RISK_CODE.ALIAS_PROVIDER_INVALID_RESPONSE;
    case "NOT_FOUND":
      return RESOLUTION_RISK_CODE.ALIAS_NOT_ASSOCIATED;
    case "RESOLVED":
      return RESOLUTION_RISK_CODE.ALIAS_PROVIDER_INVALID_RESPONSE;
  }
}

function isAliasProviderStatus(value: unknown): value is AliasProviderStatus {
  return [
    "RESOLVED",
    "NOT_FOUND",
    "UNAVAILABLE",
    "BLOCKED_BY_INTERFACE_EVIDENCE",
    "INVALID_RESPONSE",
    "INVALID_REQUEST",
  ].includes(value as AliasProviderStatus);
}

function isBindingStatus(value: unknown): value is ResolutionBindingStatus {
  return ["ACTIVE", "REVOKED", "NO_ACTIVE_DESTINATION", "UNKNOWN"].includes(value as ResolutionBindingStatus);
}

function isVisibility(value: unknown): value is ResolutionVisibility {
  return ["PUBLIC", "PRIVATE", "SELECTIVE", "UNKNOWN"].includes(value as ResolutionVisibility);
}

function blockedResult(input: {
  readonly providerStatus?: AliasProviderStatus | null;
  readonly alias?: ExternalAlias | null;
  readonly code: ResolutionRiskCode;
  readonly detail: string;
}): ResolutionContinuityResult {
  return {
    status: "BLOCKED",
    blocked: true,
    prismId: null,
    alias: input.alias ?? null,
    externalSubject: null,
    executionAccount: null,
    destination: null,
    providerStatus: input.providerStatus ?? null,
    previousSnapshot: null,
    snapshot: null,
    diff: null,
    risks: [providerRisk(input.code, input.detail)],
    detail: input.detail,
  };
}

function isExternalAliasResolution(value: unknown): value is ExternalAliasResolution {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ExternalAliasResolution>;
  return typeof candidate.status === "string" && typeof candidate.alias === "object" && candidate.alias !== null;
}

export class ResolutionContinuityService {
  private readonly aliasProvider: IdentityAliasProvider | null;
  private readonly aliasAssociation: IdentityAliasAssociationPort | null;
  private readonly destinationResolver: ResolutionDestinationResolver;
  private readonly snapshotStore: ResolutionSnapshotStore;
  private readonly now: ResolutionContinuityServiceOptions["now"];

  constructor(options: ResolutionContinuityServiceOptions) {
    this.aliasProvider = options.aliasProvider ?? null;
    this.aliasAssociation = options.aliasAssociation ?? null;
    this.destinationResolver = options.destinationResolver;
    this.snapshotStore = options.snapshotStore;
    this.now = options.now;
  }

  async resolve(request: ResolutionRequest): Promise<ResolutionContinuityResult> {
    if (!request || typeof request !== "object" || !request.identifier || typeof request.identifier !== "object") {
      return blockedResult({ code: RESOLUTION_RISK_CODE.ALIAS_PROVIDER_INVALID_RESPONSE, detail: "resolution_request_invalid" });
    }
    let venue: string;
    let purpose: string;
    try {
      venue = normalizeScopePart(request.venue, "venue", "");
      purpose = normalizePurpose(request.purpose);
    } catch (cause) {
      return blockedResult({ code: RESOLUTION_RISK_CODE.ALIAS_PROVIDER_INVALID_RESPONSE, detail: cause instanceof Error ? cause.message : "resolution_scope_invalid" });
    }

    let prismId: PrismId | null = null;
    let alias: ExternalAlias | null = null;
    let externalSubject: string | null = null;
    let providerStatus: AliasProviderStatus | null = null;

    if (request.identifier.kind === "prism-id") {
      try {
        prismId = assertValidPrismId(request.identifier.prismId);
      } catch {
        return blockedResult({ code: RESOLUTION_RISK_CODE.ALIAS_PROVIDER_INVALID_RESPONSE, detail: "invalid_prism_id" });
      }
    } else if (request.identifier.kind === "external-alias") {
      try {
        alias = normalizeExternalAlias(request.identifier.alias);
      } catch (cause) {
        return blockedResult({ code: RESOLUTION_RISK_CODE.ALIAS_PROVIDER_INVALID_RESPONSE, detail: cause instanceof Error ? cause.message : "invalid_external_alias" });
      }
      if (!this.aliasProvider) {
        return blockedResult({ alias, providerStatus: "BLOCKED_BY_INTERFACE_EVIDENCE", code: RESOLUTION_RISK_CODE.ALIAS_PROVIDER_INTERFACE_BLOCKED, detail: "alias_provider_not_configured" });
      }

      let providerResolution: ExternalAliasResolution;
      try {
        providerResolution = await this.aliasProvider.resolve(alias);
      } catch {
        return blockedResult({ alias, providerStatus: "UNAVAILABLE", code: RESOLUTION_RISK_CODE.ALIAS_PROVIDER_UNAVAILABLE, detail: "alias_provider_threw" });
      }
      if (!isExternalAliasResolution(providerResolution) || !isAliasProviderStatus(providerResolution.status)) {
        return blockedResult({ alias, providerStatus: "INVALID_RESPONSE", code: RESOLUTION_RISK_CODE.ALIAS_PROVIDER_INVALID_RESPONSE, detail: "alias_provider_response_invalid" });
      }
      providerStatus = providerResolution.status;
      if (providerResolution.status !== "RESOLVED") {
        return blockedResult({
          alias,
          providerStatus: providerResolution.status,
          code: providerRiskCode(providerResolution.status),
          detail: providerResolution.detail ?? `alias_provider_${providerResolution.status.toLowerCase()}`,
        });
      }
      let providerAlias: ExternalAlias;
      try {
        providerAlias = normalizeExternalAlias(providerResolution.alias);
      } catch {
        return blockedResult({ alias, providerStatus: "INVALID_RESPONSE", code: RESOLUTION_RISK_CODE.ALIAS_PROVIDER_INVALID_RESPONSE, detail: "alias_provider_alias_invalid" });
      }
      if (
        providerAlias.provider !== alias.provider ||
        typeof providerAlias.value !== "string" ||
        providerAlias.value.length === 0 ||
        typeof providerResolution.subject !== "string" ||
        providerResolution.subject.trim().length === 0
      ) {
        return blockedResult({ alias, providerStatus: "INVALID_RESPONSE", code: RESOLUTION_RISK_CODE.ALIAS_PROVIDER_INVALID_RESPONSE, detail: "alias_provider_resolved_record_invalid" });
      }
      alias = providerAlias;
      externalSubject = providerResolution.subject.trim();
      if (!this.aliasAssociation) {
        return blockedResult({ alias, providerStatus: "INVALID_RESPONSE", code: RESOLUTION_RISK_CODE.ALIAS_NOT_ASSOCIATED, detail: "explicit_prism_association_not_configured" });
      }
      let association;
      try {
        association = await this.aliasAssociation.resolve({ alias, resolution: providerResolution });
      } catch {
        return blockedResult({ alias, providerStatus, code: RESOLUTION_RISK_CODE.ALIAS_NOT_ASSOCIATED, detail: "explicit_prism_association_unavailable" });
      }
      if (!isExplicitAliasAssociationResult(association)) {
        const detail = association && typeof association === "object" && "detail" in association && typeof (association as { detail?: unknown }).detail === "string"
          ? (association as { detail: string }).detail
          : "alias_not_explicitly_associated";
        return blockedResult({ alias, providerStatus, code: RESOLUTION_RISK_CODE.ALIAS_NOT_ASSOCIATED, detail });
      }
      // The runtime guard has validated both the explicit evidence marker and
      // the Prism ID shape. Do not accept a status/PrismId cast on its own.
      prismId = association.prismId;
    } else {
      return blockedResult({ code: RESOLUTION_RISK_CODE.ALIAS_PROVIDER_INVALID_RESPONSE, detail: "resolution_identifier_kind_invalid" });
    }

    if (prismId === null) {
      return blockedResult({ alias, providerStatus, code: RESOLUTION_RISK_CODE.ALIAS_NOT_ASSOCIATED, detail: "prism_id_not_resolved" });
    }

    let observation: ResolutionDestinationObservation;
    try {
      observation = await this.destinationResolver.resolve(prismId, venue);
      if (!observation || typeof observation.executionAccount !== "string" && observation.executionAccount !== null) {
        throw new Error("destination_observation_invalid");
      }
    } catch (cause) {
      return blockedResult({ alias, providerStatus, code: RESOLUTION_RISK_CODE.SNAPSHOT_UNAVAILABLE, detail: cause instanceof Error ? cause.message : "destination_resolution_unavailable" });
    }

    let observedAt: number;
    try {
      observedAt = readNow(this.now);
    } catch (cause) {
      return blockedResult({ alias, providerStatus, code: RESOLUTION_RISK_CODE.SNAPSHOT_UNAVAILABLE, detail: cause instanceof Error ? cause.message : "resolution_observed_at_invalid" });
    }

    let destination: ResolutionDestination | null;
    let bindingStatus: ResolutionBindingStatus;
    let visibility: ResolutionVisibility;
    try {
      destination = observation.executionAccount === null
        ? null
        : {
            chain: normalizeScopePart(observation.chain ?? undefined, "chain", venue),
            address: normalizeAddress(observation.executionAccount),
          };
      if (observation.bindingStatus !== undefined && !isBindingStatus(observation.bindingStatus)) {
        throw new Error("binding_status_invalid");
      }
      if (observation.visibility !== undefined && !isVisibility(observation.visibility)) {
        throw new Error("visibility_invalid");
      }
      bindingStatus = observation.bindingStatus
        ?? (destination === null ? "NO_ACTIVE_DESTINATION" : "ACTIVE");
      visibility = observation.visibility ?? "UNKNOWN";
      if (bindingStatus === "ACTIVE" && destination === null) throw new Error("active_binding_without_destination");
      if (bindingStatus !== "ACTIVE" && destination !== null) throw new Error("non_active_binding_with_destination");
      if (bindingStatus === "UNKNOWN") throw new Error("binding_status_unknown");
    } catch (cause) {
      return blockedResult({ alias, providerStatus, code: RESOLUTION_RISK_CODE.SNAPSHOT_UNAVAILABLE, detail: cause instanceof Error ? cause.message : "destination_observation_invalid" });
    }
    const key = resolutionSnapshotKey({ prismId, venue, purpose });

    let previousSnapshot: ResolutionSnapshot | null;
    try {
      previousSnapshot = await this.snapshotStore.get({ prismId, venue, purpose });
    } catch {
      return blockedResult({ alias, providerStatus, code: RESOLUTION_RISK_CODE.SNAPSHOT_UNAVAILABLE, detail: "snapshot_read_failed" });
    }

    const snapshot: ResolutionSnapshot = {
      key,
      prismId,
      venue,
      purpose,
      alias,
      externalSubject,
      destination,
      bindingStatus,
      visibility,
      watermark: observation.watermark ?? null,
      observedAt,
      version: previousSnapshot ? previousSnapshot.version + 1 : 1,
    };
    const diff = diffResolution(previousSnapshot, snapshot);
    const risks = risksFromDiff(diff);

    let persisted: ResolutionSnapshot;
    try {
      persisted = await this.snapshotStore.save(snapshot, previousSnapshot?.version ?? null);
    } catch (cause) {
      const detail = cause instanceof ResolutionSnapshotStoreError ? cause.message : "snapshot_write_failed";
      return blockedResult({ alias, providerStatus, code: RESOLUTION_RISK_CODE.SNAPSHOT_UNAVAILABLE, detail });
    }

    const noActive = destination === null;
    return {
      status: noActive ? "NO_ACTIVE_DESTINATION" : "RESOLVED",
      blocked: noActive || risks.some((risk) => risk.blocking),
      prismId,
      alias,
      externalSubject,
      executionAccount: destination?.address ?? null,
      destination,
      providerStatus,
      previousSnapshot,
      snapshot: persisted,
      diff,
      risks,
      detail: noActive ? bindingStatus.toLowerCase() : null,
    };
  }

  async resolveAlias(alias: ExternalAlias, venue: string, purpose = "default"): Promise<ResolutionContinuityResult> {
    return this.resolve({ identifier: { kind: "external-alias", alias }, venue, purpose });
  }

  async resolvePrismId(prismId: PrismId, venue: string, purpose = "default"): Promise<ResolutionContinuityResult> {
    return this.resolve({ identifier: { kind: "prism-id", prismId }, venue, purpose });
  }
}
