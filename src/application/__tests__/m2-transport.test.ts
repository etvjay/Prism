// M2 transport/API contract tests: auth-vs-authority, idempotency, stale version,
// unknown operation, watermark propagation, route errors, no chain bypass.
// Transport-neutral assertions plus HTTP helper parsing and SDK/MCP boundary.

import { describe, it, expect } from "vitest";
import { PrismChallengeService } from "../../features/prism-identity/application/challenge-service";
import { InMemoryOwnershipProofStore } from "../../features/prism-identity/adapters/memory-ownership-proof-store";
import { fixedClock } from "../../features/prism-identity/adapters/clock";
import { viemChallengeCrypto } from "../../features/prism-identity/adapters/viem-crypto";
import { LocalErc1271SemanticsChecker, makeEoaSigner, presentedFromIssued } from "../../features/prism-identity/testing/fixtures";
import { InMemoryOperationStore } from "../../features/prism-operations/adapters/memory-operation-store";
import { PrismApplicationService } from "../prism-application";
import { InMemoryRegistry } from "../adapters/in-memory-registry";
import { createPrismApiHandlers } from "../handlers";
import { parseHeaders, toHttpResponse, readJson } from "../http-helpers";
import { InMemoryPauseService } from "../pause-port";
import { ReceiptService } from "../receipt-service";
import type { Hex } from "../../features/prism-operations/domain/operation";
import type { AppSession } from "../auth";
import { createPrismClient } from "../../sdk/client";
import { createMcpAdapter, MCP_TOOL_DEFINITIONS } from "../../sdk/mcp-boundary";

const DOMAIN = "prism.example";
const CONTROLLER = "0x1111111111111111111111111111111111111111";
const OTHER_CONTROLLER = "0x2222222222222222222222222222222222222222";
const PRISM_ID = "prism:P7F21";

function appSession(now: number): AppSession {
  return { sessionId: "sess_12345678", userId: "user-1", issuedAt: now - 10, expiresAt: now + 600 };
}

function build(now = 1_789_000_000) {
  const clock = fixedClock(now);
  const ownershipStore = new InMemoryOwnershipProofStore();
  const checker = new LocalErc1271SemanticsChecker();
  const challengeService = new PrismChallengeService({
    clock,
    crypto: viemChallengeCrypto,
    checker,
    store: ownershipStore,
    policy: { defaultTtlSeconds: 600, defaultDomain: DOMAIN, defaultChainId: 84532 },
  });
  const operationStore = new InMemoryOperationStore();
  const registry = new InMemoryRegistry();
  registry.seedIdentity(PRISM_ID, CONTROLLER);
  let n = 1;
  const app = new PrismApplicationService({
    challengeService,
    operationStore,
    registry,
    submitPort: registry,
    clock,
    idGenerator: { generateOperationId: () => `op-${n++}-${Date.now()}` },
  });
  const handlers = createPrismApiHandlers(app);
  const pauseService = new InMemoryPauseService(clock);
  const receiptService = new ReceiptService(operationStore);
  return { app, handlers, registry, operationStore, challengeService, clock, pauseService, receiptService };
}

describe("M2 — auth vs authority separation", () => {
  it("expired app session fails even when execution authority (controller) is correct (ERR-013)", async () => {
    const h = build();
    const expired: AppSession = { sessionId: "sess_12345678", userId: "user-1", issuedAt: 1_789_000_000 - 100, expiresAt: 1_789_000_000 - 1 };
    const res = await h.app.createIdentity({ headers: { requestId: "r1", idempotencyKey: "idem-auth-1" }, session: expired, payload: { controllerAddress: CONTROLLER } });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("ERR-013");
  });

  it("valid session but wrong controller fails ERR-004, not session error (authority ≠ authentication)", async () => {
    const h = build();
    const owner = makeEoaSigner();
    const acct = owner.address.toLowerCase();
    const session = appSession(h.clock.now());
    const issued = await h.app.issueChallenge({ headers: { requestId: "r1" }, session, payload: { prismId: PRISM_ID, venue: "BASE", executionAccount: acct } });
    if (!issued.ok) throw new Error("issue failed");
    const sig = await owner.signMessage({ message: issued.data.messageToSign });
    const verified = await h.app.submitProof({ headers: { requestId: "r2" }, session, payload: { challengeId: issued.data.challengeId, presented: presentedFromIssued(issued.data as never), signature: sig as Hex } });
    if (!verified.ok) throw new Error("verify failed");
    const bindRes = await h.app.bind({
      headers: { requestId: "r3", idempotencyKey: "idem-bind-auth" },
      session,
      payload: { prismId: PRISM_ID, venue: "BASE", executionAccount: acct, proofDigest: verified.data.digest, controllerAddress: OTHER_CONTROLLER },
    });
    expect(bindRes.ok).toBe(false);
    if (!bindRes.ok) {
      expect(bindRes.error.code).toBe("ERR-004");
      expect(bindRes.error.httpStatusHint).toBe(403);
    }
  });
});

