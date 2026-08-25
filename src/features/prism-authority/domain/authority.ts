import {
  IdentityAuthorityDomainError,
  invariant,
  requireNonEmpty,
} from "../../prism-bindings/domain/errors";
import {
  AUTHORITY_STATUSES,
  type Authority,
  type AuthorityStatus,
  type AuthoritySubject,
} from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function assertSubject(value: unknown): asserts value is AuthoritySubject {
  invariant(isRecord(value), "authority_subject_required");
  invariant(value.type === "OWNER" || value.type === "SESSION_KEY", "authority_subject_type_invalid");
  if (value.type === "OWNER") requireNonEmpty(value.account, "owner_account");
  else requireNonEmpty(value.publicKey, "session_public_key");
}

export function assertAuthority(value: unknown): asserts value is Authority {
  invariant(isRecord(value), "authority_required");
  requireNonEmpty(value.id, "authority_id");
  requireNonEmpty(value.endpointId, "endpoint_id");
  assertSubject(value.subject);
  invariant(
    typeof value.status === "string" && (AUTHORITY_STATUSES as readonly string[]).includes(value.status),
    "authority_status_invalid",
  );
}

export interface CreateAuthorityInput {
  readonly id: string;
  readonly endpointId: string;
  readonly subject: AuthoritySubject;
  readonly status?: AuthorityStatus;
}

export function createAuthority(input: CreateAuthorityInput): Authority {
  invariant(isRecord(input), "authority_input_required");
  assertSubject(input.subject);
  const authority: Authority = {
    id: requireNonEmpty(input.id, "authority_id"),
    endpointId: requireNonEmpty(input.endpointId, "endpoint_id"),
    subject: input.subject.type === "OWNER"
      ? { type: "OWNER", account: requireNonEmpty(input.subject.account, "owner_account") }
      : { type: "SESSION_KEY", publicKey: requireNonEmpty(input.subject.publicKey, "session_public_key") },
    status: input.status ?? "ACTIVE",
  };
  assertAuthority(authority);
  return authority;
}

export function canTransitionAuthority(from: AuthorityStatus, to: AuthorityStatus): boolean {
  return from === "ACTIVE" && to === "REVOKED";
}

export function transitionAuthority(authority: Authority, to: AuthorityStatus): Authority {
  assertAuthority(authority);
  invariant((AUTHORITY_STATUSES as readonly string[]).includes(to), "authority_status_invalid");
  if (to === "ACTIVE") {
    if (authority.status === "REVOKED") throw new IdentityAuthorityDomainError("authority_cannot_be_reactivated");
    throw new IdentityAuthorityDomainError("authority_transition_not_allowed");
  }
  if (authority.status === "REVOKED") throw new IdentityAuthorityDomainError("authority_already_revoked");
  invariant(canTransitionAuthority(authority.status, to), "authority_transition_not_allowed");
  return { ...authority, status: "REVOKED" };
}

export function activateAuthority(authority: Authority): Authority {
  return transitionAuthority(authority, "ACTIVE");
}

export function revokeAuthority(authority: Authority): Authority {
  return transitionAuthority(authority, "REVOKED");
}
