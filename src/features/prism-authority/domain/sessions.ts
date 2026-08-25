import {
  assertValidPrismId,
  type PrismId,
} from "../../prism-identity/domain/identifiers";
import {
  IdentityAuthorityDomainError,
  invariant,
  requireFiniteTimestamp,
  requireNonEmpty,
  requirePositiveInteger,
} from "../../prism-bindings/domain/errors";
import {
  SESSION_GRANT_STATUSES,
  type CreateSessionGrantInput,
  type SessionAction,
  type SessionGrant,
  type SessionGrantScope,
  type SessionGrantStatus,
  type SessionGrantTransitionInput,
  type SessionGrantUsage,
} from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function assertPrismId(value: unknown): asserts value is PrismId {
  invariant(typeof value === "string", "prism_id_required");
  try {
    assertValidPrismId(value);
  } catch {
    throw new IdentityAuthorityDomainError("malformed_prism_id");
  }
}

function assertNonEmptyList(value: unknown, field: string): asserts value is readonly string[] {
  invariant(Array.isArray(value) && value.length > 0, `${field}_must_not_be_empty`);
  for (const item of value) requireNonEmpty(item, field);
  invariant(new Set(value).size === value.length, `${field}_contains_duplicates`);
}

function assertScope(scope: unknown): asserts scope is SessionGrantScope {
  invariant(isRecord(scope), "session_scope_required");
  const hasContracts = scope.contracts !== undefined;
  const hasSelectors = scope.selectors !== undefined;
  const hasTokenLimits = scope.tokenLimits !== undefined;
  const hasMaxCalls = scope.maxCalls !== undefined;
  invariant(hasContracts || hasSelectors || hasTokenLimits || hasMaxCalls, "session_scope_must_be_bounded");

  if (hasContracts) assertNonEmptyList(scope.contracts, "contracts");
  if (hasSelectors) assertNonEmptyList(scope.selectors, "selectors");
  if (hasTokenLimits) {
    invariant(Array.isArray(scope.tokenLimits) && scope.tokenLimits.length > 0, "token_limits_must_not_be_empty");
    const seen = new Set<string>();
    for (const rawLimit of scope.tokenLimits) {
      invariant(isRecord(rawLimit), "token_limit_invalid");
      const token = requireNonEmpty(rawLimit.token, "token");
      invariant(!seen.has(token), "token_limits_contains_duplicates");
      seen.add(token);
      invariant(typeof rawLimit.maxAmount === "bigint", "token_limit_amount_must_be_bigint");
      invariant(rawLimit.maxAmount > 0n, "token_limit_must_be_positive");
    }
  }
  if (hasMaxCalls) requirePositiveInteger(scope.maxCalls, "max_calls");
}

function assertUsage(value: unknown, scope: SessionGrantScope): asserts value is SessionGrantUsage {
  if (value === undefined) return;
  invariant(isRecord(value), "session_usage_invalid");
  invariant(typeof value.calls === "number" && Number.isSafeInteger(value.calls) && value.calls >= 0, "session_usage_calls_invalid");
  if (scope.maxCalls !== undefined) invariant(value.calls <= scope.maxCalls, "session_usage_exceeds_max_calls");
  invariant(isRecord(value.spentByToken), "session_usage_spend_invalid");
  const limits = scope.tokenLimits ?? [];
  const allowedTokens = new Set(limits.map((limit) => limit.token));
  for (const [token, amount] of Object.entries(value.spentByToken)) {
    invariant(typeof amount === "bigint" && amount >= 0n, "session_usage_amount_invalid");
    if (limits.length === 0) invariant(amount === 0n, "session_usage_spend_without_token_limit");
    else {
      invariant(allowedTokens.has(token), "session_usage_token_not_allowed");
      const limit = limits.find((candidate) => candidate.token === token)!;
      invariant(amount <= limit.maxAmount, "session_usage_exceeds_token_limit");
    }
  }
}

/** Runtime guard for grants received from persistence or an adapter. */
export function assertSessionGrant(value: unknown): asserts value is SessionGrant {
  invariant(isRecord(value), "session_grant_required");
  requireNonEmpty(value.id, "session_grant_id");
  assertPrismId(value.prismId);
  requireNonEmpty(value.endpointId, "endpoint_id");
  requireNonEmpty(value.delegatePublicKey, "delegate_public_key");
  assertScope(value.scope);
  const validFrom = requireFiniteTimestamp(value.validFrom, "valid_from");
  const validUntil = requireFiniteTimestamp(value.validUntil, "valid_until");
  invariant(validFrom >= 0 && validUntil >= 0, "session_validity_timestamp_invalid");
  invariant(validUntil > validFrom, "valid_until_must_be_after_valid_from");
  invariant(
    typeof value.status === "string" && (SESSION_GRANT_STATUSES as readonly string[]).includes(value.status),
    "session_grant_status_invalid",
  );
  assertUsage(value.usage, value.scope);
}

