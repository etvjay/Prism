import {
  assertValidPrismId,
  type PrismId,
} from "../../prism-identity/domain/identifiers";
import type { DisclosurePolicy } from "../../prism-disclosure/domain/policy";
import { assertDisclosurePolicy } from "../../prism-disclosure/domain/policy";
import type { Authority } from "../../prism-authority/domain/types";
import { assertAuthority } from "../../prism-authority/domain/authority";
import {
  IdentityAuthorityDomainError,
  invariant,
  requireFiniteTimestamp,
  requireNonEmpty,
} from "./errors";
import {
  BINDING_LIFECYCLES,
  BINDING_STATUSES,
  BINDING_VISIBILITIES,
  CHAIN_NAMESPACES,
  ENDPOINT_KINDS,
  PERSISTED_V0_BINDING_LIFECYCLE,
  type Binding,
  type BindingLifecycle,
  type BindingStatus,
  type BindingVisibility,
  type BindingVisibilityChangeResult,
  type CreateBindingInput,
  type ExecutionEndpoint,
  type PublicExposure,
  type V0PersistableBinding,
} from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

function assertPrismId(value: unknown): asserts value is PrismId {
  invariant(typeof value === "string", "prism_id_required");
  try {
    assertValidPrismId(value);
  } catch {
    throw new IdentityAuthorityDomainError("malformed_prism_id");
  }
}

function assertPublicExposure(value: unknown): asserts value is PublicExposure {
  invariant(isRecord(value), "public_exposure_invalid");
  const firstExposedAt = requireFiniteTimestamp(value.firstExposedAt, "first_exposed_at");
  invariant(firstExposedAt >= 0, "first_exposed_at_invalid_timestamp");
  if (value.unpublishedAt !== undefined) {
    const unpublishedAt = requireFiniteTimestamp(value.unpublishedAt, "unpublished_at");
    invariant(unpublishedAt >= firstExposedAt, "unpublished_at_before_first_exposed_at");
  }
}

/** Runtime guard for the endpoint boundary. */
export function assertExecutionEndpoint(value: unknown): asserts value is ExecutionEndpoint {
  invariant(isRecord(value), "execution_endpoint_required");
  requireNonEmpty(value.id, "endpoint_id");
  invariant(isOneOf(CHAIN_NAMESPACES, value.chain), "unsupported_chain_namespace");
  requireNonEmpty(value.chainId, "endpoint_chain_id");
  invariant(isOneOf(ENDPOINT_KINDS, value.kind), "unsupported_endpoint_kind");

  if (value.address !== undefined) requireNonEmpty(value.address, "endpoint_address");
  if (value.kind === "ACCOUNT") invariant(value.address !== undefined, "account_address_required");
  if (value.kind !== "ACCOUNT") {
    invariant(value.chain === "STARKNET", "strk20_endpoint_requires_starknet");
  }
}

export function createExecutionEndpoint(input: ExecutionEndpoint): ExecutionEndpoint {
  assertExecutionEndpoint(input);
  return {
    id: requireNonEmpty(input.id, "endpoint_id"),
    chain: input.chain,
    chainId: requireNonEmpty(input.chainId, "endpoint_chain_id"),
    kind: input.kind,
    ...(input.address === undefined ? {} : { address: requireNonEmpty(input.address, "endpoint_address") }),
  };
}

/** Runtime guard for the binding record and its historical-public marker. */
export function assertBinding(value: unknown): asserts value is Binding {
  invariant(isRecord(value), "binding_required");
  requireNonEmpty(value.id, "binding_id");
  assertPrismId(value.prismId);
  requireNonEmpty(value.endpointId, "endpoint_id");
  requireNonEmpty(value.authorityId, "authority_id");
  requireNonEmpty(value.disclosurePolicyId, "disclosure_policy_id");
  invariant(isOneOf(BINDING_VISIBILITIES, value.visibility), "unsupported_binding_visibility");
  invariant(isOneOf(BINDING_LIFECYCLES, value.lifecycle), "unsupported_binding_lifecycle");
  invariant(isOneOf(BINDING_STATUSES, value.status), "unsupported_binding_status");

  const createdAt = requireFiniteTimestamp(value.createdAt, "created_at");
  invariant(createdAt >= 0, "created_at_invalid_timestamp");

  if (value.expiresAt !== undefined) {
    const expiresAt = requireFiniteTimestamp(value.expiresAt, "expires_at");
    invariant(expiresAt > createdAt, "expires_at_must_be_after_created_at");
  }
  if (value.lifecycle !== "PERSISTENT") {
    invariant(value.expiresAt !== undefined, "non_persistent_binding_requires_expiry");
  }

  if (value.status === "REVOKED") {
    invariant(value.revokedAt !== undefined, "revoked_binding_requires_revoked_at");
    const revokedAt = requireFiniteTimestamp(value.revokedAt, "revoked_at");
    invariant(revokedAt >= createdAt, "revoked_at_before_created_at");
  } else {
    invariant(value.revokedAt === undefined, "active_binding_cannot_have_revoked_at");
  }

  if (value.publicExposure !== undefined) assertPublicExposure(value.publicExposure);
  if (value.visibility === "PUBLIC" && value.status !== "REVOKED") {
    invariant(value.publicExposure !== undefined, "public_binding_requires_exposure_record");
    invariant(value.publicExposure.unpublishedAt === undefined, "active_public_binding_cannot_be_unpublished");
  }
}

