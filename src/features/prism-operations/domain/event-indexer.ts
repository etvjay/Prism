// Idempotent event reconstruction for the three registry facts.
// Authority: projects/prism/system/events.yaml + EVENT_CATALOGUE.md
// Guarantee: empty state + replay(PrismIdentityCreated)* + replay(ExecutionIdentityBound)* + replay(BindingRevoked)*
//            = complete canonical identity/binding state (TEST-7-3-1, gate A7-4).
//
// Keying: idempotent by (registry scope, tx_hash, event_index) — the canonical
// event correlation_id. Legacy unscoped pure-domain callers retain their old key.
// Transport-neutral: pure domain, no RPC or DB imports.
//
// Consumer responsibilities enforced by tests:
// - indexer creates projection, must not enrich with social data
// - BindingRevoked flips resolution to NO_ACTIVE_DESTINATION but MUST NOT delete identity (INV-SYS-006)
// - invalidate resolution caches on BIND/REVOKE
//
// Ordering: (block_number, tx_hash, event_index) — chain order.

import type { Hex } from "./operation";

export type RegistryEventKind =
  | "PrismIdentityCreated"
  | "ExecutionIdentityBound"
  | "BindingRevoked";

/** The ABI boundary is part of an event's identity. */
export type RegistryAbiVersion = "v1" | "v2";

export interface RegistryEventScopeInput {
  readonly registryAddress: string;
  readonly network: string;
  /** Existing application terminology. */
  readonly registryVersion?: RegistryAbiVersion;
  /** Alias accepted at local boundaries that call this an ABI version. */
  readonly abiVersion?: RegistryAbiVersion;
}

export interface RegistryEventScope {
  readonly registryAddress: string;
  readonly network: string;
  readonly registryVersion: RegistryAbiVersion;
  readonly abiVersion: RegistryAbiVersion;
}

export interface PrismIdentityCreatedPayload {
  prismId: string;
  controller: string;
}

export interface ExecutionIdentityBoundPayload {
  prismId: string;
  venue: string;
  executionAccount: string;
  proofDigest: Hex;
}

export interface BindingRevokedPayload {
  prismId: string;
  venue: string;
  executionAccount: string;
}

export type RegistryEventPayload =
  | PrismIdentityCreatedPayload
  | ExecutionIdentityBoundPayload
  | BindingRevokedPayload;

export interface RegistryCanonicalEvent {
  readonly txHash: Hex;
  readonly eventIndex: number;
  readonly blockNumber: number;
  readonly kind: RegistryEventKind;
  readonly payload: RegistryEventPayload;
  /** Required at persistence boundaries; optional for legacy pure-domain callers. */
  readonly registryAddress?: string;
  readonly network?: string;
  readonly registryVersion?: RegistryAbiVersion;
  /** Alias accepted on input; normalized stores return registryVersion. */
  readonly abiVersion?: RegistryAbiVersion;
  readonly schemaVersion?: number;
}

export interface IdentityProjection {
  readonly prismId: string;
  readonly controller: string;
  readonly createdAtBlock: number;
  readonly version: number;
}

export interface BindingProjection {
  readonly prismId: string;
  readonly venue: string;
  readonly executionAccount: string;
  readonly status: "ACTIVE" | "REVOKED";
  readonly boundAtBlock: number;
  readonly revokedAtBlock: number | null;
  readonly proofDigest: Hex | null;
}

export interface ProjectionState {
  readonly identities: ReadonlyMap<string, IdentityProjection>;
  readonly bindings: ReadonlyMap<string, BindingProjection>;
  /** Set of seen scoped correlation keys — idempotency ledger (LEDGER_INDEX). */
  readonly seenKeys: ReadonlySet<string>;
  /** Last watermark for observability chain (served_state_version). */
  readonly watermark: number | null;
  /** A projection is single-scope; null retains legacy unscoped pure-domain mode. */
  readonly scope: RegistryEventScope | null;
}

const CONTRACT_ADDRESS_LIMIT = 1n << 251n;

