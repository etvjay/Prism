// Provider-neutral external-identity contracts.
//
// An ExternalAlias is an addressable value owned by another identity system.
// It is deliberately not a PrismId and carries no implicit Prism association.
// Adapters may provide evidence about the external subject; only an explicit
// PrismAliasAssociationPort may associate that subject with a Prism identity.

import { assertValidPrismId, type PrismId } from "../../features/prism-identity/domain/identifiers";

export type AliasProviderStatus =
  | "RESOLVED"
  | "NOT_FOUND"
  | "UNAVAILABLE"
  | "BLOCKED_BY_INTERFACE_EVIDENCE"
  | "INVALID_RESPONSE"
  | "INVALID_REQUEST";

export interface ExternalAlias {
  readonly provider: string;
  readonly value: string;
}

export function normalizeExternalAlias(alias: ExternalAlias): ExternalAlias {
  if (!alias || typeof alias !== "object") {
    throw new Error("external_alias_required");
  }
  if (typeof alias.provider !== "string" || alias.provider.trim().length === 0) {
    throw new Error("external_alias_provider_required");
  }
  if (typeof alias.value !== "string" || alias.value.trim().length === 0) {
    throw new Error("external_alias_value_required");
  }
  return {
    provider: alias.provider.trim().toLowerCase(),
    value: alias.value.trim().toLowerCase(),
  };
}

export interface ExternalAliasResolution {
  readonly status: AliasProviderStatus;
  /** Canonical external alias returned by the provider. */
  readonly alias: ExternalAlias;
  /** Stable subject in the external provider's namespace, never a Prism ID. */
  readonly subject: string | null;
  /** Optional provider-native destination/address evidence. */
  readonly externalAddress?: string | null;
  /** Provider-native canonical/display value, if available. */
  readonly canonicalValue?: string | null;
  readonly detail?: string | null;
}

/**
 * Provider-neutral alias lookup boundary. Implementations must return a typed
 * unavailable/blocked result for dependency or interface-evidence failures;
 * callers must never infer identity from an alias string alone.
 */
export interface IdentityAliasProvider {
  readonly providerId: string;
  resolve(alias: ExternalAlias): Promise<ExternalAliasResolution>;
}

export type AliasAssociationResult =
  | {
      readonly status: "ASSOCIATED";
      readonly prismId: PrismId;
      /** Evidence is explicit Prism-owned association, not alias parsing. */
      readonly evidence: "explicit_prism_association";
    }
  | {
      readonly status: "NOT_ASSOCIATED";
      readonly detail?: string | null;
    }
  | {
      readonly status: "UNAVAILABLE";
      readonly detail?: string | null;
    };

/**
 * Runtime guard for the only result that may cross the alias → Prism
 * association boundary. Provider ports are effectful/JSON-shaped and callers
 * can bypass TypeScript with an `as` cast, so a status plus a Prism-looking
 * string is not association evidence.
 */
export function isExplicitAliasAssociationResult(value: unknown): value is Extract<AliasAssociationResult, { status: "ASSOCIATED" }> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.status !== "ASSOCIATED" || candidate.evidence !== "explicit_prism_association" || typeof candidate.prismId !== "string") return false;
  try {
    assertValidPrismId(candidate.prismId);
    return true;
  } catch {
    return false;
  }
}

/**
 * Separate boundary for an explicit alias → Prism association. Keeping this
 * separate prevents an external provider's subject/name from becoming a
 * canonical Prism identity by accident.
 */
export interface IdentityAliasAssociationPort {
  resolve(input: {
    readonly alias: ExternalAlias;
    readonly resolution: ExternalAliasResolution;
  }): Promise<AliasAssociationResult>;
}

export function providerFailureStatus(status: AliasProviderStatus): boolean {
  return status !== "RESOLVED";
}