/**
 * Runtime guard for callers crossing into the durable v0 projection. The
 * broader domain still accepts SELECTIVE and short-lived lifecycles; this
 * guard makes their deferred persistence status explicit.
 */
export function assertV0PersistableBinding(value: unknown): asserts value is V0PersistableBinding {
  assertBinding(value);
  if (value.visibility === "SELECTIVE") throw new IdentityAuthorityDomainError("selective_persistence_deferred");
  invariant(value.visibility === "PUBLIC" || value.visibility === "PRIVATE", "unsupported_v0_binding_visibility");
  invariant(value.lifecycle === PERSISTED_V0_BINDING_LIFECYCLE, "non_persistent_lifecycle_deferred");
}

export function assertBindingUsesDisclosurePolicy(binding: Binding, policy: DisclosurePolicy): void {
  assertBinding(binding);
  assertDisclosurePolicy(policy);
  invariant(binding.disclosurePolicyId === policy.id, "binding_disclosure_policy_id_mismatch");
  invariant(binding.visibility === policy.visibility, "binding_disclosure_visibility_mismatch");
}

export function assertBindingUsesAuthority(binding: Binding, authority: Authority): void {
  assertBinding(binding);
  assertAuthority(authority);
  invariant(binding.authorityId === authority.id, "binding_authority_id_mismatch");
  invariant(binding.endpointId === authority.endpointId, "binding_authority_endpoint_mismatch");
}

export function createBinding(input: CreateBindingInput): Binding {
  invariant(isRecord(input), "binding_input_required");
  const status = input.status ?? "PENDING";
  const createdAt = requireFiniteTimestamp(input.createdAt, "created_at");
  const publicExposure = input.publicExposure ?? (
    input.visibility === "PUBLIC" ? { firstExposedAt: createdAt } : undefined
  );
  const binding: Binding = {
    id: requireNonEmpty(input.id, "binding_id"),
    prismId: input.prismId,
    endpointId: requireNonEmpty(input.endpointId, "endpoint_id"),
    authorityId: requireNonEmpty(input.authorityId, "authority_id"),
    disclosurePolicyId: requireNonEmpty(input.disclosurePolicyId, "disclosure_policy_id"),
    visibility: input.visibility,
    lifecycle: input.lifecycle,
    status,
    createdAt,
    ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
    ...(status === "REVOKED" && input.revokedAt !== undefined ? { revokedAt: input.revokedAt } : {}),
    ...(publicExposure === undefined ? {} : {
      publicExposure: {
        firstExposedAt: publicExposure.firstExposedAt,
        ...(publicExposure.unpublishedAt === undefined ? {} : { unpublishedAt: publicExposure.unpublishedAt }),
      },
    }),
  };

  // A caller cannot smuggle status/timestamp contradictions through the input.
  assertBinding(binding);
  return binding;
}

export function canTransitionBindingStatus(from: BindingStatus, to: BindingStatus): boolean {
  if (!isOneOf(BINDING_STATUSES, from) || !isOneOf(BINDING_STATUSES, to) || from === to) return false;
  return (
    (from === "PENDING" && (to === "ACTIVE" || to === "REVOKED")) ||
    (from === "ACTIVE" && to === "REVOKED")
  );
}

export interface BindingStatusTransitionInput {
  readonly to: BindingStatus;
  readonly now: number;
}

