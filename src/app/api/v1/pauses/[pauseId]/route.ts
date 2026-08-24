import { getAppFactory } from "@/application/factory";
import { parseHeaders, jsonError } from "@/application/http-helpers";

// GET /v1/pauses/:pauseId
export async function GET(req: Request, ctx: { params: Promise<{ pauseId: string }> }): Promise<Response> {
  const parsed = parseHeaders(req);
  const { pauseId } = await ctx.params;
  const decoded = decodeURIComponent(pauseId);
  let factory;
  try {
    factory = await getAppFactory();
  } catch (e) {
    const msg = (e as Error)?.message ?? "store_unavailable";
    // Never leak connection string; sanitize
    const safe = msg.includes("postgres") ? "store_unavailable" : msg.slice(0, 80);
    return jsonError(parsed.requestId, "ERR-021", 503, safe);
  }
  let pause;
  try {
    pause = await factory.pauseService.getPause(decoded);
  } catch {
    const response = jsonError(parsed.requestId, "ERR-021", 503, "store_unavailable");
    if (parsed.correlationId) response.headers.set("x-correlation-id", parsed.correlationId);
    return response;
  }
  if (!pause) {
    const response = jsonError(parsed.requestId, "ERR-002", 404, `pause_not_found:${decoded}`);
    if (parsed.correlationId) response.headers.set("x-correlation-id", parsed.correlationId);
    return response;
  }
  const headers = new Headers({ "content-type": "application/json", etag: `"${pause.version}"` });
  if (parsed.requestId) headers.set("x-request-id", parsed.requestId);
  if (parsed.correlationId) headers.set("x-correlation-id", parsed.correlationId);
  return new Response(JSON.stringify({ ok: true, data: pause, requestId: parsed.requestId ?? null }), { status: 200, headers });
}
