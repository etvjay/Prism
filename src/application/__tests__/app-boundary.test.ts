// Contract/API tests for the typed application boundary.
// Covers success, altered proof, expiry, wrong controller, replay,
// stale version, idempotency conflict, dependency failure, retry.
// Transport-neutral: exercises PrismApplicationService directly via typed
// requests (no HTTP). Verifies stable ERR mappings, idempotency, CAS,
// operation_id-before-submit, submitted!=completed, and auth separation.

import { describe, it, expect, beforeEach } from "vitest";
import { PrismChallengeService } from "../../features/prism-identity/application/challenge-service";
import { InMemoryOwnershipProofStore } from "../../features/prism-identity/adapters/memory-ownership-proof-store";
import { fixedClock } from "../../features/prism-identity/adapters/clock";
import { viemChallengeCrypto } from "../../features/prism-identity/adapters/viem-crypto";
import { LocalErc1271SemanticsChecker, makeEoaSigner, presentedFromIssued, mutatePresented } from "../../features/prism-identity/testing/fixtures";
import { InMemoryOperationStore } from "../../features/prism-operations/adapters/memory-operation-store";
import { PrismApplicationService } from "../prism-application";
import { InMemoryRegistry } from "../adapters/in-memory-registry";
import type { Hex } from "../../features/prism-operations/domain/operation";
import type { AppSession } from "../auth";

const DOMAIN = "prism.example";
const BASE_ACCOUNT = makeEoaSigner().address.toLowerCase();
const CONTROLLER = "0x1111111111111111111111111111111111111111";
const OTHER_CONTROLLER = "0x2222222222222222222222222222222222222222";
const PRISM_ID = "prism:P7F21";
const VENUE = "BASE";
const TX_HASH: Hex = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function appSession(now: number): AppSession {
  return { sessionId: "sess_12345678", userId: "user-1", issuedAt: now - 10, expiresAt: now + 600 };
}

function idGen() {
  let n = 1;
  return { generateOperationId: () => `op-${n++}-${Date.now()}` };
}

interface Harness {
  app: PrismApplicationService;
  operationStore: InMemoryOperationStore;
  registry: InMemoryRegistry;
  challengeService: PrismChallengeService;
  clock: ReturnType<typeof fixedClock>;
  signer: ReturnType<typeof makeEoaSigner>;
}

function buildHarness(start = 1_789_000_000): Harness {
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
  const app = new PrismApplicationService({
    challengeService,
    operationStore,
    registry,
    submitPort: registry,
    clock,
    idGenerator: idGen(),
  });
  const signer = makeEoaSigner();
  return { app, operationStore, registry, challengeService, clock, signer };
}

// Helper to issue + verify a challenge via the app boundary
async function issueAndVerify(h: Harness, executionAccount: string) {
  const now = h.clock.now();
  const session = appSession(now);
  const issued = await h.app.issueChallenge({
    headers: { requestId: "req-issue-1", idempotencyKey: "idem-issue-1" },
    session,
    payload: { prismId: PRISM_ID, venue: VENUE, executionAccount },
  });
  expect(issued.ok).toBe(true);
  if (!issued.ok) throw new Error("issue failed");
  const view = issued.data;
  // Sign via an ephemeral owner matching executionAccount
  // For simplicity, reuse signer if its address matches, else create signer that owns that account
  // In tests we generate a signer whose address equals executionAccount
  // So we need to find signer for that account: we will generate one fresh and re-issue with its address
  return view;
}

