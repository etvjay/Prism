import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "../by-controller/route";

vi.mock("@/application/factory", () => ({
  getAppFactory: vi.fn(),
}));

import { getAppFactory } from "@/application/factory";

describe("GET /api/v1/identities/by-controller", () => {
  beforeEach(() => vi.resetAllMocks());

  it("empty registry returns 200 NONE, not 503", async () => {
    (getAppFactory as any).mockResolvedValue({
      registryReadPort: { listByController: async () => [], getIdentity: async () => null },
      eventProjectionCoordinator: null,
    });
    const req = new Request("http://localhost/api/v1/identities/by-controller?controller=0x123abc");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.state).toBe("NONE");
    expect(body.candidates).toEqual([]);
    expect(body.source).toBeDefined();
  });

  it("one identity returns FOUND", async () => {
    (getAppFactory as any).mockResolvedValue({
      registryReadPort: {
        listByController: async () => [{ prismId: "prism:one", createdAtBlock: 10, version: 0 }],
        getIdentity: async () => ({ controller: "0xabc", createdAtBlock: 10, version: 0 }),
      },
      eventProjectionCoordinator: null,
    });
    const req = new Request("http://localhost/api/v1/identities/by-controller?controller=0xabc");
    const res = await GET(req);
    const body: any = await res.json();
    expect(res.status).toBe(200);
    expect(body.state).toBe("FOUND");
    expect(body.candidates).toHaveLength(1);
    expect(body.candidates[0].prismId).toBe("prism:one");
    expect(body.candidates[0]).toHaveProperty("status");
    expect(body.candidates[0]).toHaveProperty("watermark");
    // must not leak private binding data
    expect(body).not.toHaveProperty("bindings");
    expect(body).not.toHaveProperty("ciphertext");
  });

  it("multiple identities returns MULTIPLE and disables SUSPENDED later", async () => {
    (getAppFactory as any).mockResolvedValue({
      registryReadPort: {
        listByController: async () => [
          { prismId: "prism:one", createdAtBlock: 1, version: 0 },
          { prismId: "prism:two", createdAtBlock: 2, version: 0 },
        ],
        getIdentity: async () => ({ controller: "0xabc", createdAtBlock: 1, version: 0 }),
      },
      eventProjectionCoordinator: null,
    });
    const req = new Request("http://localhost/api/v1/identities/by-controller?controller=0xabc");
    const res = await GET(req);
    const body: any = await res.json();
    expect(body.state).toBe("MULTIPLE");
    expect(body.candidates).toHaveLength(2);
  });

  it("malformed controller is rejected with 422 UNKNOWN", async () => {
    (getAppFactory as any).mockResolvedValue({
      registryReadPort: { listByController: async () => [], getIdentity: async () => null },
      eventProjectionCoordinator: null,
    });
    const req = new Request("http://localhost/api/v1/identities/by-controller?controller=not-hex");
    const res = await GET(req);
    expect(res.status).toBe(422);
    const body: any = await res.json();
    expect(body.state).toBe("UNKNOWN");
  });

  it("unexpected registry error returns 502 UNKNOWN", async () => {
    (getAppFactory as any).mockResolvedValue({
      registryReadPort: {
        listByController: async () => { throw new Error("boom"); },
        getIdentity: async () => null,
      },
      eventProjectionCoordinator: null,
    });
    const req = new Request("http://localhost/api/v1/identities/by-controller?controller=0xabc");
    const res = await GET(req);
    expect(res.status).toBe(502);
    const body: any = await res.json();
    expect(body.state).toBe("UNKNOWN");
  });

  it("response shape matches approved public candidate shape", async () => {
    (getAppFactory as any).mockResolvedValue({
      registryReadPort: {
        listByController: async () => [{ prismId: "prism:shape", createdAtBlock: 5, version: 0 }],
        getIdentity: async () => ({ controller: "0xabc", createdAtBlock: 5, version: 0 }),
      },
      eventProjectionCoordinator: null,
    });
    const req = new Request("http://localhost/api/v1/identities/by-controller?controller=0xabc");
    const res = await GET(req);
    const body: any = await res.json();
    const cand = body.candidates[0];
    expect(cand).toHaveProperty("prismId");
    expect(cand).toHaveProperty("status");
    expect(cand).toHaveProperty("watermark");
    expect(Object.keys(cand)).not.toContain("controller");
    expect(Object.keys(cand)).not.toContain("ciphertext");
  });

  it("does not count a registry candidate without canonical getIdentity readback", async () => {
    const getIdentity = vi.fn(async () => null);
    (getAppFactory as any).mockResolvedValue({
      registryReadPort: {
        listByController: async () => [{ prismId: "prism:stale", createdAtBlock: 5, version: 0 }],
        getIdentity,
      },
      eventProjectionCoordinator: null,
    });

    const res = await GET(new Request("http://localhost/api/v1/identities/by-controller?controller=0xabc"));
    const body: any = await res.json();
    expect(res.status).toBe(200);
    expect(body.state).toBe("NONE");
    expect(body.candidates).toEqual([]);
    expect(getIdentity).toHaveBeenCalledWith("prism:stale");
  });

  it("returns UNAVAILABLE when canonical by-controller lookup is unavailable and no projection exists", async () => {
    (getAppFactory as any).mockResolvedValue({
      registryReadPort: {
        listByController: async () => { throw new Error("by_controller_unavailable"); },
        getIdentity: async () => null,
      },
      eventProjectionCoordinator: null,
    });

    const res = await GET(new Request("http://localhost/api/v1/identities/by-controller?controller=0xabc"));
    const body: any = await res.json();
    expect(res.status).toBe(503);
    expect(body.ok).toBe(false);
    expect(body.state).toBe("UNAVAILABLE");
    expect(body.error.code).toBe("CONTROLLER_LOOKUP_UNAVAILABLE");
  });

  it("uses scoped projection rows plus canonical readback and never fabricates status", async () => {
    const listByController = vi.fn(async () => { throw new Error("by_controller_unavailable"); });
    const getIdentity = vi.fn(async (id: string) => id === "prism:projected" ? ({ controller: "0xabc", createdAtBlock: 9, version: 2 }) : null);
    (getAppFactory as any).mockResolvedValue({
      registryReadPort: { listByController, getIdentity },
      eventProjectionCoordinator: {
        getProjection: async () => ({
          identities: new Map([["prism:projected", { prismId: "prism:projected", controller: "0xabc", createdAtBlock: 9, version: 2 }]]),
          bindings: new Map(),
          seenKeys: new Set(),
          watermark: 12,
          scope: { registryAddress: "0x1234", network: "SN_SEPOLIA", registryVersion: "v1", abiVersion: "v1" },
        }),
      },
    });

    const res = await GET(new Request("http://localhost/api/v1/identities/by-controller?controller=0xabc"));
    const body: any = await res.json();
    expect(res.status).toBe(200);
    expect(body.state).toBe("FOUND");
    expect(body.watermark).toBe(12);
    expect(body.candidates).toEqual([{ prismId: "prism:projected", status: "UNKNOWN", watermark: 12 }]);
    expect(body.source).toContain("scoped_public_event_projection");
    expect(listByController).not.toHaveBeenCalled();
    expect(getIdentity).toHaveBeenCalledWith("prism:projected");
  });
});
