import { getAppFactory } from "@/application/factory";
import {parseHeaders, toHttpResponse, readJson, requireAuthenticatedSession, jsonError} from "@/application/http-helpers";

// POST /v1/identity — create Prism ID on Starknet (OP-7-01)
// Semantics: idempotency required, correlation propagated, submitted != completed.
export async function POST(req: Request): Promise<Response> {
  const parsed = parseHeaders(req);
  const body = await readJson(req);
  if (body === null) return new Response(JSON.stringify({ ok: false, error: { code: "ERR-023", name: "stale_state_conflict", category: "stale_state", retryable: "re_read", userAction: "refresh", httpStatusHint: 400, detail: "malformed_json" }, requestId: parsed.requestId ?? null }), { status: 400, headers: { "content-type": "application/json" } });
  const sessionOrErr = requireAuthenticatedSession(req, body);
  if ("error" in sessionOrErr) return sessionOrErr.error;
  const session = sessionOrErr;
  const controllerAddress = (body.controllerAddress as string | undefined) ?? (body.controller as string | undefined) ?? null;
  const kind = (body.kind as string | undefined) ?? "create_identity";
  const headers = { requestId: parsed.requestId ?? null, idempotencyKey: parsed.idempotencyKey ?? (body.idempotencyKey as string | null) ?? null, correlationId: parsed.correlationId ?? (body.correlationId as string | null) ?? null, expectedVersion: parsed.expectedVersion };

  let factory;
  try {
    factory = await getAppFactory();
  } catch (e) {
    const msg = (e as Error)?.message ?? "store_unavailable";
    // Never leak connection string; sanitize
    const safe = msg.includes("postgres") ? "store_unavailable" : msg.slice(0, 80);
    return jsonError(parsed.requestId, "ERR-021", 503, safe);
  }
  const res = await factory.handlers.createIdentity({ headers, session, payload: { controllerAddress, kind } });
  return toHttpResponse(res, parsed);
}
