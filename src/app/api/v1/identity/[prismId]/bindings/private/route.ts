import { getAppFactory } from "@/application/factory";
import { jsonError, parseHeaders, requireSession, toHttpResponse } from "@/application/http-helpers";

// GET /v1/identity/:prismId/bindings/private — owner-authorized private audience
// This route has no public fallback. Private endpoint data can only be returned
// by the injected owner-authorization and protection ports through the handler.
export async function GET(req: Request, ctx: { params: Promise<{ prismId: string }> }): Promise<Response> {
  const parsed = parseHeaders(req);
  const { prismId } = await ctx.params;
  const decodedPrismId = decodeURIComponent(prismId);
  const sessionOrErr = requireSession(req, null);
  if ("error" in sessionOrErr) return sessionOrErr.error;

  let factory;
  try {
    factory = await getAppFactory();
  } catch (e) {
    const msg = (e as Error)?.message ?? "store_unavailable";
    const safe = msg.includes("postgres") ? "store_unavailable" : msg.slice(0, 80);
    return jsonError(parsed.requestId, "ERR-021", 503, safe);
  }
  const res = await factory.handlers.listOwnerPrivateBindings({
    headers: {
      requestId: parsed.requestId,
      correlationId: parsed.correlationId,
    },
    session: sessionOrErr,
    payload: { prismId: decodedPrismId },
  });
  return toHttpResponse(res, parsed);
}
