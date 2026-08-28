import { createHmac } from "node:crypto";
import { chromium } from "@playwright/test";

const baseURL = process.env.BACKEND_E2E_BASE_URL ?? "http://127.0.0.1:4173";
const secret = process.env.PRISM_APP_SESSION_SECRET;
if (!secret || secret.length < 32) throw new Error("PRISM_APP_SESSION_SECRET must be provided for signed-session E2E");

function signedToken(userId, sessionId) {
  const now = Math.floor(Date.now() / 1000);
  const claims = { sid: sessionId, sub: userId, iat: now - 10, exp: now + 3600, iss: "prism", aud: "prism-api" };
  const encoded = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = createHmac("sha256", secret).update(`v1.${encoded}`).digest().toString("base64url");
  return `v1.${encoded}.${signature}`;
}

const user = "0x1111111111111111111111111111111111111111";
const sessionHeaders = {
  "content-type": "application/json",
  "idempotency-key": `e2e-${Date.now()}`,
  "x-request-id": "backend-e2e",
  authorization: `Bearer ${signedToken(user, "e2e-session-0001")}`,
};
const otherHeaders = {
  ...sessionHeaders,
  authorization: `Bearer ${signedToken("0x2222222222222222222222222222222222222222", "e2e-session-0002")}`,
};
const hash = `0x${"a".repeat(64)}`;
const giftAsset = `0x${"d".repeat(40)}`;
const requireSharedStore = process.env.BACKEND_E2E_REQUIRE_SHARED_STORE === "1";
const skipped = [];
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE ?? "/snap/bin/chromium",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

async function api(page, path, options = {}) {
  return page.evaluate(async ({ url, path, options }) => {
    const response = await fetch(`${url}${path}`, options);
    return { status: response.status, body: await response.json() };
  }, { url: baseURL, path, options });
}

try {
  const page = await browser.newPage();
  await page.goto(baseURL, { waitUntil: "domcontentloaded" });

  const unauthenticated = await api(page, "/api/v1/payments/requests", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestId: "backend-e2e-unauth", recipient: { kind: "claim_token", commitment: `0x${"b".repeat(64)}` }, asset: "native", amount: "10", chainId: 84532, expiresAt: 4102444800, now: 4102444000 }),
  });
  if (unauthenticated.status !== 401) throw new Error(`unauthenticated write expected 401, got ${unauthenticated.status}`);

  const forgedLegacy = await api(page, "/api/v1/payments/requests", {
    method: "POST",
    headers: { ...sessionHeaders, authorization: "Bearer e2e-session-0001:e2e-user" },
    body: JSON.stringify({ requestId: "backend-e2e-forged", recipient: { kind: "claim_token", commitment: hash }, asset: "native", amount: "10", chainId: 84532, expiresAt: 4102444800, now: 4102444000 }),
  });
  if (forgedLegacy.status !== 401) throw new Error(`forged legacy session expected 401, got ${forgedLegacy.status}`);

  const created = await api(page, "/api/v1/payments/requests", {
    method: "POST",
    headers: sessionHeaders,
    body: JSON.stringify({ requestId: "backend-e2e-auth", requesterRef: "attacker-value", recipient: { kind: "claim_token", commitment: hash }, asset: "native", amount: "10", chainId: 84532, expiresAt: 4102444800, now: 4102444000 }),
  });
  if (created.status !== 201 || created.body?.ok !== true) throw new Error(`authenticated create failed: ${created.status}`);
  if (JSON.stringify(created.body).includes("attacker-value")) throw new Error("caller-supplied requester leaked");

  const viewed = await api(page, "/api/v1/payments/requests/backend-e2e-auth", {
    method: "POST",
    headers: sessionHeaders,
    body: JSON.stringify({ operation: "view", now: 4102444001 }),
  });
  if (viewed.status === 404 && !requireSharedStore) skipped.push("payment_cross_route_lifecycle_requires_shared_store");
  else if (viewed.status !== 200 || viewed.body?.data?.state !== "viewed") throw new Error(`payment view failed: ${viewed.status}`);

  if (viewed.status === 200) {
    const wrongOwner = await api(page, "/api/v1/payments/requests/backend-e2e-auth", {
      method: "POST",
      headers: otherHeaders,
      body: JSON.stringify({ operation: "view", now: 4102444002 }),
    });
    if (wrongOwner.status !== 403) throw new Error(`payment ownership expected 403, got ${wrongOwner.status}`);
  } else skipped.push("payment_ownership_requires_shared_store");

  const gift = await api(page, "/api/v1/gifts", {
    method: "POST",
    headers: sessionHeaders,
    body: JSON.stringify({ claimId: "backend-e2e-gift", sender: user, asset: giftAsset, amount: "10", chainId: 84532, expiresAt: 4102444800, nullifierCommitment: `0x${"c".repeat(64)}`, now: 4102444000 }),
  });
  if (gift.status !== 201 || gift.body?.data?.state !== "created") throw new Error(`gift create failed: ${gift.status}`);

  const giftRead = await api(page, "/api/v1/gifts/backend-e2e-gift", { headers: sessionHeaders });
  if (giftRead.status !== 200 && !(giftRead.status === 404 && !requireSharedStore)) throw new Error(`gift read failed: ${giftRead.status}`);
  if (giftRead.status === 404) skipped.push("gift_cross_route_lifecycle_requires_shared_store");
  else if (giftRead.body?.data?.state !== "created") throw new Error(`gift read state failed: ${giftRead.body?.data?.state}`);

  const forgedGiftSender = await api(page, "/api/v1/gifts", {
    method: "POST",
    headers: sessionHeaders,
    body: JSON.stringify({ sender: "0x2222222222222222222222222222222222222222", asset: giftAsset, amount: "10", chainId: 84532, expiresAt: 4102444800, nullifierCommitment: `0x${"e".repeat(64)}`, now: 4102444000 }),
  });
  if (forgedGiftSender.status !== 403) throw new Error(`gift ownership expected 403, got ${forgedGiftSender.status}`);

  if (giftRead.status === 200) {
    const expiredGift = await api(page, "/api/v1/gifts/backend-e2e-gift", {
      method: "POST",
      headers: sessionHeaders,
      body: JSON.stringify({ operation: "expire", now: 4102444800 }),
    });
    if (expiredGift.status !== 200 || expiredGift.body?.data?.state !== "expired") throw new Error(`gift expiry failed: ${expiredGift.status}`);
  } else skipped.push("gift_expiry_requires_shared_store");

  console.log(JSON.stringify({ ok: true, browser: "chromium", baseURL, checks: ["unauthenticated_write_rejected", "forged_legacy_session_rejected", "authenticated_payment_created", "gift_created", "gift_sender_ownership_enforced"], lifecycleChecks: skipped.length === 0 ? ["payment_viewed", "payment_ownership_enforced", "gift_readback", "gift_expired"] : [], skipped, note: "No chain settlement claimed; funding/claim remain provider-bound. In-memory Next route bundles cannot share lifecycle state across route modules without a durable store." }));
} finally {
  await browser.close();
}
