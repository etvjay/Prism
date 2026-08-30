// Testable transport hardening: bounded request admission plus structured hooks.
export interface AuditEvent { readonly event: string; readonly requestId: string | null; readonly route?: string; readonly subject?: string | null; readonly status?: number; readonly metadata?: Record<string, string | number | boolean | null>; }
export interface HttpTelemetry { audit?(event: AuditEvent): void; metric?(name: string, value?: number, tags?: Record<string, string>): void; }
export function recordHttpEvent(telemetry: HttpTelemetry | undefined, event: AuditEvent): void {
  telemetry?.audit?.(event);
  telemetry?.metric?.(`http.${event.event}`, 1, { status: String(event.status ?? "unknown"), route: event.route ?? "unknown" });
}

export interface RateLimitDecision { allowed: boolean; retryAfterSeconds: number; remaining: number; }
export interface RateLimiter { check(key: string, nowMs?: number): RateLimitDecision; }

export function createFixedWindowRateLimiter(limit = 60, windowMs = 60_000, clock: () => number = Date.now): RateLimiter {
  const buckets = new Map<string, { start: number; count: number }>();
  return { check(key, nowMs = clock()) {
    const current = buckets.get(key);
    if (!current || nowMs - current.start >= windowMs) { buckets.set(key, { start: nowMs, count: 1 }); return { allowed: true, retryAfterSeconds: 0, remaining: Math.max(0, limit - 1) }; }
    if (current.count >= limit) return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((windowMs - (nowMs - current.start)) / 1000)), remaining: 0 };
    current.count += 1;
    return { allowed: true, retryAfterSeconds: 0, remaining: Math.max(0, limit - current.count) };
  } };
}

export const defaultRateLimiter = createFixedWindowRateLimiter(
  Number(process.env.PRISM_HTTP_RATE_LIMIT ?? 120),
  Number(process.env.PRISM_HTTP_RATE_WINDOW_MS ?? 60_000),
);

export function rateLimitResponse(requestId: string | null, decision: RateLimitDecision): Response {
  const headers = new Headers({ "content-type": "application/json", "retry-after": String(decision.retryAfterSeconds), "x-ratelimit-limit": "configured", "x-ratelimit-remaining": "0" });
  if (requestId) headers.set("x-request-id", requestId);
  return new Response(JSON.stringify({ ok: false, error: { code: "ERR-429", name: "rate_limit_exceeded", category: "transport", retryable: "true_backoff", userAction: "wait_retry", httpStatusHint: 429, detail: "rate_limit_exceeded" }, requestId }), { status: 429, headers });
}

export function clientRateLimitKey(req: Request): string {
  return req.headers.get("x-session-id") ?? req.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim() ?? "anonymous";
}
