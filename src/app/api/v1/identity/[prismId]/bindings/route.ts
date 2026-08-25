import { getAppFactory } from "@/application/factory";
import {parseHeaders, toHttpResponse, readJson, requireSession, jsonError} from "@/application/http-helpers";

// GET /v1/identity/:prismId/bindings — public audience projection only
export async function GET(req: Request, ctx: { params: Promise<{ prismId: string }> }): Promise<Response> {
  const parsed = parseHeaders(req);
  const { prismId } = await ctx.params;
  const decodedPrismId = decodeURIComponent(prismId);
  const url = new URL(req.url);
  const audience = url.searchParams.get("audience");
  const visibility = url.searchParams.get("visibility");
  const lifecycle = url.searchParams.get("lifecycle");

  // The public route has one audience and one durable lifecycle. Explicitly
  // reject future domain selectors; never collapse them into PUBLIC.
  if (audience !== null && audience !== "public") return jsonError(parsed.requestId, "AUDIENCE_UNSUPPORTED", 501, "public_audience_only");
  if (visibility === "SELECTIVE") return jsonError(parsed.requestId, "SELECTIVE_UNSUPPORTED", 501, "selective_route_deferred");
  if (visibility !== null && visibility !== "PUBLIC") return jsonError(parsed.requestId, "PRIVATE_AUDIENCE_REQUIRED", 403, "private_audience_required");
  if (lifecycle === "SESSION" || lifecycle === "EPHEMERAL") return jsonError(parsed.requestId, "LIFECYCLE_UNSUPPORTED", 501, "non_persistent_route_deferred");
  if (lifecycle !== null && lifecycle !== "PERSISTENT") return jsonError(parsed.requestId, "LIFECYCLE_UNSUPPORTED", 501, "unsupported_lifecycle");

  let factory;
  try {
    factory = await getAppFactory();
  } catch (e) {
    const msg = (e as Error)?.message ?? "store_unavailable";
    const safe = msg.includes("postgres") ? "store_unavailable" : msg.slice(0, 80);
    return jsonError(parsed.requestId, "ERR-021", 503, safe);
  }
  const res = await factory.handlers.listPublicBindings({
    headers: { requestId: parsed.requestId },
    payload: { prismId: decodedPrismId },
  });
  return toHttpResponse(res, parsed);
}

// POST /v1/identity/:prismId/bindings — bind Base account (OP-8-01)
export async function POST(req: Request, ctx: { params: Promise<{ prismId: string }> }): Promise<Response> {
  const parsed = parseHeaders(req);
  const { prismId } = await ctx.params;
  const decodedPrismId = decodeURIComponent(prismId);
  const body = await readJson(req);
  if (body === null) return new Response(JSON.stringify({ ok: false, error: { code: "ERR-023", name: "stale_state_conflict", category: "stale_state", retryable: "re_read", userAction: "refresh", httpStatusHint: 400, detail: "malformed_json" }, requestId: parsed.requestId ?? null }), { status: 400, headers: { "content-type": "application/json" } });
  // The canonical chain bind route is PUBLIC-only. Do not silently discard a
  // higher-level disclosure/lifecycle selector supplied by a caller.
  const requestedVisibility = body.visibility as string | undefined;
  const requestedLifecycle = body.lifecycle as string | undefined;
  if (requestedVisibility === "SELECTIVE") return jsonError(parsed.requestId, "SELECTIVE_UNSUPPORTED", 501, "selective_route_deferred");
  if (requestedVisibility !== undefined && requestedVisibility !== "PUBLIC") return jsonError(parsed.requestId, "PRIVATE_AUDIENCE_REQUIRED", 403, "canonical_bind_is_public_only");
  if (requestedLifecycle === "SESSION" || requestedLifecycle === "EPHEMERAL") return jsonError(parsed.requestId, "LIFECYCLE_UNSUPPORTED", 501, "non_persistent_route_deferred");
  if (requestedLifecycle !== undefined && requestedLifecycle !== "PERSISTENT") return jsonError(parsed.requestId, "LIFECYCLE_UNSUPPORTED", 501, "unsupported_lifecycle");
  const sessionOrErr = requireSession(req, body);
  if ("error" in sessionOrErr) return sessionOrErr.error;
  const session = sessionOrErr;

  const venue = (body.venue as string | undefined) ?? "BASE";
  const executionAccount = body.executionAccount as string | undefined;
  const proofDigest = body.proofDigest as string | undefined;
  const challengeId = body.challengeId as string | undefined;
  const chainId = body.chainId as number | undefined;
  const expiresAt = body.expiresAt as number | undefined;
  const controllerAddress = (body.controllerAddress as string | undefined) ?? (body.controller as string | undefined) ?? "";

  if (!executionAccount || !proofDigest || !challengeId || chainId === undefined || expiresAt === undefined || !controllerAddress) {
    const { jsonError } = await import("@/application/http-helpers");
    return jsonError(parsed.requestId, "ERR-005", 422, "missing_binding_proof_reference");
  }

  const headers = {
    requestId: parsed.requestId ?? null,
    idempotencyKey: parsed.idempotencyKey ?? (body.idempotencyKey as string | null) ?? null,
    correlationId: parsed.correlationId ?? (body.correlationId as string | null) ?? null,
    expectedVersion: parsed.expectedVersion ?? (body.expectedVersion as number | null) ?? null,
  };
  let factory;
  try {
    factory = await getAppFactory();
  } catch (e) {
    const msg = (e as Error)?.message ?? "store_unavailable";
    // Never leak connection string; sanitize
    const safe = msg.includes("postgres") ? "store_unavailable" : msg.slice(0, 80);
    return jsonError(parsed.requestId, "ERR-021", 503, safe);
  }
  const res = await factory.handlers.bind({
    headers,
    session,
    payload: {
      prismId: decodedPrismId,
      venue,
      executionAccount,
      proofDigest: proofDigest as `0x${string}`,
      challengeId: challengeId as `0x${string}` | undefined,
      chainId,
      expiresAt,
      controllerAddress,
    },
  });
  return toHttpResponse(res, parsed);
}
