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
  type SecureSessionGrant,
  type SessionReplayProtection,
  type SessionSpendLimit,
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

function assertSpendLimits(value: unknown): asserts value is readonly SessionSpendLimit[] {
  invariant(Array.isArray(value) && value.length > 0, "spend_limits_must_not_be_empty");
  const seen = new Set<string>();
  for (const rawLimit of value) {
    invariant(isRecord(rawLimit), "spend_limit_invalid");
    const asset = requireNonEmpty(rawLimit.asset, "spend_limit_asset");
    invariant(!seen.has(asset), "spend_limits_contains_duplicates");
    seen.add(asset);
    invariant(typeof rawLimit.maxPerCall === "bigint" && rawLimit.maxPerCall > 0n, "spend_limit_per_call_invalid");
    invariant(typeof rawLimit.maxTotal === "bigint" && rawLimit.maxTotal > 0n, "spend_limit_total_invalid");
    invariant(rawLimit.maxPerCall <= rawLimit.maxTotal, "spend_limit_per_call_exceeds_total");
  }
}

function assertReplayProtection(value: unknown): asserts value is SessionReplayProtection {
  invariant(isRecord(value), "session_replay_required");
  invariant(value.mode === "unique-key", "session_replay_mode_invalid");
  requireNonEmpty(value.namespace, "session_replay_namespace");
}

function assertScope(scope: unknown): asserts scope is SessionGrantScope {
  invariant(isRecord(scope), "session_scope_required");
  const hasContracts = scope.contracts !== undefined;
  const hasSelectors = scope.selectors !== undefined;
  const hasTokenLimits = scope.tokenLimits !== undefined;
  const hasSpendLimits = scope.spendLimits !== undefined;
  const hasMaxCalls = scope.maxCalls !== undefined;
  invariant(hasContracts || hasSelectors || hasTokenLimits || hasSpendLimits || hasMaxCalls, "session_scope_must_be_bounded");

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
  if (hasSpendLimits) assertSpendLimits(scope.spendLimits);
  if (hasMaxCalls) requirePositiveInteger(scope.maxCalls, "max_calls");
}

function assertUsage(value: unknown, scope: SessionGrantScope): asserts value is SessionGrantUsage {
  if (value === undefined) return;
  invariant(isRecord(value), "session_usage_invalid");
  invariant(typeof value.calls === "number" && Number.isSafeInteger(value.calls) && value.calls >= 0, "session_usage_calls_invalid");
  if (scope.maxCalls !== undefined) invariant(value.calls <= scope.maxCalls, "session_usage_exceeds_max_calls");
  invariant(isRecord(value.spentByToken), "session_usage_spend_invalid");
  const tokenLimits = scope.tokenLimits ?? [];
  const spendLimits = scope.spendLimits ?? [];
  const allowedTokens = new Set(tokenLimits.map((limit) => limit.token));
  const allowedAssets = new Map(spendLimits.map((limit) => [limit.asset, limit]));
  for (const [token, amount] of Object.entries(value.spentByToken)) {
    invariant(typeof amount === "bigint" && amount >= 0n, "session_usage_amount_invalid");
    if (tokenLimits.length > 0 && allowedTokens.has(token)) {
      const limit = tokenLimits.find((candidate) => candidate.token === token)!;
      invariant(amount <= limit.maxAmount, "session_usage_exceeds_token_limit");
    } else if (spendLimits.length > 0) {
      const limit = [...allowedAssets.entries()].find(([asset]) => sameAuthorityIdentifier(asset, token))?.[1];
      invariant(limit !== undefined, "session_usage_asset_not_allowed");
      invariant(amount <= limit.maxTotal, "session_usage_exceeds_aggregate_limit");
    } else {
      invariant(amount === 0n, "session_usage_spend_without_token_limit");
    }
  }
  if (value.consumedReplayKeys !== undefined) {
    invariant(Array.isArray(value.consumedReplayKeys), "session_usage_replay_keys_invalid");
    const replayKeys = value.consumedReplayKeys as readonly unknown[];
    invariant(new Set(replayKeys).size === replayKeys.length, "session_usage_replay_keys_duplicates");
    for (const replayKey of replayKeys) requireNonEmpty(replayKey, "session_usage_replay_key");
  }
}

