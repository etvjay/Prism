import { describe, it, expect } from "vitest";
import { PrismClient } from "../../../sdk/client";
import { createIsolatedFactory } from "../../../application/factory";
import { parseHeaders } from "../../../application/http-helpers";
import { testPauseAuthorityResolver } from "./test-authority";

function headersOf(obj: { headers: Headers }): string | null { return null; }

describe("P6 transport/API convergence + SDK hash vocabulary", () => {
  it("REST Pause routes use rigorous PauseService and expose stable hash/CAS/error semantics", async () => {
    const factory = createIsolatedFactory(1_800_000_000, { pauseAuthorityResolver: testPauseAuthorityResolver });
    // Create intent via service (simulates POST /v1/intents with Idempotency-Key + Correlation)
    const intent = await factory.pauseService.createIntent({
      prismId: "prism:alice",
      purpose: "payment",
      venue: "base",
      asset: "0xdead",
      recipientAddress: "0xabc",
      amount: "100",
      idempotencyKey: "idem_p6_1",
      correlationId: "corr-p6-1",
      requestId: "req-111",
    });
    expect(intent.planHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(intent.correlationId).toBe("corr-p6-1");

    // Pause
    const pause = await factory.pauseService.pauseIntent(intent.intentId, { correlationId: "corr-p6-1", requestId: "req-222" });
    expect(pause.planHash).toBe(intent.planHash);
    expect(pause.version).toBe(0);
    expect(pause.correlationId).toBe("corr-p6-1");

    // Verify -> RELEASE_READY with planHash/approvalScopeHash stable
    const verified = await factory.pauseService.verifyPause(pause.pauseId);
    expect(verified.state).toBe("RELEASE_READY");
    expect(verified.planHash).toBe(intent.planHash);
    expect(verified.approvalScopeHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(verified.settlementOperationId).toBeNull();

    // Release with CAS (expectedVersion) -> RELEASED with settlementOperationId linked
    const version = verified.version;
    const released = await factory.pauseService.releasePause(verified.pauseId, version, { planHash: verified.planHash, approvalScopeHash: verified.approvalScopeHash!, settlementOperationId: "op_p6_1", correlationId: "corr-p6-1" });
    expect(released.state).toBe("RELEASED");
    expect(released.settlementOperationId).toBe("op_p6_1");
    expect(released.planHash).toBe(intent.planHash);
    expect(released.approvalScopeHash).toBe(verified.approvalScopeHash);
    expect(released.version).toBe(version + 1);

    // CAS header semantics via parseHeaders: If-Match / X-Expected-Version
    const parsed = parseHeaders({ headers: { "If-Match": `"${version}"`, "X-Request-Id": "req-444", "X-Correlation-Id": "corr-p6-1" } } as any);
    expect(parsed.expectedVersion).toBe(version);
    expect(parsed.requestId).toBe("req-444");
    expect(parsed.correlationId).toBe("corr-p6-1");

    // Stale CAS -> 409 ERR-111 via domain service directly
    await expect(factory.pauseService.releasePause(released.pauseId, version, { planHash: verified.planHash, settlementOperationId: "op_p6_2" })).rejects.toThrow();

    // Operation durable: submitted distinct, never completed
    const op = await factory.operationStore.getById("op_p6_1");
    expect(op).toBeDefined();
    expect(op!.state).toBe("submitted");
    expect(op!.state).not.toBe("completed");
    expect(op!.correlationId).toBe("corr-p6-1");
  });

  it("SDK vocabulary carries planHash/approvalScopeHash/settlementOperationId without raw calldata", async () => {
    const fs = await import("node:fs");
    const clientSrc = fs.readFileSync("src/sdk/client.ts", "utf8");
    const typesSrc = fs.readFileSync("src/sdk/types.ts", "utf8");
    // SDK types must carry hashes (allow comment mentioning the ban)
    expect(typesSrc.includes("planHash")).toBe(true);
    expect(typesSrc.includes("approvalScopeHash")).toBe(true);
    expect(typesSrc.includes("settlementOperationId")).toBe(true);
    expect(typesSrc.includes("correlationId")).toBe(true);
    // Ensure PauseData block does not declare a raw calldata/felt property (ignore comments)
    const pauseBlockRaw = typesSrc.slice(typesSrc.indexOf("export interface PauseData"));
    const pauseBlockEnd = pauseBlockRaw.indexOf("}");
    const pauseSnippet = pauseBlockRaw.slice(0, pauseBlockEnd).split("\n").filter(l=> !l.trim().startsWith("//")).join("\n");
    expect(pauseSnippet.toLowerCase().includes("calldata:")).toBe(false);
    expect(pauseSnippet.toLowerCase().includes("felt:")).toBe(false);
    // Client must not import starknet.js (no chain bypass)
    expect(clientSrc.includes("from \"starknet\"") || clientSrc.includes("from 'starknet'")).toBe(false);
    expect(clientSrc.includes("starknet.js")).toBe(false);
    const client = new PrismClient({ baseUrl: "http://localhost", defaultSession: { sessionId:"sess1", userId:"prism:alice", issuedAt: Math.floor(Date.now()/1000)-5, expiresAt: Math.floor(Date.now()/1000)+3600 } });
    expect((client as any).pauses).toBeDefined();
    // PauseData shape via service returns hashes, not calldata
    const factory = createIsolatedFactory(1_800_000_200, { pauseAuthorityResolver: testPauseAuthorityResolver });
    const intent = await factory.pauseService.createIntent({ prismId:"prism:bob", purpose:"payment", venue:"base", asset:"0xdead", recipientAddress:"0xabc", amount:"10", idempotencyKey:"idem_sdk", correlationId:"corr-sdk" });
    const pause = await factory.pauseService.pauseIntent(intent.intentId, { correlationId:"corr-sdk" });
    const verified = await factory.pauseService.verifyPause(pause.pauseId);
    // SDK-like PauseData mapping preserves hashes
    expect(verified.planHash).toMatch(/^0x/);
    expect(verified.approvalScopeHash).toMatch(/^0x/);
    // settlementOperationId initially null, after release non-null
    const released = await factory.pauseService.releasePause(verified.pauseId, verified.version, { settlementOperationId: "op_sdk_1", correlationId:"corr-sdk" });
    expect(released.settlementOperationId).toBe("op_sdk_1");
  });
});
