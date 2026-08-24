import { getAppFactory } from "@/application/factory";
import { parseHeaders, toHttpResponse } from "@/application/http-helpers";

// GET /v1/receipts/:receiptId — receipt derived from operation (submitted != completed preserved)
export async function GET(req: Request, ctx: { params: Promise<{ receiptId: string }> }): Promise<Response> {
  const parsed = parseHeaders(req);
  const { receiptId } = await ctx.params;
  const decoded = decodeURIComponent(receiptId);
  const factory = getAppFactory();
  const res = await factory.receiptService.getReceipt(decoded, parsed.requestId);
  return toHttpResponse(res, parsed);
}
