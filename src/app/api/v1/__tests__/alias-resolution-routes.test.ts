import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAppFactory } from "@/application/factory";
import { GET as aliasGet } from "../aliases/[provider]/[value]/route";
import { GET as continuityGet } from "../resolution/[identifier]/continuity/route";

vi.mock("@/application/factory", () => ({
  getAppFactory: vi.fn(),
}));

const lookupAlias = vi.fn();
const assessContinuity = vi.fn();

function request(url: string, requestId = "req-resolution-api"): Request {
  return new Request(`http://localhost${url}`, {
    method: "GET",
    headers: {
      "x-request-id": requestId,
      "x-correlation-id": "corr-resolution-api",
    },
  });
}

function success(data: unknown, watermark?: number | null) {
  return {
    ok: true,
    data,
    requestId: "req-resolution-api",
    ...(watermark !== undefined ? { watermark } : {}),
  };
}

describe("alias and resolution continuity REST routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAppFactory).mockResolvedValue({
      handlers: { lookupAlias, assessContinuity },
    } as never);
  });

  it("rejects malformed alias path input with the existing error envelope and request id", async () => {
    const response = await aliasGet(
      request("/api/v1/aliases/%E0%A4%A/alice"),
      { params: Promise.resolve({ provider: "%E0%A4%A", value: "alice" }) },
    );
    const body = (await response.json()) as { ok: boolean; error: { code: string; detail?: string }; requestId: string | null };

    expect(response.status).toBe(422);
    expect(body).toMatchObject({
      ok: false,
      error: { code: "ALIAS_INVALID_REQUEST", detail: "malformed_alias_path" },
      requestId: "req-resolution-api",
    });
    expect(response.headers.get("x-request-id")).toBe("req-resolution-api");
    expect(lookupAlias).not.toHaveBeenCalled();
  });

  it("forwards decoded provider/value through the application envelope and returns provider state without raw material", async () => {
    lookupAlias.mockResolvedValue(success({
      status: "RESOLVED",
      state: "FOUND",
      alias: { provider: "starknet-id", value: "alice.stark" },
      subject: "starknet-subject:alice",
      externalAddress: "0x123",
      canonicalValue: "alice.stark",
      association: {
        status: "ASSOCIATED",
        prismId: "prism:P7F21",
        evidence: "explicit_prism_association",
        detail: null,
      },
      prismId: "prism:P7F21",
      associationEvidence: "explicit_prism_association",
      detail: null,
    }));

    const response = await aliasGet(
      request("/api/v1/aliases/starknet-id/alice.stark"),
      { params: Promise.resolve({ provider: "starknet-id", value: "alice.stark" }) },
    );
    const body = (await response.json()) as { ok: boolean; data: Record<string, unknown>; requestId: string | null };

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      requestId: "req-resolution-api",
      data: {
        status: "RESOLVED",
        state: "FOUND",
        subject: "starknet-subject:alice",
        prismId: "prism:P7F21",
        associationEvidence: "explicit_prism_association",
      },
    });
    expect(JSON.stringify(body)).not.toMatch(/ciphertext|viewingKey|privateNote|rawProviderResponse/i);
    expect(lookupAlias).toHaveBeenCalledWith({
      headers: { requestId: "req-resolution-api" },
      payload: { provider: "starknet-id", value: "alice.stark" },
    });
  });

  it("maps factory initialization failures to a sanitized dependency envelope", async () => {
    vi.mocked(getAppFactory).mockRejectedValueOnce(new Error("postgres://user:password@host/private"));

    const response = await aliasGet(
      request("/api/v1/aliases/starknet-id/alice.stark", "req-factory-failure"),
      { params: Promise.resolve({ provider: "starknet-id", value: "alice.stark" }) },
    );
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(body).toContain('"code":"ERR-021"');
    expect(body).toContain("store_unavailable");
    expect(body).not.toContain("password");
    expect(body).not.toContain("postgres://");
    expect(response.headers.get("x-request-id")).toBe("req-factory-failure");
  });

  it("requires an explicit provider for a non-Prism continuity identifier", async () => {
    const response = await continuityGet(
      request("/api/v1/resolution/alice.stark/continuity?venue=BASE"),
      { params: Promise.resolve({ identifier: "alice.stark" }) },
    );
    const body = (await response.json()) as { ok: boolean; error: { code: string; detail?: string } };

    expect(response.status).toBe(422);
    expect(body).toMatchObject({
      ok: false,
      error: {
        code: "ALIAS_INVALID_REQUEST",
        detail: "alias_provider_required_for_non_prism_identifier",
      },
    });
    expect(assessContinuity).not.toHaveBeenCalled();
  });

  it("accepts a canonical Prism identifier, normalizes the purpose, and propagates watermark/freshness envelope fields", async () => {
    assessContinuity.mockResolvedValue(success({
      state: "ACTIVE",
      status: "RESOLVED",
      continuityStatus: "RESOLVED",
      evidenceStatus: "KNOWN",
      blocked: false,
      prismId: "prism:P7F21",
      associationEvidence: null,
      alias: null,
      externalSubject: null,
      executionAccount: "0xabc",
      destination: { chain: "BASE", address: "0xabc" },
      providerStatus: null,
      previous: null,
      current: {
        key: JSON.stringify(["prism:P7F21", "BASE", "send"]),
        prismId: "prism:P7F21",
        venue: "BASE",
        purpose: "send",
        alias: null,
        externalSubject: null,
        destination: { chain: "BASE", address: "0xabc" },
        bindingStatus: "ACTIVE",
        visibility: "UNKNOWN",
        watermark: 101,
        observedAt: 1_789_000_000,
        version: 1,
      },
      diff: { firstTime: true },
      risks: [{ code: "FIRST_TIME_RECIPIENT", level: "MEDIUM", blocking: false, detail: "no_prior_resolution_snapshot" }],
      watermark: 101,
      source: "registry_canonical",
      detail: null,
    }, 101));

    const response = await continuityGet(
      request("/api/v1/resolution/prism%3AP7F21/continuity?venue=BASE&purpose=SEND"),
      { params: Promise.resolve({ identifier: "prism:P7F21" }) },
    );
    const body = (await response.json()) as {
      ok: boolean;
      data: { state: string; current: { prismId: string; purpose: string }; risks: Array<{ code: string }>; watermark: number; source: string };
      requestId: string | null;
    };

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      requestId: "req-resolution-api",
      data: {
        state: "ACTIVE",
        current: { prismId: "prism:P7F21", purpose: "send" },
        risks: [{ code: "FIRST_TIME_RECIPIENT" }],
        watermark: 101,
        source: "registry_canonical",
      },
    });
    expect(response.headers.get("x-prism-watermark")).toBe("101");
    expect(response.headers.get("etag")).toBe('"101"');
    expect(response.headers.get("x-correlation-id")).toBe("corr-resolution-api");
    expect(assessContinuity).toHaveBeenCalledWith({
      headers: { requestId: "req-resolution-api" },
      payload: {
        identifier: { kind: "prism-id", prismId: "prism:P7F21" },
        venue: "BASE",
        purpose: "send",
      },
    });
  });

  it("supports provider:value aliases and preserves a stale refusal as a typed blocked response", async () => {
    assessContinuity.mockResolvedValue(success({
      state: "STALE",
      status: "NO_ACTIVE_DESTINATION",
      continuityStatus: "NO_ACTIVE_DESTINATION",
      evidenceStatus: "UNKNOWN",
      blocked: true,
      prismId: "prism:P7F21",
      associationEvidence: "explicit_prism_association",
      alias: { provider: "starknet-id", value: "alice.stark" },
      externalSubject: "starknet-subject:alice",
      executionAccount: null,
      destination: null,
      providerStatus: "RESOLVED",
      previous: null,
      current: null,
      diff: null,
      risks: [{ code: "SNAPSHOT_UNAVAILABLE", level: "UNKNOWN", blocking: true, detail: "stale_resolution" }],
      watermark: 90,
      source: "stale_refused",
      detail: "stale_resolution",
    }, 90));

    const response = await continuityGet(
      request("/api/v1/resolution/starknet-id%3Aalice.stark/continuity?venue=BASE"),
      { params: Promise.resolve({ identifier: "starknet-id:alice.stark" }) },
    );
    const body = (await response.json()) as { ok: boolean; data: Record<string, unknown> };

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, data: { state: "STALE", source: "stale_refused", blocked: true, executionAccount: null } });
    expect(response.headers.get("x-prism-watermark")).toBe("90");
    expect(assessContinuity).toHaveBeenCalledWith({
      headers: { requestId: "req-resolution-api" },
      payload: {
        identifier: { kind: "external-alias", alias: { provider: "starknet-id", value: "alice.stark" } },
        venue: "BASE",
        purpose: "default",
      },
    });
  });
});
