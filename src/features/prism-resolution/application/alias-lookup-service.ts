// Provider-neutral alias lookup application boundary.
//
// This service owns provider evidence and the separate explicit
// alias-to-Prism association decision. It never parses an alias into a Prism ID
// and never reads or mutates canonical registry state.

import {
  isExplicitAliasAssociationResult,
  normalizeExternalAlias,
  type AliasAssociationResult,
  type AliasProviderStatus,
  type ExternalAlias,
  type ExternalAliasResolution,
  type IdentityAliasAssociationPort,
  type IdentityAliasProvider,
} from "../../../integrations/identity-alias/types";

export type AliasLookupState = "FOUND" | "NOT_FOUND" | "UNAVAILABLE" | "UNKNOWN";
export type AliasAssociationViewStatus = "ASSOCIATED" | "NOT_ASSOCIATED" | "UNAVAILABLE";

export interface AliasAssociationView {
  readonly status: AliasAssociationViewStatus;
  readonly prismId: string | null;
  readonly evidence: "explicit_prism_association" | null;
  readonly detail: string | null;
}

export interface AliasLookupResult {
  readonly status: AliasProviderStatus;
  /** Stable public state derived from provider evidence, not from a Prism ID string. */
  readonly state: AliasLookupState;
  readonly alias: ExternalAlias;
  /** Provider namespace subject; never a Prism ID. */
  readonly subject: string | null;
  readonly externalAddress: string | null;
  readonly canonicalValue: string | null;
  /** Null means no association decision was possible for this provider result. */
  readonly association: AliasAssociationView | null;
  /** Populated only when association.evidence is explicit_prism_association. */
  readonly prismId: string | null;
  readonly associationEvidence: "explicit_prism_association" | null;
  readonly detail: string | null;
}

export interface AliasLookupServiceOptions {
  /** Provider registry keyed by normalized provider namespace. */
  readonly providers?: ReadonlyMap<string, IdentityAliasProvider> | Readonly<Record<string, IdentityAliasProvider>>;
  /** Convenience injection for a single provider in focused tests. */
  readonly provider?: IdentityAliasProvider | null;
  /** Explicit Prism-owned association evidence; absent means unavailable. */
  readonly association?: IdentityAliasAssociationPort | null;
}

