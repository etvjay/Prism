import { getAppFactory } from "@/application/factory";
import { parseHeaders, toHttpResponse, jsonError } from "@/application/http-helpers";
import { StaleCacheError } from "@/features/prism-operations/domain/resolve-service";

// GET /v1/resolve/:identifier?venue=BASE — watermarked resolve (QRY-8-01, K=5 stale refusal)
export async function GET(req: Request, ctx: { params: Promise<{ identifier: string }> }): Promise<Response> {
  const parsed = parseHeaders(req);
  const { identifier } = await ctx.params;
  let decoded: string;
  try {
    decoded = decodeURIComponent(identifier);
  } catch {
    return withCorrelation(jsonError(parsed.requestId, "ERR-023", 400, "malformed_identifier"), parsed.correlationId);
  }
  const url = new URL(req.url);
  const venue = url.searchParams.get("venue") ?? "BASE";
  if (!venue) return withCorrelation(jsonError(parsed.requestId, "ERR-001", 422, "missing_venue"), parsed.correlationId);

  let factory;
  try {
    factory = await getAppFactory();
  } catch {
    return withCorrelation(jsonError(parsed.requestId, "ERR-021", 503, "store_unavailable"), parsed.correlationId);
  }

  // Resolve must keep the QRY-8-01 unknown-identifier distinction. The
  // watermarked service owns freshness, while this canonical existence read
  // prevents a projection-only binding from masquerading as an identity.
  if (factory.resolveService && factory.registryReadPort && typeof factory.registryReadPort.getIdentity === "function") {
    try {
      const identity = await factory.registryReadPort.getIdentity(decoded);
      if (!identity) {
        return withCorrelation(jsonError(parsed.requestId, "ERR-010", 404, "identity_not_found"), parsed.correlationId);
      }
    } catch {
      // A canonical dependency failure is handled by the service's explicit
      // projection fallback; do not turn a transient read failure into 404.
    }
  }

  // Prefer the factory's watermarked service. It reads canonical registry state
  // first and only uses a scope-bound projection when the canonical read fails.
  const allowStale = url.searchParams.get("allowStale") === "true";
  try {
    if (factory.resolveService) {
      const result = await factory.resolveService.resolve(decoded, venue, { allowStale });
      const appRes = {
        ok: true as const,
        data: {
          prismId: decoded,
          venue,
          executionAccount: result.executionAccount,
          exists: result.executionAccount !== null,
          watermark: result.watermark,
          authoritativeSource: result.authoritativeSource,
          staleRefused: result.staleRefused,
        },
        watermark: result.watermark,
        requestId: parsed.requestId,
      };
      const httpRes = toHttpResponse(appRes as never, parsed);
      if (result.staleRefused) httpRes.headers.set("x-prism-stale-refused", "1");
      httpRes.headers.set("x-prism-watermark-k", "5");
      httpRes.headers.set("x-prism-authoritative-source", result.authoritativeSource);
      return httpRes;
    }
  } catch (cause) {
    if (cause instanceof StaleCacheError) {
      return withCorrelation(jsonError(parsed.requestId, cause.code, cause.httpStatusHint, "stale_cache_refused"), parsed.correlationId);
    }
    // Never pass provider/projection exception text to the client.
    return withCorrelation(jsonError(parsed.requestId, "ERR-021", 503, "resolve_failed"), parsed.correlationId);
  }

  // Legacy injected factories may not expose WatermarkedResolveService; keep
  // the application query as a compatibility fallback without adding a second
  // source of authority.
  const res = await factory.app.resolve({ payload: { prismId: decoded, venue }, headers: { requestId: parsed.requestId } });
  return toHttpResponse(res, parsed);
}

function withCorrelation(response: Response, correlationId: string | null): Response {
  if (correlationId) response.headers.set("x-correlation-id", correlationId);
  return response;
}
