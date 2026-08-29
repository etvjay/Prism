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
  /** Source label is supplied by the canonical/projection resolver. */
  readonly authoritativeSource?: ResolutionSource;
}

export type ResolutionSource =
  | "registry_canonical"
  | "indexer_projection"
  | "stale_refused"
  | "in_memory_test"
  | "unavailable"
  | "unknown";

export type ResolutionFreshnessStatus = "FRESH" | "STALE" | "UNKNOWN";

/** Public continuity state; `status` remains the legacy coarse status. */
export type ResolutionContinuityState =
  | "ACTIVE"
  | "NO_ACTIVE_DESTINATION"
  | "BINDING_REVOKED"
  | "ADDRESS_CHANGED"
  | "CHAIN_CHANGED"
  | "ALIAS_CHANGED"
  | "VISIBILITY_CHANGED"
  | "CHANGED"
  | "STALE"
  | "UNAVAILABLE"
  | "UNKNOWN"
  | "NOT_FOUND";

export interface ResolutionDestinationResolver {
  resolve(prismId: PrismId, venue: string): Promise<ResolutionDestinationObservation>;
}

export interface ResolutionContinuityServiceOptions {
  readonly aliasProvider?: IdentityAliasProvider | null;
  /** Provider-neutral resolver for aliases when more than one namespace is wired. */
  readonly aliasProviderResolver?: ((provider: string) => IdentityAliasProvider | null) | null;
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
  readonly continuityStatus: ResolutionContinuityStatus;
  readonly state: ResolutionContinuityState;
  /** KNOWN means the destination read completed; UNKNOWN blocks use. */
  readonly evidenceStatus: "KNOWN" | "UNKNOWN";
  readonly blocked: boolean;
  /** Null for a blocked alias provider/association path. */
  readonly prismId: PrismId | null;
  readonly alias: ExternalAlias | null;
  readonly associationEvidence: "explicit_prism_association" | null;
  readonly externalSubject: string | null;
  readonly executionAccount: string | null;
  readonly destination: ResolutionDestination | null;
  readonly providerStatus: AliasProviderStatus | null;
  readonly previousSnapshot: ResolutionSnapshot | null;
  readonly snapshot: ResolutionSnapshot | null;
  readonly diff: ReturnType<typeof diffResolution> | null;
  readonly risks: readonly ResolutionRisk[];
  readonly watermark: number | null;
  readonly freshness: ResolutionFreshnessStatus;
  /** Descriptive alias for clients that name this field explicitly. */
  readonly freshnessStatus: ResolutionFreshnessStatus;
  readonly source: ResolutionSource;
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

function sourceFor(value: unknown): ResolutionSource {
  return ["registry_canonical", "indexer_projection", "stale_refused", "in_memory_test", "unavailable", "unknown"].includes(value as string)
    ? (value as ResolutionSource)
    : "unknown";
}

function freshnessFor(source: ResolutionSource): ResolutionFreshnessStatus {
  if (source === "stale_refused") return "STALE";
  if (source === "registry_canonical" || source === "indexer_projection") return "FRESH";
  return "UNKNOWN";
}

function stateForDiff(diff: ReturnType<typeof diffResolution>): ResolutionContinuityState {
  if (diff.bindingRevoked) return "BINDING_REVOKED";
  if (diff.noActiveDestination) return "NO_ACTIVE_DESTINATION";
  const changed = [
    diff.addressChanged ? "ADDRESS_CHANGED" : null,
    diff.chainChanged ? "CHAIN_CHANGED" : null,
    diff.aliasChanged ? "ALIAS_CHANGED" : null,
    diff.visibilityChanged ? "VISIBILITY_CHANGED" : null,
  ].filter((value): value is Exclude<ResolutionContinuityState, "ACTIVE" | "NO_ACTIVE_DESTINATION" | "BINDING_REVOKED" | "STALE" | "UNAVAILABLE" | "UNKNOWN" | "NOT_FOUND" | "CHANGED"> => value !== null);
  if (changed.length === 1) return changed[0];
  if (changed.length > 1) return "CHANGED";
  return "ACTIVE";
}

function blockedState(input: { providerStatus?: AliasProviderStatus | null; code: ResolutionRiskCode }): ResolutionContinuityState {
  if (input.providerStatus === "NOT_FOUND") return "NOT_FOUND";
  if (input.providerStatus === "UNAVAILABLE" || input.code === RESOLUTION_RISK_CODE.SNAPSHOT_UNAVAILABLE) return "UNAVAILABLE";
  return "UNKNOWN";
}

function blockedResult(input: {
  readonly providerStatus?: AliasProviderStatus | null;
  readonly alias?: ExternalAlias | null;
  readonly prismId?: PrismId | null;
  readonly externalSubject?: string | null;
  readonly associationEvidence?: "explicit_prism_association" | null;
  readonly code: ResolutionRiskCode;
  readonly detail: string;
  readonly state?: ResolutionContinuityState;
  readonly source?: ResolutionSource;
  readonly status?: ResolutionContinuityStatus;
  readonly evidenceStatus?: "KNOWN" | "UNKNOWN";
  readonly watermark?: number | null;
}): ResolutionContinuityResult {
  const source = input.source ?? "unavailable";
  const status = input.status ?? "BLOCKED";
  const freshness = freshnessFor(source);
  return {
    status,
    continuityStatus: status,
    state: input.state ?? blockedState(input),
    evidenceStatus: input.evidenceStatus ?? "UNKNOWN",
    blocked: true,
    prismId: input.prismId ?? null,
    alias: input.alias ?? null,
    associationEvidence: input.associationEvidence ?? null,
    externalSubject: input.externalSubject ?? null,
    executionAccount: null,
    destination: null,
    providerStatus: input.providerStatus ?? null,
    previousSnapshot: null,
    snapshot: null,
    diff: null,
    risks: [providerRisk(input.code, input.detail)],
    watermark: input.watermark ?? null,
    freshness,
    freshnessStatus: freshness,
    source,
    detail: input.detail,
  };
}

function publicSnapshot(snapshot: ResolutionSnapshot | null): ResolutionSnapshot | null {
  if (!snapshot) return null;
  return {
    key: snapshot.key,
    prismId: snapshot.prismId,
    venue: snapshot.venue,
    purpose: snapshot.purpose,
    alias: snapshot.alias ? { provider: snapshot.alias.provider, value: snapshot.alias.value } : null,
    externalSubject: snapshot.externalSubject,
    destination: snapshot.destination ? { chain: snapshot.destination.chain, address: snapshot.destination.address } : null,
    bindingStatus: snapshot.bindingStatus,
    visibility: snapshot.visibility,
    watermark: snapshot.watermark,
    observedAt: snapshot.observedAt,
    version: snapshot.version,
  };
}

function isExternalAliasResolution(value: unknown): value is ExternalAliasResolution {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ExternalAliasResolution>;
  return typeof candidate.status === "string" && typeof candidate.alias === "object" && candidate.alias !== null;
}

export class ResolutionContinuityService {
  private readonly aliasProvider: IdentityAliasProvider | null;
  private readonly aliasProviderResolver: ((provider: string) => IdentityAliasProvider | null) | null;
  private readonly aliasAssociation: IdentityAliasAssociationPort | null;
  private readonly destinationResolver: ResolutionDestinationResolver;
  private readonly snapshotStore: ResolutionSnapshotStore;
  private readonly now: ResolutionContinuityServiceOptions["now"];

