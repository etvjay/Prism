import { beforeEach, describe, expect, it } from "vitest";
import { POST as createPayment } from "../payments/requests/route";
import { GET as getPayment } from "../payments/requests/[requestId]/route";
import { POST as createGift } from "../gifts/route";
import { getPaymentHttpRuntime, resetPaymentHttpRuntime } from "@/features/prism-payments/application/http-runtime";

const hash = `0x${"a".repeat(64)}`;
const sessionHeaders = {
  "content-type": "application/json",
  "Idempotency-Key": "k1",
  "X-Request-Id": "r1",
  "x-session-id": "sess-0001",
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
    process.env.PRISM_RUNTIME_MODE = "test";
    process.env.PRISM_TEST_ONLY_ALLOW_SESSION_FIXTURES = "1";
    delete process.env.PRISM_REQUIRE_POSTGRES;
    delete process.env.PRISM_POSTGRES_TEST_URL;
    delete process.env.PRISM_POSTGRES_URL;
  });

  it("requires a session for writes", async () => {
    const response = await createPayment(new Request("http://x/v1/payments/requests", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: paymentBody(),
    }));
    expect(response.status).toBe(401);
  });

  it("rejects malformed and expired test sessions", async () => {
    const malformed = await createPayment(new Request("http://x/v1/payments/requests", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: paymentBody({ session: { sessionId: "bad", userId: "requester", issuedAt: 1, expiresAt: 9999999999 } }),
    }));
    expect(malformed.status).toBe(401);
    const expired = await createPayment(new Request("http://x/v1/payments/requests", {
      method: "POST",
      headers: { ...sessionHeaders, "x-session-expires-at": "1" },
      body: paymentBody({ requestId: "req-expired" }),
    }));
    expect(expired.status).toBe(401);
  });

  it("fails closed without Postgres in production mode", async () => {
    process.env.PRISM_RUNTIME_MODE = "production";
    resetPaymentHttpRuntime();
    await expect(getPaymentHttpRuntime()).rejects.toMatchObject({ code: "ERR-062" });
    process.env.PRISM_RUNTIME_MODE = "test";
  });

  it("rejects malformed Postgres configuration before constructing a payment store", async () => {
    process.env.PRISM_POSTGRES_TEST_URL = "http://not-postgres";
    resetPaymentHttpRuntime();
    await expect(getPaymentHttpRuntime()).rejects.toMatchObject({ code: "ERR-062", detail: "invalid_postgres_url_format" });
    delete process.env.PRISM_POSTGRES_TEST_URL;
  });

  it("requires an explicit test-only fixture opt-in even in test mode", async () => {
    delete process.env.PRISM_TEST_ONLY_ALLOW_SESSION_FIXTURES;
    const response = await createPayment(new Request("http://x/v1/payments/requests", {
      method: "POST",
      headers: sessionHeaders,
      body: paymentBody({ requestId: "req-fixture-opt-in" }),
    }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { detail: "session_fixture_opt_in_required" } });
  });

  it("rejects unverified header sessions outside test mode", async () => {
    process.env.PRISM_RUNTIME_MODE = "production";
    resetPaymentHttpRuntime();
    const response = await createPayment(new Request("http://x/v1/payments/requests", {
      method: "POST",
      headers: sessionHeaders,
      body: paymentBody({ requestId: "req-unverified" }),
    }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { detail: "session_verifier_unavailable" } });
    process.env.PRISM_RUNTIME_MODE = "test";
  });

  it("rejects a forged gift sender even with a valid test fixture session", async () => {
    const response = await createGift(new Request("http://x/v1/gifts", {
      method: "POST",
      headers: { ...sessionHeaders, "Idempotency-Key": "gift-forged" },
      body: JSON.stringify({
        sender: "attacker",
        asset: "0x0000000000000000000000000000000000000001",
        amount: "10",
        chainId: 84532,
        expiresAt: 200,
        nullifierCommitment: hash,
        now: 100,
      }),
    }));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "ERR-065" } });
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
