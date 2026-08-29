import { getAppFactory } from "@/application/factory";
import { parseHeaders, toHttpResponse, jsonError, sanitizeExternalDetail } from "@/application/http-helpers";

// GET /v1/operations/:operationId — durable operation read (SM-PRISM-003)
export async function GET(req: Request, ctx: { params: Promise<{ operationId: string }> }): Promise<Response> {
  const parsed = parseHeaders(req);
  const { operationId } = await ctx.params;
  let decoded: string;
  try {
    decoded = decodeURIComponent(operationId);
  } catch {
    return withCorrelation(jsonError(parsed.requestId, "ERR-023", 400, "malformed_operation_id"), parsed.correlationId);
  }
  let factory;
  try {
    factory = await getAppFactory();
  } catch {
    return withCorrelation(jsonError(parsed.requestId, "ERR-021", 503, "store_unavailable"), parsed.correlationId);
  }
  const res = await factory.handlers.getOperation({ payload: { operationId: decoded }, headers: { requestId: parsed.requestId } });
  if (!res.ok || !res.data) return toHttpResponse(res, parsed);

  // The durable row contains idempotency keys, request fingerprints, and
  // reconciliation provider metadata needed only by the backend worker. They
  // are not part of the public operation resource (requestFingerprint may
  // contain a proof digest).
  const publicData = publicOperation(res.data as unknown as Record<string, unknown>);
  return toHttpResponse({ ...res, data: publicData } as never, parsed);
}

function publicOperation(operation: Record<string, unknown>): Record<string, unknown> {
  const errorCode = typeof operation.errorCode === "string" ? operation.errorCode : undefined;
  return {
    id: operation.id,
    kind: operation.kind,
    state: operation.state,
    version: operation.version,
    createdAt: operation.createdAt,
    updatedAt: operation.updatedAt,
    authoritativeSource: operation.authoritativeSource,
    txHash: operation.txHash ?? null,
    errorCode: operation.errorCode ?? null,
    errorDetail: sanitizeExternalDetail(errorCode, operation.errorDetail) ?? null,
    attempts: operation.attempts,
    submissionAttempted: operation.submissionAttempted,
    correlationId: operation.correlationId ?? null,
    reconciliationWatermark: operation.reconciliationWatermark ?? null,
  };
}

function withCorrelation(response: Response, correlationId: string | null): Response {
  if (correlationId) response.headers.set("x-correlation-id", correlationId);
  return response;
}
