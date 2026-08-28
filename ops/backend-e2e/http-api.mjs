import { createHmac } from "node:crypto";
import { chromium } from "@playwright/test";

const baseURL = process.env.BACKEND_E2E_BASE_URL ?? "http://127.0.0.1:4173";
const secret = process.env.PRISM_APP_SESSION_SECRET;
if (!secret || secret.length < 32) throw new Error("PRISM_APP_SESSION_SECRET must be provided for signed-session E2E");
const now = Math.floor(Date.now() / 1000);
const claims = { sid: "e2e-session-0001", sub: "e2e-user", iat: now - 10, exp: now + 3600, iss: "prism", aud: "prism-api" };
const encoded = Buffer.from(JSON.stringify(claims)).toString("base64url");
const signature = createHmac("sha256", secret).update(`v1.${encoded}`).digest().toString("base64url");
const sessionToken = `v1.${encoded}.${signature}`;
const hash = `0x${"a".repeat(64)}`;
const sessionHeaders = {
  "content-type": "application/json",
  "idempotency-key": `e2e-${Date.now()}`,
  "x-request-id": "backend-e2e",
  authorization: `Bearer ${sessionToken}`,
};

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE ?? "/snap/bin/chromium",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
try {
  const page = await browser.newPage();
  await page.goto(baseURL, { waitUntil: "domcontentloaded" });
  const unauthenticated = await page.evaluate(async (url) => {
    const response = await fetch(`${url}/api/v1/payments/requests`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId: "backend-e2e-unauth", recipient: { kind: "claim_token", commitment: "0x" + "b".repeat(64) }, asset: "native", amount: "10", chainId: 84532, expiresAt: 4102444800, now: 4102444000 }),
    });
    return { status: response.status, body: await response.json() };
  }, baseURL);
  if (unauthenticated.status !== 401) throw new Error(`unauthenticated write expected 401, got ${unauthenticated.status}`);

  const created = await page.evaluate(async ({ url, headers, commitment }) => {
    const response = await fetch(`${url}/api/v1/payments/requests`, {
      method: "POST",
      headers,
      body: JSON.stringify({ requestId: "backend-e2e-auth", requesterRef: "attacker-value", recipient: { kind: "claim_token", commitment }, asset: "native", amount: "10", chainId: 84532, expiresAt: 4102444800, now: 4102444000 }),
    });
    return { status: response.status, body: await response.json() };
  }, { url: baseURL, headers: sessionHeaders, commitment: hash });
  if (created.status !== 201 || created.body?.ok !== true) throw new Error(`authenticated create failed: ${created.status}`);
  if (JSON.stringify(created.body).includes("attacker-value")) throw new Error("caller-supplied requester leaked");

  const fetched = await page.evaluate(async ({ url, headers }) => {
    const response = await fetch(`${url}/api/v1/payments/requests/backend-e2e-auth`, { headers: { ...headers, "x-request-id": "backend-e2e-read" } });
    return { status: response.status, body: await response.json() };
  }, { url: baseURL, headers: sessionHeaders });
  if (fetched.status !== 200 || fetched.body?.ok !== true) throw new Error(`payment read failed: ${fetched.status}`);

  console.log(JSON.stringify({ ok: true, browser: "chromium", baseURL, checks: ["unauthenticated_write_rejected", "authenticated_payment_created", "caller_identity_redacted", "payment_readback"] }));
} finally {
  await browser.close();
}
