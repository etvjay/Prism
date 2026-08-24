import { getAppFactory } from "@/application/factory";
import { parseHeaders, toHttpResponse, readJson, requireSession, jsonError } from "@/application/http-helpers";

// POST /v1/challenge/verify
export async function POST(req: Request): Promise<Response> {
  const parsed = parseHeaders(req);
  const body = await readJson(req);
  if (body === null) return new Response(JSON.stringify({ ok: false, error: { code: "ERR-023", name: "stale_state_conflict", category: "stale_state", retryable: "re_read", userAction: "refresh", httpStatusHint: 400, detail: "malformed_json" }, requestId: parsed.requestId ?? null }), { status: 400, headers: { "content-type": "application/json" } });
  const sessionOrErr = requireSession(req, body);
  if ("error" in sessionOrErr) return sessionOrErr.error;
  const session = sessionOrErr;
  const challengeId = body.challengeId as string | undefined;
  const presented = body.presented as Record<string, unknown> | undefined;
  const signature = body.signature as string | undefined;
  if (!challengeId || !presented || !signature) {
    const { jsonError } = await import("@/application/http-helpers");
    return jsonError(parsed.requestId, "ERR-012", 400, "missing_proof_fields");
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
  const res = await factory.app.submitProof({ headers: { requestId: parsed.requestId }, session, payload: { challengeId: challengeId as `0x${string}`, presented: presented as never, signature: signature as `0x${string}` } });
  return toHttpResponse(res, parsed);
}
