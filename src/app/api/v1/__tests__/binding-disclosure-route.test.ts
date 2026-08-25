import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAppFactory } from "@/application/factory";
import { GET as publicListGet } from "../identity/[prismId]/bindings/route";
import { GET as ownerPrivateGet } from "../identity/[prismId]/bindings/private/route";

vi.mock("@/application/factory", () => ({
  getAppFactory: vi.fn(),
}));

const listPublicBindings = vi.fn();
const listOwnerPrivateBindings = vi.fn();
const session = {
  sessionId: "sess_bindings_1",
  userId: "owner-1",
  issuedAt: 1_789_000_000,
  expiresAt: 1_789_000_600,
};

function getRequest(path: string, headers: Record<string, string> = {}) {
  return new Request(`http://localhost${path}`, { headers });
}

describe("binding disclosure REST contracts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAppFactory).mockResolvedValue({
      handlers: { listPublicBindings, listOwnerPrivateBindings },
    } as never);
  });

  it("uses the public audience projection and never asks for owner/private data", async () => {
    listPublicBindings.mockResolvedValue({
      ok: true,
      data: [{
        bindingId: "binding-public",
        prismId: "prism:P7F21",
        visibility: "PUBLIC",
        status: "ACTIVE",
        version: 0,
        endpoint: { id: "endpoint-public", chain: "BASE", chainId: "8453", kind: "ACCOUNT", address: "0xabc0000000000000000000000000000000000001" },
        historicalPublic: true,
        publiclyExposedAt: 1_789_000_000,
        createdAt: 1_789_000_000,
        updatedAt: 1_789_000_000,
      }],
    });

    const response = await publicListGet(
      getRequest("/v1/identity/prism%3AP7F21/bindings?audience=public"),
      { params: Promise.resolve({ prismId: "prism:P7F21" }) },
    );

    expect(response.status).toBe(200);
    expect(listPublicBindings).toHaveBeenCalledWith(expect.objectContaining({ payload: { prismId: "prism:P7F21" } }));
    expect(listOwnerPrivateBindings).not.toHaveBeenCalled();
  });

  it("rejects SELECTIVE and non-persistent route selectors instead of collapsing them", async () => {
    const selective = await publicListGet(
      getRequest("/v1/identity/prism%3AP7F21/bindings?visibility=SELECTIVE"),
      { params: Promise.resolve({ prismId: "prism:P7F21" }) },
    );
    const ephemeral = await publicListGet(
      getRequest("/v1/identity/prism%3AP7F21/bindings?lifecycle=EPHEMERAL"),
      { params: Promise.resolve({ prismId: "prism:P7F21" }) },
    );

    expect(selective.status).toBe(501);
    expect((await selective.json()).error.code).toBe("SELECTIVE_UNSUPPORTED");
    expect(ephemeral.status).toBe(501);
    expect((await ephemeral.json()).error.code).toBe("LIFECYCLE_UNSUPPORTED");
    expect(listPublicBindings).not.toHaveBeenCalled();
  });

  it("requires an app session before entering the owner/private audience", async () => {
    const response = await ownerPrivateGet(
      getRequest("/v1/identity/prism%3AP7F21/bindings/private"),
      { params: Promise.resolve({ prismId: "prism:P7F21" }) },
    );

    expect(response.status).toBe(401);
    expect((await response.json()).error.detail).toBe("missing_app_session");
    expect(listOwnerPrivateBindings).not.toHaveBeenCalled();
  });

  it("forwards only the owner/private audience with session context", async () => {
    listOwnerPrivateBindings.mockResolvedValue({
      ok: true,
      data: [{
        bindingId: "binding-private",
        prismId: "prism:P7F21",
        visibility: "PRIVATE",
        status: "ACTIVE",
        version: 0,
        endpoint: { id: "endpoint-private", chain: "BASE", chainId: "8453", kind: "ACCOUNT", address: "0xdef0000000000000000000000000000000000002" },
        historicalPublic: false,
        publiclyExposedAt: null,
        hiddenAt: null,
        createdAt: 1_789_000_000,
        updatedAt: 1_789_000_000,
        historicalPublicWarning: null,
      }],
    });

    const response = await ownerPrivateGet(
      getRequest("/v1/identity/prism%3AP7F21/bindings/private", {
        "x-session-id": session.sessionId,
        "x-session-user": session.userId,
        "x-session-issued-at": String(session.issuedAt),
        "x-session-expires-at": String(session.expiresAt),
      }),
      { params: Promise.resolve({ prismId: "prism:P7F21" }) },
    );

    expect(response.status).toBe(200);
    expect(listOwnerPrivateBindings).toHaveBeenCalledWith(expect.objectContaining({
      payload: { prismId: "prism:P7F21" },
      session: expect.objectContaining({ userId: "owner-1" }),
    }));
  });

  it("preserves fail-closed key-management and owner-auth responses", async () => {
    listOwnerPrivateBindings.mockResolvedValue({
      ok: false,
      error: {
        code: "BLOCKED_BY_KEY_MANAGEMENT",
        name: "blocked_by_key_management",
        category: "dependency",
        retryable: "true_backoff",
        userAction: "wait_retry",
        httpStatusHint: 503,
        detail: "key_management_unconfigured",
      },
    });
    const response = await ownerPrivateGet(
      getRequest("/v1/identity/prism%3AP7F21/bindings/private", {
        "x-session-id": session.sessionId,
        "x-session-user": session.userId,
        "x-session-issued-at": String(session.issuedAt),
        "x-session-expires-at": String(session.expiresAt),
      }),
      { params: Promise.resolve({ prismId: "prism:P7F21" }) },
    );

    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("BLOCKED_BY_KEY_MANAGEMENT");
  });
});
