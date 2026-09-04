/**
 * Consent interstitial model for the privacy wallet flow.
 *
 * Consent is bound to the token set + session address + timestamp. Grant and
 * deny run through `assertNoViewingKey` / `assertNoSecretMaterial` first, and
 * no key, note, or proof material is ever retained — only the non-secret
 * consent record below.
 */

import { assertNoViewingKey } from "../prism-strk20/domain/privacy-guard";
import { WALLET_SESSION_ERROR_CODE, WalletSessionError } from "../wallet/session/errors";
import { assertNoSecretMaterial } from "../wallet/session/no-secrets";
import { denyConsent, grantConsent } from "../wallet/session/session-state";
import type { WalletSessionContract } from "../wallet/session/types";

export type ConsentDecision = "granted" | "denied";

export interface ConsentScope {
  readonly tokens: readonly string[];
  readonly sessionAddress: string | null;
  readonly requestedAt: number;
}

export interface ConsentRecord {
  readonly decision: ConsentDecision;
  readonly tokens: readonly string[];
  readonly sessionAddress: string | null;
  readonly requestedAt: number;
  readonly decidedAt: number;
  /** Non-secret audit id derived from tokens + session + timestamp. */
  readonly consentReference: string;
}

function referenceFor(scope: ConsentScope): string {
  const material = `${scope.tokens.join(",")}|${scope.sessionAddress ?? "none"}|${scope.requestedAt}`;
  let hash = 0;
  for (let i = 0; i < material.length; i += 1) {
    hash = (hash * 31 + material.charCodeAt(i)) >>> 0;
  }
  return `audit-ref-${hash.toString(16).padStart(8, "0")}`;
}

export function buildConsentScope(input: {
  tokens: readonly string[];
  sessionAddress: string | null;
  now: number;
}): ConsentScope {
  if (!Number.isFinite(input.now)) {
    throw new WalletSessionError(WALLET_SESSION_ERROR_CODE.STALE_STATE, "invalid_now");
  }
  if (input.tokens.length === 0) {
    throw new WalletSessionError(WALLET_SESSION_ERROR_CODE.CONSENT_REQUIRED, "token_scope_required");
  }
  const scope: ConsentScope = {
    tokens: [...input.tokens],
    sessionAddress: input.sessionAddress,
    requestedAt: input.now,
  };
  assertNoViewingKey(scope, "consent_scope");
  assertNoSecretMaterial(scope, "consent_scope");
  return scope;
}

/**
 * Records a grant/deny decision. Fail-closed on secret material: the guards
 * run before any session transition, and the record carries no key, note,
 * or proof payload.
 */
export function decideConsent<T extends WalletSessionContract>(
  session: T,
  scope: ConsentScope,
  decision: ConsentDecision,
  now: number,
): { session: T; record: ConsentRecord } {
  assertNoViewingKey({ scope, decision }, "consent_decision");
  assertNoSecretMaterial({ scope, decision }, "consent_decision");
  const record: ConsentRecord = {
    decision,
    tokens: [...scope.tokens],
    sessionAddress: scope.sessionAddress,
    requestedAt: scope.requestedAt,
    decidedAt: now,
    consentReference: referenceFor(scope),
  };
  const next = decision === "granted" ? grantConsent(session, now) : denyConsent(session, now);
  return { session: next, record };
}

export function consentBindingLine(record: ConsentRecord): string {
  return `Tokens ${record.tokens.join(", ")} · session ${record.sessionAddress ?? "none"} · ${new Date(record.requestedAt).toISOString()} · ${record.consentReference}`;
}
