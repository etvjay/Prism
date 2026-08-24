import { getAppFactory } from "@/application/factory";
import {parseHeaders, toHttpResponse, jsonError} from "@/application/http-helpers";

// GET /v1/receipts/:receiptId — receipt derived from operation (submitted != completed preserved)
export async function GET(req: Request, ctx: { params: Promise<{ receiptId: string }> }): Promise<Response> {
  const parsed = parseHeaders(req);
  const { receiptId } = await ctx.params;
  const decoded = decodeURIComponent(receiptId);
  let factory;
  try {
    factory = await getAppFactory();
  } catch (e) {
    const msg = (e as Error)?.message ?? "store_unavailable";
    // Never leak connection string; sanitize
    const safe = msg.includes("postgres") ? "store_unavailable" : msg.slice(0, 80);
    return jsonError(parsed.requestId, "ERR-021", 503, safe);
  }
  const res = await factory.receiptService.getReceipt(decoded, parsed.requestId);
  return toHttpResponse(res, parsed);
}