describe("App boundary — application command/query contract", () => {
  // -------------------------------------------------------------------------
  // 1. Success — full decisive tail via operation boundary
  // -------------------------------------------------------------------------
  it("success: issue → verify → bind → resolve → revoke → resolve shows NO_ACTIVE_DESTINATION, P persists", async () => {
    const h = buildHarness();
    const owner = makeEoaSigner();
    const executionAccount = owner.address.toLowerCase();
    const session = appSession(h.clock.now());

    // issue
    const issued = await h.app.issueChallenge({ headers: { requestId: "r1" }, session, payload: { prismId: PRISM_ID, venue: VENUE, executionAccount } });
    expect(issued.ok).toBe(true);
    if (!issued.ok) throw new Error("issue failed");
    const sig = await owner.signMessage({ message: issued.data.messageToSign });
    // verify
    const verified = await h.app.submitProof({
      headers: { requestId: "r2" },
      session,
      payload: { challengeId: issued.data.challengeId, presented: presentedFromIssued(issued.data as any), signature: sig as Hex },
    });
    expect(verified.ok).toBe(true);
    if (!verified.ok) throw new Error("verify failed");
    expect(verified.data.signatureClass).toBe("EOA");

    // bind — operation_id persisted before chain submission, state = submitted, not completed
    const bindRes = await h.app.bind({
      headers: { requestId: "r3", idempotencyKey: "idem-bind-1", correlationId: "corr-1" },
      session,
      payload: { prismId: PRISM_ID, venue: VENUE, executionAccount, proofDigest: verified.data.digest, controllerAddress: CONTROLLER },
    });
    expect(bindRes.ok).toBe(true);
    if (!bindRes.ok) throw new Error("bind failed");
    expect(bindRes.data.operationId).toMatch(/^op-/);
    expect(bindRes.data.state).toBe("submitted");
    expect(bindRes.operation?.state).toBe("submitted");
    // Invariant: submitted != completed
    expect(bindRes.data.state).not.toBe("completed");
    const opStored = await h.operationStore.getById(bindRes.data.operationId);
    expect(opStored?.state).toBe("submitted");
    expect(opStored?.txHash).toMatch(/^0x/);

    // Simulate reconciliation making the binding canonical (without faking receipts)
    h.registry.applyBindForTest(PRISM_ID, VENUE, executionAccount, verified.data.digest);

    // resolve returns active
    const resolveActive = await h.app.resolve({ payload: { prismId: PRISM_ID, venue: VENUE } });
    expect(resolveActive.ok).toBe(true);
    if (!resolveActive.ok) throw new Error("resolve failed");
    expect(resolveActive.data.executionAccount?.toLowerCase()).toBe(executionAccount);

    // revoke — operation_id before submission
    const revokeRes = await h.app.revoke({
      headers: { requestId: "r4", idempotencyKey: "idem-revoke-1" },
      session,
      payload: { prismId: PRISM_ID, venue: VENUE, executionAccount, controllerAddress: CONTROLLER },
    });
    expect(revokeRes.ok).toBe(true);
    if (!revokeRes.ok) throw new Error("revoke failed");
    expect(revokeRes.data.state).toBe("submitted");

    h.registry.applyRevokeForTest(PRISM_ID, VENUE, executionAccount);

    // resolve after revoke => NO_ACTIVE_DESTINATION, identity persists
    const resolveAfter = await h.app.resolve({ payload: { prismId: PRISM_ID, venue: VENUE } });
    expect(resolveAfter.ok).toBe(true);
    if (!resolveAfter.ok) throw new Error("resolve after failed");
    expect(resolveAfter.data.executionAccount).toBeNull();

    const idRes = await h.app.getIdentity({ payload: { prismId: PRISM_ID } });
    expect(idRes.ok).toBe(true);
    if (!idRes.ok) throw new Error("getIdentity failed");
    expect(idRes.data.exists).toBe(true);
    expect(idRes.data.controller?.toLowerCase()).toBe(CONTROLLER);
  });

  // -------------------------------------------------------------------------
  // 2. Altered proof — ERR-012
  // -------------------------------------------------------------------------
  it("altered proof: mutated presented field fails ERR-012", async () => {
    const h = buildHarness();
    const owner = makeEoaSigner();
    const executionAccount = owner.address.toLowerCase();
    const session = appSession(h.clock.now());
    const issued = await h.app.issueChallenge({ headers: { requestId: "r1" }, session, payload: { prismId: PRISM_ID, venue: VENUE, executionAccount } });
    expect(issued.ok).toBe(true);
    if (!issued.ok) throw new Error("issue failed");
    const sig = await owner.signMessage({ message: issued.data.messageToSign });
    const altered = mutatePresented(presentedFromIssued(issued.data as any), { prismId: "prism:OTHER" });
    const res = await h.app.submitProof({
      headers: { requestId: "r2" },
      session,
      payload: { challengeId: issued.data.challengeId, presented: altered as unknown as { domain: string; venue: string; executionAccount: string; prismId: string; chainId: number; schemaVersion: number; nonce: Hex; expiresAt: number }, signature: sig as Hex },
    });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("should have failed");
    expect(res.error.code).toBe("ERR-012");
    expect(res.error.httpStatusHint).toBe(400);
  });

  // -------------------------------------------------------------------------
  // 3. Expiry — ERR-013
  // -------------------------------------------------------------------------
  it("expiry: proof submitted after TTL fails ERR-013", async () => {
    const h = buildHarness();
    const owner = makeEoaSigner();
    const executionAccount = owner.address.toLowerCase();
    const session = appSession(h.clock.now());
    const issued = await h.app.issueChallenge({ headers: { requestId: "r1" }, session, payload: { prismId: PRISM_ID, venue: VENUE, executionAccount, ttlSeconds: 30 } });
    expect(issued.ok).toBe(true);
    if (!issued.ok) throw new Error("issue failed");
    const sig = await owner.signMessage({ message: issued.data.messageToSign });
    h.clock.advance(31);
    const freshSession = appSession(h.clock.now());
    const res = await h.app.submitProof({
      headers: { requestId: "r2" },
      session: freshSession,
      payload: { challengeId: issued.data.challengeId, presented: presentedFromIssued(issued.data as any), signature: sig as Hex },
    });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("should be expired");
    expect(res.error.code).toBe("ERR-013");
    expect(res.error.httpStatusHint).toBe(410);
  });

  // -------------------------------------------------------------------------
  // 4. Wrong controller — ERR-004 (Starknet authority ≠ session)
  // -------------------------------------------------------------------------
  it("wrong controller: bind with non-controller Starknet address fails ERR-004", async () => {
    const h = buildHarness();
    const owner = makeEoaSigner();
    const executionAccount = owner.address.toLowerCase();
    const session = appSession(h.clock.now());
    const issued = await h.app.issueChallenge({ headers: { requestId: "r1" }, session, payload: { prismId: PRISM_ID, venue: VENUE, executionAccount } });
    expect(issued.ok).toBe(true);
    if (!issued.ok) throw new Error("issue failed");
    const sig = await owner.signMessage({ message: issued.data.messageToSign });
    const verified = await h.app.submitProof({
      headers: { requestId: "r2" },
      session,
      payload: { challengeId: issued.data.challengeId, presented: presentedFromIssued(issued.data as any), signature: sig as Hex },
    });
    expect(verified.ok).toBe(true);
    if (!verified.ok) throw new Error("verify failed");
    const bindRes = await h.app.bind({
      headers: { requestId: "r3", idempotencyKey: "idem-bind-wrong-ctrl" },
      session,
      payload: { prismId: PRISM_ID, venue: VENUE, executionAccount, proofDigest: verified.data.digest, controllerAddress: OTHER_CONTROLLER },
    });
    expect(bindRes.ok).toBe(false);
    if (bindRes.ok) throw new Error("should be not_controller");
    expect(bindRes.error.code).toBe("ERR-004");
    expect(bindRes.error.httpStatusHint).toBe(403);
  });

  // -------------------------------------------------------------------------
  // 5. Replay — ERR-006 at proof layer, ERR-007 at bind via digest single-use
  // -------------------------------------------------------------------------
  it("replay: second submitProof with same nonce fails ERR-006", async () => {
    const h = buildHarness();
    const owner = makeEoaSigner();
    const executionAccount = owner.address.toLowerCase();
    const session = appSession(h.clock.now());
    const issued = await h.app.issueChallenge({ headers: { requestId: "r1" }, session, payload: { prismId: PRISM_ID, venue: VENUE, executionAccount } });
    expect(issued.ok).toBe(true);
    if (!issued.ok) throw new Error("issue failed");
    const sig = await owner.signMessage({ message: issued.data.messageToSign });
    const first = await h.app.submitProof({
      headers: { requestId: "r2" },
      session,
      payload: { challengeId: issued.data.challengeId, presented: presentedFromIssued(issued.data as any), signature: sig as Hex },
    });
    expect(first.ok).toBe(true);
    const second = await h.app.submitProof({
      headers: { requestId: "r3" },
      session,
      payload: { challengeId: issued.data.challengeId, presented: presentedFromIssued(issued.data as any), signature: sig as Hex },
    });
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error("replay should fail");
    expect(second.error.code).toBe("ERR-006");
    expect(second.error.httpStatusHint).toBe(409);
  });

  it("replay via digest: second bind with same digest fails ERR-007", async () => {
    const h = buildHarness();
    const owner = makeEoaSigner();
    const executionAccount = owner.address.toLowerCase();
    const session = appSession(h.clock.now());
    const issued = await h.app.issueChallenge({ headers: { requestId: "r1" }, session, payload: { prismId: PRISM_ID, venue: VENUE, executionAccount } });
    expect(issued.ok).toBe(true);
    if (!issued.ok) throw new Error("issue failed");
    const sig = await owner.signMessage({ message: issued.data.messageToSign });
    const verified = await h.app.submitProof({
      headers: { requestId: "r2" },
      session,
      payload: { challengeId: issued.data.challengeId, presented: presentedFromIssued(issued.data as any), signature: sig as Hex },
    });
    expect(verified.ok).toBe(true);
    if (!verified.ok) throw new Error("verify failed");
    const firstBind = await h.app.bind({
      headers: { requestId: "r3", idempotencyKey: "idem-bind-first" },
      session,
      payload: { prismId: PRISM_ID, venue: VENUE, executionAccount, proofDigest: verified.data.digest, controllerAddress: CONTROLLER },
    });
    expect(firstBind.ok).toBe(true);
    // Make digest appear consumed onchain
    h.registry.applyBindForTest(PRISM_ID, VENUE, executionAccount, verified.data.digest);
    const secondBind = await h.app.bind({
      headers: { requestId: "r4", idempotencyKey: "idem-bind-second" },
      session,
      payload: { prismId: PRISM_ID, venue: VENUE, executionAccount, proofDigest: verified.data.digest, controllerAddress: CONTROLLER },
    });
    expect(secondBind.ok).toBe(false);
    if (secondBind.ok) throw new Error("digest replay should fail");
    expect(secondBind.error.code).toBe("ERR-007");
  });

  // -------------------------------------------------------------------------
  // 6. Stale version — ERR-023 stale_version via CAS
  // -------------------------------------------------------------------------
  it("stale version: transition with wrong expectedVersion fails ERR-023", async () => {
    const h = buildHarness();
    const session = appSession(h.clock.now());
    // Create identity operation via app boundary
    const created = await h.app.createIdentity({
      headers: { requestId: "r1", idempotencyKey: "idem-create-stale" },
      session,
      payload: { controllerAddress: CONTROLLER },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("create failed");
    const opId = created.data.operationId;
    const op = await h.operationStore.getById(opId);
    expect(op?.version).toBeGreaterThanOrEqual(2); // after awaiting+ready+submitted => version 3
    // Attempt stale transition: supply expectedVersion 0
    const stale = await h.app.transitionOperation(opId, "processing", 0, { txHash: TX_HASH });
    expect(stale.ok).toBe(false);
    if (stale.ok) throw new Error("stale should fail");
    expect(stale.error.code).toBe("ERR-023");
    expect(stale.error.detail).toContain("stale_version");
  });

  // -------------------------------------------------------------------------
  // 7. Idempotency conflict — ERR-023 idempotency_key_conflict
  // -------------------------------------------------------------------------
  it("idempotency conflict: same key different fingerprint fails ERR-023", async () => {
    const h = buildHarness();
    const executionAccount = makeEoaSigner().address.toLowerCase();
    const executionAccount2 = makeEoaSigner().address.toLowerCase();
    const session = appSession(h.clock.now());
    // Need a verified proof for first bind
    const owner1 = makeEoaSigner();
    const acct1 = owner1.address.toLowerCase();
    const issued1 = await h.app.issueChallenge({ headers: { requestId: "r1" }, session, payload: { prismId: PRISM_ID, venue: VENUE, executionAccount: acct1 } });
    expect(issued1.ok).toBe(true);
    if (!issued1.ok) throw new Error("issue1 failed");
    const sig1 = await owner1.signMessage({ message: issued1.data.messageToSign });
    const verified1 = await h.app.submitProof({ headers: { requestId: "r2" }, session, payload: { challengeId: issued1.data.challengeId, presented: presentedFromIssued(issued1.data as any), signature: sig1 as Hex } });
    expect(verified1.ok).toBe(true);
    if (!verified1.ok) throw new Error("verify1 failed");

    const first = await h.app.bind({
      headers: { requestId: "r3", idempotencyKey: "idem-same-key" },
      session,
      payload: { prismId: PRISM_ID, venue: VENUE, executionAccount: acct1, proofDigest: verified1.data.digest, controllerAddress: CONTROLLER },
    });
    expect(first.ok).toBe(true);

    // Second bind with same idempotencyKey but different executionAccount (different fingerprint)
    const owner2 = makeEoaSigner();
    const acct2 = owner2.address.toLowerCase();
    const issued2 = await h.app.issueChallenge({ headers: { requestId: "r4" }, session, payload: { prismId: PRISM_ID, venue: VENUE, executionAccount: acct2 } });
    expect(issued2.ok).toBe(true);
    if (!issued2.ok) throw new Error("issue2 failed");
    const sig2 = await owner2.signMessage({ message: issued2.data.messageToSign });
    const verified2 = await h.app.submitProof({ headers: { requestId: "r5" }, session, payload: { challengeId: issued2.data.challengeId, presented: presentedFromIssued(issued2.data as any), signature: sig2 as Hex } });
    expect(verified2.ok).toBe(true);
    if (!verified2.ok) throw new Error("verify2 failed");

    const conflict = await h.app.bind({
      headers: { requestId: "r6", idempotencyKey: "idem-same-key" },
      session,
      payload: { prismId: PRISM_ID, venue: VENUE, executionAccount: acct2, proofDigest: verified2.data.digest, controllerAddress: CONTROLLER },
    });
    expect(conflict.ok).toBe(false);
    if (conflict.ok) throw new Error("should be conflict");
    expect(conflict.error.code).toBe("ERR-023");
    expect(conflict.error.detail).toContain("idempotency_key_conflict");
    // Same key same fingerprint is benign — replays return original operation
    const replayBenign = await h.app.bind({
      headers: { requestId: "r7", idempotencyKey: "idem-same-key" },
      session,
      payload: { prismId: PRISM_ID, venue: VENUE, executionAccount: acct1, proofDigest: verified1.data.digest, controllerAddress: CONTROLLER },
    });
    expect(replayBenign.ok).toBe(true);
    if (!replayBenign.ok) throw new Error("benign replay failed");
    expect(replayBenign.data.operationId).toBe((first as { ok: true; data: { operationId: string } }).data.operationId);
  });

  // -------------------------------------------------------------------------
  // 8. Dependency failure — ERR-021, fail-closed, operation persists without tx completion
  // -------------------------------------------------------------------------
  it("dependency failure: submitPort throws maps to ERR-021 and leaves operation without completed state", async () => {
    const h = buildHarness();
    const session = appSession(h.clock.now());
    // Inject dependency failure
    const { AppError } = await import("../errors");
    h.registry.injectDependencyFailure(new AppError("ERR-021", "rpc_unavailable: Starknet RPC down" as unknown as string) as unknown as Error);
    // Actually inject plain error that submitPort will surface; app layer maps to ERR-021
    // Use generic error with code
    const depErr = new Error("rpc_unavailable");
    (depErr as unknown as { code?: string }).code = "ERR-021";
    h.registry.injectDependencyFailure(depErr);

    const res = await h.app.createIdentity({
      headers: { requestId: "r1", idempotencyKey: "idem-dep-fail" },
      session,
      payload: { controllerAddress: CONTROLLER },
    });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("should be dependency failure");
    expect(res.error.code).toBe("ERR-021");
    expect(res.error.httpStatusHint).toBe(503);
    // Operation must exist and NOT be completed — submitted != completed
    const ops = await h.operationStore.listNonTerminal(10);
    expect(ops.length).toBe(1);
    expect(ops[0].state).toBe("failed_retryable");
    expect(ops[0].state).not.toBe("completed");
    expect(ops[0].state).not.toBe("submitted"); // moved to retryable branch
  });

  // -------------------------------------------------------------------------
  // 9. Retry — failed_retryable can be retried to submitted
  // -------------------------------------------------------------------------
  it("retry: failed_retryable operation can be retried to submitted (poll-only, never inferred as completed)", async () => {
    const h = buildHarness();
    const session = appSession(h.clock.now());
    // Force dependency failure first
    const depErr = new Error("rpc_unavailable");
    (depErr as unknown as { code?: string }).code = "ERR-021";
    h.registry.injectDependencyFailure(depErr);
    const failed = await h.app.createIdentity({
      headers: { requestId: "r1", idempotencyKey: "idem-retry-flow" },
      session,
      payload: { controllerAddress: CONTROLLER },
    });
    expect(failed.ok).toBe(false);
    const ops = await h.operationStore.listNonTerminal(10);
    const opId = ops[0].id;
    expect(ops[0].state).toBe("failed_retryable");

    // Retry via application helper
    const retried = await h.app.retryOperation(opId, h.clock.now() + 5);
    expect(retried.ok).toBe(true);
    if (!retried.ok) throw new Error("retry failed");
    expect(retried.data.state).toBe("submitted");
    // Still not completed
    expect(retried.data.state).not.toBe("completed");
    const after = await h.operationStore.getById(opId);
    expect(after?.state).toBe("submitted");
    expect(after?.txHash).toMatch(/^0x/);
  });

  // -------------------------------------------------------------------------
  // Auth separation — app session ≠ execution authority
  // -------------------------------------------------------------------------
  it("auth separation: expired app session fails even with valid execution authority (ERR-013)", async () => {
    const h = buildHarness();
    const owner = makeEoaSigner();
    const executionAccount = owner.address.toLowerCase();
    const expiredSession: AppSession = { sessionId: "sess_12345678", userId: "user-1", issuedAt: 1_789_000_000 - 100, expiresAt: 1_789_000_000 - 1 };
    const res = await h.app.issueChallenge({ headers: { requestId: "r1" }, session: expiredSession, payload: { prismId: PRISM_ID, venue: VENUE, executionAccount } });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("expired session should fail");
    expect(res.error.code).toBe("ERR-013");
  });

  it("submitted is never completed without reconciliation (INV-SYS-005)", async () => {
    const h = buildHarness();
    const session = appSession(h.clock.now());
    const created = await h.app.createIdentity({ headers: { requestId: "r1", idempotencyKey: "idem-inv-005" }, session, payload: { controllerAddress: CONTROLLER } });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("create failed");
    const opId = created.data.operationId;
    // Attempt illegal skip: submitted -> completed directly must be rejected
    const illegal = await h.app.transitionOperation(opId, "completed", (await h.operationStore.getById(opId))!.version);
    expect(illegal.ok).toBe(false);
    if (illegal.ok) throw new Error("illegal skip should fail");
    expect(illegal.error.code).toBe("ERR-023");
    expect(illegal.error.detail).toContain("submitted_is_not_completed");
  });
});
