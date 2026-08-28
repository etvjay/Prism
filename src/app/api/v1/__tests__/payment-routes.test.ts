import { beforeEach, describe, expect, it } from "vitest";
import { POST as createPayment } from "../payments/requests/route";
import { GET as getPayment } from "../payments/requests/[requestId]/route";
import { resetPaymentHttpRuntime } from "@/features/prism-payments/application/http-runtime";

const hash = `0x${"a".repeat(64)}`;
const sessionHeaders = {
  "content-type": "application/json",
  "Idempotency-Key": "k1",
  "X-Request-Id": "r1",
  "x-session-id": "sess-1",
  "x-session-user": "requester",
};

function paymentBody(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    requestId: "req1",
    requesterRef: "attacker-controlled-value",
    recipient: { kind: "claim_token", commitment: hash },
    asset: "native",
    amount: "10",
    chainId: 84532,
    expiresAt: 200,
    now: 100,
    ...overrides,
  });
}

describe("request payment mounted route", () => {
  beforeEach(() => {
    resetPaymentHttpRuntime();
    delete process.env.PRISM_RUNTIME_MODE;
    delete process.env.PRISM_REQUIRE_POSTGRES;
  });

  it("requires a session for writes", async () => {
    const response = await createPayment(new Request("http://x/v1/payments/requests", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: paymentBody(),
    }));
    expect(response.status).toBe(401);
  });

  it("fails closed without Postgres in production mode", async () => {
    process.env.PRISM_RUNTIME_MODE = "production";
    resetPaymentHttpRuntime();
    const response = await createPayment(new Request("http://x/v1/payments/requests", {
      method: "POST",
      headers: sessionHeaders,
      body: paymentBody({ requestId: "req-production" }),
    }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ ok: false, error: { detail: "dependency_unavailable" } });
    delete process.env.PRISM_RUNTIME_MODE;
  });

  it("binds the requester to the authenticated session and redacts private fields", async () => {
    const response = await createPayment(new Request("http://x/v1/payments/requests", {
      method: "POST",
      headers: sessionHeaders,
      body: paymentBody({ memo: "secret" }),
    }));
    expect(response.status).toBe(201);
    const json = await response.json();
    expect(json.ok).toBe(true);
    expect(json.data.amount).toBe("10");
    expect(json.data.requesterRef).toBeUndefined();
    expect(JSON.stringify(json)).not.toContain("secret");

    const fetched = await getPayment(new Request("http://x"), { params: Promise.resolve({ requestId: "req1" }) });
    expect(fetched.status).toBe(200);
  });
});
