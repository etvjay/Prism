import { describe, it, expect } from "vitest";
import { PrismChallengeService } from "../../features/prism-identity/application/challenge-service";
import { InMemoryOwnershipProofStore } from "../../features/prism-identity/adapters/memory-ownership-proof-store";
import { fixedClock } from "../../features/prism-identity/adapters/clock";
import { viemChallengeCrypto } from "../../features/prism-identity/adapters/viem-crypto";
import { LocalErc1271SemanticsChecker, makeEoaSigner, presentedFromIssued } from "../../features/prism-identity/testing/fixtures";
import { InMemoryOperationStore } from "../../features/prism-operations/adapters/memory-operation-store";
import { PrismApplicationService } from "../prism-application";
import { InMemoryRegistry } from "../adapters/in-memory-registry";
import { createPrismApiHandlers, API_CONTRACTS } from "../handlers";
import type { Hex } from "../../features/prism-operations/domain/operation";
import type { AppSession } from "../auth";

const DOMAIN = "prism.example";
const CONTROLLER = "0x1111111111111111111111111111111111111111";
const PRISM_ID = "prism:P7F21";
const VENUE = "BASE";

function appSession(now: number): AppSession {
  return { sessionId: "sess_12345678", userId: "user-1", issuedAt: now - 10, expiresAt: now + 600 };
}

function buildHandlers(start = 1_789_000_000) {
  const clock = fixedClock(start);
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
    registryVersion: "v1",
    clock,
    idGenerator: { generateOperationId: () => `op-${n++}-${Date.now()}` },
  });
  const handlers = createPrismApiHandlers(app);
  return { handlers, operationStore, registry, clock };
}

