// Typed resolution diffs and risk signals.
// No opaque score is used: each risk has a stable code, severity, and blocking
// decision that downstream policy can consume directly.

import type { ExternalAlias } from "../../../integrations/identity-alias/types";
import type { ResolutionSnapshot } from "./snapshot";

export const RESOLUTION_RISK_CODE = {
  FIRST_TIME_RECIPIENT: "FIRST_TIME_RECIPIENT",
  ADDRESS_CHANGED: "ADDRESS_CHANGED",
  ALIAS_CHANGED: "ALIAS_CHANGED",
  CHAIN_CHANGED: "CHAIN_CHANGED",
  BINDING_REVOKED: "BINDING_REVOKED",
  VISIBILITY_CHANGED: "VISIBILITY_CHANGED",
  NO_ACTIVE_DESTINATION: "NO_ACTIVE_DESTINATION",
  ALIAS_PROVIDER_UNAVAILABLE: "ALIAS_PROVIDER_UNAVAILABLE",
  ALIAS_PROVIDER_INTERFACE_BLOCKED: "ALIAS_PROVIDER_INTERFACE_BLOCKED",
  ALIAS_PROVIDER_INVALID_RESPONSE: "ALIAS_PROVIDER_INVALID_RESPONSE",
  ALIAS_NOT_ASSOCIATED: "ALIAS_NOT_ASSOCIATED",
  SNAPSHOT_UNAVAILABLE: "SNAPSHOT_UNAVAILABLE",
} as const;

export type ResolutionRiskCode = (typeof RESOLUTION_RISK_CODE)[keyof typeof RESOLUTION_RISK_CODE];
export type ResolutionRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN";

export interface ResolutionRisk {
  readonly code: ResolutionRiskCode;
  readonly level: ResolutionRiskLevel;
  readonly blocking: boolean;
  readonly detail: string;
}

export interface ResolutionDiff {
  readonly previous: ResolutionSnapshot | null;
  readonly current: ResolutionSnapshot;
  readonly firstTime: boolean;
  readonly addressChanged: boolean;
  readonly aliasChanged: boolean;
  readonly externalSubjectChanged: boolean;
  readonly chainChanged: boolean;
  readonly bindingRevoked: boolean;
  readonly visibilityChanged: boolean;
  readonly noActiveDestination: boolean;
}

function canonical(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (/^0x[0-9a-f]+$/.test(trimmed)) {
    try {
      return `0x${BigInt(trimmed).toString(16)}`;
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

function sameAlias(left: ExternalAlias | null, right: ExternalAlias | null): boolean {
  if (left === null || right === null) return left === right;
  return canonical(left.provider) === canonical(right.provider) && canonical(left.value) === canonical(right.value);
}

function sameAddress(left: string | null, right: string | null): boolean {
  if (left === null || right === null) return left === right;
  return canonical(left) === canonical(right);
}

function sameExternalSubject(left: string | null, right: string | null): boolean {
  if (left === null || right === null) return left === right;
  // Provider subjects are opaque namespace identifiers. Trim transport
  // whitespace, but preserve case because a provider may use case-sensitive
  // subject identifiers.
  return left.trim() === right.trim();
}

export function diffResolution(previous: ResolutionSnapshot | null, current: ResolutionSnapshot): ResolutionDiff {
  if (previous === null) {
    return {
      previous: null,
      current,
      firstTime: true,
      addressChanged: false,
      aliasChanged: false,
      externalSubjectChanged: false,
      chainChanged: false,
      bindingRevoked: current.bindingStatus === "REVOKED",
      visibilityChanged: false,
      noActiveDestination: current.destination === null || current.bindingStatus === "NO_ACTIVE_DESTINATION" || current.bindingStatus === "REVOKED",
    };
  }
  const externalSubjectChanged = !sameExternalSubject(previous.externalSubject, current.externalSubject);
  return {
    previous,
    current,
    firstTime: false,
    addressChanged: !sameAddress(previous.destination?.address ?? null, current.destination?.address ?? null),
    aliasChanged: !sameAlias(previous.alias, current.alias) || externalSubjectChanged,
    externalSubjectChanged,
    chainChanged:
      previous.destination !== null &&
      current.destination !== null &&
      canonical(previous.destination.chain) !== canonical(current.destination.chain),
    bindingRevoked: current.bindingStatus === "REVOKED",
    visibilityChanged: previous.visibility !== current.visibility,
    noActiveDestination: current.destination === null || current.bindingStatus === "NO_ACTIVE_DESTINATION" || current.bindingStatus === "REVOKED",
  };
}

function risk(code: ResolutionRiskCode, level: ResolutionRiskLevel, blocking: boolean, detail: string): ResolutionRisk {
  return { code, level, blocking, detail };
}

export function risksFromDiff(diff: ResolutionDiff): readonly ResolutionRisk[] {
  const risks: ResolutionRisk[] = [];
  if (diff.firstTime) risks.push(risk(RESOLUTION_RISK_CODE.FIRST_TIME_RECIPIENT, "MEDIUM", false, "no_prior_resolution_snapshot"));
  if (diff.addressChanged) risks.push(risk(RESOLUTION_RISK_CODE.ADDRESS_CHANGED, "HIGH", false, "destination_address_changed"));
  if (diff.aliasChanged) risks.push(risk(RESOLUTION_RISK_CODE.ALIAS_CHANGED, "MEDIUM", false, diff.externalSubjectChanged ? "external_alias_or_subject_changed" : "external_alias_changed"));
  if (diff.chainChanged) risks.push(risk(RESOLUTION_RISK_CODE.CHAIN_CHANGED, "HIGH", false, "destination_chain_changed"));
  if (diff.visibilityChanged) risks.push(risk(RESOLUTION_RISK_CODE.VISIBILITY_CHANGED, "HIGH", false, "resolution_visibility_changed"));
  if (diff.bindingRevoked) {
    risks.push(risk(RESOLUTION_RISK_CODE.BINDING_REVOKED, "HIGH", true, "binding_is_revoked"));
  } else if (diff.noActiveDestination) {
    risks.push(risk(RESOLUTION_RISK_CODE.NO_ACTIVE_DESTINATION, "HIGH", true, "no_active_destination"));
  }
  return risks;
}

export function providerRisk(code: ResolutionRiskCode, detail: string): ResolutionRisk {
  // Provider/association/storage failures are unknown rather than safe. They
  // therefore block downstream use until the dependency is available again.
  return { code, level: "UNKNOWN", blocking: true, detail };
}

export function hasBlockingResolutionRisk(risks: readonly ResolutionRisk[]): boolean {
  return risks.some((item) => item.blocking);
}