/** Runtime guard for grants received from persistence or an adapter. */
export function assertSessionGrant(value: unknown): asserts value is SessionGrant {
  invariant(isRecord(value), "session_grant_required");
  requireNonEmpty(value.id, "session_grant_id");
  assertPrismId(value.prismId);
  requireNonEmpty(value.endpointId, "endpoint_id");
  requireNonEmpty(value.delegatePublicKey, "delegate_public_key");
  if (value.chainId !== undefined) {
    invariant(typeof value.chainId === "number" && Number.isSafeInteger(value.chainId) && value.chainId > 0, "session_chain_id_invalid");
  }
  if (value.account !== undefined) requireNonEmpty(value.account, "session_account");
  if (value.delegateAccount !== undefined) requireNonEmpty(value.delegateAccount, "session_delegate_account");
  if (value.replay !== undefined) assertReplayProtection(value.replay);
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

/**
 * A venue adapter may only consume a grant with every security binding
 * materialized. Legacy grants remain valid for the original domain API, but
 * cannot cross into a chain adapter through this guard.
 */
export function assertSecureSessionGrant(value: unknown): asserts value is SecureSessionGrant {
  assertSessionGrant(value);
  const grant = value as SessionGrant;
  invariant(grant.chainId !== undefined, "session_chain_id_required");
  invariant(grant.account !== undefined, "session_account_required");
  invariant(grant.delegateAccount !== undefined, "session_delegate_account_required");
  invariant(grant.replay !== undefined, "session_replay_required");
  invariant(grant.scope.contracts !== undefined, "session_contracts_required");
  invariant(grant.scope.selectors !== undefined, "session_selectors_required");
  invariant(grant.scope.spendLimits !== undefined, "session_spend_limits_required");
  invariant(grant.scope.maxCalls !== undefined, "session_max_calls_required");
  invariant(grant.usage !== undefined, "session_usage_required");
  invariant(Array.isArray(grant.usage.consumedReplayKeys), "session_replay_usage_required");
}

function cloneReplay(replay: SessionReplayProtection): SessionReplayProtection {
  return { mode: replay.mode, namespace: replay.namespace };
}

function cloneScope(scope: SessionGrantScope): SessionGrantScope {
  return {
    ...(scope.contracts === undefined ? {} : { contracts: [...scope.contracts] }),
    ...(scope.selectors === undefined ? {} : { selectors: [...scope.selectors] }),
    ...(scope.tokenLimits === undefined ? {} : {
      tokenLimits: scope.tokenLimits.map((limit) => ({ token: limit.token, maxAmount: limit.maxAmount })),
    }),
    ...(scope.spendLimits === undefined ? {} : {
      spendLimits: scope.spendLimits.map((limit) => ({
        asset: limit.asset,
        maxPerCall: limit.maxPerCall,
        maxTotal: limit.maxTotal,
      })),
    }),
    ...(scope.maxCalls === undefined ? {} : { maxCalls: scope.maxCalls }),
  };
}

function emptyUsage(includeReplay = false): SessionGrantUsage {
  return includeReplay ? { calls: 0, spentByToken: {}, consumedReplayKeys: [] } : { calls: 0, spentByToken: {} };
}

function hasSecureGrantFields(input: CreateSessionGrantInput): boolean {
  return input.chainId !== undefined || input.account !== undefined || input.delegateAccount !== undefined || input.replay !== undefined || input.scope.spendLimits !== undefined;
}

function assertSecureCreateInput(input: CreateSessionGrantInput): void {
  invariant(isRecord(input.scope), "session_scope_required");
  invariant(input.chainId !== undefined, "session_chain_id_required");
  invariant(input.account !== undefined, "session_account_required");
  invariant(input.delegateAccount !== undefined, "session_delegate_account_required");
  invariant(input.replay !== undefined, "session_replay_required");
  invariant(input.scope.contracts !== undefined, "session_contracts_required");
  invariant(input.scope.selectors !== undefined, "session_selectors_required");
  invariant(input.scope.spendLimits !== undefined, "session_spend_limits_required");
  invariant(input.scope.maxCalls !== undefined, "session_max_calls_required");
}

export function createSessionGrant(input: CreateSessionGrantInput): SessionGrant {
  invariant(isRecord(input), "session_grant_input_required");
  assertPrismId(input.prismId);
  assertScope(input.scope);
  if (hasSecureGrantFields(input)) assertSecureCreateInput(input);
  const grant: SessionGrant = {
    id: requireNonEmpty(input.id, "session_grant_id"),
    prismId: input.prismId,
    endpointId: requireNonEmpty(input.endpointId, "endpoint_id"),
    delegatePublicKey: requireNonEmpty(input.delegatePublicKey, "delegate_public_key"),
    ...(input.chainId === undefined ? {} : { chainId: input.chainId }),
    ...(input.account === undefined ? {} : { account: requireNonEmpty(input.account, "session_account") }),
    ...(input.delegateAccount === undefined ? {} : { delegateAccount: requireNonEmpty(input.delegateAccount, "session_delegate_account") }),
    ...(input.replay === undefined ? {} : { replay: cloneReplay(input.replay) }),
    scope: cloneScope(input.scope),
    validFrom: input.validFrom,
    validUntil: input.validUntil,
    status: "CREATED",
    usage: emptyUsage(hasSecureGrantFields(input)),
  };
  assertSessionGrant(grant);
  if (hasSecureGrantFields(input)) assertSecureSessionGrant(grant);
  return grant;
}

export function createSecureSessionGrant(input: CreateSessionGrantInput): SecureSessionGrant {
  invariant(isRecord(input), "session_grant_input_required");
  assertSecureCreateInput(input);
  const grant = createSessionGrant(input);
  assertSecureSessionGrant(grant);
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
  if (grant.scope.spendLimits !== undefined && grant.scope.spendLimits.length > 0) {
    return grant.scope.spendLimits.every((limit) => (usage.spentByToken[limit.asset] ?? 0n) >= limit.maxTotal);
  }
  return false;
}

function actionAsset(action: SessionAction): string | undefined {
  if (action.asset !== undefined && action.token !== undefined) {
    invariant(action.asset === action.token, "session_action_asset_mismatch");
  }
  const asset = action.asset ?? action.token;
  if (asset !== undefined) requireNonEmpty(asset, "session_action_asset");
  return asset;
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
  actionAsset(action);
  invariant(amount === 0n || actionAsset(action) !== undefined, "session_action_asset_required_for_spend");
  if (action.chainId !== undefined) invariant(typeof action.chainId === "number" && Number.isSafeInteger(action.chainId) && action.chainId > 0, "session_action_chain_id_invalid");
  if (action.account !== undefined) requireNonEmpty(action.account, "session_action_account");
  if (action.delegateAccount !== undefined) requireNonEmpty(action.delegateAccount, "session_action_delegate_account");
  if (action.replayKey !== undefined) requireNonEmpty(action.replayKey, "session_action_replay_key");
  return amount;
}

function sameAuthorityIdentifier(left: string, right: string): boolean {
  return left.slice(0, 2).toLowerCase() === "0x" && right.slice(0, 2).toLowerCase() === "0x"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function assertActionAllowed(grant: SessionGrant, action: SessionAction): bigint {
  const amount = assertActionShape(action);
  if (grant.status !== "ACTIVE") throw new IdentityAuthorityDomainError("session_grant_not_active");
  if (action.now >= grant.validUntil) throw new IdentityAuthorityDomainError("session_grant_expired");
  if (action.now < grant.validFrom) throw new IdentityAuthorityDomainError("session_grant_not_active");

  const usage = grant.usage ?? emptyUsage();
  if (grant.chainId !== undefined && action.chainId !== grant.chainId) {
    throw new IdentityAuthorityDomainError("session_chain_not_allowed");
  }
  if (grant.account !== undefined && (action.account === undefined || !sameAuthorityIdentifier(grant.account, action.account))) {
    throw new IdentityAuthorityDomainError("session_account_not_allowed");
  }
  if (grant.delegateAccount !== undefined && (action.delegateAccount === undefined || !sameAuthorityIdentifier(grant.delegateAccount, action.delegateAccount))) {
    throw new IdentityAuthorityDomainError("session_delegate_account_not_allowed");
  }
  const replayKey = action.replayKey === undefined || grant.replay === undefined
    ? undefined
    : `${grant.replay.namespace}:${action.replayKey}`;
  if (grant.replay !== undefined) {
    if (action.replayKey === undefined) throw new IdentityAuthorityDomainError("session_replay_key_required");
    if ((usage.consumedReplayKeys ?? []).includes(replayKey!)) throw new IdentityAuthorityDomainError("session_replay_detected");
  }

  if (grant.scope.contracts !== undefined && !grant.scope.contracts.includes(action.contract)) {
    throw new IdentityAuthorityDomainError("session_contract_not_allowed");
  }
  if (grant.scope.selectors !== undefined && !grant.scope.selectors.includes(action.selector)) {
    throw new IdentityAuthorityDomainError("session_selector_not_allowed");
  }
  if (grant.scope.maxCalls !== undefined && usage.calls >= grant.scope.maxCalls) {
    throw new IdentityAuthorityDomainError("session_call_limit_exceeded");
  }

  const asset = actionAsset(action);
  if (grant.scope.spendLimits !== undefined && (amount > 0n || asset !== undefined)) {
    const limit = asset === undefined
      ? undefined
      : grant.scope.spendLimits.find((candidate) => sameAuthorityIdentifier(candidate.asset, asset));
    if (!limit) throw new IdentityAuthorityDomainError("session_asset_not_allowed");
    if (amount > limit.maxPerCall) throw new IdentityAuthorityDomainError("session_per_call_spend_limit_exceeded");
    const alreadySpent = usage.spentByToken[limit.asset] ?? 0n;
    if (alreadySpent + amount > limit.maxTotal) throw new IdentityAuthorityDomainError("session_aggregate_spend_limit_exceeded");
  }

  if (grant.scope.tokenLimits !== undefined) {
    const token = action.token ?? asset;
    const limit = token === undefined ? undefined : grant.scope.tokenLimits.find((candidate) => candidate.token === token);
    if (!limit) throw new IdentityAuthorityDomainError("session_token_not_allowed");
    const alreadySpent = usage.spentByToken[limit.token] ?? 0n;
    if (alreadySpent + amount > limit.maxAmount) {
      throw new IdentityAuthorityDomainError("session_spend_limit_exceeded");
    }
  } else if (amount > 0n && grant.scope.spendLimits === undefined) {
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
  const asset = actionAsset(action);
  const spendLimit = grant.scope.spendLimits?.find((candidate) => asset !== undefined && sameAuthorityIdentifier(candidate.asset, asset));
  const spendKey = spendLimit?.asset ?? action.token ?? asset;
  if (spendKey !== undefined && amount > 0n) {
    spentByToken[spendKey] = (spentByToken[spendKey] ?? 0n) + amount;
  }
  const consumedReplayKeys = [...(previousUsage.consumedReplayKeys ?? [])];
  if (grant.replay !== undefined && action.replayKey !== undefined) {
    consumedReplayKeys.push(`${grant.replay.namespace}:${action.replayKey}`);
  }
  const usage: SessionGrantUsage = {
    calls: previousUsage.calls + 1,
    spentByToken,
    ...(grant.replay !== undefined || previousUsage.consumedReplayKeys !== undefined ? { consumedReplayKeys } : {}),
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
  SessionReplayProtection,
  SessionSpendLimit,
  SecureSessionGrant,
} from "./types";
