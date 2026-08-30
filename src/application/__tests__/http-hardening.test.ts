import { describe, expect, it, vi } from "vitest";
import { clientRateLimitKey, createFixedWindowRateLimiter, rateLimitResponse, recordHttpEvent } from "../http-guards";
import { signAppSession } from "../auth";
import { PrismClient } from "../../sdk/client";
import { validateMcpToolInput } from "../../sdk/mcp-boundary";

describe("API/SDK/MCP hardening", () => {
  it("fails closed when version negotiation has no server version", async () => {
    const client = new PrismClient({ baseUrl: "http://localhost", fetch: vi.fn().mockResolvedValue(new Response("{}", { status: 404 })) });
    await expect(client.negotiateVersion()).resolves.toEqual({ serverVersion: null, supported: false });
  });

  it("preserves all Pause binding fields in SDK release payload", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, data: {} }), { headers: { "content-type": "application/json" } }));
    const client = new PrismClient({ baseUrl: "http://localhost", fetch, defaultSession: { sessionId: "s", userId: "u", issuedAt: 1 } });
    await client.pauses.release("p", { planHash: "0xplan", approvalScopeHash: "0xscope", settlementOperationId: "settle", expectedVersion: 3 });
    const init = fetch.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(init.body))).toMatchObject({ planHash: "0xplan", approvalScopeHash: "0xscope", settlementOperationId: "settle", expectedVersion: 3 });
  });

  it("enforces a deterministic fixed-window limit and Retry-After", async () => {
    let now = 1000;
    const limiter = createFixedWindowRateLimiter(1, 1000, () => now);
    expect(limiter.check("same").allowed).toBe(true);
    const denied = limiter.check("same");
    expect(denied).toMatchObject({ allowed: false, retryAfterSeconds: 1 });
    expect((await rateLimitResponse("r", denied)).headers.get("retry-after")).toBe("1");
    now += 1000;
    expect(limiter.check("same").allowed).toBe(true);
  });

  it("supports injected structured audit and metrics hooks", () => {
    const audit = vi.fn(); const metric = vi.fn();
    recordHttpEvent({ audit, metric }, { event: "rejected", requestId: "r", route: "/v1/x", status: 429 });
    expect(audit).toHaveBeenCalledOnce();
    expect(metric).toHaveBeenCalledWith("http.rejected", 1, { status: "429", route: "/v1/x" });
  });

  it("does not let x-session-id or an untrusted forwarded header choose the bucket", () => {
    delete process.env.PRISM_TRUST_PROXY;
    const request = new Request("http://localhost", { headers: { "x-session-id": "attacker-chosen", "x-forwarded-for": "10.0.0.1" } });
    expect(clientRateLimitKey(request)).toBe("anonymous");
  });

  it("keys authenticated requests by the verified principal, not the presented session id", () => {
    process.env.PRISM_APP_SESSION_SECRET = "test-only-session-secret-32-bytes-long";
    const token = signAppSession({ sid: "session-0001", sub: "verified-user", iat: 1, exp: 4102444800 }, process.env.PRISM_APP_SESSION_SECRET);
    const request = new Request("http://localhost", { headers: { authorization: `Bearer ${token}`, "x-session-id": "forged" } });
    expect(clientRateLimitKey(request)).toBe("principal:verified-user");
    delete process.env.PRISM_APP_SESSION_SECRET;
  });

  it("rejects MCP secret/viewing-key inputs and requires exact pause bindings", () => {
    expect(validateMcpToolInput("prism_request_pause_verification", { pauseId: "p" })).toBe("missing_required:planHash");
    expect(validateMcpToolInput("prism_request_pause_verification", { pauseId: "p", planHash: "0xabc", viewingKey: "do-not-accept" })).toBe("secret_input_rejected");
    expect(validateMcpToolInput("prism_request_approval", { pauseId: "p", planHash: "0xabc", approvalScopeHash: "0xdef" })).toBeNull();
  });
});
