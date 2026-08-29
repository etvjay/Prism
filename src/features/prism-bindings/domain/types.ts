import type { PrismId } from "../../prism-identity/domain/identifiers";

export type { PrismId } from "../../prism-identity/domain/identifiers";

export const CHAIN_NAMESPACES = ["STARKNET", "BASE"] as const;
export type ChainNamespace = (typeof CHAIN_NAMESPACES)[number];

export const ENDPOINT_KINDS = [
  "ACCOUNT",
  "STRK20_PRIVATE_CONTEXT",
] as const;
export type EndpointKind = (typeof ENDPOINT_KINDS)[number];

/** A venue-specific place at which Prism can route execution. */
export interface ExecutionEndpoint {
  readonly id: string;
  readonly chain: ChainNamespace;
  readonly chainId: string;
  readonly kind: EndpointKind;
  /** Ordinary accounts expose an address; private contexts may not. */
  readonly address?: string;
}

export const BINDING_VISIBILITIES = ["PUBLIC", "SELECTIVE", "PRIVATE"] as const;
export type BindingVisibility = (typeof BINDING_VISIBILITIES)[number];

/** Durable v0 projection supported by the current binding store. */
export const PERSISTED_V0_BINDING_VISIBILITIES = ["PUBLIC", "PRIVATE"] as const;
export type PersistedV0BindingVisibility = (typeof PERSISTED_V0_BINDING_VISIBILITIES)[number];
export const PERSISTED_V0_BINDING_LIFECYCLE = "PERSISTENT" as const;
export type PersistedV0BindingLifecycle = typeof PERSISTED_V0_BINDING_LIFECYCLE;

export const BINDING_LIFECYCLES = ["PERSISTENT", "SESSION", "EPHEMERAL"] as const;
export type BindingLifecycle = (typeof BINDING_LIFECYCLES)[number];

export const BINDING_STATUSES = ["PENDING", "ACTIVE", "REVOKED"] as const;
export type BindingStatus = (typeof BINDING_STATUSES)[number];

/**
 * Evidence that a binding was exposed publicly at some point. The marker is
 * intentionally retained after unpublishing: changing visibility cannot erase
 * blockchain/indexer history.
 */
export interface PublicExposure {
  readonly firstExposedAt: number;
  readonly unpublishedAt?: number;
}

/**
 * A relationship between a persistent Prism identity and one endpoint.
 * `visibility` and `lifecycle` are separate axes by design.
 */
export interface Binding {
  readonly id: string;
  readonly prismId: PrismId;
  readonly endpointId: string;
  readonly authorityId: string;
  readonly disclosurePolicyId: string;
  readonly visibility: BindingVisibility;
  readonly lifecycle: BindingLifecycle;
  readonly status: BindingStatus;
  readonly createdAt: number;
  readonly expiresAt?: number;
  readonly revokedAt?: number;
  readonly publicExposure?: PublicExposure;
}

/**
 * Type-level projection for the current durable store. A SELECTIVE/session or
 * ephemeral binding is valid domain state but cannot satisfy this v0 type.
 */
export type V0PersistableBinding = Binding & {
  readonly visibility: PersistedV0BindingVisibility;
  readonly lifecycle: PersistedV0BindingLifecycle;
};

export interface CreateBindingInput {
  readonly id: string;
  readonly prismId: PrismId;
  readonly endpointId: string;
  readonly authorityId: string;
  readonly disclosurePolicyId: string;
  readonly visibility: BindingVisibility;
  readonly lifecycle: BindingLifecycle;
  readonly status?: BindingStatus;
  readonly createdAt: number;
  readonly expiresAt?: number;
  readonly revokedAt?: number;
  readonly publicExposure?: PublicExposure;
}

export interface BindingVisibilityChangeResult {
  readonly binding: Binding;
  /** True once the relationship has ever been publicly exposed. */
  readonly historicalPublic: boolean;
  /** True when a public association was hidden or otherwise needs disclosure warning. */
  readonly historyWarning: boolean;
  /** Signals the caller to revoke/unpublish the old public registry record. */
  readonly previousPublicBinding?: Binding;
  /** Signals the caller to revoke/unpublish the public registry record. */
  readonly publicAssociationHidden: boolean;
}
