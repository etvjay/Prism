import { getAppFactory } from "@/application/factory";
import { parseHeaders, toHttpResponse } from "@/application/http-helpers";

// GET /v1/operations/:operationId — durable operation read (SM-PRISM-003)
export async function GET(req: Request, ctx: { params: Promise<{ operationId: string }> }): Promise<Response> {
  const parsed = parseHeaders(req);
  const { operationId } = await ctx.params;
  const decoded = decodeURIComponent(operationId);
  const factory = getAppFactory();
  const res = await factory.handlers.getOperation({ payload: { operationId: decoded }, headers: { requestId: parsed.requestId } });
  return toHttpResponse(res, parsed);
}
