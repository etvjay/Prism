import {
  normalizeExternalAlias,
  type ExternalAlias,
  type ExternalAliasResolution,
  type IdentityAliasProvider,
} from "../identity-alias/types";
import { STARKNET_ID_PROVIDER_ID, type StarknetIdLookupPort } from "./types";

function resultFor(alias: ExternalAlias, status: ExternalAliasResolution["status"], detail: string, subject: string | null = null, canonicalValue: string | null = null): ExternalAliasResolution {
  return { status, alias, subject, canonicalValue, detail };
}

/**
 * Provider boundary for Starknet ID.
 *
 * With no injected lookup port this adapter is deliberately blocked by the
 * evidence gate. It does not call a default endpoint, import an RPC client, or
 * convert a Starknet ID name/address into a Prism ID.
 */
export class StarknetIdAliasProvider implements IdentityAliasProvider {
  readonly providerId = STARKNET_ID_PROVIDER_ID;
  private readonly lookupPort: StarknetIdLookupPort | null;

  constructor(lookupPort?: StarknetIdLookupPort | null) {
    this.lookupPort = lookupPort ?? null;
  }

  async resolve(input: ExternalAlias): Promise<ExternalAliasResolution> {
    let alias: ExternalAlias;
    try {
      alias = normalizeExternalAlias(input);
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : "invalid_external_alias";
      return resultFor(
        {
          provider: typeof input?.provider === "string" ? input.provider : this.providerId,
          value: typeof input?.value === "string" ? input.value : "",
        },
        "INVALID_REQUEST",
        detail,
      );
    }

    if (alias.provider !== this.providerId) {
      return resultFor(alias, "INVALID_REQUEST", "provider_mismatch");
    }

    if (!this.lookupPort) {
      return resultFor(alias, "BLOCKED_BY_INTERFACE_EVIDENCE", "starknet_id_interface_not_proven");
    }

    let record;
    try {
      record = await this.lookupPort.lookup(alias);
    } catch {
      return resultFor(alias, "UNAVAILABLE", "starknet_id_provider_unavailable");
    }
    if (record === null) {
      return resultFor(alias, "NOT_FOUND", "starknet_id_alias_not_found");
    }
    const subject = typeof record?.subject === "string" && record.subject.trim().length > 0
      ? record.subject.trim()
      : typeof record?.address === "string" && record.address.trim().length > 0
        ? record.address.trim()
        : null;
    if (!subject) {
      return resultFor(alias, "INVALID_RESPONSE", "starknet_id_subject_missing");
    }
    if (record.address !== undefined && record.address !== null && (typeof record.address !== "string" || record.address.trim().length === 0)) {
      return resultFor(alias, "INVALID_RESPONSE", "starknet_id_address_invalid");
    }
    if (record.canonicalValue !== undefined && record.canonicalValue !== null && typeof record.canonicalValue !== "string") {
      return resultFor(alias, "INVALID_RESPONSE", "starknet_id_canonical_value_invalid");
    }

    return {
      status: "RESOLVED",
      alias,
      subject,
      externalAddress: record.address?.trim() || null,
      canonicalValue: record.canonicalValue?.trim() || null,
      detail: null,
    };
  }

  async resolveAlias(input: ExternalAlias): Promise<ExternalAliasResolution> {
    return this.resolve(input);
  }

  async lookup(input: ExternalAlias): Promise<ExternalAliasResolution> {
    return this.resolve(input);
  }
}

/** Explicit names for callers that prefer adapter/provider terminology. */
export const StarknetIdAdapter = StarknetIdAliasProvider;
export const StarknetIdProvider = StarknetIdAliasProvider;