export function normalizeRegistryEventScope(input: RegistryEventScopeInput): RegistryEventScope {
  if (!input || typeof input.registryAddress !== "string" || !/^0x[0-9a-fA-F]{1,64}$/.test(input.registryAddress.trim())) {
    throw new Error("event_scope_invalid_registry_address");
  }
  let address: string;
  try {
    const value = BigInt(input.registryAddress.trim());
    if (value <= 0n || value >= CONTRACT_ADDRESS_LIMIT) throw new Error("invalid_address_range");
    address = `0x${value.toString(16)}`;
  } catch {
    throw new Error("event_scope_invalid_registry_address");
  }
  if (typeof input.network !== "string" || input.network.trim().length === 0) {
    throw new Error("event_scope_missing_network");
  }
  const registryVersion = input.registryVersion ?? input.abiVersion;
  if (input.registryVersion !== undefined && input.abiVersion !== undefined && input.registryVersion !== input.abiVersion) {
    throw new Error("event_scope_version_mismatch");
  }
  if (registryVersion !== "v1" && registryVersion !== "v2") {
    throw new Error("event_scope_registry_version_required");
  }
  return {
    registryAddress: address,
    network: input.network.trim().toUpperCase(),
    registryVersion,
    abiVersion: registryVersion,
  };
}

export function scopeKey(scope: RegistryEventScopeInput): string {
  const normalized = normalizeRegistryEventScope(scope);
  return `${normalized.registryAddress}|${normalized.network}|${normalized.registryVersion}`;
}

export function eventScope(event: RegistryCanonicalEvent): RegistryEventScope | null {
  const fields = [event.registryAddress, event.network, event.registryVersion, event.abiVersion];
  if (fields.every((value) => value === undefined)) return null;
  if (event.registryAddress === undefined || event.network === undefined) {
    throw new Error("event_scope_incomplete");
  }
  return normalizeRegistryEventScope({
    registryAddress: event.registryAddress,
    network: event.network,
    registryVersion: event.registryVersion,
    abiVersion: event.abiVersion,
  });
}

export function scopeMatches(a: RegistryEventScopeInput, b: RegistryEventScopeInput): boolean {
  const left = normalizeRegistryEventScope(a);
  const right = normalizeRegistryEventScope(b);
  return left.registryAddress === right.registryAddress && left.network === right.network && left.registryVersion === right.registryVersion;
}

export function withEventScope(event: RegistryCanonicalEvent, input: RegistryEventScopeInput): RegistryCanonicalEvent {
  const scope = normalizeRegistryEventScope(input);
  const existing = eventScope(event);
  if (existing && !scopeMatches(existing, scope)) throw new Error("event_scope_mismatch");
  return {
    ...event,
    registryAddress: scope.registryAddress,
    network: scope.network,
    registryVersion: scope.registryVersion,
    abiVersion: scope.abiVersion,
  };
}

export function eventKey(event: RegistryCanonicalEvent): string;
export function eventKey(txHash: Hex, eventIndex: number, scope?: RegistryEventScopeInput): string;
export function eventKey(
  eventOrTxHash: RegistryCanonicalEvent | Hex,
  eventIndex?: number,
  inputScope?: RegistryEventScopeInput,
): string {
  const event = typeof eventOrTxHash === "object" ? eventOrTxHash : null;
  const txHash = event ? event.txHash : (eventOrTxHash as Hex);
  const index = event ? event.eventIndex : eventIndex;
  if (index === undefined) throw new Error("event_key_missing_index");
  const scope = event ? eventScope(event) : inputScope ? normalizeRegistryEventScope(inputScope) : null;
  const prefix = scope ? `${scopeKey(scope)}:` : "";
  return `${prefix}${txHash.toLowerCase()}:${index}`;
}

function bindingKey(prismId: string, venue: string, executionAccount: string): string {
  return `${prismId}|${venue}|${executionAccount.toLowerCase()}`;
}

export function emptyProjection(scopeInput?: RegistryEventScopeInput): ProjectionState {
  return {
    identities: new Map(),
    bindings: new Map(),
    seenKeys: new Set(),
    watermark: null,
    scope: scopeInput ? normalizeRegistryEventScope(scopeInput) : null,
  };
}

