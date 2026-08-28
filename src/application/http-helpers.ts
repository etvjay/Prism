// Stable HTTP ↔ Application mapping.
// Headers: Idempotency-Key, X-Request-Id, X-Correlation-Id, If-Match / X-Expected-Version.
// Responses: stable JSON, no stacks, watermark header, correlation echo.

import type { AppResponse } from "./schemas";
import { APP_ERROR_CODE } from "./errors";
import type { AppSession } from "./auth";

export interface ParsedHeaders {
  requestId: string | null;
  correlationId: string | null;
  idempotencyKey: string | null;
  expectedVersion: number | null;
}

const DEPENDENCY_ERROR_CODES = new Set(["ERR-021", "ERR-022"]);

/** Keep client diagnostics useful without exposing provider output or secrets. */
export function sanitizeExternalDetail(code: string | undefined, detail: unknown): string | undefined {
  if (detail === undefined || detail === null) return undefined;
  if (code && DEPENDENCY_ERROR_CODES.has(code)) {
    if (code === "ERR-022") return "submission_status_unknown";
    return detail === "store_unavailable" ? "store_unavailable" : "dependency_unavailable";
  }
  let safe = String(detail).split(/\r?\n/, 1)[0].slice(0, 240);
  safe = safe.replace(/\b(?:https?|wss?):\/\/[^\s"'<>]+/gi, "<redacted_url>");
  safe = safe.replace(/\b(?:postgres(?:ql)?|mysql(?:\+[^:]+)?):\/\/[^\s"'<>]+/gi, "<redacted_connection>");
  safe = safe.replace(/((?:api[_-]?key|access[_-]?token|auth[_-]?token|token|secret|password|private[ _-]?key|viewing[ _-]?key|connection(?:[ _-]?string)?|ciphertext|raw[ _-]?proof|proof[ _-]?digest)\s*[:=]\s*)(["']?)[^,\s"']+\2/gi, "$1<redacted>");
  safe = safe.replace(/((?:private[ _-]?key|viewing[ _-]?key|secret|token|password)\s+)[A-Za-z0-9+/=_-]{8,}/gi, "$1<redacted>");
  safe = safe.replace(/0x[0-9a-f]{64}/gi, "<opaque>");
  return safe;
}

export function parseHeaders(req: Request | { headers: Headers | Record<string, string | undefined> }): ParsedHeaders {
  const get = (name: string): string | null => {
    if (req instanceof Request) return req.headers.get(name);
    const h = (req as { headers: Record<string, string | undefined> }).headers as Record<string, string | undefined>;
    const lower = name.toLowerCase();
    for (const [k, v] of Object.entries(h)) if (k.toLowerCase() === lower) return v ?? null;
    return null;
  };
  const requestId = get("x-request-id") ?? get("request-id") ?? null;
  const correlationId = get("x-correlation-id") ?? get("correlation-id") ?? null;
  const idempotencyKey = get("idempotency-key") ?? get("x-idempotency-key") ?? null;
  let expectedVersion: number | null = null;
  const rawExpected = get("if-match") ?? get("x-expected-version") ?? get("expected-version") ?? null;
  if (rawExpected !== null && rawExpected !== "") {
    const stripped = rawExpected.replace(/^W\//, "").replace(/^"/, "").replace(/"$/, "").trim();
    const n = Number(stripped);
    if (Number.isFinite(n) && Number.isInteger(n) && n >= 0) expectedVersion = n;
    else expectedVersion = null;
  }
  return { requestId, correlationId, idempotencyKey, expectedVersion };
}

export function parseSession(req: Request, bodySession?: unknown): AppSession | null {
  // Prefer body session if provided (SDK), else headers.
  if (bodySession && typeof bodySession === "object" && "sessionId" in (bodySession as Record<string, unknown>)) {
    return bodySession as AppSession;
  }
  const get = (name: string): string | null => req.headers.get(name);
  const sessionId = get("x-session-id") ?? get("x-prism-session-id") ?? null;
  const userId = get("x-session-user") ?? get("x-user-id") ?? null;
  const issuedAtRaw = get("x-session-issued-at");
  const expiresAtRaw = get("x-session-expires-at");
  if (!sessionId || !userId) return null;
  const issuedAt = issuedAtRaw ? Number(issuedAtRaw) : Math.floor(Date.now() / 1000) - 10;
  const expiresAt = expiresAtRaw ? Number(expiresAtRaw) : Math.floor(Date.now() / 1000) + 3600;
  return { sessionId, userId, issuedAt, expiresAt };
}

export function toHttpResponse<T>(appRes: AppResponse<T>, parsed: ParsedHeaders): Response {
  const headers = new Headers();
  headers.set("content-type", "application/json");
  if (parsed.requestId) headers.set("x-request-id", parsed.requestId);
  if (parsed.correlationId) headers.set("x-correlation-id", parsed.correlationId);
  if (appRes.ok && (appRes as { watermark?: number | null }).watermark !== undefined && (appRes as { watermark?: number | null }).watermark !== null) {
    headers.set("x-prism-watermark", String((appRes as { watermark: number }).watermark));
    headers.set("etag", `"${(appRes as { watermark: number }).watermark}"`);
  }
  if (appRes.ok && (appRes as { operation?: { version: number } }).operation) {
    headers.set("etag", `"${(appRes as { operation: { version: number } }).operation.version}"`);
  }
  if (!appRes.ok) {
    const rawError = (appRes as { error: { code: string; name: string; category: string; retryable: string; userAction: string; httpStatusHint: number; detail?: unknown } }).error;
    const code = rawError.code;
    const statusHint = rawError.httpStatusHint;
    const detail = sanitizeExternalDetail(code, rawError.detail);
    const error = {
      code: rawError.code,
      name: rawError.name,
      category: rawError.category,
      retryable: rawError.retryable,
      userAction: rawError.userAction,
      httpStatusHint: rawError.httpStatusHint,
      ...(detail ? { detail } : {}),
    };
    // Never leak stacks, provider output, credentials, or proof material.
    const body = JSON.stringify({ ok: false, error, requestId: parsed.requestId ?? null });
    headers.set("x-error-code", code);
    return new Response(body, { status: statusHint, headers });
  }
  const httpStatus = 200;
  // For created/submitted semantics, still 200 with operation.state (submitted != completed)
  const envelope: Record<string, unknown> = {
    ok: true,
    data: (appRes as { data: unknown }).data,
    requestId: parsed.requestId ?? null,
  };
  if ((appRes as { operation?: unknown }).operation) envelope.operation = (appRes as { operation: unknown }).operation;
  if ((appRes as { watermark?: unknown }).watermark !== undefined) envelope.watermark = (appRes as { watermark: unknown }).watermark;
  // Spec requires 202 for dependency/processing? Keep 200 per stable contract; client checks operation.state.
  return new Response(JSON.stringify(envelope), { status: httpStatus, headers });
}

export function jsonError(requestId: string | null, code: string, httpStatus: number, detail?: string): Response {
  const headers = new Headers({ "content-type": "application/json" });
  if (requestId) headers.set("x-request-id", requestId);
  headers.set("x-error-code", code);
  const safeDetail = sanitizeExternalDetail(code, detail);
  const body = JSON.stringify({
    ok: false,
    error: { code, name: code, category: "unknown", retryable: "no", userAction: "none", httpStatusHint: httpStatus, ...(safeDetail ? { detail: safeDetail } : {}) },
    requestId,
  });
  return new Response(body, { status: httpStatus, headers });
}

export interface ExternalHttpErrorShape {
  readonly code: string;
  readonly name: string;
  readonly category: string;
  readonly retryable: string;
  readonly userAction: string;
  readonly httpStatusHint: number;
  readonly detail?: unknown;
}

/** Serialize a domain error at the HTTP boundary with the same redaction as AppResponse errors. */
export function toHttpErrorResponse(error: ExternalHttpErrorShape, parsed: ParsedHeaders, status = error.httpStatusHint): Response {
  const headers = new Headers({ "content-type": "application/json", "x-error-code": error.code });
  if (parsed.requestId) headers.set("x-request-id", parsed.requestId);
  if (parsed.correlationId) headers.set("x-correlation-id", parsed.correlationId);
  const detail = sanitizeExternalDetail(error.code, error.detail);
  const safeError = {
    code: error.code,
    name: error.name,
    category: error.category,
    retryable: error.retryable,
    userAction: error.userAction,
    httpStatusHint: error.httpStatusHint,
    ...(detail ? { detail } : {}),
  };
  return new Response(JSON.stringify({ ok: false, error: safeError, requestId: parsed.requestId ?? null }), { status, headers });
}

export async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const text = await req.text();
    if (!text || text.trim().length === 0) return {};
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// Helper to build AppSession fallback for unauthenticated tests (requires explicit session in real flow)
export function requireSession(req: Request, body: Record<string, unknown> | null): AppSession | { error: Response } {
  const fromBody = (body?.session ?? body?.appSession ?? null) as unknown as AppSession | null;
  const parsed = parseSession(req, fromBody);
  if (parsed) return parsed;
  // Allow Authorization: Bearer <sessionId:userId> for tests
  const auth = req.headers.get("authorization");
  if (auth && auth.startsWith("Bearer ")) {
    const token = auth.slice(7).trim();
    const parts = token.split(":");
    if (parts.length >= 2) {
      return { sessionId: parts[0], userId: parts[1], issuedAt: Math.floor(Date.now() / 1000) - 10, expiresAt: Math.floor(Date.now() / 1000) + 3600 };
    }
  }
  const parsedHeaders = parseHeaders(req);
  return { error: jsonError(parsedHeaders.requestId, APP_ERROR_CODE.STALE_STATE_CONFLICT, 401, "missing_app_session") };
}
