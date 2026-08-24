import { getAppFactory } from "@/application/factory";
import { parseHeaders, toHttpResponse, jsonError } from "@/application/http-helpers";
import { StaleCacheError } from "@/features/prism-operations/domain/resolve-service";

// GET /v1/resolve/:identifier?venue=BASE — watermarked resolve (QRY-8-01, K=5 stale refusal)
export async function GET(req: Request, ctx: { params: Promise<{ identifier: string }> }): Promise<Response> {
  const parsed = parseHeaders(req);
  const { identifier } = await ctx.params;
  const decoded = decodeURIComponent(identifier);
  const url = new URL(req.url);
  const venue = url.searchParams.get("venue") ?? "BASE";
  if (!venue) return jsonError(parsed.requestId, "ERR-001", 422, "missing_venue");
  let factory;
  try {
    factory = await getAppFactory();
  } catch (e) {
    const msg = (e as Error)?.message ?? "store_unavailable";
    // Never leak connection string; sanitize
    const safe = msg.includes("postgres") ? "store_unavailable" : msg.slice(0, 80);
    return jsonError(parsed.requestId, "ERR-021", 503, safe);
  }
  // Prefer WatermarkedResolveService K=5 path when available; falls back to app.resolve for legacy in-memory path.
  // This closes the gap between durable store + real ledger confirmed block and HTTP serving layer.
  const allowStale = url.searchParams.get("allowStale") === "true";
  try {
    if (factory.resolveService) {
      const r = await factory.resolveService.resolve(decoded, venue, { allowStale });
      // Map WatermarkedResolveService result to AppResponse shape for toHttpResponse
      const appRes = {
        ok: true as const,
        data: { prismId: decoded, venue, executionAccount: r.executionAccount, exists: r.executionAccount !== null, watermark: r.watermark },
        watermark: r.watermark,
        requestId: parsed.requestId,
      };
      // When stale ACTIVE was refused, we serve NO_ACTIVE_DESTINATION (null) with same watermark — fail-closed, not 500.
      // For thrown StaleCacheError (projection stale), we map to 409 below.
      const headers = { ...parsed };
      // Preserve staleRefused observation via header for observability (not in body)
      const httpRes = toHttpResponse(appRes as never, headers);
      if (r.staleRefused) httpRes.headers.set("x-prism-stale-refused", "1");
      httpRes.headers.set("x-prism-watermark-k", "5");
      return httpRes;
    }
  } catch (e) {
    if (e instanceof StaleCacheError) {
      return jsonError(parsed.requestId, e.code, e.httpStatusHint, `stale_cache_refused:${String(e.message).slice(0, 60)}`);
    }
    return jsonError(parsed.requestId, "ERR-021", 503, "resolve_failed");
  }
  const res = await factory.app.resolve({ payload: { prismId: decoded, venue }, headers: { requestId: parsed.requestId } });
  return toHttpResponse(res, parsed);
}