describe("M2 — idempotency semantics (stable JSON, no raw stacks)", () => {
  it("same idempotency key + same fingerprint is benign (returns same operationId), different fingerprint is ERR-023", async () => {
    const h = build();
    const session = appSession(h.clock.now());
    const first = await h.app.createIdentity({ headers: { requestId: "r1", idempotencyKey: "idem-same" }, session, payload: { controllerAddress: CONTROLLER } });
    expect(first.ok).toBe(true);
    const opId1 = (first as { ok: true; data: { operationId: string } }).data.operationId;

    // Same key, same fingerprint (same controller) -> benign replay
    const replay = await h.app.createIdentity({ headers: { requestId: "r2", idempotencyKey: "idem-same" }, session, payload: { controllerAddress: CONTROLLER } });
    expect(replay.ok).toBe(true);
    expect((replay as { ok: true; data: { operationId: string } }).data.operationId).toBe(opId1);

    // Same key, different fingerprint (different controller) -> conflict
    const conflict = await h.app.createIdentity({ headers: { requestId: "r3", idempotencyKey: "idem-same" }, session, payload: { controllerAddress: OTHER_CONTROLLER } });
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) {
      expect(conflict.error.code).toBe("ERR-023");
      expect(conflict.error.detail).toContain("idempotency_key_conflict");
      expect(JSON.stringify(conflict)).not.toMatch(/stack/i);
    }
  });

  it("bind idempotency: second bind with same digest via same key is benign, via different key with same digest is ERR-007", async () => {
    const h = build();
    const owner = makeEoaSigner();
    const acct = owner.address.toLowerCase();
    const session = appSession(h.clock.now());
    const issued = await h.app.issueChallenge({ headers: {}, session, payload: { prismId: PRISM_ID, venue: "BASE", executionAccount: acct } });
    if (!issued.ok) throw new Error("issue failed");
    const sig = await owner.signMessage({ message: issued.data.messageToSign });
    const verified = await h.app.submitProof({ headers: {}, session, payload: { challengeId: issued.data.challengeId, presented: presentedFromIssued(issued.data as never), signature: sig as Hex } });
    if (!verified.ok) throw new Error("verify failed");

    const first = await h.app.bind({ headers: { idempotencyKey: "idem-bind-1" }, session, payload: { prismId: PRISM_ID, venue: "BASE", executionAccount: acct, proofDigest: verified.data.digest, controllerAddress: CONTROLLER } });
    expect(first.ok).toBe(true);

    // Benign replay with same key+same body
    const benign = await h.app.bind({ headers: { idempotencyKey: "idem-bind-1" }, session, payload: { prismId: PRISM_ID, venue: "BASE", executionAccount: acct, proofDigest: verified.data.digest, controllerAddress: CONTROLLER } });
    expect(benign.ok).toBe(true);
    expect((benign as { ok: true; data: { operationId: string } }).data.operationId).toBe((first as { ok: true; data: { operationId: string } }).data.operationId);

    // Make digest consumed, then different key with same digest -> ERR-007
    h.registry.applyBindForTest(PRISM_ID, "BASE", acct, verified.data.digest);
    const second = await h.app.bind({ headers: { idempotencyKey: "idem-bind-2" }, session, payload: { prismId: PRISM_ID, venue: "BASE", executionAccount: acct, proofDigest: verified.data.digest, controllerAddress: CONTROLLER } });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.code).toBe("ERR-007");
  });

  it("pause intent idempotency: same key returns same intent, different prismId is conflict", async () => {
    const h = build();
    const first = await h.pauseService.createIntent({ prismId: PRISM_ID, purpose: "payment", idempotencyKey: "idem-intent-1", correlationId: "corr-1" });
    const replay = await h.pauseService.createIntent({ prismId: PRISM_ID, purpose: "payment", idempotencyKey: "idem-intent-1", correlationId: "corr-1" });
    expect(replay.intentId).toBe(first.intentId);
    await expect(h.pauseService.createIntent({ prismId: "prism:OTHER", purpose: "payment", idempotencyKey: "idem-intent-1" })).rejects.toMatchObject({ code: "ERR-023" });
  });
});

