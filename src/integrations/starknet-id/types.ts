// Typed boundary for Starknet ID integration.
//
// This module intentionally contains no RPC/client implementation. The
// first-party Starknet ID interface is not treated as proven here; callers
// inject a port only after they have an independently reviewed adapter. The
// adapter returns external-subject evidence, never a Prism ID.

import type { ExternalAlias } from "../identity-alias/types";
export type {
  AliasAssociationResult,
  AliasProviderStatus,
  ExternalAlias,
  ExternalAliasResolution,
  IdentityAliasAssociationPort,
  IdentityAliasProvider,
} from "../identity-alias/types";
export { normalizeExternalAlias } from "../identity-alias/types";

export const STARKNET_ID_PROVIDER_ID = "starknet-id" as const;
export type StarknetIdAlias = ExternalAlias;

export interface StarknetIdLookupResult {
  /** Stable subject in the Starknet ID namespace. */
  readonly subject?: string | null;
  /** Some adapters expose the resolved Starknet address instead of a subject. */
  readonly address?: string | null;
  /** Provider-canonical name/display value, if the port can prove it. */
  readonly canonicalValue?: string | null;
}

/**
 * Adapter port only. A real implementation must be supplied explicitly; no
 * network fallback is hidden in StarknetIdAliasProvider.
 */
export interface StarknetIdLookupPort {
  lookup(alias: StarknetIdAlias): Promise<StarknetIdLookupResult | null>;
}

/** Alias used by callers that name the integration boundary explicitly. */
export type StarknetIdAdapterPort = StarknetIdLookupPort;
