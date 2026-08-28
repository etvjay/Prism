// App-session authentication separated from execution authority.
// CON-PRISM-006: product authentication (AppSession) never substitutes for
// Starknet controller signature or Base wallet proof. This module owns
// session validation only; execution authority is validated via dedicated
// registry/verifier ports (AUTHORITY_MATRIX A2/A4).

import { createHmac, timingSafeEqual } from "node:crypto";

export interface AppSession {
  readonly sessionId: string;
  readonly userId: string;
  /** Unix seconds when session was issued. */
  readonly issuedAt: number;
  /** Unix seconds when session expires. Optional = no expiry (fixture only). */
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
const SIGNED_SESSION_VERSION = "v1";
const DEFAULT_ISSUER = "prism";
const DEFAULT_AUDIENCE = "prism-api";

export interface SignedSessionClaims {
  readonly sid: string;
  readonly sub: string;
  readonly iat: number;
  readonly exp: number;
  readonly iss: string;
  readonly aud: string;
  readonly jti?: string;
}

function base64url(value: string | Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

function decodeJson(value: string): unknown {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
}

function configuredSecret(): string | null {
  const secret = process.env.PRISM_APP_SESSION_SECRET;
  return secret && secret.length >= 32 ? secret : null;
}

function configuredIssuer(): string { return process.env.PRISM_APP_SESSION_ISSUER || DEFAULT_ISSUER; }
function configuredAudience(): string { return process.env.PRISM_APP_SESSION_AUDIENCE || DEFAULT_AUDIENCE; }

/** Issue the compact HMAC session format used by the trusted server boundary. */
export function signAppSession(claims: Omit<SignedSessionClaims, "iss" | "aud"> & Partial<Pick<SignedSessionClaims, "iss" | "aud">>, secret = configuredSecret()): string {
  if (!secret) throw new AppAuthError("ERR-023", "session_secret_unavailable");
  const payload: SignedSessionClaims = { ...claims, iss: claims.iss ?? configuredIssuer(), aud: claims.aud ?? configuredAudience() };
  const encoded = base64url(JSON.stringify(payload));
  const signature = createHmac("sha256", secret).update(`${SIGNED_SESSION_VERSION}.${encoded}`).digest();
  return `${SIGNED_SESSION_VERSION}.${encoded}.${base64url(signature)}`;
}

function revokedSessionIds(): Set<string> {
  return new Set((process.env.PRISM_APP_SESSION_REVOKED_IDS ?? "").split(",").map((v) => v.trim()).filter(Boolean));
}

/** Verify authenticity and all server-controlled claims; never trusts request metadata. */
export function verifySignedAppSession(token: string, now = Math.floor(Date.now() / 1000)): AppSession {
  const secret = configuredSecret();
  if (!secret) throw new AppAuthError("ERR-023", "session_secret_unavailable");
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== SIGNED_SESSION_VERSION) throw new AppAuthError("ERR-023", "malformed_session");
  const expected = createHmac("sha256", secret).update(`${parts[0]}.${parts[1]}`).digest();
  let actual: Buffer;
  try { actual = Buffer.from(parts[2], "base64url"); } catch { throw new AppAuthError("ERR-023", "malformed_session"); }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new AppAuthError("ERR-023", "invalid_session_signature");
  let claims: SignedSessionClaims;
  try { claims = decodeJson(parts[1]) as SignedSessionClaims; } catch { throw new AppAuthError("ERR-023", "malformed_session"); }
  if (!claims || claims.iss !== configuredIssuer() || claims.aud !== configuredAudience()) throw new AppAuthError("ERR-023", "session_claim_mismatch");
  if (typeof claims.sid !== "string" || typeof claims.sub !== "string" || !Number.isFinite(claims.iat) || !Number.isFinite(claims.exp)) throw new AppAuthError("ERR-023", "malformed_session");
  if (claims.iat > now + 60) throw new AppAuthError("ERR-023", "session_issued_in_future");
  if (now >= claims.exp) throw new AppAuthError("ERR-013", "session_expired");
  if (claims.exp <= claims.iat || revokedSessionIds().has(claims.sid) || (claims.jti ? revokedSessionIds().has(claims.jti) : false)) throw new AppAuthError("ERR-023", "session_revoked");
  return assertValidAppSession({ sessionId: claims.sid, userId: claims.sub, issuedAt: claims.iat, expiresAt: claims.exp }, now);
}

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
