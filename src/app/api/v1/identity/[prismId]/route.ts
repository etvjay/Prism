import { getAppFactory } from "@/application/factory";
import { parseHeaders, toHttpResponse } from "@/application/http-helpers";

// GET /v1/identity/:prismId — canonical read (QRY-7-01), watermarked
export async function GET(req: Request, ctx: { params: Promise<{ prismId: string }> }): Promise<Response> {
  const parsed = parseHeaders(req);
  const { prismId } = await ctx.params;
  const factory = getAppFactory();
  const decoded = decodeURIComponent(prismId);
  const res = await factory.app.getIdentity({ payload: { prismId: decoded }, headers: { requestId: parsed.requestId } });
  return toHttpResponse(res, parsed);
}