export function transitionBinding(binding: Binding, input: BindingStatusTransitionInput): Binding {
  invariant(isRecord(input), "binding_transition_input_required");
  assertBinding(binding);
  requireFiniteTimestamp(input.now, "transition_now");
  invariant(input.now >= binding.createdAt, "transition_before_created_at");
  invariant(canTransitionBindingStatus(binding.status, input.to), "binding_transition_not_allowed");

  if (input.to === "ACTIVE") {
    if (binding.expiresAt !== undefined) invariant(input.now < binding.expiresAt, "binding_expired");
    return { ...binding, status: "ACTIVE" };
  }

  const exposure = binding.visibility === "PUBLIC"
    ? {
        firstExposedAt: binding.publicExposure?.firstExposedAt ?? binding.createdAt,
        unpublishedAt: binding.publicExposure?.unpublishedAt ?? input.now,
      }
    : binding.publicExposure;
  const next: Binding = {
    ...binding,
    status: "REVOKED",
    revokedAt: input.now,
    ...(exposure === undefined ? {} : { publicExposure: exposure }),
  };
  assertBinding(next);
  return next;
}

export function activateBinding(binding: Binding, now: number): Binding {
  return transitionBinding(binding, { to: "ACTIVE", now });
}

export function revokeBinding(binding: Binding, now: number): Binding {
  if (binding.status === "REVOKED") throw new IdentityAuthorityDomainError("binding_already_revoked");
  return transitionBinding(binding, { to: "REVOKED", now });
}

/** BindingStatus has no separate EXPIRED state; expiry is a revocation reason. */
export function expireBinding(binding: Binding, now: number): Binding {
  assertBinding(binding);
  invariant(binding.lifecycle !== "PERSISTENT", "persistent_binding_cannot_expire");
  invariant(binding.expiresAt !== undefined, "non_persistent_binding_requires_expiry");
  requireFiniteTimestamp(now, "binding_expiry_now");
  invariant(now >= binding.expiresAt, "binding_not_expired");
  return revokeBinding(binding, now);
}

export interface ChangeBindingVisibilityOptions {
  /** Required when making a binding publicly discoverable. */
  readonly publish?: boolean;
}

/**
 * Changes the current disclosure label without erasing historical exposure.
 * The returned `publicAssociationHidden` flag is the adapter/application
 * instruction to revoke the old public registry record.
 */
export function changeBindingVisibility(
  binding: Binding,
  visibility: BindingVisibility,
  now: number,
  options: ChangeBindingVisibilityOptions = {},
): BindingVisibilityChangeResult {
  assertBinding(binding);
  invariant(isOneOf(BINDING_VISIBILITIES, visibility), "unsupported_binding_visibility");
  requireFiniteTimestamp(now, "visibility_change_now");
  invariant(now >= binding.createdAt, "visibility_change_before_created_at");
  invariant(binding.status !== "REVOKED", "revoked_binding_visibility_immutable");

  if (visibility === binding.visibility) {
    return {
      binding,
      historicalPublic: binding.publicExposure !== undefined,
      historyWarning: false,
      publicAssociationHidden: false,
    };
  }

  if (visibility === "PUBLIC") {
    invariant(options.publish === true, "publish_confirmation_required");
    const exposure: PublicExposure = {
      firstExposedAt: binding.publicExposure?.firstExposedAt ?? now,
    };
    const next: Binding = { ...binding, visibility, publicExposure: exposure };
    assertBinding(next);
    return {
      binding: next,
      historicalPublic: true,
      historyWarning: false,
      publicAssociationHidden: false,
    };
  }

  const publicAssociationHidden = binding.visibility === "PUBLIC";
  const exposure = publicAssociationHidden
    ? {
        firstExposedAt: binding.publicExposure?.firstExposedAt ?? binding.createdAt,
        unpublishedAt: now,
      }
    : binding.publicExposure;
  const next: Binding = {
    ...binding,
    visibility,
    ...(exposure === undefined ? {} : { publicExposure: exposure }),
  };
  assertBinding(next);
  const previousPublicBinding = publicAssociationHidden
    ? {
        ...binding,
        visibility: "PUBLIC" as const,
        status: "REVOKED" as const,
        revokedAt: now,
        publicExposure: exposure!,
      }
    : undefined;
  if (previousPublicBinding !== undefined) assertBinding(previousPublicBinding);
  return {
    binding: next,
    historicalPublic: exposure !== undefined,
    historyWarning: publicAssociationHidden,
    ...(previousPublicBinding === undefined ? {} : { previousPublicBinding }),
    publicAssociationHidden,
  };
}

export function publishBinding(binding: Binding, now: number): BindingVisibilityChangeResult {
  return changeBindingVisibility(binding, "PUBLIC", now, { publish: true });
}

export function hidePublicBinding(binding: Binding, now: number): BindingVisibilityChangeResult {
  return changeBindingVisibility(binding, "PRIVATE", now);
}
