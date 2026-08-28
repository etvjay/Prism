import { getAppFactory } from "@/application/factory";
import { parseHeaders, toHttpResponse, jsonError, requireAuthenticatedSession } from "@/application/http-helpers";

// GET /v1/privacy/receipts/:receiptId, derived policy-filtered projection.
// This route never returns generic operation/provider/raw receipt material.
export async function GET(req: Request, ctx: { params: Promise<{ receiptId: string }> }): Promise<Response> {
  const parsed = parseHeaders(req);
  const sessionOrErr = requireAuthenticatedSession(req, null);
  if ("error" in sessionOrErr) return sessionOrErr.error;
  const { receiptId } = await ctx.params;
  let decoded: string;
  try {
    decoded = decodeURIComponent(receiptId);
  } catch {
    return jsonError(parsed.requestId, "STRK20-011", 400, "malformed_receipt_id");
  }
  let factory;
  try {
    factory = await getAppFactory();
  } catch {
    return jsonError(parsed.requestId, "ERR-021", 503, "store_unavailable");
  }
  const response = await factory.handlers.getPrivacyReceipt({
    payload: { receiptId: decoded },
    headers: { requestId: parsed.requestId },
    session: sessionOrErr,
  });
  return toHttpResponse(response, parsed);
}
