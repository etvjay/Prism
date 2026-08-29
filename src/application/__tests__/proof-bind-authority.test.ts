import { describe, expect, it } from "vitest";
import { PrismChallengeService } from "../../features/prism-identity/application/challenge-service";
import { InMemoryOwnershipProofStore } from "../../features/prism-identity/adapters/memory-ownership-proof-store";
import { fixedClock } from "../../features/prism-identity/adapters/clock";
import { viemChallengeCrypto } from "../../features/prism-identity/adapters/viem-crypto";
import { LocalErc1271SemanticsChecker, makeEoaSigner, presentedFromIssued } from "../../features/prism-identity/testing/fixtures";
import { InMemoryOperationStore } from "../../features/prism-operations/adapters/memory-operation-store";
import { PrismApplicationService } from "../prism-application";
import { InMemoryRegistry } from "../adapters/in-memory-registry";
import { createPrismApiHandlers } from "../handlers";
import type { AppSession } from "../auth";
import type { Hex } from "../../features/prism-operations/domain/operation";
import type { StarknetSubmitPort } from "../ports";
import { StarknetSubmitAdapter } from "../../features/prism-operations/adapters/starknet-submit";

const PRISM_ID = "prism:P7F21";
const VENUE = "BASE";
const CONTROLLER = "0x1111111111111111111111111111111111111111";
const ARBITRARY_DIGEST = `0x${"f".repeat(64)}` as Hex;

function buildHarness(start = 1_789_000_000) {
  const clock = fixedClock(start);
  const ownershipStore = new InMemoryOwnershipProofStore();
  const challengeService = new PrismChallengeService({
    clock,
    crypto: viemChallengeCrypto,
    checker: new LocalErc1271SemanticsChecker(),
    store: ownershipStore,
    policy: { defaultTtlSeconds: 600, defaultDomain: "prism.example", defaultChainId: 84532 },
  });
  const operationStore = new InMemoryOperationStore();
  const registry = new InMemoryRegistry();
  registry.seedIdentity(PRISM_ID, CONTROLLER);
  let submitBindCalls = 0;
  const submitPort: StarknetSubmitPort = {
    isTestDouble: true,
    registryVersion: "v1",
    async submitCreateIdentity(input) {
      return registry.submitCreateIdentity(input);
    },
    async submitBind(input) {
      submitBindCalls += 1;
      return registry.submitBind(input);
    },
    async submitRevoke(input) {
      return registry.submitRevoke(input);
    },
  };
  let nextOperation = 1;
  const app = new PrismApplicationService({
    challengeService,
    operationStore,
    registry,
    submitPort,
    registryVersion: "v1",
    clock,
    idGenerator: { generateOperationId: () => `op-bind-proof-${nextOperation++}` },
  });
  const session = (): AppSession => ({
    sessionId: "sess_12345678",
    userId: "user-1",
    issuedAt: clock.now() - 10,
    expiresAt: clock.now() + 600,
  });
  return { app, challengeService, clock, operationStore, registry, session, get submitBindCalls() { return submitBindCalls; } };
}

async function issueAndVerify(h: ReturnType<typeof buildHarness>, owner: ReturnType<typeof makeEoaSigner>) {
  const account = owner.address.toLowerCase();
  const issued = await h.app.issueChallenge({
    headers: { requestId: "issue" },
    session: h.session(),
    payload: { prismId: PRISM_ID, venue: VENUE, executionAccount: account },
  });
  expect(issued.ok).toBe(true);
  if (!issued.ok) throw new Error("challenge issue failed");
  const signature = await owner.signMessage({ message: issued.data.messageToSign });
  const verified = await h.app.submitProof({
    headers: { requestId: "verify" },
    session: h.session(),
    payload: {
      challengeId: issued.data.challengeId,
      presented: presentedFromIssued(issued.data),
      signature: signature as Hex,
    },
  });
  expect(verified.ok).toBe(true);
  if (!verified.ok) throw new Error("proof verification failed");
  return { issued: issued.data, verified: verified.data };
}

