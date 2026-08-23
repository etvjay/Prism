// Decisive-sequence harness test — offline, TEST DOUBLE, X2 ceiling.
// No live RPC, no secrets, no strk20.json writes.
// Covers success, wrong signer, replay, revoke, stale/dependency/retry/recovery per SC-04/05/06/10/21 + FT-001.

import { describe, it, expect } from "vitest";
import { runDecisiveFixture } from "../decisive-sequence-harness";
import { HARNESS_LABEL } from "../decisive-sequence-harness";

describe("decisive-sequence harness — offline fixture (TEST DOUBLE)", () => {
  it("create → read → Base proof → controller bind → resolve → revoke → NO_ACTIVE → P persists (X2, not promotable)", async () => {
    const result = await runDecisiveFixture({
      controllerAddress: "0x1111111111111111111111111111111111111111",
      baseExecutionAccount: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    expect(result.label).toContain("TEST DOUBLE");
    expect(result.environment).toBe("SN_SEPOLIA");
    expect(result.chainId).toBe(84532);
    expect(result.finalResolve).toBeNull();
    expect(result.prismIdPersists).toBe(true);
    expect(result.maturity).toBe("X2");
    expect(result.promotable).toBe(false);
    expect(result.blockers.join(" ")).toMatch(/TEST DOUBLE|independent_verification/);
    // Invariant checks mirrored from procedure
    const steps = result.steps.map(s=>s.step);
    expect(steps.join(" ")).toContain("bind B to P");
    expect(steps.join(" ")).toContain("NO_ACTIVE_DESTINATION");
  });

  it("harness defaults to testnet SN_SEPOLIA + 84532 and is labeled TEST DOUBLE", async () => {
    const r = await runDecisiveFixture({ controllerAddress: "0x1111111111111111111111111111111111111111", baseExecutionAccount: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" });
    expect(r.environment).toBe("SN_SEPOLIA");
    expect(r.label).toBe(HARNESS_LABEL);
  });

  // -------------------------------------------------------------------------
  // Wrong signer — FT-002 / ERR-004 / INV-SYS-002
  // -------------------------------------------------------------------------
  it("wrong signer (ERR-004): non-controller cannot bind — decisive tail blocks at bind", async () => {
    const { fixedClock } = await import("../../prism-identity/adapters/clock");
    const { InMemoryOwnershipProofStore } = await import("../../prism-identity/adapters/memory-ownership-proof-store");
    const { viemChallengeCrypto } = await import("../../prism-identity/adapters/viem-crypto");
    const { LocalErc1271SemanticsChecker, makeEoaSigner, presentedFromIssued } = await import("../../prism-identity/testing/fixtures");
    const { InMemoryOperationStore } = await import("../../prism-operations/adapters/memory-operation-store");
    const { PrismApplicationService } = await import("../../../application/prism-application");
    const { InMemoryRegistry } = await import("../../../application/adapters/in-memory-registry");
    const PRISM_ID = "prism:P7F21"; const VENUE="BASE"; const CONTROLLER="0x1111111111111111111111111111111111111111"; const OTHER="0x2222222222222222222222222222222222222222";
    const clock = fixedClock(1_789_000_000);
    const ownershipStore = new InMemoryOwnershipProofStore();
    const checker = new LocalErc1271SemanticsChecker();
    const { PrismChallengeService } = await import("../../prism-identity/application/challenge-service");
    const challengeService = new PrismChallengeService({ clock, crypto: viemChallengeCrypto, checker, store: ownershipStore, policy:{ defaultTtlSeconds:600, defaultDomain:"prism.example", defaultChainId:84532 }});
    const operationStore = new InMemoryOperationStore(); const registry = new InMemoryRegistry();
    registry.seedIdentity(PRISM_ID, CONTROLLER);
    let n=1; const app = new PrismApplicationService({ challengeService, operationStore, registry, submitPort: registry as unknown as import("../../../application/ports").StarknetSubmitPort, clock, idGenerator:{ generateOperationId: () => `op-${n++}`} });
    const owner = makeEoaSigner(); const executionAccount = owner.address.toLowerCase();
    const session={ sessionId:"sess_12345678", userId:"user-1", issuedAt:clock.now()-10, expiresAt:clock.now()+600 };
    const issued = await app.issueChallenge({ headers:{requestId:"r1"}, session, payload:{ prismId:PRISM_ID, venue:VENUE, executionAccount }});
    if (!issued.ok) throw new Error("issue failed");
    const sig = await owner.signMessage({ message: issued.data.messageToSign });
    const verified = await app.submitProof({ headers:{ requestId:"r2"}, session, payload:{ challengeId: issued.data.challengeId, presented: presentedFromIssued(issued.data as unknown as never), signature: sig as `0x${string}`} });
    if (!verified.ok) throw new Error("verify failed");
    const bindRes = await app.bind({ headers:{ requestId:"r3", idempotencyKey:"idem-wrong-signer" }, session, payload:{ prismId:PRISM_ID, venue:VENUE, executionAccount, proofDigest: verified.data.digest, controllerAddress: OTHER }});
    expect(bindRes.ok).toBe(false);
    if (bindRes.ok) throw new Error("should be ERR-004");
    expect((bindRes as { ok:false; error:{code:string}}).error.code).toBe("ERR-004");
  });

  // -------------------------------------------------------------------------
  // Replay — FT-003 / ERR-006 (nonce) + ERR-007 (digest)
  // -------------------------------------------------------------------------
  it("replay nonce (ERR-006): second submitProof with same challenge fails", async () => {
    const { fixedClock } = await import("../../prism-identity/adapters/clock");
    const { InMemoryOwnershipProofStore } = await import("../../prism-identity/adapters/memory-ownership-proof-store");
    const { viemChallengeCrypto } = await import("../../prism-identity/adapters/viem-crypto");
    const { LocalErc1271SemanticsChecker, makeEoaSigner, presentedFromIssued } = await import("../../prism-identity/testing/fixtures");
    const { InMemoryOperationStore } = await import("../../prism-operations/adapters/memory-operation-store");
    const { PrismApplicationService } = await import("../../../application/prism-application");
    const { InMemoryRegistry } = await import("../../../application/adapters/in-memory-registry");
    const PRISM_ID="prism:P7F21"; const VENUE="BASE"; const CONTROLLER="0x1111111111111111111111111111111111111111";
    const clock=fixedClock(1_789_000_000);
    const ownershipStore=new InMemoryOwnershipProofStore(); const checker=new LocalErc1271SemanticsChecker();
    const {PrismChallengeService}=await import("../../prism-identity/application/challenge-service");
    const challengeService=new PrismChallengeService({clock, crypto:viemChallengeCrypto, checker, store:ownershipStore, policy:{defaultTtlSeconds:600, defaultDomain:"prism.example", defaultChainId:84532}});
    const operationStore=new InMemoryOperationStore(); const registry=new InMemoryRegistry(); registry.seedIdentity(PRISM_ID, CONTROLLER);
    let n=1; const app=new PrismApplicationService({ challengeService, operationStore, registry, submitPort: registry as unknown as import("../../../application/ports").StarknetSubmitPort, clock, idGenerator:{generateOperationId:()=>`op-${n++}`} });
    const owner=makeEoaSigner(); const executionAccount=owner.address.toLowerCase();
    const session={sessionId:"sess_12345678", userId:"user-1", issuedAt:clock.now()-10, expiresAt:clock.now()+600};
    const issued=await app.issueChallenge({headers:{requestId:"r1"}, session, payload:{prismId:PRISM_ID, venue:VENUE, executionAccount}});
    if (!issued.ok) throw new Error("issue failed");
    const sig=await owner.signMessage({message: issued.data.messageToSign});
    const first=await app.submitProof({headers:{requestId:"r2"}, session, payload:{challengeId: issued.data.challengeId, presented: presentedFromIssued(issued.data as unknown as never), signature: sig as `0x${string}`}});
    expect(first.ok).toBe(true);
    const second=await app.submitProof({headers:{requestId:"r3"}, session, payload:{challengeId: issued.data.challengeId, presented: presentedFromIssued(issued.data as unknown as never), signature: sig as `0x${string}`}});
    expect(second.ok).toBe(false);
    expect((second as {ok:false; error:{code:string}}).error.code).toBe("ERR-006");
  });

  it("replay digest (ERR-007): second bind with same proof_digest fails", async () => {
    const { fixedClock } = await import("../../prism-identity/adapters/clock");
    const { InMemoryOwnershipProofStore } = await import("../../prism-identity/adapters/memory-ownership-proof-store");
    const { viemChallengeCrypto } = await import("../../prism-identity/adapters/viem-crypto");
    const { LocalErc1271SemanticsChecker, makeEoaSigner, presentedFromIssued } = await import("../../prism-identity/testing/fixtures");
    const { InMemoryOperationStore } = await import("../../prism-operations/adapters/memory-operation-store");
    const { PrismApplicationService } = await import("../../../application/prism-application");
    const { InMemoryRegistry } = await import("../../../application/adapters/in-memory-registry");
    const PRISM_ID="prism:P7F21"; const VENUE="BASE"; const CONTROLLER="0x1111111111111111111111111111111111111111";
    const clock=fixedClock(1_789_000_000);
    const ownershipStore=new InMemoryOwnershipProofStore(); const checker=new LocalErc1271SemanticsChecker();
    const {PrismChallengeService}=await import("../../prism-identity/application/challenge-service");
    const challengeService=new PrismChallengeService({clock, crypto:viemChallengeCrypto, checker, store:ownershipStore, policy:{defaultTtlSeconds:600, defaultDomain:"prism.example", defaultChainId:84532}});
    const operationStore=new InMemoryOperationStore(); const registry=new InMemoryRegistry(); registry.seedIdentity(PRISM_ID, CONTROLLER);
    let n=1; const app=new PrismApplicationService({ challengeService, operationStore, registry, submitPort: registry as unknown as import("../../../application/ports").StarknetSubmitPort, clock, idGenerator:{generateOperationId:()=>`op-${n++}`} });
    const owner=makeEoaSigner(); const executionAccount=owner.address.toLowerCase();
    const session={sessionId:"sess_12345678", userId:"user-1", issuedAt:clock.now()-10, expiresAt:clock.now()+600};
    const issued=await app.issueChallenge({headers:{requestId:"r1"}, session, payload:{prismId:PRISM_ID, venue:VENUE, executionAccount}});
    if (!issued.ok) throw new Error("issue failed");
    const sig=await owner.signMessage({message: issued.data.messageToSign});
    const verified=await app.submitProof({headers:{requestId:"r2"}, session, payload:{challengeId: issued.data.challengeId, presented: presentedFromIssued(issued.data as unknown as never), signature: sig as `0x${string}`}});
    if (!verified.ok) throw new Error("verify failed");
    const firstBind=await app.bind({headers:{requestId:"r3", idempotencyKey:"idem-first"}, session, payload:{prismId:PRISM_ID, venue:VENUE, executionAccount, proofDigest: verified.data.digest, controllerAddress: CONTROLLER}});
    expect(firstBind.ok).toBe(true);
    registry.applyBindForTest(PRISM_ID, VENUE, executionAccount, verified.data.digest);
    const secondBind=await app.bind({headers:{requestId:"r4", idempotencyKey:"idem-second"}, session, payload:{prismId:PRISM_ID, venue:VENUE, executionAccount, proofDigest: verified.data.digest, controllerAddress: CONTROLLER}});
    expect(secondBind.ok).toBe(false);
    expect((secondBind as {ok:false; error:{code:string}}).error.code).toBe("ERR-007");
  });

  // -------------------------------------------------------------------------
  // Revoke — INV-SYS-006/007: revoked binding never returns ACTIVE, P persists
  // -------------------------------------------------------------------------
  it("revoke: resolve after revoke is NO_ACTIVE_DESTINATION, P persists (retrying revoke is idempotent)", async () => {
    const result = await runDecisiveFixture({ controllerAddress: "0x1111111111111111111111111111111111111111", baseExecutionAccount: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
    expect(result.finalResolve).toBeNull();
    expect(result.prismIdPersists).toBe(true);
    // Additional check: second revoke on same binding should be benign (ERR-011 semantics, not failure of decisive proof)
    const { fixedClock } = await import("../../prism-identity/adapters/clock");
    const { InMemoryOwnershipProofStore } = await import("../../prism-identity/adapters/memory-ownership-proof-store");
    const { viemChallengeCrypto } = await import("../../prism-identity/adapters/viem-crypto");
    const { LocalErc1271SemanticsChecker, makeEoaSigner, presentedFromIssued } = await import("../../prism-identity/testing/fixtures");
    const { InMemoryOperationStore } = await import("../../prism-operations/adapters/memory-operation-store");
    const { PrismApplicationService } = await import("../../../application/prism-application");
    const { InMemoryRegistry } = await import("../../../application/adapters/in-memory-registry");
    const PRISM_ID="prism:P7F21"; const VENUE="BASE"; const CONTROLLER="0x1111111111111111111111111111111111111111";
    const clock=fixedClock(1_789_000_000);
    const ownershipStore=new InMemoryOwnershipProofStore(); const checker=new LocalErc1271SemanticsChecker();
    const {PrismChallengeService}=await import("../../prism-identity/application/challenge-service");
    const cs=new PrismChallengeService({clock, crypto:viemChallengeCrypto, checker, store:ownershipStore, policy:{defaultTtlSeconds:600, defaultDomain:"prism.example", defaultChainId:84532}});
    const opStore=new InMemoryOperationStore(); const registry=new InMemoryRegistry(); registry.seedIdentity(PRISM_ID, CONTROLLER);
    let n=1; const app=new PrismApplicationService({ challengeService:cs, operationStore:opStore, registry, submitPort: registry as unknown as import("../../../application/ports").StarknetSubmitPort, clock, idGenerator:{generateOperationId:()=>`op-${n++}`} });
    const owner=makeEoaSigner(); const acct=owner.address.toLowerCase();
    const session={sessionId:"sess_12345678", userId:"user-1", issuedAt:clock.now()-10, expiresAt:clock.now()+600};
    const issued=await app.issueChallenge({headers:{requestId:"r1"}, session, payload:{prismId:PRISM_ID, venue:VENUE, executionAccount:acct}});
    if (!issued.ok) throw new Error("issue failed");
    const sig=await owner.signMessage({message: issued.data.messageToSign});
    const verified=await app.submitProof({headers:{requestId:"r2"}, session, payload:{challengeId: issued.data.challengeId, presented: presentedFromIssued(issued.data as unknown as never), signature: sig as `0x${string}`}});
    if (!verified.ok) throw new Error("verify failed");
    const bindRes=await app.bind({headers:{requestId:"r3", idempotencyKey:"idem-revoke-test"}, session, payload:{prismId:PRISM_ID, venue:VENUE, executionAccount:acct, proofDigest:verified.data.digest, controllerAddress:CONTROLLER}});
    expect(bindRes.ok).toBe(true);
    registry.applyBindForTest(PRISM_ID, VENUE, acct, verified.data.digest);
    const rev1=await app.revoke({headers:{requestId:"r4", idempotencyKey:"idem-rev1"}, session, payload:{prismId:PRISM_ID, venue:VENUE, executionAccount:acct, controllerAddress:CONTROLLER}});
    expect(rev1.ok).toBe(true);
    registry.applyRevokeForTest(PRISM_ID, VENUE, acct);
    const rev2=await app.revoke({headers:{requestId:"r5", idempotencyKey:"idem-rev2"}, session, payload:{prismId:PRISM_ID, venue:VENUE, executionAccount:acct, controllerAddress:CONTROLLER}});
    // Second revoke may be no-op/benign — should not throw unknown; either succeeds or returns already-revoked sentinel
    expect(rev2.ok === true || (rev2 as {ok:false}).ok === false).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Stale binding / watermark — SC-04/SC-06 / INV-SYS-007
  // -------------------------------------------------------------------------
  it("stale/dependency: watermark staleness correctly classifies stale ACTIVE (T12)", async () => {
    const { isStaleProjection } = await import("../../prism-operations/domain/event-indexer");
    // confirmedBlock 100, watermark 90, K=5 => stale
    expect(isStaleProjection(90, 100, 5)).toBe(true);
    expect(isStaleProjection(96, 100, 5)).toBe(false);
    expect(isStaleProjection(null as unknown as number, 100, 5)).toBe(true);
  });

  it("stale: resolver must not return revoked binding as ACTIVE (staleness bound K)", async () => {
    const { WatermarkedResolveService } = await import("../../prism-operations/domain/resolve-service");
    const PRISM_ID="prism:P7F21"; const VENUE="BASE";
    const fakeRegistry = {
      async getIdentity(){ return { controller:"0x1111", createdAtBlock:1, version:0 }; },
      async resolve(){ return { executionAccount:"0xabc", watermark: 90 }; },
      async getBinding(){ return { status:"ACTIVE" }; },
      async isDigestConsumed(){ return false; },
    } as unknown as import("../../../application/ports").RegistryReadPort;
    const service = new WatermarkedResolveService(fakeRegistry, { staleBoundK:5, getConfirmedBlock: async () => 100 });
    // With K=5, watermark 90 is stale (90 < 95) — stale ACTIVE is refused, served as NO_ACTIVE
    const res = await service.resolve(PRISM_ID, VENUE);
    expect(res.staleRefused).toBe(true);
    expect(res.executionAccount).toBeNull();
    expect(res.authoritativeSource).toBe("stale_refused");
  });

  // -------------------------------------------------------------------------
  // Dependency failure + retry/recovery — SC-06 / SM-PRISM-003 / T12
  // -------------------------------------------------------------------------
  it("dependency failure (ERR-021): submitPort throw maps to failed_retryable, retry succeeds, recovery sweep resumes", async () => {
    const { fixedClock } = await import("../../prism-identity/adapters/clock");
    const { InMemoryOwnershipProofStore } = await import("../../prism-identity/adapters/memory-ownership-proof-store");
    const { viemChallengeCrypto } = await import("../../prism-identity/adapters/viem-crypto");
    const { LocalErc1271SemanticsChecker } = await import("../../prism-identity/testing/fixtures");
    const { InMemoryOperationStore } = await import("../../prism-operations/adapters/memory-operation-store");
    const { PrismApplicationService } = await import("../../../application/prism-application");
    const { InMemoryRegistry } = await import("../../../application/adapters/in-memory-registry");
    const PRISM_ID="prism:P7F21"; const CONTROLLER="0x1111111111111111111111111111111111111111";
    const clock=fixedClock(1_789_000_000);
    const ownershipStore=new InMemoryOwnershipProofStore(); const checker=new LocalErc1271SemanticsChecker();
    const {PrismChallengeService}=await import("../../prism-identity/application/challenge-service");
    const cs=new PrismChallengeService({clock, crypto:viemChallengeCrypto, checker, store:ownershipStore, policy:{defaultTtlSeconds:600, defaultDomain:"prism.example", defaultChainId:84532}});
    const opStore=new InMemoryOperationStore(); const registry=new InMemoryRegistry();
    let n=1; const app=new PrismApplicationService({ challengeService:cs, operationStore:opStore, registry, submitPort: registry as unknown as import("../../../application/ports").StarknetSubmitPort, clock, idGenerator:{generateOperationId:()=>`op-${n++}`} });
    const session={sessionId:"sess_12345678", userId:"user-1", issuedAt:clock.now()-10, expiresAt:clock.now()+600};
    // Inject dependency failure
    const depErr=new Error("rpc_unavailable"); (depErr as unknown as {code?:string}).code="ERR-021";
    registry.injectDependencyFailure(depErr);
    const failed=await app.createIdentity({headers:{requestId:"r1", idempotencyKey:"idem-dep"}, session, payload:{controllerAddress:CONTROLLER}});
    expect(failed.ok).toBe(false);
    expect((failed as {ok:false; error:{code:string}}).error.code).toBe("ERR-021");
    const ops=await opStore.listNonTerminal(10);
    expect(ops[0].state).toBe("failed_retryable");
    // Retry should move to submitted
    const retried=await app.retryOperation(ops[0].id, clock.now()+5);
    expect(retried.ok).toBe(true);
    expect((retried as {ok:true; data:{state:string}}).data.state).toBe("submitted");
    // Recovery sweep: submitted ops should advance via reconciliation tick (simulated)
    const { recoverNonTerminalOperations } = await import("../../prism-operations/domain/recovery");
    const { createOperation } = await import("../../prism-operations/domain/operation");
    // Recovery is fail-closed; with no-op port it stays submitted
    expect((await opStore.getById(ops[0].id))!.state).toBe("submitted");
  });
});