function cloneScope(scope: SessionGrantScope): SessionGrantScope {
  return {
    ...(scope.contracts === undefined ? {} : { contracts: [...scope.contracts] }),
    ...(scope.selectors === undefined ? {} : { selectors: [...scope.selectors] }),
    ...(scope.tokenLimits === undefined ? {} : {
      tokenLimits: scope.tokenLimits.map((limit) => ({ token: limit.token, maxAmount: limit.maxAmount })),
    }),
    ...(scope.maxCalls === undefined ? {} : { maxCalls: scope.maxCalls }),
  };
}

function emptyUsage(): SessionGrantUsage {
  return { calls: 0, spentByToken: {} };
}

export function createSessionGrant(input: CreateSessionGrantInput): SessionGrant {
  invariant(isRecord(input), "session_grant_input_required");
  assertPrismId(input.prismId);
  assertScope(input.scope);
  const grant: SessionGrant = {
    id: requireNonEmpty(input.id, "session_grant_id"),
    prismId: input.prismId,
    endpointId: requireNonEmpty(input.endpointId, "endpoint_id"),
    delegatePublicKey: requireNonEmpty(input.delegatePublicKey, "delegate_public_key"),
    scope: cloneScope(input.scope),
    validFrom: input.validFrom,
    validUntil: input.validUntil,
    status: "CREATED",
    usage: emptyUsage(),
  };
  assertSessionGrant(grant);
  return grant;
}

export function canTransitionSessionGrant(from: SessionGrantStatus, to: SessionGrantStatus): boolean {
  if (!(SESSION_GRANT_STATUSES as readonly string[]).includes(from)) return false;
  if (!(SESSION_GRANT_STATUSES as readonly string[]).includes(to)) return false;
  if (from === "CREATED") return to === "ACTIVE";
  if (from === "ACTIVE") return to === "EXPIRED" || to === "REVOKED" || to === "EXHAUSTED";
  return false;
}

function assertNow(value: number | undefined, field = "session_now"): number {
  return requireFiniteTimestamp(value, field);
}

export function transitionSessionGrant(grant: SessionGrant, input: SessionGrantTransitionInput): SessionGrant {
  invariant(isRecord(input), "session_transition_input_required");
  assertSessionGrant(grant);
  invariant(canTransitionSessionGrant(grant.status, input.to), "session_grant_transition_not_allowed");

  if (input.to === "ACTIVE") {
    const now = assertNow(input.now);
    if (now < grant.validFrom) throw new IdentityAuthorityDomainError("session_grant_not_started");
    if (now >= grant.validUntil) throw new IdentityAuthorityDomainError("session_grant_expired");
    return { ...grant, status: "ACTIVE" };
  }
  if (input.to === "EXPIRED") {
    const now = assertNow(input.now);
    invariant(now >= grant.validUntil, "session_grant_not_expired");
  }
  if (input.to === "EXHAUSTED") {
    invariant(isSessionGrantExhausted(grant), "session_grant_not_exhausted");
  }
  return { ...grant, status: input.to };
}

export function activateSessionGrant(grant: SessionGrant, now: number): SessionGrant {
  return transitionSessionGrant(grant, { to: "ACTIVE", now });
}

export function revokeSessionGrant(grant: SessionGrant): SessionGrant {
  return transitionSessionGrant(grant, { to: "REVOKED" });
}

export function expireSessionGrant(grant: SessionGrant, now: number): SessionGrant {
  return transitionSessionGrant(grant, { to: "EXPIRED", now });
}

export function exhaustSessionGrant(grant: SessionGrant): SessionGrant {
  return transitionSessionGrant(grant, { to: "EXHAUSTED" });
}

/** Applies time/usage observations without reviving or mutating terminal grants. */
export function refreshSessionGrant(grant: SessionGrant, now: number): SessionGrant {
  assertSessionGrant(grant);
  const current = assertNow(now);
  if (grant.status !== "ACTIVE") return grant;
  if (current >= grant.validUntil) return { ...grant, status: "EXPIRED" };
  if (isSessionGrantExhausted(grant)) return { ...grant, status: "EXHAUSTED" };
  return grant;
}

