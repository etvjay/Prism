import { getAppFactory } from "@/application/factory";
import { parseHeaders, toHttpResponse, jsonError, requireAuthenticatedSession } from "@/application/http-helpers";

// GET /v1/strk20/actions/:actionId — JSON-safe lifecycle view.
export async function GET(req: Request, ctx: { params: Promise<{ actionId: string }> }): Promise<Response> {
  const parsed = parseHeaders(req);
  // Action views can contain wallet capability, fee, transaction, and receipt
  // metadata. Never expose them as an unauthenticated identifier lookup.
  const sessionOrErr = requireAuthenticatedSession(req, null);
  if ("error" in sessionOrErr) return sessionOrErr.error;
  const { actionId } = await ctx.params;
  let decoded: string;
  try {
    decoded = decodeURIComponent(actionId);
  } catch {
    return jsonError(parsed.requestId, "STRK20-011", 400, "malformed_action_id");
  }
  let factory;
  try {
    factory = await getAppFactory();
  } catch {
    return jsonError(parsed.requestId, "ERR-021", 503, "store_unavailable");
  }
  const response = await factory.handlers.getStrk20Action({
    payload: { actionId: decoded },
    headers: { requestId: parsed.requestId },
    session: sessionOrErr,
  });
  return toHttpResponse(response, parsed);
}