describe("proof-to-bind authority linkage", () => {
  it("rejects an arbitrary client-supplied proofDigest before submitBind", async () => {
    const h = buildHarness();
    const response = await h.app.bind({
      headers: { requestId: "bind", idempotencyKey: "idem-arbitrary-proof" },
      session: h.session(),
      payload: {
        prismId: PRISM_ID,
        venue: VENUE,
        executionAccount: makeEoaSigner().address.toLowerCase(),
        proofDigest: ARBITRARY_DIGEST,
        controllerAddress: CONTROLLER,
      },
    });

    expect(response.ok).toBe(false);
    if (response.ok) throw new Error("arbitrary proof digest must not bind");
    expect(response.error.code).toBe("ERR-012");
    expect(h.submitBindCalls).toBe(0);
    expect(await h.operationStore.listNonTerminal(10)).toHaveLength(0);
  });

  it("requires a verified challenge and exact binding fields, including chain and expiry", async () => {
    const h = buildHarness();
    const owner = makeEoaSigner();
    const account = owner.address.toLowerCase();
    const issued = await h.app.issueChallenge({
      headers: { requestId: "issue" },
      session: h.session(),
      payload: { prismId: PRISM_ID, venue: VENUE, executionAccount: account },
    });
    expect(issued.ok).toBe(true);
    if (!issued.ok) throw new Error("challenge issue failed");

    const notVerified = await h.app.bind({
      headers: { requestId: "bind-unverified", idempotencyKey: "idem-unverified" },
      session: h.session(),
      payload: {
        prismId: PRISM_ID,
        venue: VENUE,
        executionAccount: account,
        proofDigest: issued.data.digest,
        challengeId: issued.data.challengeId,
        chainId: issued.data.chainId,
        expiresAt: issued.data.expiresAt,
        controllerAddress: CONTROLLER,
      },
    });
    expect(notVerified.ok).toBe(false);
    if (notVerified.ok) throw new Error("ISSUED challenge must not bind");
    expect(notVerified.error.code).toBe("ERR-012");

    const signature = await owner.signMessage({ message: issued.data.messageToSign });
    const verified = await h.app.submitProof({
      headers: { requestId: "verify" },
      session: h.session(),
      payload: { challengeId: issued.data.challengeId, presented: presentedFromIssued(issued.data), signature: signature as Hex },
    });
    expect(verified.ok).toBe(true);

    const wrongChain = await h.app.bind({
      headers: { requestId: "bind-chain", idempotencyKey: "idem-chain" },
      session: h.session(),
      payload: {
        prismId: PRISM_ID,
        venue: VENUE,
        executionAccount: account,
        proofDigest: issued.data.digest,
        challengeId: issued.data.challengeId,
        chainId: 8453,
        expiresAt: issued.data.expiresAt,
        controllerAddress: CONTROLLER,
      },
    });
    expect(wrongChain.ok).toBe(false);
    if (wrongChain.ok) throw new Error("cross-chain proof reference must not bind");
    expect(wrongChain.error.code).toBe("ERR-012");

    const wrongExpiry = await h.app.bind({
      headers: { requestId: "bind-expiry", idempotencyKey: "idem-expiry" },
      session: h.session(),
      payload: {
        prismId: PRISM_ID,
        venue: VENUE,
        executionAccount: account,
        proofDigest: verified.ok ? verified.data.digest : issued.data.digest,
        challengeId: issued.data.challengeId,
        chainId: issued.data.chainId,
        expiresAt: issued.data.expiresAt - 1,
        controllerAddress: CONTROLLER,
      },
    });
    expect(wrongExpiry.ok).toBe(false);
    if (wrongExpiry.ok) throw new Error("altered expiry must not bind");
    expect(wrongExpiry.error.code).toBe("ERR-012");
    expect(h.submitBindCalls).toBe(0);
  });

  it("rejects a verified proof after its expiry boundary", async () => {
    const h = buildHarness();
    const owner = makeEoaSigner();
    const account = owner.address.toLowerCase();
    const { issued, verified } = await issueAndVerify(h, owner);
    h.clock.setTo(issued.expiresAt);

    const response = await h.app.bind({
      headers: { requestId: "bind-expired", idempotencyKey: "idem-expired" },
      session: h.session(),
      payload: {
        prismId: PRISM_ID,
        venue: VENUE,
        executionAccount: account,
        proofDigest: verified.digest,
        challengeId: issued.challengeId,
        chainId: issued.chainId,
        expiresAt: issued.expiresAt,
        controllerAddress: CONTROLLER,
      },
    });

    expect(response.ok).toBe(false);
    if (response.ok) throw new Error("expired proof must not bind");
    expect(response.error.code).toBe("ERR-013");
    expect(h.submitBindCalls).toBe(0);
  });

  it("claims a verified proof once, while preserving same-key idempotency and blocking fresh-key replay", async () => {
    const h = buildHarness();
    const owner = makeEoaSigner();
    const account = owner.address.toLowerCase();
    const { issued, verified } = await issueAndVerify(h, owner);
    const payload = {
      prismId: PRISM_ID,
      venue: VENUE,
      executionAccount: account,
      proofDigest: verified.digest,
      challengeId: issued.challengeId,
      chainId: issued.chainId,
      expiresAt: issued.expiresAt,
      controllerAddress: CONTROLLER,
    } as const;

    const first = await h.app.bind({ headers: { idempotencyKey: "idem-once" }, session: h.session(), payload });
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error("first bind failed");
    expect(first.data.state).toBe("submitted");

    const sameKey = await h.app.bind({ headers: { idempotencyKey: "idem-once" }, session: h.session(), payload });
    expect(sameKey.ok).toBe(true);
    if (!sameKey.ok) throw new Error("same-key retry must be idempotent");
    expect(sameKey.data.operationId).toBe(first.data.operationId);

    const freshKey = await h.app.bind({ headers: { idempotencyKey: "idem-replay" }, session: h.session(), payload });
    expect(freshKey.ok).toBe(false);
    if (freshKey.ok) throw new Error("fresh-key replay must be rejected");
    expect(freshKey.error.code).toBe("ERR-007");
    expect(h.submitBindCalls).toBe(1);
  });

  it("exposes the same rejection through the transport-neutral API handler", async () => {
    const h = buildHarness();
    const handlers = createPrismApiHandlers(h.app);
    const response = await handlers.bind({
      headers: { requestId: "api-bind", idempotencyKey: "api-arbitrary" },
      session: h.session(),
      payload: {
        prismId: PRISM_ID,
        venue: VENUE,
        executionAccount: makeEoaSigner().address.toLowerCase(),
        proofDigest: ARBITRARY_DIGEST,
        controllerAddress: CONTROLLER,
      },
    });

    expect(response.ok).toBe(false);
    if (response.ok) throw new Error("API handler must not forward arbitrary proof digests");
    expect(response.error.code).toBe("ERR-012");
    expect(response.requestId).toBe("api-bind");
  });

  it("rejects an application whose selected registry version disagrees with the submit port", () => {
    const h = buildHarness();
    h.registry.setDigestMode("v2");
    expect(
      () => new PrismApplicationService({
        challengeService: h.challengeService,
        operationStore: h.operationStore,
        registry: h.registry,
        submitPort: h.registry as unknown as StarknetSubmitPort,
        registryVersion: "v1",
        clock: h.clock,
        idGenerator: { generateOperationId: () => "op-version-mismatch" },
      }),
    ).toThrow(/registryVersion.*mismatch/i);
  });

  it("does not retry a legacy bind operation after its proof-to-bind fence is consumed", async () => {
    const h = buildHarness();
    const owner = makeEoaSigner();
    const { issued, verified } = await issueAndVerify(h, owner);
    const executionAccount = owner.address.toLowerCase() as `0x${string}`;
    const claim = await h.challengeService.claimVerifiedProof({
      challengeId: issued.challengeId,
      proofDigest: verified.digest,
      prismId: PRISM_ID,
      venue: VENUE,
      executionAccount,
      chainId: issued.chainId,
      expiresAt: issued.expiresAt,
      now: h.clock.now(),
    });
    expect(claim).toBe("claimed");

    const fingerprint = JSON.stringify({
      kind: "bind_execution_identity",
      prismId: PRISM_ID,
      venue: VENUE,
      executionAccount,
      proofDigest: verified.digest,
      challengeId: issued.challengeId,
      chainId: issued.chainId,
      expiresAt: issued.expiresAt,
      controllerAddress: `0x${"0".repeat(63)}1`,
    });
    let op = await h.operationStore.create({
      id: "op-legacy-bind-retry",
      kind: "bind_execution_identity",
      idempotencyKey: "legacy-bind-retry",
      requestFingerprint: fingerprint,
      now: h.clock.now(),
    });
    op = await h.operationStore.transition(op.id, {
      to: "awaiting_authorization",
      now: h.clock.now() + 1,
      expectedVersion: op.version,
    });
    op = await h.operationStore.transition(op.id, {
      to: "ready",
      now: h.clock.now() + 2,
      expectedVersion: op.version,
    });
    op = await h.operationStore.transition(op.id, {
      to: "failed_retryable",
      now: h.clock.now() + 3,
      expectedVersion: op.version,
      errorCode: "ERR-021",
      errorDetail: "legacy pre-fence failure",
    });

    let submitCalls = 0;
    const submitPort = new StarknetSubmitAdapter({
      account: {
        address: `0x${"0".repeat(63)}1`,
        async execute() {
          submitCalls += 1;
          return { transaction_hash: `0x${"0".repeat(63)}2` };
        },
      },
      registryAddress: `0x${"0".repeat(63)}3`,
    });
    const retryApp = new PrismApplicationService({
      challengeService: h.challengeService,
      operationStore: h.operationStore,
      registry: h.registry,
      submitPort,
      registryVersion: "v1",
      clock: h.clock,
      idGenerator: { generateOperationId: () => "op-unused" },
    });

    const response = await retryApp.retryOperation(op.id, h.clock.now() + 4);
    expect(response.ok).toBe(false);
    if (response.ok) throw new Error("consumed proof must not be retried");
    expect(response.error.code).toBe("ERR-007");
    expect(submitCalls).toBe(0);
  });
});