export interface ApplyResult {
  readonly state: ProjectionState;
  readonly isDuplicate: boolean;
  readonly duplicateKey?: string;
  /** Non-terminal error: payload field missing, etc. Returns state unchanged. */
  readonly error?: string;
}

/**
 * Pure idempotent apply. Keyed by txHash+eventIndex.
 * Replaying the same key twice is a benign duplicate (isDuplicate=true) and
 * leaves state unchanged. Payload is not enriched.
 */
export function applyEvent(
  state: ProjectionState,
  event: RegistryCanonicalEvent,
): ApplyResult {
  let incomingScope: RegistryEventScope | null;
  try {
    incomingScope = eventScope(event);
  } catch (cause) {
    return { state, isDuplicate: false, error: cause instanceof Error ? cause.message : "malformed_event_scope" };
  }
  if (state.scope && (!incomingScope || !scopeMatches(state.scope, incomingScope))) {
    return { state, isDuplicate: false, error: "event_scope_mismatch" };
  }
  const nextScope = state.scope ?? incomingScope;
  const key = eventKey(event);
  if (state.seenKeys.has(key)) {
    return { state, isDuplicate: true, duplicateKey: key };
  }
  // Validate event correlation fields exist
  if (!event.txHash || !/^0x[0-9a-fA-F]{64}$/.test(event.txHash)) {
    return { state, isDuplicate: false, error: "malformed_tx_hash" };
  }
  if (!Number.isInteger(event.eventIndex) || event.eventIndex < 0) {
    return { state, isDuplicate: false, error: "malformed_event_index" };
  }
  if (!Number.isFinite(event.blockNumber)) {
    return { state, isDuplicate: false, error: "malformed_block_number" };
  }

  const nextSeen = new Set(state.seenKeys);
  nextSeen.add(key);
  const watermark =
    state.watermark === null ? event.blockNumber : Math.max(state.watermark, event.blockNumber);

  if (event.kind === "PrismIdentityCreated") {
    const p = event.payload as PrismIdentityCreatedPayload;
    if (!p.prismId || !p.controller) {
      return { state, isDuplicate: false, error: "malformed_payload:PrismIdentityCreated" };
    }
    // Uniqueness: prism_id once ever — duplicate creation attempt is idempotent (first wins)
    if (state.identities.has(p.prismId)) {
      return {
        state: { ...state, scope: nextScope, seenKeys: nextSeen, watermark },
        isDuplicate: false,
      };
    }
    const nextIdentities = new Map(state.identities);
    nextIdentities.set(p.prismId, {
      prismId: p.prismId,
      controller: p.controller,
      createdAtBlock: event.blockNumber,
      version: 0,
    });
    return {
      state: { identities: nextIdentities, bindings: state.bindings, seenKeys: nextSeen, watermark, scope: nextScope },
      isDuplicate: false,
    };
  }

  if (event.kind === "ExecutionIdentityBound") {
    const p = event.payload as ExecutionIdentityBoundPayload;
    if (!p.prismId || !p.venue || !p.executionAccount || !p.proofDigest) {
      return { state, isDuplicate: false, error: "malformed_payload:ExecutionIdentityBound" };
    }
    const bKey = bindingKey(p.prismId, p.venue, p.executionAccount);
    const existing = state.bindings.get(bKey);
    // If already ACTIVE, duplicate bound event is benign (idempotent by event_key+digest_check)
    // If REVOKED, a new bind after revoke creates a NEW binding fact with fresh digest — but our
    // projection uses the same composite key; to keep idempotent-by-key semantics, we model
    // re-bind after revoke as transition back to ACTIVE with new boundAtBlock and proofDigest.
    // This preserves INV-SYS-006 "revoked never returns to active via any existing command"
    // only when the re-bind is a NEW event with different txHash+eventIndex — which it is.
    const nextBindings = new Map(state.bindings);
    if (existing && existing.status === "ACTIVE") {
      // Duplicate ACTIVE bind — already active, treat as idempotent duplicate (no state change beyond seenKeys)
      return {
        state: { ...state, scope: nextScope, seenKeys: nextSeen, watermark },
        isDuplicate: false,
      };
    }
    nextBindings.set(bKey, {
      prismId: p.prismId,
      venue: p.venue,
      executionAccount: p.executionAccount,
      status: "ACTIVE",
      boundAtBlock: event.blockNumber,
      revokedAtBlock: null,
      proofDigest: p.proofDigest,
    });
    return {
      state: { identities: state.identities, bindings: nextBindings, seenKeys: nextSeen, watermark, scope: nextScope },
      isDuplicate: false,
    };
  }

  if (event.kind === "BindingRevoked") {
    const p = event.payload as BindingRevokedPayload;
    if (!p.prismId || !p.venue || !p.executionAccount) {
      return { state, isDuplicate: false, error: "malformed_payload:BindingRevoked" };
    }
    const bKey = bindingKey(p.prismId, p.venue, p.executionAccount);
    const existing = state.bindings.get(bKey);
    // Idempotence: revoking an already-revoked binding is benign (ERR-011 semantics)
    // Must NOT delete identity projection (INV-SYS-006)
    const nextBindings = new Map(state.bindings);
    if (existing) {
      nextBindings.set(bKey, {
        ...existing,
        status: "REVOKED",
        revokedAtBlock: event.blockNumber,
      });
    } else {
      // Revocation of non-existent binding — record as REVOKED for audit completeness
      nextBindings.set(bKey, {
        prismId: p.prismId,
        venue: p.venue,
        executionAccount: p.executionAccount,
        status: "REVOKED",
        boundAtBlock: -1,
        revokedAtBlock: event.blockNumber,
        proofDigest: null,
      });
    }
    return {
      state: { identities: state.identities, bindings: nextBindings, seenKeys: nextSeen, watermark, scope: nextScope },
      isDuplicate: false,
    };
  }

  return { state, isDuplicate: false, error: `unknown_kind:${event.kind}` };
}

