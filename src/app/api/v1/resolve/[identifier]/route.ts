import { getAppFactory } from "@/application/factory";
import { parseHeaders, toHttpResponse, jsonError } from "@/application/http-helpers";

// GET /v1/resolve/:identifier?venue=BASE — watermarked resolve (QRY-8-01)
export async function GET(req: Request, ctx: { params: Promise<{ identifier: string }> }): Promise<Response> {
  const parsed = parseHeaders(req);
  const { identifier } = await ctx.params;
  const decoded = decodeURIComponent(identifier);
  const url = new URL(req.url);
  const venue = url.searchParams.get("venue") ?? "BASE";
  if (!venue) return jsonError(parsed.requestId, "ERR-001", 422, "missing_venue");
  const factory = getAppFactory();
  const res = await factory.app.resolve({ payload: { prismId: decoded, venue }, headers: { requestId: parsed.requestId } });
  return toHttpResponse(res, parsed);
}