const PROVIDER_STATUSES: readonly AliasProviderStatus[] = [
  "RESOLVED",
  "NOT_FOUND",
  "UNAVAILABLE",
  "BLOCKED_BY_INTERFACE_EVIDENCE",
  "INVALID_RESPONSE",
  "INVALID_REQUEST",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function aliasState(status: AliasProviderStatus): AliasLookupState {
  switch (status) {
    case "RESOLVED":
      return "FOUND";
    case "NOT_FOUND":
      return "NOT_FOUND";
    case "UNAVAILABLE":
      return "UNAVAILABLE";
    case "BLOCKED_BY_INTERFACE_EVIDENCE":
    case "INVALID_RESPONSE":
    case "INVALID_REQUEST":
      return "UNKNOWN";
  }
}

function stableProviderDetail(status: AliasProviderStatus): string {
  switch (status) {
    case "RESOLVED":
      return "";
    case "NOT_FOUND":
      return "alias_not_found";
    case "UNAVAILABLE":
      return "alias_provider_unavailable";
    case "BLOCKED_BY_INTERFACE_EVIDENCE":
      return "alias_provider_interface_not_proven";
    case "INVALID_RESPONSE":
      return "alias_provider_response_invalid";
    case "INVALID_REQUEST":
      return "alias_provider_request_invalid";
  }
}

function safeAliasInput(value: unknown): ExternalAlias {
  return {
    provider: typeof (value as { provider?: unknown } | null)?.provider === "string"
      ? (value as { provider: string }).provider.trim().slice(0, 120).toLowerCase()
      : "",
    value: typeof (value as { value?: unknown } | null)?.value === "string"
      ? (value as { value: string }).value.trim().slice(0, 500).toLowerCase()
      : "",
  };
}

function safeNullableString(value: unknown, maxLength = 500): string | null {
  if (value === undefined || value === null) return null;
  return typeof value === "string" && value.trim().length > 0 ? value.trim().slice(0, maxLength) : null;
}

function baseResult(input: {
  readonly status: AliasProviderStatus;
  readonly alias: ExternalAlias;
  readonly subject?: string | null;
  readonly externalAddress?: string | null;
  readonly canonicalValue?: string | null;
  readonly association?: AliasAssociationView | null;
  readonly prismId?: string | null;
  readonly associationEvidence?: "explicit_prism_association" | null;
  readonly detail?: string | null;
}): AliasLookupResult {
  return {
    status: input.status,
    state: aliasState(input.status),
    alias: { provider: input.alias.provider, value: input.alias.value },
    subject: input.subject ?? null,
    externalAddress: input.externalAddress ?? null,
    canonicalValue: input.canonicalValue ?? null,
    association: input.association ?? null,
    prismId: input.prismId ?? null,
    associationEvidence: input.associationEvidence ?? null,
    detail: input.detail ?? (stableProviderDetail(input.status) || null),
  };
}

function invalidRequest(input: unknown, detail: string): AliasLookupResult {
  return baseResult({ status: "INVALID_REQUEST", alias: safeAliasInput(input), detail });
}

function blocked(alias: ExternalAlias, detail: string): AliasLookupResult {
  return baseResult({ status: "BLOCKED_BY_INTERFACE_EVIDENCE", alias, detail });
}

type NormalizedProviderResult = {
  readonly status: AliasProviderStatus;
  readonly alias: ExternalAlias;
  readonly subject: string | null;
  readonly externalAddress: string | null;
  readonly canonicalValue: string | null;
  readonly detail: string | null;
};

function providerResult(requested: ExternalAlias, value: unknown): NormalizedProviderResult {
  if (!isRecord(value) || typeof value.status !== "string" || !PROVIDER_STATUSES.includes(value.status as AliasProviderStatus)) {
    return { status: "INVALID_RESPONSE", alias: requested, subject: null, externalAddress: null, canonicalValue: null, detail: "alias_provider_response_invalid" };
  }

  const status = value.status as AliasProviderStatus;
  let providerAlias: ExternalAlias;
  try {
    providerAlias = normalizeExternalAlias(value.alias as ExternalAlias);
  } catch {
    return { status: "INVALID_RESPONSE", alias: requested, subject: null, externalAddress: null, canonicalValue: null, detail: "alias_provider_alias_invalid" };
  }
  if (providerAlias.provider !== requested.provider) {
    return { status: "INVALID_RESPONSE", alias: requested, subject: null, externalAddress: null, canonicalValue: null, detail: "alias_provider_namespace_mismatch" };
  }
  if (value.externalAddress !== undefined && value.externalAddress !== null && typeof value.externalAddress !== "string") {
    return { status: "INVALID_RESPONSE", alias: providerAlias, subject: null, externalAddress: null, canonicalValue: null, detail: "alias_provider_external_address_invalid" };
  }
  if (value.canonicalValue !== undefined && value.canonicalValue !== null && typeof value.canonicalValue !== "string") {
    return { status: "INVALID_RESPONSE", alias: providerAlias, subject: null, externalAddress: null, canonicalValue: null, detail: "alias_provider_canonical_value_invalid" };
  }

  if (status !== "RESOLVED") {
    // A failed provider result never carries a usable subject/address forward.
    return {
      status,
      alias: providerAlias,
      subject: null,
      externalAddress: null,
      canonicalValue: null,
      detail: stableProviderDetail(status),
    };
  }

  const subject = safeNullableString(value.subject);
  if (subject === null) {
    return { status: "INVALID_RESPONSE", alias: providerAlias, subject: null, externalAddress: null, canonicalValue: null, detail: "alias_provider_subject_missing" };
  }
  return {
    status,
    alias: providerAlias,
    subject,
    externalAddress: safeNullableString(value.externalAddress),
    canonicalValue: safeNullableString(value.canonicalValue),
    // Provider-native detail is intentionally not returned or passed through.
    detail: null,
  };
}

function associationView(result: unknown): AliasAssociationView {
  if (isExplicitAliasAssociationResult(result)) {
    return {
      status: "ASSOCIATED",
      prismId: result.prismId,
      evidence: "explicit_prism_association",
      detail: null,
    };
  }
  if (isRecord(result) && result.status === "NOT_ASSOCIATED") {
    return {
      status: "NOT_ASSOCIATED",
      prismId: null,
      evidence: null,
      detail: "alias_not_explicitly_associated",
    };
  }
  if (isRecord(result) && result.status === "UNAVAILABLE") {
    return {
      status: "UNAVAILABLE",
      prismId: null,
      evidence: null,
      detail: "explicit_prism_association_unavailable",
    };
  }
  return {
    status: "UNAVAILABLE",
    prismId: null,
    evidence: null,
    detail: "explicit_prism_association_evidence_invalid",
  };
}

function providersFrom(options: AliasLookupServiceOptions): Map<string, IdentityAliasProvider> {
  const map = new Map<string, IdentityAliasProvider>();
  if (options.providers instanceof Map) {
    for (const [provider, adapter] of options.providers.entries()) {
      if (typeof provider === "string" && adapter) map.set(provider.trim().toLowerCase(), adapter);
    }
  } else if (options.providers) {
    for (const [provider, adapter] of Object.entries(options.providers)) {
      if (adapter) map.set(provider.trim().toLowerCase(), adapter);
    }
  }
  if (options.provider) map.set(options.provider.providerId.trim().toLowerCase(), options.provider);
  return map;
}

export class AliasLookupService {
  private readonly providers: ReadonlyMap<string, IdentityAliasProvider>;
  private readonly association: IdentityAliasAssociationPort | null;

  constructor(options: AliasLookupServiceOptions = {}) {
    this.providers = providersFrom(options);
    this.association = options.association ?? null;
  }

  async lookup(input: ExternalAlias): Promise<AliasLookupResult> {
    let alias: ExternalAlias;
    try {
      alias = normalizeExternalAlias(input);
    } catch (cause) {
      return invalidRequest(input, cause instanceof Error ? cause.message : "invalid_external_alias");
    }

    const provider = this.providers.get(alias.provider);
    if (!provider || typeof provider.resolve !== "function") return blocked(alias, "alias_provider_not_configured");
    if (typeof provider.providerId !== "string" || provider.providerId.trim().toLowerCase() !== alias.provider) {
      return blocked(alias, "alias_provider_namespace_not_configured");
    }

    let raw: unknown;
    try {
      raw = await provider.resolve(alias);
    } catch {
      return baseResult({ status: "UNAVAILABLE", alias, detail: "alias_provider_unavailable" });
    }

    const normalized = providerResult(alias, raw);
    if (normalized.status !== "RESOLVED") return baseResult(normalized);

    if (!this.association) {
      return baseResult({
        ...normalized,
        association: {
          status: "UNAVAILABLE",
          prismId: null,
          evidence: null,
          detail: "explicit_prism_association_not_configured",
        },
      });
    }

    let association: AliasAssociationResult | unknown;
    try {
      association = await this.association.resolve({
        alias: normalized.alias,
        resolution: {
          status: normalized.status,
          alias: normalized.alias,
          subject: normalized.subject,
          externalAddress: normalized.externalAddress,
          canonicalValue: normalized.canonicalValue,
          detail: null,
        },
      });
    } catch {
      return baseResult({
        ...normalized,
        association: {
          status: "UNAVAILABLE",
          prismId: null,
          evidence: null,
          detail: "explicit_prism_association_unavailable",
        },
      });
    }

    const view = associationView(association);
    return baseResult({
      ...normalized,
      association: view,
      prismId: view.status === "ASSOCIATED" ? view.prismId : null,
      associationEvidence: view.evidence,
    });
  }

  async lookupAlias(input: ExternalAlias): Promise<AliasLookupResult> {
    return this.lookup(input);
  }
}

/** JSON-safe projection helper for transport adapters. */
export function serializeAliasLookupResult(result: AliasLookupResult): AliasLookupResult {
  return {
    status: result.status,
    state: result.state,
    alias: { provider: result.alias.provider, value: result.alias.value },
    subject: result.subject,
    externalAddress: result.externalAddress,
    canonicalValue: result.canonicalValue,
    association: result.association
      ? {
          status: result.association.status,
          prismId: result.association.prismId,
          evidence: result.association.evidence,
          detail: result.association.detail,
        }
      : null,
    prismId: result.prismId,
    associationEvidence: result.associationEvidence,
    detail: result.detail,
  };
}