  constructor(options: ResolutionContinuityServiceOptions) {
    this.aliasProvider = options.aliasProvider ?? null;
    this.aliasProviderResolver = options.aliasProviderResolver ?? null;
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
    let associationEvidence: "explicit_prism_association" | null = null;
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
      const aliasProvider = this.aliasProviderResolver
        ? this.aliasProviderResolver(alias.provider)
        : this.aliasProvider;
      if (!aliasProvider) {
        return blockedResult({ alias, providerStatus: "BLOCKED_BY_INTERFACE_EVIDENCE", code: RESOLUTION_RISK_CODE.ALIAS_PROVIDER_INTERFACE_BLOCKED, detail: "alias_provider_not_configured" });
      }

      let providerResolution: ExternalAliasResolution;
      try {
        providerResolution = await aliasProvider.resolve(alias);
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
      if (providerResolution.externalAddress !== undefined && providerResolution.externalAddress !== null && typeof providerResolution.externalAddress !== "string") {
        return blockedResult({ alias, providerStatus: "INVALID_RESPONSE", code: RESOLUTION_RISK_CODE.ALIAS_PROVIDER_INVALID_RESPONSE, detail: "alias_provider_external_address_invalid" });
      }
      if (providerResolution.canonicalValue !== undefined && providerResolution.canonicalValue !== null && typeof providerResolution.canonicalValue !== "string") {
        return blockedResult({ alias, providerStatus: "INVALID_RESPONSE", code: RESOLUTION_RISK_CODE.ALIAS_PROVIDER_INVALID_RESPONSE, detail: "alias_provider_canonical_value_invalid" });
      }
      // Pass only a validated provider-shaped record into the association
      // boundary. Arbitrary provider fields never cross into Prism logic.
      providerResolution = {
        status: "RESOLVED",
        alias,
        subject: externalSubject,
        externalAddress: providerResolution.externalAddress?.trim() || null,
        canonicalValue: providerResolution.canonicalValue?.trim() || null,
        detail: null,
      };
      if (!this.aliasAssociation) {
        return blockedResult({ alias, providerStatus: "RESOLVED", state: "UNAVAILABLE", code: RESOLUTION_RISK_CODE.ALIAS_NOT_ASSOCIATED, detail: "explicit_prism_association_not_configured" });
      }
      let association;
      try {
        association = await this.aliasAssociation.resolve({ alias, resolution: providerResolution });
      } catch {
        return blockedResult({ alias, providerStatus, state: "UNAVAILABLE", code: RESOLUTION_RISK_CODE.ALIAS_NOT_ASSOCIATED, detail: "explicit_prism_association_unavailable" });
      }
      if (!isExplicitAliasAssociationResult(association)) {
        const isNotAssociated = association && typeof association === "object" && "status" in association && (association as { status?: unknown }).status === "NOT_ASSOCIATED";
        return blockedResult({
          alias,
          providerStatus,
          state: isNotAssociated ? "NOT_FOUND" : "UNKNOWN",
          code: RESOLUTION_RISK_CODE.ALIAS_NOT_ASSOCIATED,
          detail: isNotAssociated ? "alias_not_explicitly_associated" : "explicit_prism_association_evidence_invalid",
        });
      }
      // The runtime guard has validated both the explicit evidence marker and
      // the Prism ID shape. Do not accept a status/PrismId cast on its own.
      prismId = association.prismId;
      associationEvidence = "explicit_prism_association";
    } else {
      return blockedResult({ code: RESOLUTION_RISK_CODE.ALIAS_PROVIDER_INVALID_RESPONSE, detail: "resolution_identifier_kind_invalid" });
    }

    if (prismId === null) {
      return blockedResult({ alias, providerStatus, code: RESOLUTION_RISK_CODE.ALIAS_NOT_ASSOCIATED, detail: "prism_id_not_resolved" });
    }

    let observation: ResolutionDestinationObservation;
    let observationSource: ResolutionSource = "unknown";
    let sourceWasExplicit = false;
    try {
      observation = await this.destinationResolver.resolve(prismId, venue);
      if (!observation || typeof observation.executionAccount !== "string" && observation.executionAccount !== null) {
        throw new Error("destination_observation_invalid");
      }
      sourceWasExplicit = observation.authoritativeSource !== undefined;
      observationSource = sourceFor(observation.authoritativeSource);
      if (observation.watermark !== undefined && observation.watermark !== null && (!Number.isSafeInteger(observation.watermark) || observation.watermark < 0)) {
        throw new Error("watermark_invalid");
      }
    } catch {
      return blockedResult({
        alias,
        providerStatus,
        prismId,
        externalSubject,
        associationEvidence,
        code: RESOLUTION_RISK_CODE.SNAPSHOT_UNAVAILABLE,
        state: "UNAVAILABLE",
        source: "unavailable",
        detail: "destination_resolution_unavailable",
      });
    }

    const observationWatermark = observation.watermark ?? null;
    // `stale_refused` is an explicit refusal by the canonical/projection
    // serving boundary. It is not evidence of a real empty binding and must
    // never overwrite a previously known snapshot.
    if (observationSource === "stale_refused" || (
      sourceWasExplicit &&
      (observationSource === "registry_canonical" || observationSource === "indexer_projection") &&
      observation.executionAccount !== null &&
      observationWatermark === null
    )) {
      return blockedResult({
        alias,
        providerStatus,
        prismId,
        externalSubject,
        associationEvidence,
        code: RESOLUTION_RISK_CODE.SNAPSHOT_UNAVAILABLE,
        state: "STALE",
        source: "stale_refused",
        watermark: observationWatermark,
        detail: "resolution_stale",
      });
    }
    if (sourceWasExplicit && observationSource === "unavailable") {
      return blockedResult({
        alias,
        providerStatus,
        prismId,
        externalSubject,
        associationEvidence,
        code: RESOLUTION_RISK_CODE.SNAPSHOT_UNAVAILABLE,
        state: "UNAVAILABLE",
        source: "unavailable",
        watermark: observationWatermark,
        detail: "destination_resolution_unavailable",
      });
    }
    if (sourceWasExplicit && observationSource === "unknown") {
      return blockedResult({
        alias,
        providerStatus,
        prismId,
        externalSubject,
        associationEvidence,
        code: RESOLUTION_RISK_CODE.SNAPSHOT_UNAVAILABLE,
        state: "UNKNOWN",
        source: "unknown",
        watermark: observationWatermark,
        detail: "destination_resolution_unknown",
      });
    }

    let observedAt: number;
    try {
      observedAt = readNow(this.now);
    } catch {
      return blockedResult({
        alias,
        providerStatus,
        prismId,
        externalSubject,
        associationEvidence,
        code: RESOLUTION_RISK_CODE.SNAPSHOT_UNAVAILABLE,
        state: "UNAVAILABLE",
        source: "unavailable",
        watermark: observationWatermark,
        detail: "resolution_observed_at_invalid",
      });
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
      const detail = cause instanceof Error ? cause.message : "destination_observation_invalid";
      return blockedResult({
        alias,
        providerStatus,
        prismId,
        externalSubject,
        associationEvidence,
        code: RESOLUTION_RISK_CODE.SNAPSHOT_UNAVAILABLE,
        state: detail === "binding_status_unknown" ? "UNKNOWN" : "UNAVAILABLE",
        source: detail === "binding_status_unknown" ? "unknown" : "unavailable",
        watermark: observationWatermark,
        detail: detail === "binding_status_unknown" ? "binding_status_unknown" : "destination_observation_invalid",
      });
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
      watermark: observationWatermark,
      observedAt,
      version: previousSnapshot ? previousSnapshot.version + 1 : 1,
    };
    const diff = diffResolution(previousSnapshot, snapshot);
    const risks = risksFromDiff(diff);

    let persisted: ResolutionSnapshot;
    try {
      persisted = await this.snapshotStore.save(snapshot, previousSnapshot?.version ?? null);
    } catch {
      return blockedResult({
        alias,
        providerStatus,
        prismId,
        externalSubject,
        associationEvidence,
        code: RESOLUTION_RISK_CODE.SNAPSHOT_UNAVAILABLE,
        state: "UNAVAILABLE",
        source: "unavailable",
        watermark: observationWatermark,
        detail: "snapshot_store_unavailable",
      });
    }

    const noActive = destination === null;
    const source = sourceFor(observation.authoritativeSource);
    const freshness = freshnessFor(source);
    const continuityState = stateForDiff(diff);
    return {
      status: noActive ? "NO_ACTIVE_DESTINATION" : "RESOLVED",
      continuityStatus: noActive ? "NO_ACTIVE_DESTINATION" : "RESOLVED",
      state: continuityState,
      evidenceStatus: "KNOWN",
      blocked: noActive || risks.some((risk) => risk.blocking),
      prismId,
      alias,
      associationEvidence,
      externalSubject,
      executionAccount: destination?.address ?? null,
      destination,
      providerStatus,
      previousSnapshot,
      snapshot: persisted,
      diff,
      risks,
      watermark: observationWatermark,
      freshness,
      freshnessStatus: freshness,
      source,
      detail: noActive ? bindingStatus.toLowerCase() : null,
    };
  }

