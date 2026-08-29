import { getAppFactory } from "@/application/factory";
import { parseHeaders, readJson, requireAuthenticatedSession, jsonError, toHttpErrorResponse } from "@/application/http-helpers";
import { APP_ERROR_CODE } from "@/application/errors";
import { PauseError, PAUSE_ERROR_CODE } from "@/features/prism-pause/domain/errors";

export async function POST(req: Request, ctx: { params: Promise<{ pauseId: string }> }): Promise<Response> {
  const parsed = parseHeaders(req);
  const { pauseId } = await ctx.params;
  const decoded = decodeURIComponent(pauseId);
  const body = await readJson(req);
  if (body === null) return jsonError(parsed.requestId, "ERR-023", 400, "malformed_json");
  const sessionOrErr = requireAuthenticatedSession(req, body);
  if ("error" in sessionOrErr) return sessionOrErr.error;
  if (Object.prototype.hasOwnProperty.call(body, "sources")) {
    const error = new PauseError(PAUSE_ERROR_CODE.INVALID_STATE, "verification_sources_not_client_writable");
    return new Response(JSON.stringify({ ok: false, error: error.toExternalShape(), requestId: parsed.requestId ?? null }), {
      status: error.httpStatusHint,
      headers: {
        "content-type": "application/json",
        ...(parsed.requestId ? { "x-request-id": parsed.requestId } : {}),
        ...(parsed.correlationId ? { "x-correlation-id": parsed.correlationId } : {}),
      },
    });
  }
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
    const planHash = body.planHash as string | undefined;
    const policyVersion = body.policyVersion as string | undefined;
    const pause = await factory.pauseService.verifyPause(decoded, { planHash, policyVersion });
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
