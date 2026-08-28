import { getAppFactory } from "@/application/factory";
import { parseHeaders, readJson, requireSession, jsonError, toHttpResponse, toHttpErrorResponse } from "@/application/http-helpers";
import { APP_ERROR_CODE } from "@/application/errors";
import { PauseError } from "@/features/prism-pause/domain/errors";

// POST /v1/intents — create ExecutionIntent (injectable Pause service)
export async function POST(req: Request): Promise<Response> {
  const parsed = parseHeaders(req);
  const body = await readJson(req);
  if (body === null) return jsonError(parsed.requestId, "ERR-023", 400, "malformed_json");
  const sessionOrErr = requireSession(req, body);
  if ("error" in sessionOrErr) return sessionOrErr.error;
  // Intent creation requires prismId/purpose; venue/account optional.
  const prismId = body.prismId as string | undefined;
  const purpose = (body.purpose as string | undefined) ?? "payment";
  if (!prismId) return jsonError(parsed.requestId, APP_ERROR_CODE.IDENTITY_NOT_FOUND, 404, "missing_prismId");
  const allowed: readonly string[] = ["payment", "transfer", "contract_call", "private_action", "other"];
  if (!allowed.includes(purpose)) return jsonError(parsed.requestId, "ERR-023", 422, "invalid_purpose");

  const idempotencyKey = parsed.idempotencyKey ?? (body.idempotencyKey as string | undefined) ?? null;
  if (!idempotencyKey) return jsonError(parsed.requestId, APP_ERROR_CODE.STALE_STATE_CONFLICT, 409, "missing_idempotency_key");

  let factory;
  try {
    factory = await getAppFactory();
  } catch (e) {
    const msg = (e as Error)?.message ?? "store_unavailable";
    // Never leak connection string; sanitize
    const safe = msg.includes("postgres") ? "store_unavailable" : msg.slice(0, 80);
    return jsonError(parsed.requestId, "ERR-021", 503, safe);
  }
  try {
    const intent = await factory.pauseService.createIntent({
      prismId,
      venue: (body.venue as string | undefined) ?? undefined,
      executionAccount: (body.executionAccount as string | undefined) ?? undefined,
      purpose: purpose as never,
      amount: (body.amount as string | undefined) ?? undefined,
      asset: (body.asset as string | undefined) ?? undefined,
      recipientPrismId: (body.recipientPrismId as string | undefined) ?? undefined,
      recipientAddress: (body.recipientAddress as string | undefined) ?? undefined,
      idempotencyKey,
      correlationId: parsed.correlationId ?? (body.correlationId as string | null) ?? null,
      requestId: parsed.requestId ?? undefined,
    } as never);
    const headers = new Headers({ "content-type": "application/json" });
    if (parsed.requestId) headers.set("x-request-id", parsed.requestId);
    if (parsed.correlationId) headers.set("x-correlation-id", parsed.correlationId);
    return new Response(JSON.stringify({ ok: true, data: intent, requestId: parsed.requestId ?? null }), { status: 200, headers });
  } catch (e) {
    if (e instanceof PauseError) {
      return toHttpErrorResponse(e.toExternalShape(), parsed);
    }
    const code = (e as { code?: string })?.code ?? APP_ERROR_CODE.STALE_STATE_CONFLICT;
    const detail = (e as { detail?: string })?.detail ?? (e as Error).message;
    // Map via http-helpers stable shape
    const { AppError } = await import("@/application/errors");
    const appErr = new AppError(code as never, detail);
    return toHttpErrorResponse(appErr.toExternalShape(), parsed);
  }
}

// GET /v1/intents/:id not yet routed here; handled via intents/[intentId]/route if needed (not required for M2)
