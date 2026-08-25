import {
  assertValidPrismId,
  type PrismId,
} from "../../prism-identity/domain/identifiers";

export type { PrismId } from "../../prism-identity/domain/identifiers";
import {
  IdentityAuthorityDomainError,
  invariant,
  requireFiniteTimestamp,
  requireNonEmpty,
} from "../../prism-bindings/domain/errors";
import {
  BINDING_VISIBILITIES,
  type BindingVisibility,
} from "../../prism-bindings/domain/types";

export type DisclosurePurpose = "PAYMENT" | "TRADING" | "IDENTITY_VERIFICATION";
export const DISCLOSURE_PURPOSES = ["PAYMENT", "TRADING", "IDENTITY_VERIFICATION"] as const;

export interface DisclosurePolicy {
  readonly id: string;
  readonly visibility: BindingVisibility;
  readonly allowedPrincipals?: readonly PrismId[];
  readonly allowedApplications?: readonly string[];
  readonly allowedPurposes?: readonly DisclosurePurpose[];
  readonly expiresAt?: number;
}

export interface DisclosurePolicyInput {
  readonly id: string;
  readonly visibility: BindingVisibility;
  readonly allowedPrincipals?: readonly PrismId[];
  readonly allowedApplications?: readonly string[];
  readonly allowedPurposes?: readonly DisclosurePurpose[];
  readonly expiresAt?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPurpose(value: unknown): value is DisclosurePurpose {
  return typeof value === "string" && (DISCLOSURE_PURPOSES as readonly string[]).includes(value);
}

function assertPrincipal(value: unknown): asserts value is PrismId {
  invariant(typeof value === "string", "allowed_principal_invalid");
  try {
    assertValidPrismId(value);
  } catch {
    throw new IdentityAuthorityDomainError("allowed_principal_malformed");
  }
}

function assertStringList(value: unknown, field: string): asserts value is readonly string[] {
  invariant(Array.isArray(value), `${field}_must_be_array`);
  for (const entry of value) requireNonEmpty(entry, field);
  invariant(new Set(value).size === value.length, `${field}_contains_duplicates`);
}

/** Runtime guard for a disclosure policy. */
export function assertDisclosurePolicy(value: unknown): asserts value is DisclosurePolicy {
  invariant(isRecord(value), "disclosure_policy_required");
  requireNonEmpty(value.id, "disclosure_policy_id");
  invariant(
    typeof value.visibility === "string" && (BINDING_VISIBILITIES as readonly string[]).includes(value.visibility),
    "unsupported_binding_visibility",
  );

  if (value.allowedPrincipals !== undefined) {
    invariant(Array.isArray(value.allowedPrincipals), "allowed_principals_must_be_array");
    for (const principal of value.allowedPrincipals) assertPrincipal(principal);
    invariant(new Set(value.allowedPrincipals).size === value.allowedPrincipals.length, "allowed_principals_contains_duplicates");
  }
  if (value.allowedApplications !== undefined) assertStringList(value.allowedApplications, "allowed_applications");
  if (value.allowedPurposes !== undefined) {
    invariant(Array.isArray(value.allowedPurposes), "allowed_purposes_must_be_array");
    for (const purpose of value.allowedPurposes) invariant(isPurpose(purpose), "allowed_purpose_invalid");
    invariant(new Set(value.allowedPurposes).size === value.allowedPurposes.length, "allowed_purposes_contains_duplicates");
  }
  if (value.expiresAt !== undefined) {
    const expiresAt = requireFiniteTimestamp(value.expiresAt, "disclosure_expires_at");
    invariant(expiresAt >= 0, "disclosure_expires_at_invalid_timestamp");
  }

  const hasPrincipalAudience = Array.isArray(value.allowedPrincipals) && value.allowedPrincipals.length > 0;
  const hasApplicationAudience = Array.isArray(value.allowedApplications) && value.allowedApplications.length > 0;
  const hasPurposeRestriction = Array.isArray(value.allowedPurposes) && value.allowedPurposes.length > 0;

  if (value.visibility === "PUBLIC") {
    invariant(value.allowedPrincipals === undefined && value.allowedApplications === undefined, "public_policy_cannot_have_allowlist");
    invariant(value.allowedPurposes === undefined, "public_policy_cannot_have_purpose_restriction");
  }
  if (value.visibility === "SELECTIVE") {
    invariant(hasPrincipalAudience || hasApplicationAudience, "selective_policy_requires_audience");
  }
  if (value.visibility === "PRIVATE") {
    invariant(value.allowedPrincipals === undefined && value.allowedApplications === undefined, "private_policy_cannot_have_allowlist");
    invariant(value.allowedPurposes === undefined, "private_policy_cannot_have_purpose_restriction");
  }
}

export function createDisclosurePolicy(input: DisclosurePolicyInput): DisclosurePolicy {
  invariant(isRecord(input), "disclosure_policy_input_required");
  const policy: DisclosurePolicy = {
    id: requireNonEmpty(input.id, "disclosure_policy_id"),
    visibility: input.visibility,
    ...(input.allowedPrincipals === undefined ? {} : { allowedPrincipals: [...input.allowedPrincipals] }),
    ...(input.allowedApplications === undefined ? {} : { allowedApplications: [...input.allowedApplications] }),
    ...(input.allowedPurposes === undefined ? {} : { allowedPurposes: [...input.allowedPurposes] }),
    ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
  };
  assertDisclosurePolicy(policy);
  return policy;
}

export interface DisclosureRequest {
  readonly requesterPrismId?: PrismId;
  readonly application?: string;
  readonly purpose?: DisclosurePurpose;
  readonly isOwner?: boolean;
  readonly now?: number;
}

export function isDisclosurePolicyExpired(policy: DisclosurePolicy, now: number): boolean {
  assertDisclosurePolicy(policy);
  const current = requireFiniteTimestamp(now, "disclosure_now");
  return policy.expiresAt !== undefined && current >= policy.expiresAt;
}

/**
 * Fail-closed disclosure evaluation. PRIVATE is owner-context only; SELECTIVE
 * requires an explicitly listed principal/application and optional purpose.
 */
export function isDisclosureAllowed(policy: DisclosurePolicy, request: DisclosureRequest = {}): boolean {
  assertDisclosurePolicy(policy);
  if (policy.expiresAt !== undefined) {
    if (request.now === undefined || !Number.isFinite(request.now)) return false;
    if (request.now >= policy.expiresAt) return false;
  }

  if (policy.visibility === "PUBLIC") return true;
  if (policy.visibility === "PRIVATE") return request.isOwner === true;

  const principalAllowed = request.requesterPrismId !== undefined
    && policy.allowedPrincipals?.includes(request.requesterPrismId) === true;
  const applicationAllowed = request.application !== undefined
    && policy.allowedApplications?.includes(request.application) === true;
  if (!principalAllowed && !applicationAllowed) return false;
  return policy.allowedPurposes === undefined
    || (request.purpose !== undefined && policy.allowedPurposes.includes(request.purpose));
}

export const canDisclose = isDisclosureAllowed;

export interface DisclosurePolicyTransitionOptions {
  readonly publish?: boolean;
}

export function transitionDisclosurePolicy(
  policy: DisclosurePolicy,
  visibility: BindingVisibility,
  options: DisclosurePolicyTransitionOptions = {},
): DisclosurePolicy {
  assertDisclosurePolicy(policy);
  if (visibility === "PUBLIC" && policy.visibility !== "PUBLIC") {
    invariant(options.publish === true, "publish_confirmation_required");
  }
  return createDisclosurePolicy({
    ...policy,
    visibility,
  });
}
