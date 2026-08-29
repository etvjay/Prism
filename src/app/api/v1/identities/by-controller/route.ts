import { getAppFactory } from "@/application/factory";
import { parseHeaders } from "@/application/http-helpers";
import { normalizeRegistryEventScope } from "@/features/prism-operations/domain/event-indexer";
import { discoverControllerIdentities, normalizeControllerAddress, type DiscoveryResult } from "@/application/controller-discovery";

const PROJECTION_SOURCE = "scoped_public_event_projection+canonical_starknet_read";
const CANONICAL_SOURCE = "canonical_by_controller+canonical_starknet_read";

/**
 * GET /v1/identities/by-controller?controller=0x…
 *
 * Discovery is deliberately a read-only aggregate. A candidate is returned
 * only after its controller has been read back from the canonical identity
 * source. When the canonical ABI has no by-controller view, the configured
 * event projection is the explicit, scope-bound candidate source. Candidate
 * status remains UNKNOWN because get_identity does not expose a lifecycle
 * status; this endpoint must not manufacture ACTIVE/SUSPENDED.
 */
export async function GET(req: Request): Promise<Response> {
  const parsed = parseHeaders(req);
  const controllerRaw = new URL(req.url).searchParams.get("controller") ?? "";

  let controller: string;
  try {
    controller = normalizeControllerAddress(controllerRaw);
  } catch {
    return discoveryFailure(parsed, "UNKNOWN", 422, "CONTROLLER_INVALID", "none", "controller_address_invalid");
  }

  let factory;
  try {
    factory = await getAppFactory();
  } catch {
    return discoveryFailure(parsed, "UNAVAILABLE", 503, "STORE_UNAVAILABLE", "none");
  }

  // A configured coordinator is the only production fallback because it is
  // constructed with one registry address/network/ABI scope by the factory.
  // Prefer it over listByController: the deployed V1/V2 ABI has no such view.
  if (factory.eventProjectionCoordinator) {
    try {
      const projection = await factory.eventProjectionCoordinator.getProjection();
      if (!projection) {
        return discoveryFailure(parsed, "UNAVAILABLE", 503, "CONTROLLER_LOOKUP_UNAVAILABLE", PROJECTION_SOURCE);
      }
      validateProjectionEvidence(projection);
      const rows = Array.from(projection.identities.values()).map((row) => {
        if (!row || typeof row.prismId !== "string" || typeof row.controller !== "string") {
          throw new Error("projection_identity_malformed");
        }
        // Only these two public identity fields cross into discovery. Binding
        // rows, proof material, and protected/private fields are not read.
        return { prismId: row.prismId, controller: row.controller };
      });
      const result = await discoverControllerIdentities(
        rows,
        controller,
        (prismId) => factory.registryReadPort.getIdentity(prismId),
        projection.watermark,
      );
      return discoverySuccess(parsed, { ...result, source: PROJECTION_SOURCE });
    } catch {
      return discoveryFailure(parsed, "UNKNOWN", 502, "CONTROLLER_LOOKUP_UNKNOWN", PROJECTION_SOURCE);
    }
  }

  // Development/test factories use the in-memory registry as their explicit
  // canonical double. Empty results are a normal 200 NONE. A live reader that
  // cannot enumerate by controller is not equivalent to an empty result.
  let listed: readonly { prismId: string; createdAtBlock: number; version: number }[];
  try {
    if (!factory.registryReadPort || typeof factory.registryReadPort.listByController !== "function") {
      return discoveryFailure(parsed, "UNAVAILABLE", 503, "CONTROLLER_LOOKUP_UNAVAILABLE", CANONICAL_SOURCE);
    }
    listed = await factory.registryReadPort.listByController(controller);
    if (!Array.isArray(listed)) throw new Error("canonical_by_controller_malformed");
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "";
    if (message.includes("by_controller_unavailable")) {
      return discoveryFailure(parsed, "UNAVAILABLE", 503, "CONTROLLER_LOOKUP_UNAVAILABLE", CANONICAL_SOURCE);
    }
    return discoveryFailure(parsed, "UNKNOWN", 502, "CONTROLLER_LOOKUP_UNKNOWN", CANONICAL_SOURCE);
  }

  try {
    const candidates: Array<{ prismId: string; status: "UNKNOWN"; watermark: number | null }> = [];
    const seen = new Set<string>();
    let watermark: number | null = null;

    for (const listedIdentity of listed) {
      if (!listedIdentity || typeof listedIdentity.prismId !== "string") throw new Error("canonical_candidate_malformed");
      if (seen.has(listedIdentity.prismId)) continue;
      seen.add(listedIdentity.prismId);

      // listByController is only an enumeration hint. Canonical getIdentity is
      // required before a result can become FOUND or MULTIPLE.
      const canonical = await factory.registryReadPort.getIdentity(listedIdentity.prismId);
      if (!canonical) continue;
      if (typeof canonical.controller !== "string") throw new Error("canonical_identity_malformed");
      if (normalizeControllerAddress(canonical.controller) !== controller) continue;

      const candidateWatermark = maxWatermark(listedIdentity.createdAtBlock, canonical.createdAtBlock);
      watermark = maxNullable(watermark, candidateWatermark);
      candidates.push({ prismId: listedIdentity.prismId, status: "UNKNOWN", watermark: candidateWatermark });
    }

    const state = candidates.length === 0 ? "NONE" : candidates.length === 1 ? "FOUND" : "MULTIPLE";
    return discoverySuccess(parsed, { state, candidates, watermark, source: CANONICAL_SOURCE });
  } catch {
    return discoveryFailure(parsed, "UNKNOWN", 502, "CONTROLLER_LOOKUP_UNKNOWN", CANONICAL_SOURCE);
  }
}

