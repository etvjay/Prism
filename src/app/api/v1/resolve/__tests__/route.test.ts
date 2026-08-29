import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAppFactory } from "@/application/factory";
import { GET } from "../[identifier]/route";

vi.mock("@/application/factory", () => ({
  getAppFactory: vi.fn(),
}));

const resolve = vi.fn();

describe("GET /api/v1/resolve/:identifier", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAppFactory).mockResolvedValue({
      resolveService: { resolve },
      app: { resolve: vi.fn() },
    } as never);
  });

  it("exposes the serving source and freshness decision for projection fallback", async () => {
    resolve.mockResolvedValue({
      executionAccount: "0xabc",
      watermark: 120,
      authoritativeSource: "indexer_projection",
      staleRefused: false,
    });

    const response = await GET(
      new Request("http://localhost/v1/resolve/prism%3Aone?venue=BASE", {
        headers: { "x-request-id": "req-resolve", "x-correlation-id": "corr-resolve" },
      }),
      { params: Promise.resolve({ identifier: "prism:one" }) },
    );
    const body: any = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      executionAccount: "0xabc",
      watermark: 120,
      authoritativeSource: "indexer_projection",
      staleRefused: false,
    });
    expect(body.data).not.toHaveProperty("providerOutput");
    expect(response.headers.get("x-prism-watermark")).toBe("120");
    expect(response.headers.get("x-prism-watermark-k")).toBe("5");
    expect(response.headers.get("x-prism-authoritative-source")).toBe("indexer_projection");
    expect(response.headers.get("x-correlation-id")).toBe("corr-resolve");
  });

  it("keeps stale ACTIVE fail-closed and marks the refusal explicitly", async () => {
    resolve.mockResolvedValue({
      executionAccount: null,
      watermark: 90,
      authoritativeSource: "stale_refused",
      staleRefused: true,
    });

    const response = await GET(
      new Request("http://localhost/v1/resolve/prism%3Aone?venue=BASE"),
      { params: Promise.resolve({ identifier: "prism:one" }) },
    );
    const body: any = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.executionAccount).toBeNull();
    expect(body.data.staleRefused).toBe(true);
    expect(body.data.authoritativeSource).toBe("stale_refused");
    expect(response.headers.get("x-prism-stale-refused")).toBe("1");
  });

  it("does not expose projection data for an unknown canonical identity", async () => {
    const getIdentity = vi.fn(async () => null);
    vi.mocked(getAppFactory).mockResolvedValue({
      registryReadPort: { getIdentity },
      resolveService: { resolve },
      app: { resolve: vi.fn() },
    } as never);
    resolve.mockResolvedValue({
      executionAccount: "0xabc",
      watermark: 120,
      authoritativeSource: "registry_canonical",
      staleRefused: false,
    });

    const response = await GET(
      new Request("http://localhost/v1/resolve/prism%3Aunknown?venue=BASE"),
      { params: Promise.resolve({ identifier: "prism:unknown" }) },
    );
    const body: any = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("ERR-010");
    expect(resolve).not.toHaveBeenCalled();
    expect(getIdentity).toHaveBeenCalledWith("prism:unknown");
  });
});