export function isSessionGrantExhausted(grant: SessionGrant): boolean {
  assertSessionGrant(grant);
  const usage = grant.usage ?? emptyUsage();
  if (grant.scope.maxCalls !== undefined && usage.calls >= grant.scope.maxCalls) return true;
  if (grant.scope.tokenLimits !== undefined && grant.scope.tokenLimits.length > 0) {
    return grant.scope.tokenLimits.every((limit) => (usage.spentByToken[limit.token] ?? 0n) >= limit.maxAmount);
  }
  return false;
}

function assertActionShape(action: SessionAction): bigint {
  invariant(isRecord(action), "session_action_required");
  requireNonEmpty(action.contract, "session_action_contract");
  requireNonEmpty(action.selector, "session_action_selector");
  const now = assertNow(action.now, "session_action_now");
  void now;
  const amount = action.amount ?? 0n;
  invariant(typeof amount === "bigint", "session_action_amount_must_be_bigint");
  invariant(amount >= 0n, "session_action_amount_negative");
  if (action.token !== undefined) requireNonEmpty(action.token, "session_action_token");
  invariant(amount === 0n || action.token !== undefined, "session_action_token_required_for_spend");
  return amount;
}

function assertActionAllowed(grant: SessionGrant, action: SessionAction): bigint {
  const amount = assertActionShape(action);
  if (grant.status !== "ACTIVE") throw new IdentityAuthorityDomainError("session_grant_not_active");
  if (action.now >= grant.validUntil) throw new IdentityAuthorityDomainError("session_grant_expired");
  if (action.now < grant.validFrom) throw new IdentityAuthorityDomainError("session_grant_not_active");

  const usage = grant.usage ?? emptyUsage();
  if (grant.scope.contracts !== undefined && !grant.scope.contracts.includes(action.contract)) {
    throw new IdentityAuthorityDomainError("session_contract_not_allowed");
  }
  if (grant.scope.selectors !== undefined && !grant.scope.selectors.includes(action.selector)) {
    throw new IdentityAuthorityDomainError("session_selector_not_allowed");
  }
  if (grant.scope.maxCalls !== undefined && usage.calls >= grant.scope.maxCalls) {
    throw new IdentityAuthorityDomainError("session_call_limit_exceeded");
  }

  if (grant.scope.tokenLimits !== undefined) {
    const token = action.token;
    const limit = token === undefined ? undefined : grant.scope.tokenLimits.find((candidate) => candidate.token === token);
    if (!limit) throw new IdentityAuthorityDomainError("session_token_not_allowed");
    const alreadySpent = usage.spentByToken[limit.token] ?? 0n;
    if (alreadySpent + amount > limit.maxAmount) {
      throw new IdentityAuthorityDomainError("session_spend_limit_exceeded");
    }
  } else if (amount > 0n) {
    throw new IdentityAuthorityDomainError("session_spend_limit_required");
  }
  return amount;
}

export function isSessionActionAllowed(grant: SessionGrant, action: SessionAction): boolean {
  try {
    assertSessionGrant(grant);
    assertActionAllowed(grant, action);
    return true;
  } catch {
    return false;
  }
}

/**
 * Checks and accounts one action atomically in the returned immutable grant.
 * Rejected actions throw before usage is changed.
 */
export function authorizeSessionAction(grant: SessionGrant, action: SessionAction): SessionGrant {
  assertSessionGrant(grant);
  const amount = assertActionAllowed(grant, action);
  const previousUsage = grant.usage ?? emptyUsage();
  const spentByToken: Record<string, bigint> = { ...previousUsage.spentByToken };
  if (action.token !== undefined && amount > 0n) {
    spentByToken[action.token] = (spentByToken[action.token] ?? 0n) + amount;
  }
  const usage: SessionGrantUsage = {
    calls: previousUsage.calls + 1,
    spentByToken,
  };
  const next: SessionGrant = {
    ...grant,
    usage,
    status: "ACTIVE",
  };
  assertSessionGrant(next);
  return isSessionGrantExhausted(next) ? { ...next, status: "EXHAUSTED" } : next;
}

export const consumeSessionGrantAction = authorizeSessionAction;

export type {
  SessionAction,
  SessionGrant,
  SessionGrantScope,
  SessionGrantStatus,
  SessionGrantTransitionInput,
  SessionGrantUsage,
  SessionTokenLimit,
} from "./types";
