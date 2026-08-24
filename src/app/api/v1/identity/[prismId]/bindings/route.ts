import { getAppFactory } from "@/application/factory";
import { parseHeaders, toHttpResponse, readJson, requireSession } from "@/application/http-helpers";

// POST /v1/identity/:prismId/bindings — bind Base account (OP-8-01)
export async function POST(req: Request, ctx: { params: Promise<{ prismId: string }> }): Promise<Response> {
  const parsed = parseHeaders(req);
  const { prismId } = await ctx.params;
  const decodedPrismId = decodeURIComponent(prismId);
  const body = await readJson(req);
  if (body === null) return new Response(JSON.stringify({ ok: false, error: { code: "ERR-023", name: "stale_state_conflict", category: "stale_state", retryable: "re_read", userAction: "refresh", httpStatusHint: 400, detail: "malformed_json" }, requestId: parsed.requestId ?? null }), { status: 400, headers: { "content-type": "application/json" } });
  const sessionOrErr = requireSession(req, body);
  if ("error" in sessionOrErr) return sessionOrErr.error;
  const session = sessionOrErr;

  const venue = (body.venue as string | undefined) ?? "BASE";
  const executionAccount = body.executionAccount as string | undefined;
  const proofDigest = body.proofDigest as string | undefined;
  const controllerAddress = (body.controllerAddress as string | undefined) ?? (body.controller as string | undefined) ?? "";

  if (!executionAccount || !proofDigest || !controllerAddress) {
    const { jsonError } = await import("@/application/http-helpers");
    return jsonError(parsed.requestId, "ERR-005", 422, "missing_binding_fields");
  }

  const headers = {
    requestId: parsed.requestId ?? null,
    idempotencyKey: parsed.idempotencyKey ?? (body.idempotencyKey as string | null) ?? null,
    correlationId: parsed.correlationId ?? (body.correlationId as string | null) ?? null,
    expectedVersion: parsed.expectedVersion ?? (body.expectedVersion as number | null) ?? null,
  };
  const factory = getAppFactory();
  const res = await factory.app.bind({
    headers,
    session,
    payload: { prismId: decodedPrismId, venue, executionAccount, proofDigest: proofDigest as `0x${string}`, controllerAddress },
  });
  return toHttpResponse(res, parsed);
}
