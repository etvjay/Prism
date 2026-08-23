// App-session authentication separated from execution authority.
// CON-PRISM-006: product authentication (AppSession) never substitutes for
// Starknet controller signature or Base wallet proof. This module owns
// session validation only; execution authority is validated via dedicated
// registry/verifier ports (AUTHORITY_MATRIX A2/A4).

export interface AppSession {
  readonly sessionId: string;
  readonly userId: string;
  /** Unix seconds when session was issued. */
  readonly issuedAt: number;
  /** Unix seconds when session expires. Optional = no expiry (test only). */
  readonly expiresAt?: number | null;
  /** Optional display handle, never used for authorization. */
  readonly displayName?: string | null;
}

export interface StarknetAuthority {
  /** Starknet controller address that will sign the registry transaction. */
  readonly controllerAddress: string;
}

export interface BaseAuthority {
  /** Base execution account asserted by wallet signature. */
  readonly executionAccount: string;
}

const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

export function assertValidAppSession(session: AppSession, now: number): AppSession {
  if (!session || typeof session.sessionId !== "string" || !SESSION_ID_PATTERN.test(session.sessionId)) {
    throw new AppAuthError("ERR-023", "invalid_session_id");
  }
  if (!session.userId || session.userId.trim().length === 0) {
    throw new AppAuthError("ERR-023", "invalid_session_user");
  }
  if (!Number.isFinite(now)) throw new AppAuthError("ERR-023", "invalid_now_timestamp");
  if (session.expiresAt !== undefined && session.expiresAt !== null) {
    if (!Number.isFinite(session.expiresAt)) throw new AppAuthError("ERR-023", "invalid_session_expiry");
    if (now >= session.expiresAt) throw new AppAuthError("ERR-013", "session_expired");
  }
  if (!Number.isFinite(session.issuedAt)) throw new AppAuthError("ERR-023", "invalid_session_issued_at");
  return session;
}

export class AppAuthError extends Error {
  readonly code: string;
  readonly detail?: string;
  constructor(code: string, detail?: string) {
    super(`[${code}] app_auth:${detail ?? code}`);
    this.name = "AppAuthError";
    this.code = code;
    this.detail = detail;
  }
}

export function isAppAuthError(v: unknown): v is AppAuthError {
  return v instanceof AppAuthError;
}
