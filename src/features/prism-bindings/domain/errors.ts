/** Stable, framework-free errors for the identity/binding/authority domain. */
export class IdentityAuthorityDomainError extends Error {
  readonly code = "ERR-IDENTITY-AUTHORITY";
  readonly reason: string;

  constructor(reason: string) {
    super(`invariant_violation:${reason}`);
    this.name = "IdentityAuthorityDomainError";
    this.reason = reason;
  }
}

export function invariant(condition: unknown, reason: string): asserts condition {
  if (!condition) throw new IdentityAuthorityDomainError(reason);
}

export function requireNonEmpty(value: unknown, field: string): string {
  invariant(typeof value === "string" && value.trim().length > 0, `${field}_required`);
  return value.trim();
}

export function requireFiniteTimestamp(value: unknown, field: string): number {
  invariant(typeof value === "number" && Number.isFinite(value), `${field}_invalid_timestamp`);
  return value;
}

export function requirePositiveInteger(value: unknown, field: string): number {
  invariant(typeof value === "number" && Number.isSafeInteger(value) && value > 0, `${field}_must_be_positive`);
  return value;
}
