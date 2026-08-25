import { describe, expect, it } from "vitest";
import { createPrismClient } from "../client";

const SESSION = {
  sessionId: "sess_sdk_bindings",
  userId: "owner-1",
  issuedAt: 1_789_000_000 - 1,
  expiresAt: 1_789_000_000 + 600,
};

function okResponse(data: unknown): Response {
  return new Response(JSON.stringify({ ok: true, data }), {
    status: 200,
    headers: { "content-type": "application/json", "x-request-id": "sdk-request" },
  });
}

describe("Prism SDK binding disclosure routes", () => {
  it("uses the proven public-list contract without a session", async () => {
    let requestedUrl = "";
    const client = createPrismClient({
      baseUrl: "https://prism.example",
      fetch: async (input) => {
        requestedUrl = String(input);
        return okResponse([]);
      },
    });

    const result = await client.bindings.listPublic("prism:P7F21", { requestId: "sdk-request" });

    expect(result.ok).toBe(true);
    expect(requestedUrl).toBe("https://prism.example/v1/identity/prism%3AP7F21/bindings?audience=public");
  });

  it("requires a session before using the owner/private contract", async () => {
    let calls = 0;
    const client = createPrismClient({
      baseUrl: "https://prism.example",
      fetch: async () => {
        calls++;
        return okResponse([]);
      },
    });

    const missing = await client.bindings.listPrivate("prism:P7F21");
    expect(missing).toMatchObject({ ok: false, error: { code: "OWNER_AUTHORIZATION_REQUIRED", httpStatusHint: 401 } });
    expect(calls).toBe(0);

    const owner = await client.bindings.listPrivate("prism:P7F21", { session: SESSION });
    expect(owner.ok).toBe(true);
    expect(calls).toBe(1);
  });
});