  /** JSON-safe transport projection; private/provider fields are not copied. */
  serialize(result: ResolutionContinuityResult): ResolutionContinuityResult {
    const previousSnapshot = publicSnapshot(result.previousSnapshot);
    const snapshot = publicSnapshot(result.snapshot);
    return {
      status: result.status,
      continuityStatus: result.continuityStatus,
      state: result.state,
      evidenceStatus: result.evidenceStatus,
      blocked: result.blocked,
      prismId: result.prismId,
      alias: result.alias ? { provider: result.alias.provider, value: result.alias.value } : null,
      associationEvidence: result.associationEvidence,
      externalSubject: result.externalSubject,
      executionAccount: result.executionAccount,
      destination: result.destination ? { chain: result.destination.chain, address: result.destination.address } : null,
      providerStatus: result.providerStatus,
      previousSnapshot,
      snapshot,
      diff: result.diff
        ? {
            previous: previousSnapshot,
            current: snapshot ?? publicSnapshot(result.diff.current)!,
            firstTime: result.diff.firstTime,
            addressChanged: result.diff.addressChanged,
            aliasChanged: result.diff.aliasChanged,
            externalSubjectChanged: result.diff.externalSubjectChanged,
            chainChanged: result.diff.chainChanged,
            bindingRevoked: result.diff.bindingRevoked,
            visibilityChanged: result.diff.visibilityChanged,
            noActiveDestination: result.diff.noActiveDestination,
          }
        : null,
      risks: result.risks.map((risk) => ({
        code: risk.code,
        level: risk.level,
        blocking: risk.blocking,
        detail: risk.detail,
      })),
      watermark: result.watermark,
      freshness: result.freshness,
      freshnessStatus: result.freshnessStatus,
      source: result.source,
      detail: result.detail,
    };
  }

  async resolveAlias(alias: ExternalAlias, venue: string, purpose = "default"): Promise<ResolutionContinuityResult> {
    return this.resolve({ identifier: { kind: "external-alias", alias }, venue, purpose });
  }

  async resolvePrismId(prismId: PrismId, venue: string, purpose = "default"): Promise<ResolutionContinuityResult> {
    return this.resolve({ identifier: { kind: "prism-id", prismId }, venue, purpose });
  }
}