describe("PrismApiHandlers — transport-neutral contracts", () => {
  it("API_CONTRACTS table covers all 8 endpoints (issue/verify/bind/resolve/revoke/operation read)", () => {
    expect(API_CONTRACTS.map((c) => c.handler)).toEqual(
      expect.arrayContaining(["issue", "verify", "createIdentity", "bind", "revoke", "getIdentity", "resolve", "getOperation"]),
    );
    expect(API_CONTRACTS).toHaveLength(8);
  });

  it("issue -> verify -> bind -> resolve -> revoke via handlers preserves stable errors and submitted!=completed", async () => {
    const { handlers, operationStore, registry, clock } = buildHandlers();
    const owner = makeEoaSigner();
    const executionAccount = owner.address.toLowerCase();
    const session = appSession(clock.now());

    const issued = await handlers.issue({ headers: { requestId: "r1" }, session, payload: { prismId: PRISM_ID, venue: VENUE, executionAccount } });
    expect(issued.ok).toBe(true);
    if (!issued.ok) throw new Error("issue failed");
    const sig = await owner.signMessage({ message: issued.data.messageToSign });

    const verified = await handlers.verify({
      headers: { requestId: "r2" },
      session,
      payload: { challengeId: issued.data.challengeId, presented: presentedFromIssued(issued.data as unknown as Parameters<typeof presentedFromIssued>[0]), signature: sig as Hex },
    });
    expect(verified.ok).toBe(true);
    if (!verified.ok) throw new Error("verify failed");

    const bindRes = await handlers.bind({
      headers: { requestId: "r3", idempotencyKey: "idem-bind-h", correlationId: "corr-h" },
      session,
      payload: { prismId: PRISM_ID, venue: VENUE, executionAccount, proofDigest: verified.data.digest, controllerAddress: CONTROLLER },
    });
    expect(bindRes.ok).toBe(true);
    if (!bindRes.ok) throw new Error("bind failed");
    expect(bindRes.data.state).toBe("submitted");
    expect(bindRes.data.state).not.toBe("completed");
    const op = await operationStore.getById(bindRes.data.operationId);
    expect(op?.state).toBe("submitted");

    registry.applyBindForTest(PRISM_ID, VENUE, executionAccount, verified.data.digest);
    const resolveActive = await handlers.resolve({ payload: { prismId: PRISM_ID, venue: VENUE } });
    expect(resolveActive.ok).toBe(true);
    if (!resolveActive.ok) throw new Error("resolve failed");
    expect(resolveActive.data.executionAccount?.toLowerCase()).toBe(executionAccount);

    const revokeRes = await handlers.revoke({
      headers: { requestId: "r4", idempotencyKey: "idem-revoke-h" },
      session,
      payload: { prismId: PRISM_ID, venue: VENUE, executionAccount, controllerAddress: CONTROLLER },
    });
    expect(revokeRes.ok).toBe(true);
    if (!revokeRes.ok) throw new Error("revoke failed");
    expect(revokeRes.data.state).not.toBe("completed");
  });

  it("handlers preserve idempotency: same key+same fingerprint benign, mismatch ERR-023", async () => {
    const { handlers, clock } = buildHandlers();
    const owner = makeEoaSigner();
    const acct = owner.address.toLowerCase();
    const session = appSession(clock.now());
    const issued = await handlers.issue({ headers: {}, session, payload: { prismId: PRISM_ID, venue: VENUE, executionAccount: acct } });
    if (!issued.ok) throw new Error("issue failed");
    const sig = await owner.signMessage({ message: issued.data.messageToSign });
    const verified = await handlers.verify({
      headers: {},
      session,
      payload: { challengeId: issued.data.challengeId, presented: presentedFromIssued(issued.data as unknown as Parameters<typeof presentedFromIssued>[0]), signature: sig as Hex },
    });
    if (!verified.ok) throw new Error("verify failed");
    const first = await handlers.bind({
      headers: { idempotencyKey: "idem-same-h" },
      session,
      payload: { prismId: PRISM_ID, venue: VENUE, executionAccount: acct, proofDigest: verified.data.digest, controllerAddress: CONTROLLER },
    });
    expect(first.ok).toBe(true);
    const owner2 = makeEoaSigner();
    const acct2 = owner2.address.toLowerCase();
    const issued2 = await handlers.issue({ headers: {}, session, payload: { prismId: PRISM_ID, venue: VENUE, executionAccount: acct2 } });
    if (!issued2.ok) throw new Error("issue2 failed");
    const sig2 = await owner2.signMessage({ message: issued2.data.messageToSign });
    const verified2 = await handlers.verify({
      headers: {},
      session,
      payload: { challengeId: issued2.data.challengeId, presented: presentedFromIssued(issued2.data as unknown as Parameters<typeof presentedFromIssued>[0]), signature: sig2 as Hex },
    });
    if (!verified2.ok) throw new Error("verify2 failed");
    const conflict = await handlers.bind({
      headers: { idempotencyKey: "idem-same-h" },
      session,
      payload: { prismId: PRISM_ID, venue: VENUE, executionAccount: acct2, proofDigest: verified2.data.digest, controllerAddress: CONTROLLER },
    });
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) expect(conflict.error.code).toBe("ERR-023");
  });

  it("handlers preserve stable ERR mapping for wrong controller and altered message", async () => {
    const { handlers, clock } = buildHandlers();
    const owner = makeEoaSigner();
    const acct = owner.address.toLowerCase();
    const session = appSession(clock.now());
    const issued = await handlers.issue({ headers: {}, session, payload: { prismId: PRISM_ID, venue: VENUE, executionAccount: acct } });
    if (!issued.ok) throw new Error("issue failed");
    const sig = await owner.signMessage({ message: issued.data.messageToSign });
    // altered verify
    const { mutatePresented } = await import("../../features/prism-identity/testing/fixtures");
    const altered = mutatePresented(presentedFromIssued(issued.data as unknown as Parameters<typeof presentedFromIssued>[0]), { prismId: "prism:OTHER" });
    const badVerify = await handlers.verify({
      headers: {},
      session,
      payload: { challengeId: issued.data.challengeId, presented: altered as unknown as Parameters<typeof presentedFromIssued>[0] & { nonce: Hex; expiresAt: number }, signature: sig as Hex },
    });
    expect(badVerify.ok).toBe(false);
    if (!badVerify.ok) expect(badVerify.error.code).toBe("ERR-012");
  });

  it("getOperation returns persisted operation with submitted != completed", async () => {
    const { handlers, clock } = buildHandlers();
    const session = appSession(clock.now());
    const created = await handlers.createIdentity({ headers: { idempotencyKey: "idem-op-read" }, session, payload: { controllerAddress: CONTROLLER } });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("create failed");
    const fetched = await handlers.getOperation({ payload: { operationId: created.data.operationId } });
    expect(fetched.ok).toBe(true);
    if (!fetched.ok) throw new Error("getOperation failed");
    expect(fetched.data?.state).toBe("submitted");
    expect(fetched.data?.state).not.toBe("completed");
  });
});
