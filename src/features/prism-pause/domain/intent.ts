// Canonical Intent — P1 foundation.
// No framework/DB imports. Pure domain value + validation.
// Spec: PRISM_PAUSE_PHASE_PLAN §2 (ExecutionIntent) + idempotency/expiry semantics.

import { PauseError, PAUSE_ERROR_CODE } from "./errors";

export type IntentInitiator = "user" | "agent" | "service";
export type IntentPurpose = "payment" | "transfer" | "contract_call" | "private_action" | "other";

export interface ExecutionIntent {
  readonly intentId: string;
  readonly principal: string; // Prism ID / authenticated actor reference
  readonly initiator: IntentInitiator;
  readonly agentId?: string | null; // required when initiator=agent
  readonly purpose: IntentPurpose;
  readonly requestedRecipient: string; // Prism ID | social principal | native address | contract
  readonly requestedAsset: string; // chain + token/asset opaque but non-empty
  readonly requestedAmount: string; // exact amount or bounded amount (decimal string)
  readonly requestedRoute: string; // destination chain + contract + entrypoint/call summary
  readonly createdAt: number; // unix ms
  readonly expiresAt: number; // unix ms
  readonly clientIdempotencyKey: string; // stable retry key
  readonly intentVersion: number; // monotonic
  readonly policyVersion: string; // snapshot bound at creation (opaque version string)
}

export interface CreateIntentInput {
  intentId: string;
  principal: string;
  initiator: IntentInitiator;
  agentId?: string | null;
  purpose: IntentPurpose;
  requestedRecipient: string;
  requestedAsset: string;
  requestedAmount: string;
  requestedRoute: string;
  createdAt: number;
  expiresAt: number;
  clientIdempotencyKey: string;
  intentVersion?: number;
  policyVersion: string;
}

const VALID_INITIATORS: ReadonlySet<string> = new Set(["user", "agent", "service"]);
const VALID_PURPOSES: ReadonlySet<string> = new Set(["payment", "transfer", "contract_call", "private_action", "other"]);

function requireNonEmpty(v: string, field: string): string {
  if (typeof v !== "string" || v.trim().length === 0) throw new PauseError(PAUSE_ERROR_CODE.INVALID_INTENT, `${field}_required`);
  return v.trim();
}

function requireFiniteNumber(n: number, field: string): number {
  if (!Number.isFinite(n)) throw new PauseError(PAUSE_ERROR_CODE.INVALID_INTENT, `${field}_invalid_timestamp`);
  return n;
}

export function createIntent(input: CreateIntentInput): ExecutionIntent {
  const intentId = requireNonEmpty(input.intentId, "intent_id");
  const principal = requireNonEmpty(input.principal, "principal");
  const initiator = requireNonEmpty(input.initiator as string, "initiator") as IntentInitiator;
  if (!VALID_INITIATORS.has(initiator)) throw new PauseError(PAUSE_ERROR_CODE.INVALID_INTENT, `initiator_invalid:${initiator}`);
  const agentId = input.agentId === undefined || input.agentId === null ? null : requireNonEmpty(input.agentId, "agent_id");
  if (initiator === "agent" && agentId === null) {
    throw new PauseError(PAUSE_ERROR_CODE.INVALID_INTENT, "agent_initiator_requires_agent_id");
  }
  const purpose = requireNonEmpty(input.purpose as string, "purpose") as IntentPurpose;
  if (!VALID_PURPOSES.has(purpose)) throw new PauseError(PAUSE_ERROR_CODE.INVALID_INTENT, `purpose_invalid:${purpose}`);
  const requestedRecipient = requireNonEmpty(input.requestedRecipient, "requested_recipient");
  const requestedAsset = requireNonEmpty(input.requestedAsset, "requested_asset");
  const requestedAmount = requireNonEmpty(input.requestedAmount, "requested_amount");
  const requestedRoute = requireNonEmpty(input.requestedRoute, "requested_route");
  const createdAt = requireFiniteNumber(input.createdAt, "created_at");
  const expiresAt = requireFiniteNumber(input.expiresAt, "expires_at");
  if (expiresAt <= createdAt) throw new PauseError(PAUSE_ERROR_CODE.INVALID_INTENT, "expires_at_must_be_after_created_at");
  const clientIdempotencyKey = requireNonEmpty(input.clientIdempotencyKey, "client_idempotency_key");
  const policyVersion = requireNonEmpty(input.policyVersion, "policy_version");
  const intentVersion = input.intentVersion ?? 1;
  if (!Number.isInteger(intentVersion) || intentVersion < 1) throw new PauseError(PAUSE_ERROR_CODE.INVALID_INTENT, "intent_version_must_be_positive_integer");

  return {
    intentId,
    principal,
    initiator,
    agentId,
    purpose,
    requestedRecipient,
    requestedAsset,
    requestedAmount,
    requestedRoute,
    createdAt,
    expiresAt,
    clientIdempotencyKey,
    intentVersion,
    policyVersion,
  };
}

/**
 * Compare the immutable business fields covered by an idempotency key.
 * Generated timestamps and the server-side intent id are deliberately excluded
 * so a retried request resolves to the original intent instead of creating a
 * false conflict, while authority-bearing fields cannot drift silently.
 */
export function sameIntentFingerprint(a: ExecutionIntent, b: ExecutionIntent): boolean {
  return (
    a.principal === b.principal &&
    a.initiator === b.initiator &&
    (a.agentId ?? null) === (b.agentId ?? null) &&
    a.purpose === b.purpose &&
    a.requestedRecipient === b.requestedRecipient &&
    a.requestedAsset === b.requestedAsset &&
    a.requestedAmount === b.requestedAmount &&
    a.requestedRoute === b.requestedRoute &&
    a.intentVersion === b.intentVersion &&
    a.policyVersion === b.policyVersion
  );
}

export function isIntentExpired(intent: ExecutionIntent, now: number): boolean {
  if (!Number.isFinite(now)) throw new PauseError(PAUSE_ERROR_CODE.INVALID_INTENT, "invalid_now");
  return now >= intent.expiresAt;
}

export function nextIntentVersion(intent: ExecutionIntent): ExecutionIntent {
  return { ...intent, intentVersion: intent.intentVersion + 1 };
}