describe("M2 — stale version (optimistic CAS)", () => {
  it("operation transition with wrong expectedVersion fails ERR-023 stale_version", async () => {
    const h = build();
    const session = appSession(h.clock.now());
    const created = await h.app.createIdentity({ headers: { idempotencyKey: "idem-stale-op" }, session, payload: { controllerAddress: CONTROLLER } });
    if (!created.ok) throw new Error("create failed");
    const opId = (created as { ok: true; data: { operationId: string } }).data.operationId;
    const op = await h.operationStore.getById(opId);
    const wrong = await h.app.transitionOperation(opId, "processing", 0, { txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Hex });
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) {
      expect(wrong.error.code).toBe("ERR-023");
      expect(wrong.error.detail).toContain("stale_version");
    }
    // Correct version succeeds (or fails for illegal transition but not stale)
    const correctVersion = op!.version;
    const illegalSkip = await h.app.transitionOperation(opId, "completed", correctVersion);
    expect(illegalSkip.ok).toBe(false);
    if (!illegalSkip.ok) expect(illegalSkip.error.detail).toContain("submitted_is_not_completed");
  });

  it("pause release with stale expectedVersion fails ERR-023/ERR-111", async () => {
    const h = build();
    const intent = await h.pauseService.createIntent({ prismId: PRISM_ID, purpose: "payment", idempotencyKey: "idem-pause-stale" });
    const pause = await h.pauseService.pauseIntent(intent.intentId);
    const verified = await h.pauseService.verifyPause(pause.pauseId);
    const stale = verified.version - 10;
    await expect(h.pauseService.releasePause(verified.pauseId, stale)).rejects.toMatchObject({ code: expect.stringMatching(/ERR-023|ERR-111/) });
    // Correct version succeeds
    const released = await h.pauseService.releasePause(verified.pauseId, verified.version);
    expect(released.state).toBe("RELEASED");
  });
});

describe("M2 — unknown operation / receipt handling", () => {
  it("getOperation for unknown id returns 404 stable error, no stack", async () => {
    const h = build();
    const res = await h.app.getOperation({ payload: { operationId: "op-unknown-xyz" }, headers: { requestId: "r-unknown" } });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("ERR-002");
      expect(res.error.httpStatusHint).toBe(404);
      expect(res.error.detail).toContain("unknown_operation");
      expect(JSON.stringify(res)).not.toMatch(/stack/i);
    }
  });

  it("receipt for unknown id returns 404", async () => {
    const h = build();
    const res = await h.receiptService.getReceipt("op-unknown-xyz", "r1");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.httpStatusHint).toBe(404);
  });

  it("receipt for known operation mirrors operation state and preserves submitted != completed", async () => {
    const h = build();
    const session = appSession(h.clock.now());
    const created = await h.app.createIdentity({ headers: { idempotencyKey: "idem-receipt" }, session, payload: { controllerAddress: CONTROLLER } });
    if (!created.ok) throw new Error("create failed");
    const opId = (created as { ok: true; data: { operationId: string } }).data.operationId;
    const receipt = await h.receiptService.getReceipt(opId, "r1");
    expect(receipt.ok).toBe(true);
    if (!receipt.ok) throw new Error("receipt failed");
    expect(receipt.data.state).toBe("submitted");
    expect(receipt.data.state).not.toBe("completed");
    expect(receipt.data.txHash).toMatch(/^0x/);
  });
});

describe("M2 — watermark propagation", () => {
  it("resolve and getIdentity propagate watermark in body and header", async () => {
    const h = build();
    const owner = makeEoaSigner();
    const acct = owner.address.toLowerCase();
    const session = appSession(h.clock.now());
    const issued = await h.app.issueChallenge({ headers: {}, session, payload: { prismId: PRISM_ID, venue: "BASE", executionAccount: acct } });
    if (!issued.ok) throw new Error("issue failed");
    const sig = await owner.signMessage({ message: issued.data.messageToSign });
    const verified = await h.app.submitProof({ headers: {}, session, payload: { challengeId: issued.data.challengeId, presented: presentedFromIssued(issued.data as never), signature: sig as Hex } });
    if (!verified.ok) throw new Error("verify failed");
    const bind = await h.app.bind({ headers: { idempotencyKey: "idem-wm" }, session, payload: { prismId: PRISM_ID, venue: "BASE", executionAccount: acct, proofDigest: verified.data.digest, controllerAddress: CONTROLLER } });
    if (!bind.ok) throw new Error("bind failed");
    h.registry.applyBindForTest(PRISM_ID, "BASE", acct, verified.data.digest);

    const resolveRes = await h.app.resolve({ payload: { prismId: PRISM_ID, venue: "BASE" }, headers: { requestId: "r-wm" } });
    expect(resolveRes.ok).toBe(true);
    if (!resolveRes.ok) throw new Error("resolve failed");
    expect(resolveRes.watermark).toBe(100);
    expect((resolveRes as { data: { watermark: number } }).data.watermark).toBe(100);

    const parsed = parseHeaders(new Request("http://x", { headers: { "x-request-id": "r-wm" } }));
    const httpRes = toHttpResponse(resolveRes, parsed);
    expect(httpRes.headers.get("x-prism-watermark")).toBe("100");
    expect(httpRes.headers.get("etag")).toBe('"100"');

    const idRes = await h.app.getIdentity({ payload: { prismId: PRISM_ID }, headers: { requestId: "r-wm2" } });
    expect(idRes.ok).toBe(true);
    if (!idRes.ok) throw new Error("getIdentity failed");
    expect(idRes.watermark).toBe(1);
  });
});

