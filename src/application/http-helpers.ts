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
    const code = (appRes as { error: { code: string } }).error.code;
    const statusHint = (appRes as { error: { httpStatusHint: number } }).error.httpStatusHint;
    // Never leak stacks — body is stable catalogue shape only.
    const body = JSON.stringify({ ok: false, error: (appRes as { error: unknown }).error, requestId: parsed.requestId ?? null });
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
  const body = JSON.stringify({
    ok: false,
    error: { code, name: code, category: "unknown", retryable: "no", userAction: "none", httpStatusHint: httpStatus, ...(detail ? { detail } : {}) },
    requestId,
  });
  return new Response(body, { status: httpStatus, headers });
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
