import { afterEach, describe, expect, it } from "vitest";
import { requireAuthenticatedSession } from "../http-helpers";
import { signAppSession, verifySignedAppSession } from "../auth";

const SECRET = "test-only-session-secret-32-bytes-long";
const NOW = Math.floor(Date.now() / 1000);

function request(headers: Record<string, string> = {}, body: Record<string, unknown> = {}) {
  return new Request("http://x/v1/payments/requests", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function validToken(overrides: Record<string, unknown> = {}) {
  return signAppSession({ sid: "session-0001", sub: "verified-user", iat: NOW - 10, exp: NOW + 3600, ...overrides }, SECRET);
}

afterEach(() => {
  delete process.env.PRISM_APP_SESSION_SECRET;
  delete process.env.PRISM_APP_SESSION_ISSUER;
  delete process.env.PRISM_APP_SESSION_AUDIENCE;
  delete process.env.PRISM_APP_SESSION_REVOKED_IDS;
  delete process.env.PRISM_RUNTIME_MODE;
  delete process.env.PRISM_TEST_ONLY_ALLOW_SESSION_FIXTURES;
});

describe("trusted application session boundary", () => {
  it("accepts a valid signed session and derives identity from verified claims", () => {
    process.env.PRISM_APP_SESSION_SECRET = SECRET;
    const result = requireAuthenticatedSession(request({ authorization: `Bearer ${validToken()}` }), { session: { sessionId: "forged", userId: "attacker" } });
    expect(result).toEqual({ sessionId: "session-0001", userId: "verified-user", issuedAt: NOW - 10, expiresAt: NOW + 3600 });
  });

  it.each(["production", "rehearsal"])("rejects forged legacy body sessions in %s even when fixture opt-in is set", (mode) => {
    process.env.PRISM_RUNTIME_MODE = mode;
    process.env.PRISM_TEST_ONLY_ALLOW_SESSION_FIXTURES = "1";
    const result = requireAuthenticatedSession(request({}, { session: { sessionId: "session-0001", userId: "attacker", issuedAt: NOW - 1, expiresAt: NOW + 100 } }), {});
    expect("error" in result && result.error.status).toBe(503);
  });

  it.each(["production", "rehearsal"])("rejects forged bearer and header material in %s", async (mode) => {
    process.env.PRISM_RUNTIME_MODE = mode;
    process.env.PRISM_APP_SESSION_SECRET = SECRET;
    const original = validToken({ sub: "verified-user" });
    const pieces = original.split(".");
    pieces[2] = (pieces[2][0] === "A" ? "B" : "A") + pieces[2].slice(1);
    const forged = pieces.join(".");
    const bearer = requireAuthenticatedSession(request({ authorization: `Bearer ${forged}` }), {});
    expect("error" in bearer && bearer.error.status).toBe(401);
    const header = requireAuthenticatedSession(request({ "x-session-id": "session-0001", "x-session-user": "attacker" }), {});
    expect("error" in header && header.error.status).toBe(503);
  });

  it("rejects malformed and expired signed sessions", () => {
    process.env.PRISM_RUNTIME_MODE = "production";
    process.env.PRISM_APP_SESSION_SECRET = SECRET;
    for (const token of ["not-a-session", validToken({ exp: NOW - 1 })]) {
      const result = requireAuthenticatedSession(request({ authorization: `Bearer ${token}` }), {});
      expect("error" in result && result.error.status).toBe(401);
    }
  });

  it("rejects wrong issuer, audience, and revoked sessions", () => {
    process.env.PRISM_RUNTIME_MODE = "production";
    process.env.PRISM_APP_SESSION_SECRET = SECRET;
    const wrongIssuer = validToken({ iss: "other-issuer" });
    const wrongAudience = validToken({ aud: "other-api" });
    for (const token of [wrongIssuer, wrongAudience]) {
      const result = requireAuthenticatedSession(request({ authorization: `Bearer ${token}` }), {});
      expect("error" in result && result.error.status).toBe(401);
    }
    process.env.PRISM_APP_SESSION_REVOKED_IDS = "session-0001";
    expect(() => verifySignedAppSession(validToken(), NOW)).toThrow(/session_revoked/);
  });

  it.each(["production", "rehearsal"])("fails closed when the %s secret is missing", (mode) => {
    process.env.PRISM_RUNTIME_MODE = mode;
    const result = requireAuthenticatedSession(request({ authorization: "Bearer v1.invalid.invalid" }), {});
    expect("error" in result && result.error.status).toBe(503);
  });

  it("keeps fixture sessions behind the explicit test-only switch", () => {
    process.env.PRISM_RUNTIME_MODE = "test";
    delete process.env.PRISM_TEST_ONLY_ALLOW_SESSION_FIXTURES;
    const body = { session: { sessionId: "session-0001", userId: "fixture-user", issuedAt: NOW - 1, expiresAt: NOW + 100 } };
    expect("error" in requireAuthenticatedSession(request({}, body), body)).toBe(true);
    process.env.PRISM_TEST_ONLY_ALLOW_SESSION_FIXTURES = "1";
    const result = requireAuthenticatedSession(request({}, body), body);
    expect(result).toMatchObject({ userId: "fixture-user" });
  });
});
