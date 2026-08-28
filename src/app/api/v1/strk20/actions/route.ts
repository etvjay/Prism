import { getAppFactory } from "@/application/factory";
import { err } from "@/application/schemas";
import { parseHeaders, readJson, requireSession, toHttpResponse, jsonError } from "@/application/http-helpers";
import { Strk20Error } from "@/features/prism-strk20/domain/errors";
import { parseStrk20ActionPayload } from "@/application/strk20-transport";

// POST /v1/strk20/actions — wallet-mediated lifecycle step.
// The body is Prism vocabulary only; proof/call/calldata/keys/notes/provider
// responses are rejected before the application handler is reached.
export async function POST(req: Request): Promise<Response> {
  const parsed = parseHeaders(req);
  const body = await readJson(req);
  if (body === null) return jsonError(parsed.requestId, "STRK20-011", 400, "malformed_json");

  const sessionOrErr = requireSession(req, body);
  if ("error" in sessionOrErr) return sessionOrErr.error;

  let payload;
  try {
    payload = parseStrk20ActionPayload(body);
  } catch (cause) {
    if (cause instanceof Strk20Error) {
      return toHttpResponse(err(cause.toExternalShape(), parsed.requestId), parsed);
    }
    return jsonError(parsed.requestId, "STRK20-013", 503, "provider_failure");
  }

  let factory;
  try {
    factory = await getAppFactory();
  } catch {
    return jsonError(parsed.requestId, "ERR-021", 503, "store_unavailable");
  }

  const response = await factory.handlers.createStrk20Action({
    headers: {
      requestId: parsed.requestId,
      correlationId: parsed.correlationId ?? (body.correlationId as string | null) ?? null,
      idempotencyKey: parsed.idempotencyKey ?? (body.idempotencyKey as string | null) ?? null,
      expectedVersion: parsed.expectedVersion,
    },
    session: sessionOrErr,
    payload,
  });
  return toHttpResponse(response, parsed);
}
