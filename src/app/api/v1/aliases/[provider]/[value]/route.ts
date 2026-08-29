import { getAppFactory } from "@/application/factory";
import { jsonError, parseHeaders, toHttpResponse } from "@/application/http-helpers";

// GET /api/v1/aliases/:provider/:value — provider-neutral alias evidence.
export async function GET(
  req: Request,
  ctx: { params: Promise<{ provider: string; value: string }> },
): Promise<Response> {
  const parsed = parseHeaders(req);
  let provider: string;
  let value: string;
  try {
    const params = await ctx.params;
    provider = decodeURIComponent(params.provider);
    value = decodeURIComponent(params.value);
  } catch {
    return jsonError(parsed.requestId, "ALIAS_INVALID_REQUEST", 422, "malformed_alias_path");
  }
  if (!provider.trim() || !value.trim()) {
    return jsonError(parsed.requestId, "ALIAS_INVALID_REQUEST", 422, "alias_provider_and_value_required");
  }

  let factory;
  try {
    factory = await getAppFactory();
  } catch {
    // Initialization details can contain credentials/connection strings.
    return jsonError(parsed.requestId, "ERR-021", 503, "store_unavailable");
  }

  try {
    const result = await factory.handlers.lookupAlias({
      headers: { requestId: parsed.requestId },
      payload: { provider: provider.trim(), value: value.trim() },
    });
    return toHttpResponse(result, parsed);
  } catch {
    return jsonError(parsed.requestId, "ERR-021", 503, "alias_lookup_unavailable");
  }
}