function validateProjectionEvidence(projection: {
  identities: ReadonlyMap<string, unknown>;
  watermark: number | null;
  scope: unknown;
}): void {
  if (!(projection.identities instanceof Map)) throw new Error("projection_identities_unavailable");
  if (projection.watermark !== null && (!Number.isSafeInteger(projection.watermark) || projection.watermark < 0)) {
    throw new Error("projection_watermark_invalid");
  }
  // EventProjectionCoordinator is scope-bound by construction. If a runtime
  // projection includes scope metadata, validate it rather than accepting a
  // cross-network/address/version row. Empty projections may legitimately have
  // null scope because no event has been reconstructed yet.
  if (projection.scope !== null && projection.scope !== undefined) {
    normalizeRegistryEventScope(projection.scope as Parameters<typeof normalizeRegistryEventScope>[0]);
  }
}

function maxWatermark(...values: unknown[]): number | null {
  const valid = values.filter((value): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0);
  return valid.length ? Math.max(...valid) : null;
}

function maxNullable(left: number | null, right: number | null): number | null {
  if (left === null) return right;
  if (right === null) return left;
  return Math.max(left, right);
}

function discoverySuccess(parsed: ReturnType<typeof parseHeaders>, result: DiscoveryResult): Response {
  const headers = discoveryHeaders(parsed, result.watermark);
  return new Response(JSON.stringify({ ok: true, ...result, requestId: parsed.requestId ?? null }), { status: 200, headers });
}

function discoveryFailure(
  parsed: ReturnType<typeof parseHeaders>,
  state: "UNKNOWN" | "UNAVAILABLE",
  status: number,
  code: string,
  source: string,
  detail?: string,
): Response {
  const headers = discoveryHeaders(parsed, null);
  const body = {
    ok: false,
    state,
    candidates: [],
    watermark: null,
    source,
    error: { code, ...(detail ? { detail } : {}) },
    requestId: parsed.requestId ?? null,
  };
  return new Response(JSON.stringify(body), { status, headers });
}

function discoveryHeaders(parsed: ReturnType<typeof parseHeaders>, watermark: number | null): Headers {
  const headers = new Headers({ "content-type": "application/json" });
  if (parsed.requestId) headers.set("x-request-id", parsed.requestId);
  if (parsed.correlationId) headers.set("x-correlation-id", parsed.correlationId);
  if (watermark !== null) {
    headers.set("x-prism-watermark", String(watermark));
    headers.set("etag", `"${watermark}"`);
  }
  return headers;
}
