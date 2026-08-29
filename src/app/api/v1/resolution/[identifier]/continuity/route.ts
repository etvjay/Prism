import { getAppFactory } from "@/application/factory";
import { jsonError, parseHeaders, toHttpResponse } from "@/application/http-helpers";

// GET /api/v1/resolution/:identifier/continuity?venue=BASE&purpose=SEND.
export async function GET(
  req: Request,
  ctx: { params: Promise<{ identifier: string }> },
): Promise<Response> {
  const parsed = parseHeaders(req);
  let identifier: string;
  try {
    const params = await ctx.params;
    identifier = decodeURIComponent(params.identifier);
  } catch {
    return jsonError(parsed.requestId, "RESOLUTION_INVALID_REQUEST", 422, "malformed_identifier");
  }

  const url = new URL(req.url);
  const venue = url.searchParams.get("venue") ?? "BASE";
  const purposeRaw = url.searchParams.get("purpose") ?? "default";
  const explicitProvider = url.searchParams.get("provider") ?? url.searchParams.get("aliasProvider");
  if (!venue.trim()) return jsonError(parsed.requestId, "ERR-001", 422, "missing_venue");
  if (!purposeRaw.trim()) return jsonError(parsed.requestId, "RESOLUTION_INVALID_REQUEST", 422, "purpose_required");
  if (!identifier.trim()) return jsonError(parsed.requestId, "RESOLUTION_INVALID_REQUEST", 422, "identifier_required");

  const normalizedIdentifier = identifier.trim();
  const provider = explicitProvider?.trim() || null;
  const isPrismId = provider === null && /^prism:/i.test(normalizedIdentifier);
  let resolutionIdentifier:
    | { readonly kind: "prism-id"; readonly prismId: string }
    | { readonly kind: "external-alias"; readonly alias: { readonly provider: string; readonly value: string } }
    | null;

  if (isPrismId) {
    if (!/^prism:[0-9A-Za-z]{1,64}$/.test(normalizedIdentifier)) {
      return jsonError(parsed.requestId, "RESOLUTION_INVALID_REQUEST", 422, "invalid_prism_id");
    }
    resolutionIdentifier = { kind: "prism-id", prismId: normalizedIdentifier };
  } else {
    const separator = normalizedIdentifier.indexOf(":");
    const inferredProvider = provider ?? (separator > 0 ? normalizedIdentifier.slice(0, separator) : null);
    const aliasValue = provider
      ? normalizedIdentifier
      : separator > 0
        ? normalizedIdentifier.slice(separator + 1)
        : normalizedIdentifier;
    resolutionIdentifier = inferredProvider && aliasValue.trim()
      ? { kind: "external-alias", alias: { provider: inferredProvider, value: aliasValue } }
      : null;
  }

  if (!resolutionIdentifier) {
    return jsonError(parsed.requestId, "ALIAS_INVALID_REQUEST", 422, "alias_provider_required_for_non_prism_identifier");
  }

  let factory;
  try {
    factory = await getAppFactory();
  } catch {
    return jsonError(parsed.requestId, "ERR-021", 503, "store_unavailable");
  }

  try {
    const result = await factory.handlers.assessContinuity({
      headers: { requestId: parsed.requestId },
      payload: {
        identifier: resolutionIdentifier,
        venue: venue.trim(),
        purpose: purposeRaw.trim().toLowerCase(),
      },
    });
    return toHttpResponse(result, parsed);
  } catch {
    return jsonError(parsed.requestId, "ERR-021", 503, "resolution_continuity_unavailable");
  }
}
