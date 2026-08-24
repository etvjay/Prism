import { getAppFactory } from "@/application/factory";
import { parseHeaders, readJson, requireSession, jsonError } from "@/application/http-helpers";
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
    const pause = await factory.pauseService.escalatePause(decoded);
    const headers = new Headers({ "content-type": "application/json", etag: `"${pause.version}"` });
    if (parsed.requestId) headers.set("x-request-id", parsed.requestId);
    return new Response(JSON.stringify({ ok: true, data: pause, requestId: parsed.requestId ?? null }), { status: 200, headers });
  } catch (e) {
    if (e instanceof PauseError) {
      const shape = e.toExternalShape();
      return new Response(JSON.stringify({ ok: false, error: shape, requestId: parsed.requestId ?? null }), { status: e.httpStatusHint, headers: { "content-type": "application/json" } });
    }
    const code = (e as { code?: string })?.code ?? APP_ERROR_CODE.STALE_STATE_CONFLICT;
    const detail = (e as { detail?: string })?.detail ?? (e as Error).message;
    const { AppError } = await import("@/application/errors");
    const appErr = new AppError(code as never, detail);
    return new Response(JSON.stringify({ ok: false, error: { code: appErr.code, name: appErr.name, category: appErr.category, retryable: appErr.retryable, userAction: appErr.userAction, httpStatusHint: appErr.httpStatusHint, detail: appErr.detail }, requestId: parsed.requestId ?? null }), { status: appErr.httpStatusHint, headers: { "content-type": "application/json" } });
  }
}
