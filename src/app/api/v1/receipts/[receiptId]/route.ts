import { getAppFactory } from "@/application/factory";
import { parseHeaders, toHttpResponse, jsonError, sanitizeExternalDetail } from "@/application/http-helpers";

// GET /v1/receipts/:receiptId — receipt derived from operation (submitted != completed preserved)
export async function GET(req: Request, ctx: { params: Promise<{ receiptId: string }> }): Promise<Response> {
  const parsed = parseHeaders(req);
  const { receiptId } = await ctx.params;
  let decoded: string;
  try {
    decoded = decodeURIComponent(receiptId);
  } catch {
    return withCorrelation(jsonError(parsed.requestId, "ERR-023", 400, "malformed_receipt_id"), parsed.correlationId);
  }
  let factory;
  try {
    factory = await getAppFactory();
  } catch {
    return withCorrelation(jsonError(parsed.requestId, "ERR-021", 503, "store_unavailable"), parsed.correlationId);
  }
  let res;
  try {
    res = await factory.receiptService.getReceipt(decoded, parsed.requestId);
  } catch {
    const response = jsonError(parsed.requestId, "ERR-021", 503, "store_unavailable");
    if (parsed.correlationId) response.headers.set("x-correlation-id", parsed.correlationId);
    return response;
  }
  if (!res.ok || !res.data) return toHttpResponse(res, parsed);

  // Receipt data is public operation metadata. Keep provider diagnostics and
  // proof-sized material out of errorDetail even when an adapter supplied it.
  const errorCode = typeof res.data.errorCode === "string" ? res.data.errorCode : undefined;
  const safeData = {
    ...res.data,
    errorDetail: sanitizeExternalDetail(errorCode, res.data.errorDetail) ?? null,
  };
  return toHttpResponse({ ...res, data: safeData } as never, parsed);
}

function withCorrelation(response: Response, correlationId: string | null): Response {
  if (correlationId) response.headers.set("x-correlation-id", correlationId);
  return response;
}
