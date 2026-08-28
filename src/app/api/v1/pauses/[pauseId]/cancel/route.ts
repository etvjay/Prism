import { getAppFactory } from "@/application/factory";
import { parseHeaders, readJson, requireSession, jsonError, toHttpErrorResponse } from "@/application/http-helpers";
import { APP_ERROR_CODE } from "@/application/errors";
import { PauseError } from "@/features/prism-pause/domain/errors";

export async function POST(req: Request, ctx: { params: Promise<{ pauseId: string }> }): Promise<Response> {
  const parsed = parseHeaders(req);
  const { pauseId } = await ctx.params;
  const decoded = decodeURIComponent(pauseId);
  const body = await readJson(req);
  if (body === null) return jsonError(parsed.requestId, "ERR-023", 400, "malformed_json");
  const sessionOrErr = requireSession(req, body);
  if ("error" in sessionOrErr) return sessionOrErr.error;
  const expectedVersion = parsed.expectedVersion ?? (body.expectedVersion as number | null | undefined) ?? null;
  // The session is the authenticated subject; request claims and the
  // cancellation reason are untrusted inputs for the configured resolver/audit.
  const authorityClaim = (body.authorityActor as string | undefined) ?? (body.actor as string | undefined);
  const reason = (body.reason as string | undefined) ?? (body.reasonCode as string | undefined);
  let factory;
  try {
    factory = await getAppFactory();
  } catch (e) {
    const msg = (e as Error)?.message ?? "store_unavailable";
    // Never leak connection string; sanitize
    const safe = msg.includes("postgres") ? "store_unavailable" : msg.slice(0, 80);
    return jsonError(parsed.requestId, "ERR-021", 503, safe);
  }
  try {
    const pause = await factory.pauseService.cancelPause(decoded, expectedVersion, {
      authoritySubject: sessionOrErr.userId,
      authorityClaim: authorityClaim ?? null,
      reason: reason ?? null,
    });
    const headers = new Headers({ "content-type": "application/json", etag: `"${pause.version}"` });
    if (parsed.requestId) headers.set("x-request-id", parsed.requestId);
    if (parsed.correlationId) headers.set("x-correlation-id", parsed.correlationId);
    return new Response(JSON.stringify({ ok: true, data: pause, requestId: parsed.requestId ?? null }), { status: 200, headers });
  } catch (e) {
    if (e instanceof PauseError) {
      return toHttpErrorResponse(e.toExternalShape(), parsed);
    }
    const code = (e as { code?: string })?.code ?? APP_ERROR_CODE.STALE_STATE_CONFLICT;
    const detail = (e as { detail?: string })?.detail ?? (e as Error).message;
    const { AppError } = await import("@/application/errors");
    const appErr = new AppError(code as never, detail);
    return toHttpErrorResponse(appErr.toExternalShape(), parsed);
  }
}