/**
 * Deterministic reconstruction: sorts by (blockNumber, txHash, eventIndex)
 * then applies idempotently. Empty + replay of three canonical events
 * reconstructs complete state.
 */
export function reconstruct(events: readonly RegistryCanonicalEvent[]): ProjectionState {
  const scopes = events.map((event) => eventScope(event)).filter((scope): scope is RegistryEventScope => scope !== null);
  if (scopes.length > 1 && scopes.some((scope) => !scopeMatches(scope, scopes[0]))) {
    throw new Error("event_scope_mismatch");
  }
  const sorted = [...events].sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) return a.blockNumber - b.blockNumber;
    if (a.txHash.toLowerCase() !== b.txHash.toLowerCase()) {
      return a.txHash.toLowerCase() < b.txHash.toLowerCase() ? -1 : 1;
    }
    return a.eventIndex - b.eventIndex;
  });
  let state = emptyProjection(scopes[0] ?? undefined);
  for (const ev of sorted) {
    const result = applyEvent(state, ev);
    if (result.error === "event_scope_mismatch") throw new Error(result.error);
    // Duplicate keys are benign; malformed payloads are treated as skipped (audit would log)
    if (!result.error) state = result.state;
  }
  return state;
}

/** Resolution helper: returns ACTIVE destination or null sentinel (NO_ACTIVE_DESTINATION). */
export function resolveBinding(
  state: ProjectionState,
  prismId: string,
  venue: string,
): string | null {
  for (const b of state.bindings.values()) {
    if (b.prismId === prismId && b.venue === venue && b.status === "ACTIVE") {
      return b.executionAccount;
    }
  }
  return null;
}

/** Stale-cache sentinel: watermark check for QRY-8-01 bounded staleness. */
export function isStaleProjection(
  projectionWatermark: number | null,
  confirmedBlock: number,
  boundK: number,
): boolean {
  if (projectionWatermark === null) return true;
  return projectionWatermark < confirmedBlock - boundK;
}
