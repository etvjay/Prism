import { getAppFactory } from "@/application/factory";
import {parseHeaders, toHttpResponse, jsonError} from "@/application/http-helpers";

// GET /v1/identity/:prismId — canonical read (QRY-7-01), watermarked
export async function GET(req: Request, ctx: { params: Promise<{ prismId: string }> }): Promise<Response> {
  const parsed = parseHeaders(req);
  const { prismId } = await ctx.params;
  let factory;
  try {
    factory = await getAppFactory();
  } catch (e) {
    const msg = (e as Error)?.message ?? "store_unavailable";
    // Never leak connection string; sanitize
    const safe = msg.includes("postgres") ? "store_unavailable" : msg.slice(0, 80);
    return jsonError(parsed.requestId, "ERR-021", 503, safe);
  }
  const decoded = decodeURIComponent(prismId);
  const res = await factory.app.getIdentity({ payload: { prismId: decoded }, headers: { requestId: parsed.requestId } });
  return toHttpResponse(res, parsed);
}
