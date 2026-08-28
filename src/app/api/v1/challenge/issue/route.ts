import { getAppFactory } from "@/application/factory";
import { parseHeaders, toHttpResponse, readJson, requireAuthenticatedSession, jsonError } from "@/application/http-helpers";

// POST /v1/challenge/issue — wrapper for issuing ownership proof challenge (used by SDK)
export async function POST(req: Request): Promise<Response> {
  const parsed = parseHeaders(req);
  const body = await readJson(req);
  if (body === null) return new Response(JSON.stringify({ ok: false, error: { code: "ERR-023", name: "stale_state_conflict", category: "stale_state", retryable: "re_read", userAction: "refresh", httpStatusHint: 400, detail: "malformed_json" }, requestId: parsed.requestId ?? null }), { status: 400, headers: { "content-type": "application/json" } });
  const sessionOrErr = requireAuthenticatedSession(req, body);
  if ("error" in sessionOrErr) return sessionOrErr.error;
  const session = sessionOrErr;
  const prismId = body.prismId as string | undefined;
  const venue = (body.venue as string | undefined) ?? "BASE";
  const executionAccount = body.executionAccount as string | undefined;
  const ttlSeconds = body.ttlSeconds as number | undefined;
  if (!prismId || !executionAccount) {
    const { jsonError } = await import("@/application/http-helpers");
    return jsonError(parsed.requestId, "ERR-005", 422, "missing_challenge_fields");
  }
  let factory;
  try {
    factory = await getAppFactory();
  } catch (e) {
    const msg = (e as Error)?.message ?? "store_unavailable";
    // Never leak connection string; sanitize
    const safe = msg.includes("postgres") ? "store_unavailable" : msg.slice(0, 80);
    return jsonError(parsed.requestId, "ERR-021", 503, safe);
  }
  const res = await factory.app.issueChallenge({ headers: { requestId: parsed.requestId }, session, payload: { prismId, venue, executionAccount, ttlSeconds } });
  return toHttpResponse(res, parsed);
}
