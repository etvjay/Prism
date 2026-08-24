import { getAppFactory } from "@/application/factory";
import { parseHeaders, jsonError } from "@/application/http-helpers";

// GET /v1/pauses/:pauseId
export async function GET(req: Request, ctx: { params: Promise<{ pauseId: string }> }): Promise<Response> {
  const parsed = parseHeaders(req);
  const { pauseId } = await ctx.params;
  const decoded = decodeURIComponent(pauseId);
  const factory = getAppFactory();
  const pause = await factory.pauseService.getPause(decoded);
  if (!pause) return jsonError(parsed.requestId, "ERR-002", 404, `pause_not_found:${decoded}`);
  const headers = new Headers({ "content-type": "application/json", etag: `"${pause.version}"` });
  if (parsed.requestId) headers.set("x-request-id", parsed.requestId);
  if (parsed.correlationId) headers.set("x-correlation-id", parsed.correlationId);
  return new Response(JSON.stringify({ ok: true, data: pause, requestId: parsed.requestId ?? null }), { status: 200, headers });
}
