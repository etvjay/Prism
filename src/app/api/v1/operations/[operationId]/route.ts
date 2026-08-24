import { getAppFactory } from "@/application/factory";
import {parseHeaders, toHttpResponse, jsonError} from "@/application/http-helpers";

// GET /v1/operations/:operationId — durable operation read (SM-PRISM-003)
export async function GET(req: Request, ctx: { params: Promise<{ operationId: string }> }): Promise<Response> {
  const parsed = parseHeaders(req);
  const { operationId } = await ctx.params;
  const decoded = decodeURIComponent(operationId);
  let factory;
  try {
    factory = await getAppFactory();
  } catch (e) {
    const msg = (e as Error)?.message ?? "store_unavailable";
    // Never leak connection string; sanitize
    const safe = msg.includes("postgres") ? "store_unavailable" : msg.slice(0, 80);
    return jsonError(parsed.requestId, "ERR-021", 503, safe);
  }
  const res = await factory.handlers.getOperation({ payload: { operationId: decoded }, headers: { requestId: parsed.requestId } });
  return toHttpResponse(res, parsed);
}
