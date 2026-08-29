// Optional provider observation for SDK-side shadow-account support.
//
// This is deliberately metadata-only. A shadow account is not a Prism
// identity/binding, STRK20 note, receipt, or execution route. The provider owns
// any account, key, note, and proof material; Prism may retain only this bounded
// readiness observation.

import { assertNoViewingKey } from "./privacy-guard";

export type ShadowAccountObservationStatus = "supported" | "unsupported" | "unknown";

export const SHADOW_ACCOUNT_OBSERVATION_SOURCE = "provider_observation" as const;
export const SHADOW_ACCOUNT_PRIVACY_CLAIM = "not_claimed" as const;

export interface ShadowAccountObservation {
  readonly status: ShadowAccountObservationStatus;
  readonly source: typeof SHADOW_ACCOUNT_OBSERVATION_SOURCE;
  /** Provider capability only; no account address or account object is retained. */
  readonly disposableExecutionAccounts: boolean;
  /** Protocol labels observed from the provider, e.g. Vesu or Endur. */
  readonly supportedProtocols: readonly string[];
  /** Explicitly prevents this observation from becoming an unlinkability claim. */
  readonly privacyClaim: typeof SHADOW_ACCOUNT_PRIVACY_CLAIM;
}

function unknownObservation(): ShadowAccountObservation {
  return {
    status: "unknown",
    source: SHADOW_ACCOUNT_OBSERVATION_SOURCE,
    disposableExecutionAccounts: false,
    supportedProtocols: [],
    privacyClaim: SHADOW_ACCOUNT_PRIVACY_CLAIM,
  };
}

function hasForbiddenShadowMaterial(value: Record<string, unknown>): boolean {
  return Object.keys(value).some((key) =>
    /^(?:address|accountAddress|executionAccount|shadowAccount|account|key|proof|note|unlinkability|untraceable)$/i.test(key));
}

function safeProtocols(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const protocols: string[] = [];
  for (const protocol of value) {
    if (typeof protocol !== "string") return null;
    const normalized = protocol.trim();
    if (normalized.length === 0 || normalized.length > 64 || !/^[A-Za-z0-9 _.-]+$/.test(normalized)) return null;
    if (!protocols.includes(normalized)) protocols.push(normalized);
  }
  return protocols;
}

/**
 * Normalize an optional provider observation without making it a prerequisite
 * for ordinary Wallet API actions. Malformed/secret-bearing observations are
 * reduced to `unknown`, never repaired into a supported capability.
 */
export function normalizeShadowAccountObservation(value: unknown): ShadowAccountObservation | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object" || Array.isArray(value)) return unknownObservation();
  try {
    assertNoViewingKey(value, "shadow_account_observation");
  } catch {
    return unknownObservation();
  }
  const input = value as Record<string, unknown>;
  if (hasForbiddenShadowMaterial(input)) return unknownObservation();
  if (input.source !== undefined && input.source !== SHADOW_ACCOUNT_OBSERVATION_SOURCE) return unknownObservation();

  const status = input.status;
  if (status !== "supported" && status !== "unsupported" && status !== "unknown") return unknownObservation();
  const protocols = safeProtocols(input.supportedProtocols);
  if (protocols === null) return unknownObservation();
  const disposable = input.disposableExecutionAccounts;
  if (typeof disposable !== "boolean") return unknownObservation();
  if (input.privacyClaim !== undefined && input.privacyClaim !== SHADOW_ACCOUNT_PRIVACY_CLAIM) return unknownObservation();

  // A provider cannot declare support while withholding the capability fact.
  if (status === "supported" && disposable !== true) return unknownObservation();
  return {
    status,
    source: SHADOW_ACCOUNT_OBSERVATION_SOURCE,
    disposableExecutionAccounts: disposable,
    supportedProtocols: protocols,
    privacyClaim: SHADOW_ACCOUNT_PRIVACY_CLAIM,
  };
}

/** The observation is informative only; it can never gate an ordinary action. */
export function isShadowAccountObservationSupported(value: ShadowAccountObservation | undefined): boolean {
  return value?.status === "supported" && value.disposableExecutionAccounts === true;
}