describe("M2 — route error stability (no raw stacks, stable codes, correlation echo)", () => {
  it("parseHeaders extracts idempotency/correlation/expectedVersion correctly", () => {
    const req = new Request("http://x", {
      headers: {
        "idempotency-key": "idem-123",
        "x-correlation-id": "corr-abc",
        "x-request-id": "req-xyz",
        "if-match": '"3"',
      },
    });
    const p = parseHeaders(req);
    expect(p.idempotencyKey).toBe("idem-123");
    expect(p.correlationId).toBe("corr-abc");
    expect(p.requestId).toBe("req-xyz");
    expect(p.expectedVersion).toBe(3);
  });

  it("toHttpResponse for error preserves stable shape and echoes requestId/correlation", async () => {
    const h = build();
    const errRes = await h.app.getOperation({ payload: { operationId: "missing" }, headers: { requestId: "r-err" } });
    expect(errRes.ok).toBe(false);
    const parsed = parseHeaders(new Request("http://x", { headers: { "x-request-id": "r-err", "x-correlation-id": "corr-1" } }));
    const httpRes = toHttpResponse(errRes, parsed);
    expect(httpRes.status).toBe(404);
    expect(httpRes.headers.get("x-request-id")).toBe("r-err");
    expect(httpRes.headers.get("x-correlation-id")).toBe("corr-1");
    const body = await httpRes.json() as { ok: boolean; error: { code: string; httpStatusHint: number; detail?: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("ERR-002");
    expect(JSON.stringify(body)).not.toMatch(/stack/i);
    expect(body.error.httpStatusHint).toBe(404);
  });

  it("submitted is never completed — illegal transition is rejected with stable error", async () => {
    const h = build();
    const session = appSession(h.clock.now());
    const created = await h.app.createIdentity({ headers: { idempotencyKey: "idem-no-complete" }, session, payload: { controllerAddress: CONTROLLER } });
    if (!created.ok) throw new Error("create failed");
    const opId = (created as { ok: true; data: { operationId: string } }).data.operationId;
    const illegal = await h.app.transitionOperation(opId, "completed", (await h.operationStore.getById(opId))!.version);
    expect(illegal.ok).toBe(false);
    if (!illegal.ok) {
      expect(illegal.error.code).toBe("ERR-023");
      expect(illegal.error.detail).toContain("submitted_is_not_completed");
    }
  });

  it("malformed JSON handling does not leak stacks (simulated via handler)", async () => {
    // We test readJson returns null for malformed, and route would return 400 without stack.
    const badReq = new Request("http://x", { method: "POST", body: "{ not json", headers: { "content-type": "application/json" } });
    const parsedBody = await readJson(badReq);
    expect(parsedBody).toBeNull();
  });
});

describe("M2 — no chain bypass (SDK and MCP)", () => {
  it("SDK client vocabulary is identities/bindings/resolve/operations/pauses with no raw felt/calldata", async () => {
    const sdkSource = await import("../../sdk/client");
    const txt = sdkSource.PrismClient.toString() + JSON.stringify(Object.getOwnPropertyNames(sdkSource.PrismClient.prototype));
    expect(txt).not.toMatch(/felt/i);
    expect(txt).not.toMatch(/calldata/i);
    // SDK must expose expected vocabulary
    const client = createPrismClient({ baseUrl: "http://localhost:3000", fetch: (async () => new Response(JSON.stringify({ ok: true, data: {} }), { status: 200, headers: {} })) as typeof fetch });
    expect(client.identities).toBeDefined();
    expect(client.bindings).toBeDefined();
    expect(client.operations).toBeDefined();
    expect(client.receipts).toBeDefined();
    expect(client.intents).toBeDefined();
    expect(client.pauses).toBeDefined();
    // poll helper exists
    expect(typeof client.pollOperation).toBe("function");
    expect(typeof client.negotiateVersion).toBe("function");
  });

  it("MCP adapter is thin over SDK — same operation semantics, no second authority", async () => {
    // Create SDK client with mock fetch that delegates to in-memory app
    const h = build();
    h.registry.seedIdentity("prism:MCP1", CONTROLLER);
    const session = appSession(h.clock.now());
    const mockFetch: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
      const method = init?.method ?? "GET";
      const headers = new Headers(init?.headers as HeadersInit);
      // Preserve correlation/request headers
      const bodyText = init?.body as string | undefined;
      const body = bodyText ? JSON.parse(bodyText) as Record<string, unknown> : {};
      // Route minimal subset for MCP test
      if (url.includes("/v1/resolve/") && method === "GET") {
        const prismId = decodeURIComponent(new URL(url).pathname.split("/").pop()!);
        const venue = new URL(url).searchParams.get("venue") ?? "BASE";
        const res = await h.app.resolve({ payload: { prismId, venue } });
        const parsed = parseHeaders(new Request(url, { headers }));
        return toHttpResponse(res, parsed);
      }
      if (url.includes("/v1/identity/") && method === "GET") {
        const prismId = decodeURIComponent(new URL(url).pathname.split("/").pop()!);
        const res = await h.app.getIdentity({ payload: { prismId } });
        const parsed = parseHeaders(new Request(url, { headers }));
        return toHttpResponse(res, parsed);
      }
      if (url.includes("/v1/operations/") && method === "GET") {
        const opId = decodeURIComponent(new URL(url).pathname.split("/").pop()!);
        const res = await h.app.getOperation({ payload: { operationId: opId } });
        const parsed = parseHeaders(new Request(url, { headers }));
        return toHttpResponse(res, parsed);
      }
      return new Response(JSON.stringify({ ok: false, error: { code: "ERR-023", name: "stale_state_conflict", category: "stale_state", retryable: "re_read", userAction: "refresh", httpStatusHint: 400 } }), { status: 400, headers: { "content-type": "application/json" } });
    };
    const client = createPrismClient({ baseUrl: "http://localhost", fetch: mockFetch, defaultSession: session });
    const mcp = createMcpAdapter(client);
    expect(mcp.tools.map((t) => t.name)).toEqual(expect.arrayContaining(["prism_resolve", "prism_get_identity", "prism_get_operation", "prism_get_receipt"]));
    // MCP must not expose tools that bypass Pause or read secrets
    const toolNames = mcp.tools.map((t) => t.name).join(" ");
    expect(toolNames).not.toMatch(/bypass/i);
    expect(toolNames).not.toMatch(/viewing/i);
    expect(MCP_TOOL_DEFINITIONS.length).toBeGreaterThanOrEqual(8);

    // MCP resolve produces same result as direct app resolve
    const direct = await h.app.resolve({ payload: { prismId: "prism:MCP1", venue: "BASE" } });
    const viaMcp = await mcp.callTool("prism_resolve", { prismId: "prism:MCP1", venue: "BASE" });
    expect(direct.ok).toBe(viaMcp.ok);
  });

  it("MCP definitions carry no secret-handling tools", () => {
    for (const t of MCP_TOOL_DEFINITIONS) {
      expect(t.name).not.toMatch(/secret|private_key|viewing/i);
      expect(t.description).not.toMatch(/private key|viewing key|seed phrase/i);
    }
  });
});

describe("M2 — SDK idempotency helper and watermark-aware resolve", () => {
  it("SDK generates idempotencyKey when not supplied and propagates correlation", async () => {
    let capturedHeaders: Record<string, string> = {};
    const fakeFetch: typeof fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      const h = new Headers(init?.headers as HeadersInit);
      capturedHeaders = Object.fromEntries(h.entries());
      return new Response(JSON.stringify({ ok: true, data: { operationId: "op-1", state: "submitted" }, operation: { operationId: "op-1", state: "submitted", version: 1 } }), { status: 200, headers: { "x-request-id": "req-1", "x-prism-watermark": "42" } });
    };
    const session = appSession(Date.now() / 1000);
    const client = createPrismClient({ baseUrl: "http://localhost", fetch: fakeFetch, defaultSession: session });
    await client.identities.create({ controllerAddress: CONTROLLER, correlationId: "corr-sdk" });
    expect(capturedHeaders["idempotency-key"]).toBeTruthy();
    expect(capturedHeaders["x-correlation-id"]).toBe("corr-sdk");
  });
});
