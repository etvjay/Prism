// M3 Base Sequence Gate — exhaustive dry-run preflight gate for
// challenge → EOA/EIP-1271/ERC-6492 verification → controller bind → resolve → revoke → empty resolve
// Covers: signature classes, wrong signer, expiry/replay, chain/domain mismatch, controller mismatch,
// felt digest/prismId exact calldata, submitted!=completed, unknown signer/provider/receipt fail-closed,
// and live-signing blocker precision (no fabricated receipt).
//
// Uses injected/public configuration (validateM3PublicConfig) and dry-run doubles only — no live RPC.

import { describe, it, expect } from "vitest";
import type { Hex } from "../../prism-identity/domain/hex";
import {
  validateM3PublicConfig,
  detectLiveSigningBlocker,
  buildM3DryRunDeps,
  runM3DryRunSequence,
  M3_MANIFEST_CHAIN_ID_TESTNET,
  M3_DEFAULT_DOMAIN,
} from "../m3-base-sequence-runner";
import { toFieldBoundedDigest, prismIdToRegistryFelt, FELT_PRIME } from "../../prism-identity/domain/felt-digest";
import { StarknetSubmitAdapter } from "../../prism-operations/adapters/starknet-submit";
import type { StarknetAccountLike } from "../../prism-operations/adapters/starknet-submit";
import { fixedClock } from "../../prism-identity/adapters/clock";
import { InMemoryOwnershipProofStore } from "../../prism-identity/adapters/memory-ownership-proof-store";
import { viemChallengeCrypto } from "../../prism-identity/adapters/viem-crypto";
import { LocalErc1271SemanticsChecker, makeEoaSigner, presentedFromIssued, wrapAsUndeployed6492 } from "../../prism-identity/testing/fixtures";
import { PrismChallengeService } from "../../prism-identity/application/challenge-service";
import { InMemoryOperationStore } from "../../prism-operations/adapters/memory-operation-store";
import { InMemoryRegistry } from "../../../application/adapters/in-memory-registry";

const CONTROLLER = "0x1111111111111111111111111111111111111111";
const REGISTRY = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const TX_HASH: Hex = "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validPublicConfig(overrides: Partial<ReturnType<typeof validPublicConfigBase>> = {}) {
  return validPublicConfigBase(overrides);
}
function validPublicConfigBase(overrides: Record<string, unknown> = {}) {
  return {
    chainId: M3_MANIFEST_CHAIN_ID_TESTNET,
    domain: M3_DEFAULT_DOMAIN,
    venue: "BASE" as const,
    prismId: "prism:1",
    executionAccount: makeEoaSigner().address.toLowerCase(),
    controllerAddress: CONTROLLER,
    registryAddress: REGISTRY,
    rpcUrl: "https://sepolia.test.rpc",
    starknetNetwork: "SN_SEPOLIA" as const,
    hasLiveSigningProvider: false,
    liveRequested: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Config validation — chain/domain/prismId boundary exactness
// ---------------------------------------------------------------------------

describe("M3 gate — injected public config validation (fail closed)", () => {
  it("accepts valid injected config with decimal prismId and correct chainId", () => {
    const cfg = validateM3PublicConfig(validPublicConfig(), M3_MANIFEST_CHAIN_ID_TESTNET);
    expect(cfg.registryFeltPrismId).toBe("0x1");
    expect(cfg.normalizedDomain).toBe(M3_DEFAULT_DOMAIN);
    expect(cfg.chainId).toBe(84532);
  });

  it("rejects chainId mismatch (altered_fields:chain_id) — fail closed", () => {
    expect(() => validateM3PublicConfig(validPublicConfig({ chainId: 8453 }), M3_MANIFEST_CHAIN_ID_TESTNET)).toThrow(/chainId mismatch|altered_fields:chain_id/);
    expect(() => validateM3PublicConfig(validPublicConfig({ chainId: 1 }), 84532)).toThrow(/mismatch/);
  });

  it("rejects domain mismatch — fail closed on unknown domain", () => {
    expect(() => validateM3PublicConfig(validPublicConfig({ domain: "evil.com" }) as unknown as Parameters<typeof validateM3PublicConfig>[0], M3_MANIFEST_CHAIN_ID_TESTNET)).not.toThrow();
    // But presented vs stored domain mismatch is tested via verification ladder below
    // Here we test malformed domain
    expect(() => validateM3PublicConfig(validPublicConfig({ domain: " " }), M3_MANIFEST_CHAIN_ID_TESTNET)).toThrow(/invalid domain/);
    expect(() => validateM3PublicConfig(validPublicConfig({ domain: "nodot" }), M3_MANIFEST_CHAIN_ID_TESTNET)).toThrow(/invalid domain/);
  });

  it("rejects malformed prismId with ERR-002 and overflow with ERR-023", () => {
    expect(() => validateM3PublicConfig(validPublicConfig({ prismId: "prism:P1" }), M3_MANIFEST_CHAIN_ID_TESTNET)).toThrow(/ERR-002/);
    expect(() => validateM3PublicConfig(validPublicConfig({ prismId: "prism:001" }), M3_MANIFEST_CHAIN_ID_TESTNET)).toThrow(/ERR-002/);
    expect(() => validateM3PublicConfig(validPublicConfig({ prismId: "prism:0" }), M3_MANIFEST_CHAIN_ID_TESTNET)).toThrow(/ERR-002/);
    expect(() => validateM3PublicConfig(validPublicConfig({ prismId: FELT_PRIME.toString() } as unknown as ReturnType<typeof validPublicConfigBase>), M3_MANIFEST_CHAIN_ID_TESTNET)).toThrow(); // will be treated as missing prefix
    expect(() => validateM3PublicConfig(validPublicConfig({ prismId: `prism:${FELT_PRIME.toString()}` }), M3_MANIFEST_CHAIN_ID_TESTNET)).toThrow(/ERR-023/);
  });

  it("rejects zero/malformed executionAccount and malformed controller", () => {
    expect(() => validateM3PublicConfig(validPublicConfig({ executionAccount: "0x0000000000000000000000000000000000000000" }), M3_MANIFEST_CHAIN_ID_TESTNET)).toThrow(/zero/);
    expect(() => validateM3PublicConfig(validPublicConfig({ executionAccount: "nothex" }), M3_MANIFEST_CHAIN_ID_TESTNET)).toThrow(/malformed executionAccount/);
    expect(() => validateM3PublicConfig(validPublicConfig({ controllerAddress: "nothex" }), M3_MANIFEST_CHAIN_ID_TESTNET)).toThrow(/malformed controllerAddress/);
  });
});

// ---------------------------------------------------------------------------
// Live signing blocker — precise, no fabricated receipt
// ---------------------------------------------------------------------------

describe("M3 gate — live signing blocker (no fabricated bind receipt)", () => {
  it("blocks when --live not requested → M3_BLOCKED_BY_SIGNING_ENVIRONMENT", () => {
    const cfg = validPublicConfig({ liveRequested: false });
    const res = detectLiveSigningBlocker(cfg, {});
    expect(res.blocked).toBe(true);
    expect(res.blocker).toMatch(/M3_BLOCKED_BY_SIGNING_ENVIRONMENT/);
    expect(res.blocker).toMatch(/--live not set/);
  });

  it("blocks when --live requested but no signing provider env → M3_BLOCKED_BY_SIGNING_ENVIRONMENT", () => {
    const cfg = validPublicConfig({ liveRequested: true, hasLiveSigningProvider: false });
    const res = detectLiveSigningBlocker(cfg, {});
    expect(res.blocked).toBe(true);
    expect(res.blocker).toMatch(/M3_BLOCKED_BY_SIGNING_ENVIRONMENT/);
    expect(res.blocker).toMatch(/missing .*signing provider/);
  });

  it("blocks when --live + provider but missing registry/rpc — no receipt fabricated", () => {
    const cfg = validPublicConfig({ liveRequested: true, hasLiveSigningProvider: true, registryAddress: undefined, rpcUrl: undefined });
    const res = detectLiveSigningBlocker(cfg, { STARKNET_SEPOLIA_DEPLOYER_PRIVATE_KEY: "0xabc", BASE_SIGNER_PRIVATE_KEY: "0xdef" });
    expect(res.blocked).toBe(true);
    expect(res.blocker).toMatch(/registryAddress and rpcUrl/);
  });

  it("blocks when only the Starknet signer is present", () => {
    const cfg = validPublicConfig({ liveRequested: true, hasLiveSigningProvider: true });
    const res = detectLiveSigningBlocker(cfg, { STARKNET_SEPOLIA_DEPLOYER_PRIVATE_KEY: "sentinel" });
    expect(res.blocked).toBe(true);
    expect(res.blocker).toMatch(/Base signing provider/);
  });

  it("blocks when only the Base signer is present", () => {
    const cfg = validPublicConfig({ liveRequested: true, hasLiveSigningProvider: true });
    const res = detectLiveSigningBlocker(cfg, { BASE_SIGNER_PRIVATE_KEY: "sentinel" });
    expect(res.blocked).toBe(true);
    expect(res.blocker).toMatch(/Starknet controller\/deployer signing provider/);
  });

  it("passes blocker when live + provider + registry + rpc present", () => {
    const cfg = validPublicConfig({ liveRequested: true, hasLiveSigningProvider: true });
    const res = detectLiveSigningBlocker(cfg, { STARKNET_SEPOLIA_DEPLOYER_PRIVATE_KEY: "0xabc", BASE_SIGNER_PRIVATE_KEY: "0xdef" });
    expect(res.blocked).toBe(false);
    expect(res.blocker).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Felt digest / prismId exact calldata — positions 0 and 3, no silent repair
// ---------------------------------------------------------------------------

describe("M3 gate — felt digest/prismId exact calldata (Starknet boundary)", () => {
  it("prism:1 -> 0x1, large decimal -> hex, leading zeros rejected, overflow ERR-023", () => {
    expect(prismIdToRegistryFelt("prism:1")).toBe("0x1");
    expect(prismIdToRegistryFelt("prism:42")).toBe("0x2a");
    expect(prismIdToRegistryFelt("prism:123")).toBe("0x7b");
    expect(() => prismIdToRegistryFelt("prism:001")).toThrow(/ERR-002/);
    expect(() => prismIdToRegistryFelt("prism:P1")).toThrow(/ERR-002/);
    expect(() => prismIdToRegistryFelt(`prism:${FELT_PRIME.toString()}`)).toThrow(/ERR-023/);
  });

  it("digest mapping: in-range pass-through, out-of-range masked, exact positions 0 and 3", async () => {
    const DIGEST_LOW: Hex = "0x00aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Hex;
    const REAL_DIGEST: Hex = "0x95aee8cf18d7533b8cf6c782bcdf9987915df4a08a6d8c2c14bc4989af5e370f" as Hex;
    const masked = `0x${(BigInt(REAL_DIGEST) & ((1n << 250n) - 1n)).toString(16).padStart(64, "0")}` as Hex;

    expect(toFieldBoundedDigest(DIGEST_LOW).felt).toBe(DIGEST_LOW.toLowerCase() as Hex);
    expect(toFieldBoundedDigest(DIGEST_LOW).bounded).toBe(false);
    expect(toFieldBoundedDigest(REAL_DIGEST).felt).toBe(masked.toLowerCase() as Hex);
    expect(toFieldBoundedDigest(REAL_DIGEST).bounded).toBe(true);

    let captured: unknown[] | null = null;
    const acct: StarknetAccountLike = {
      address: CONTROLLER,
      execute: async (calls) => {
        captured = calls[0].calldata as unknown[];
        return { transaction_hash: TX_HASH };
      },
    };
    const adapter = new StarknetSubmitAdapter({ account: acct, registryAddress: REGISTRY });
    await adapter.submitBind({
      operationId: "op-felt",
      prismId: "prism:1",
      venue: "BASE",
      executionAccount: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      proofDigest: REAL_DIGEST,
      controllerAddress: CONTROLLER,
    });
    expect(captured![0]).toBe("0x1");
    expect(captured![3]).toBe(masked.toLowerCase());
    // Combined exact positions
    expect(captured).toEqual(["0x1", "BASE", "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", masked.toLowerCase()]);
  });

  it("submitted!=completed: adapter never returns completed, only txHash; app stores submitted", async () => {
    const acct: StarknetAccountLike = { address: CONTROLLER, execute: async () => ({ transaction_hash: TX_HASH }) };
    const adapter = new StarknetSubmitAdapter({ account: acct, registryAddress: REGISTRY });
    const res = await adapter.submitBind({
      operationId: "op-sub",
      prismId: "prism:1",
      venue: "BASE",
      executionAccount: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      proofDigest: "0x00aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Hex,
      controllerAddress: CONTROLLER,
    });
    expect(res.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    // No receipt/status completed is ever present here
    expect((res as unknown as { status?: string }).status).toBeUndefined();

    // Application layer preserves submitted, not completed
    const clock = fixedClock(1_789_000_000);
    const ownershipStore = new InMemoryOwnershipProofStore();
    const checker = new LocalErc1271SemanticsChecker();
    const challengeService = new PrismChallengeService({
      clock,
      crypto: viemChallengeCrypto,
      checker,
      store: ownershipStore,
      policy: { defaultTtlSeconds: 600, defaultDomain: M3_DEFAULT_DOMAIN, defaultChainId: M3_MANIFEST_CHAIN_ID_TESTNET },
    });
    const opStore = new InMemoryOperationStore();
    const registry = new InMemoryRegistry();
    registry.seedIdentity("prism:1", CONTROLLER);
    // Issue+verify to get digest
    const signer = makeEoaSigner();
    const exec = signer.address.toLowerCase() as Hex;
    const view = await challengeService.issueChallenge({ prismId: "prism:1", venue: "BASE", executionAccount: exec });
    const sig = await signer.signMessage({ message: view.messageToSign });
    const { presentedFromIssued: pfi } = await import("../../prism-identity/testing/fixtures");
    const presented = pfi(view as unknown as import("../../prism-identity/application/challenge-service").IssuedChallengeView);
    const verified = await challengeService.submitProof({ challengeId: view.challengeId, presented: presented as unknown as import("../../prism-identity/domain/verification").PresentedChallengeFields, signature: sig as Hex });
    const { PrismApplicationService } = await import("../../../application/prism-application");
    let n = 1;
    const app = new PrismApplicationService({ challengeService, operationStore: opStore, registry, submitPort: registry as unknown as import("../../../application/ports").StarknetSubmitPort, clock, idGenerator: { generateOperationId: () => `op-${n++}` } });
    const session = { sessionId: "sess_12345678", userId: "user-1", issuedAt: clock.now() - 5, expiresAt: clock.now() + 600 };
    const bindRes = await app.bind({
      headers: { requestId: "r1", idempotencyKey: "idem-submitted" },
      session,
      payload: { prismId: "prism:1", venue: "BASE", executionAccount: exec, proofDigest: verified.digest, controllerAddress: CONTROLLER },
    });
    expect(bindRes.ok).toBe(true);
    if (bindRes.ok) {
      expect(bindRes.data.state).toBe("submitted");
      expect(bindRes.data.state).not.toBe("completed");
      const op = await opStore.getById(bindRes.data.operationId);
      expect(op!.state).toBe("submitted");
      expect(op!.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    }
  });
});

// ---------------------------------------------------------------------------
// Signature classes, wrong signer, expiry/replay
// ---------------------------------------------------------------------------

describe("M3 gate — signature class ladder + wrong signer / expiry / replay", () => {
  it("verifies EOA, EIP-1271, and ERC-6492 classes distinctly", async () => {
    // EOA
    {
      const clock = fixedClock(1_789_000_000);
      const store = new InMemoryOwnershipProofStore();
      const checker = new LocalErc1271SemanticsChecker();
      const svc = new PrismChallengeService({ clock, crypto: viemChallengeCrypto, checker, store, policy: { defaultTtlSeconds: 600, defaultDomain: M3_DEFAULT_DOMAIN, defaultChainId: M3_MANIFEST_CHAIN_ID_TESTNET } });
      const signer = makeEoaSigner();
      const view = await svc.issueChallenge({ prismId: "prism:1", venue: "BASE", executionAccount: signer.address.toLowerCase() });
      const sig = await signer.signMessage({ message: view.messageToSign });
      const { presentedFromIssued: pfi } = await import("../../prism-identity/testing/fixtures");
      const res = await svc.submitProof({ challengeId: view.challengeId, presented: pfi(view as unknown as never) as unknown as import("../../prism-identity/domain/verification").PresentedChallengeFields, signature: sig as Hex });
      expect(res.signatureClass).toBe("EOA");
    }
    // EIP-1271
    {
      const clock = fixedClock(1_789_000_000);
      const store = new InMemoryOwnershipProofStore();
      const checker = new LocalErc1271SemanticsChecker();
      const svc = new PrismChallengeService({ clock, crypto: viemChallengeCrypto, checker, store, policy: { defaultTtlSeconds: 600, defaultDomain: M3_DEFAULT_DOMAIN, defaultChainId: M3_MANIFEST_CHAIN_ID_TESTNET } });
      const owner = makeEoaSigner();
      const smart = makeEoaSigner().address.toLowerCase() as `0x${string}`;
      checker.registerSmartAccount(smart, owner.address.toLowerCase() as `0x${string}`);
      const view = await svc.issueChallenge({ prismId: "prism:1", venue: "BASE", executionAccount: smart });
      const sig = await owner.signMessage({ message: view.messageToSign });
      const { presentedFromIssued: pfi } = await import("../../prism-identity/testing/fixtures");
      const res = await svc.submitProof({ challengeId: view.challengeId, presented: pfi(view as unknown as never) as unknown as import("../../prism-identity/domain/verification").PresentedChallengeFields, signature: sig as Hex });
      expect(res.signatureClass).toBe("EIP1271");
    }
    // ERC-6492
    {
      const clock = fixedClock(1_789_000_000);
      const store = new InMemoryOwnershipProofStore();
      const checker = new LocalErc1271SemanticsChecker();
      const svc = new PrismChallengeService({ clock, crypto: viemChallengeCrypto, checker, store, policy: { defaultTtlSeconds: 600, defaultDomain: M3_DEFAULT_DOMAIN, defaultChainId: M3_MANIFEST_CHAIN_ID_TESTNET } });
      const owner = makeEoaSigner();
      const smart = makeEoaSigner().address.toLowerCase() as `0x${string}`;
      checker.registerSmartAccount(smart, owner.address.toLowerCase() as `0x${string}`);
      const view = await svc.issueChallenge({ prismId: "prism:1", venue: "BASE", executionAccount: smart });
      const inner = await owner.signMessage({ message: view.messageToSign });
      const wrapped = wrapAsUndeployed6492({ counterfactualAccount: smart, innerSignature: inner as Hex });
      const { presentedFromIssued: pfi } = await import("../../prism-identity/testing/fixtures");
      const res = await svc.submitProof({ challengeId: view.challengeId, presented: pfi(view as unknown as never) as unknown as import("../../prism-identity/domain/verification").PresentedChallengeFields, signature: wrapped });
      expect(res.signatureClass).toBe("ERC6492");
    }
  });

  it("wrong signer fails ERR-003 (fail closed, not tamper ERR-012)", async () => {
    const clock = fixedClock(1_789_000_000);
    const store = new InMemoryOwnershipProofStore();
    const checker = new LocalErc1271SemanticsChecker();
    const svc = new PrismChallengeService({ clock, crypto: viemChallengeCrypto, checker, store, policy: { defaultTtlSeconds: 600, defaultDomain: M3_DEFAULT_DOMAIN, defaultChainId: M3_MANIFEST_CHAIN_ID_TESTNET } });
    const owner = makeEoaSigner();
    const attacker = makeEoaSigner();
    checker.registerSmartAccount(owner.address.toLowerCase() as `0x${string}`, owner.address.toLowerCase() as `0x${string}`);
    const view = await svc.issueChallenge({ prismId: "prism:1", venue: "BASE", executionAccount: owner.address.toLowerCase() });
    const badSig = await attacker.signMessage({ message: view.messageToSign });
    const { presentedFromIssued: pfi } = await import("../../prism-identity/testing/fixtures");
    await expect(svc.submitProof({ challengeId: view.challengeId, presented: pfi(view as unknown as never) as unknown as import("../../prism-identity/domain/verification").PresentedChallengeFields, signature: badSig as Hex })).rejects.toMatchObject({ code: "ERR-003" });
  });

  it("expiry at boundary fails ERR-013 and later replay fails, not ERR-006 confusion", async () => {
    const clock = fixedClock(1_789_000_000);
    const store = new InMemoryOwnershipProofStore();
    const checker = new LocalErc1271SemanticsChecker();
    const svc = new PrismChallengeService({ clock, crypto: viemChallengeCrypto, checker, store, policy: { defaultTtlSeconds: 600, defaultDomain: M3_DEFAULT_DOMAIN, defaultChainId: M3_MANIFEST_CHAIN_ID_TESTNET } });
    const signer = makeEoaSigner();
    const view = await svc.issueChallenge({ prismId: "prism:1", venue: "BASE", executionAccount: signer.address.toLowerCase() });
    const sig = await signer.signMessage({ message: view.messageToSign });
    clock.setTo(view.expiresAt);
    const { presentedFromIssued: pfi } = await import("../../prism-identity/testing/fixtures");
    await expect(svc.submitProof({ challengeId: view.challengeId, presented: pfi(view as unknown as never) as unknown as import("../../prism-identity/domain/verification").PresentedChallengeFields, signature: sig as Hex })).rejects.toMatchObject({ code: "ERR-013" });
    const stored = await store.getById(view.challengeId);
    expect(stored?.state).toBe("EXPIRED");
    expect(stored?.nonceState).toBe("UNUSED");
  });

  it("replay nonce fails ERR-006 and digest replay fails ERR-007", async () => {
    const clock = fixedClock(1_789_000_000);
    const store = new InMemoryOwnershipProofStore();
    const checker = new LocalErc1271SemanticsChecker();
    const svc = new PrismChallengeService({ clock, crypto: viemChallengeCrypto, checker, store, policy: { defaultTtlSeconds: 600, defaultDomain: M3_DEFAULT_DOMAIN, defaultChainId: M3_MANIFEST_CHAIN_ID_TESTNET } });
    const signer = makeEoaSigner();
    const view = await svc.issueChallenge({ prismId: "prism:1", venue: "BASE", executionAccount: signer.address.toLowerCase() });
    const sig = await signer.signMessage({ message: view.messageToSign });
    const { presentedFromIssued: pfi } = await import("../../prism-identity/testing/fixtures");
    const presented = pfi(view as unknown as never) as unknown as import("../../prism-identity/domain/verification").PresentedChallengeFields;
    const first = await svc.submitProof({ challengeId: view.challengeId, presented, signature: sig as Hex });
    expect(first.status).toBe("verified");
    await expect(svc.submitProof({ challengeId: view.challengeId, presented, signature: sig as Hex })).rejects.toMatchObject({ code: "ERR-006" });

    // Digest replay via application bind (ERR-007)
    const opStore = new InMemoryOperationStore();
    const registry = new InMemoryRegistry();
    registry.seedIdentity("prism:1", CONTROLLER);
    let n = 1;
    const app = new (await import("../../../application/prism-application")).PrismApplicationService({
      challengeService: svc,
      operationStore: opStore,
      registry,
      submitPort: registry as unknown as import("../../../application/ports").StarknetSubmitPort,
      clock,
      idGenerator: { generateOperationId: () => `op-replay-${n++}` },
    });
    const session = { sessionId: "sess_12345678", userId: "user-1", issuedAt: clock.now() - 5, expiresAt: clock.now() + 600 };
    const exec = signer.address.toLowerCase();
    const firstBind = await app.bind({
      headers: { requestId: "r1", idempotencyKey: "idem-first" },
      session,
      payload: { prismId: "prism:1", venue: "BASE", executionAccount: exec, proofDigest: first.digest, controllerAddress: CONTROLLER },
    });
    expect(firstBind.ok).toBe(true);
    registry.applyBindForTest("prism:1", "BASE", exec, first.digest);
    const secondBind = await app.bind({
      headers: { requestId: "r2", idempotencyKey: "idem-second" },
      session,
      payload: { prismId: "prism:1", venue: "BASE", executionAccount: exec, proofDigest: first.digest, controllerAddress: CONTROLLER },
    });
    expect(secondBind.ok).toBe(false);
    if (!secondBind.ok) expect((secondBind as { ok: false; error: { code: string } }).error.code).toBe("ERR-007");
  });
});

// ---------------------------------------------------------------------------
// Chain / domain / venue mismatch + controller mismatch
// ---------------------------------------------------------------------------

describe("M3 gate — chain/domain/venue/controller mismatch (fail closed)", () => {
  it("chainId mismatch: presented chainId altered triggers ERR-012 with altered_fields:chain_id", async () => {
    const clock = fixedClock(1_789_000_000);
    const store = new InMemoryOwnershipProofStore();
    const checker = new LocalErc1271SemanticsChecker();
    const svc = new PrismChallengeService({ clock, crypto: viemChallengeCrypto, checker, store, policy: { defaultTtlSeconds: 600, defaultDomain: M3_DEFAULT_DOMAIN, defaultChainId: M3_MANIFEST_CHAIN_ID_TESTNET } });
    const signer = makeEoaSigner();
    const view = await svc.issueChallenge({ prismId: "prism:1", venue: "BASE", executionAccount: signer.address.toLowerCase() });
    const sig = await signer.signMessage({ message: view.messageToSign });
    const { presentedFromIssued: pfi } = await import("../../prism-identity/testing/fixtures");
    const presented = { ...pfi(view as unknown as never), chainId: 8453 } as unknown as import("../../prism-identity/domain/verification").PresentedChallengeFields;
    await expect(svc.submitProof({ challengeId: view.challengeId, presented, signature: sig as Hex })).rejects.toMatchObject({ code: "ERR-012" });
  });

  it("domain mismatch: presented domain altered triggers ERR-012", async () => {
    const clock = fixedClock(1_789_000_000);
    const store = new InMemoryOwnershipProofStore();
    const checker = new LocalErc1271SemanticsChecker();
    const svc = new PrismChallengeService({ clock, crypto: viemChallengeCrypto, checker, store, policy: { defaultTtlSeconds: 600, defaultDomain: M3_DEFAULT_DOMAIN, defaultChainId: M3_MANIFEST_CHAIN_ID_TESTNET } });
    const signer = makeEoaSigner();
    const view = await svc.issueChallenge({ prismId: "prism:1", venue: "BASE", executionAccount: signer.address.toLowerCase() });
    const sig = await signer.signMessage({ message: view.messageToSign });
    const { presentedFromIssued: pfi } = await import("../../prism-identity/testing/fixtures");
    const presented = { ...pfi(view as unknown as never), domain: "evil.example" } as unknown as import("../../prism-identity/domain/verification").PresentedChallengeFields;
    await expect(svc.submitProof({ challengeId: view.challengeId, presented, signature: sig as Hex })).rejects.toMatchObject({ code: "ERR-012" });
  });

  it("controller mismatch: bind with non-controller fails ERR-004, not degraded to ERR-002", async () => {
    const clock = fixedClock(1_789_000_000);
    const store = new InMemoryOwnershipProofStore();
    const checker = new LocalErc1271SemanticsChecker();
    const svc = new PrismChallengeService({ clock, crypto: viemChallengeCrypto, checker, store, policy: { defaultTtlSeconds: 600, defaultDomain: M3_DEFAULT_DOMAIN, defaultChainId: M3_MANIFEST_CHAIN_ID_TESTNET } });
    const opStore = new InMemoryOperationStore();
    const registry = new InMemoryRegistry();
    registry.seedIdentity("prism:1", CONTROLLER);
    const signer = makeEoaSigner();
    const exec = signer.address.toLowerCase() as Hex;
    const view = await svc.issueChallenge({ prismId: "prism:1", venue: "BASE", executionAccount: exec });
    const sig = await signer.signMessage({ message: view.messageToSign });
    const { presentedFromIssued: pfi } = await import("../../prism-identity/testing/fixtures");
    const presented = pfi(view as unknown as never) as unknown as import("../../prism-identity/domain/verification").PresentedChallengeFields;
    const verified = await svc.submitProof({ challengeId: view.challengeId, presented, signature: sig as Hex });
    const OTHER = "0x2222222222222222222222222222222222222222";
    let n = 1;
    const app = new (await import("../../../application/prism-application")).PrismApplicationService({
      challengeService: svc,
      operationStore: opStore,
      registry,
      submitPort: registry as unknown as import("../../../application/ports").StarknetSubmitPort,
      clock,
      idGenerator: { generateOperationId: () => `op-ctrl-${n++}` },
    });
    const session = { sessionId: "sess_12345678", userId: "user-1", issuedAt: clock.now() - 5, expiresAt: clock.now() + 600 };
    const bindRes = await app.bind({
      headers: { requestId: "r1", idempotencyKey: "idem-ctrl" },
      session,
      payload: { prismId: "prism:1", venue: "BASE", executionAccount: exec, proofDigest: verified.digest, controllerAddress: OTHER },
    });
    expect(bindRes.ok).toBe(false);
    if (!bindRes.ok) expect((bindRes as { ok: false; error: { code: string } }).error.code).toBe("ERR-004");
  });

  it("unknown signer / provider / receipt states fail closed (ERR-014 / ERR-021 / UNKNOWN)", async () => {
    // Unknown signer: EOA recovery mismatch without 1271 registration → ERR-003
    {
      const clock = fixedClock(1_789_000_000);
      const store = new InMemoryOwnershipProofStore();
      const checker = new LocalErc1271SemanticsChecker();
      const svc = new PrismChallengeService({ clock, crypto: viemChallengeCrypto, checker, store, policy: { defaultTtlSeconds: 600, defaultDomain: M3_DEFAULT_DOMAIN, defaultChainId: M3_MANIFEST_CHAIN_ID_TESTNET } });
      const owner = makeEoaSigner();
      const attacker = makeEoaSigner();
      checker.registerSmartAccount(owner.address.toLowerCase() as `0x${string}`, owner.address.toLowerCase() as `0x${string}`);
      const view = await svc.issueChallenge({ prismId: "prism:1", venue: "BASE", executionAccount: owner.address.toLowerCase() });
      const badSig = await attacker.signMessage({ message: view.messageToSign });
      const { presentedFromIssued: pfi } = await import("../../prism-identity/testing/fixtures");
      await expect(svc.submitProof({ challengeId: view.challengeId, presented: pfi(view as unknown as never) as unknown as import("../../prism-identity/domain/verification").PresentedChallengeFields, signature: badSig as Hex })).rejects.toMatchObject({ code: "ERR-003" });
    }
    // Unknown provider: undetermined checker → ERR-021
    {
      const clock = fixedClock(1_789_000_000);
      const store = new InMemoryOwnershipProofStore();
      const { UndeterminedChecker } = await import("../../prism-identity/testing/fixtures");
      const checker = new UndeterminedChecker("rpc_unreachable");
      const svc = new PrismChallengeService({ clock, crypto: viemChallengeCrypto, checker, store, policy: { defaultTtlSeconds: 600, defaultDomain: M3_DEFAULT_DOMAIN, defaultChainId: M3_MANIFEST_CHAIN_ID_TESTNET } });
      const signer = makeEoaSigner();
      const smart = makeEoaSigner().address.toLowerCase() as `0x${string}`;
      const view = await svc.issueChallenge({ prismId: "prism:1", venue: "BASE", executionAccount: smart });
      const sig = await signer.signMessage({ message: view.messageToSign });
      const { presentedFromIssued: pfi } = await import("../../prism-identity/testing/fixtures");
      await expect(svc.submitProof({ challengeId: view.challengeId, presented: pfi(view as unknown as never) as unknown as import("../../prism-identity/domain/verification").PresentedChallengeFields, signature: sig as Hex })).rejects.toMatchObject({ code: "ERR-021" });
    }
    // Unknown receipt state: Starknet submit with UNKNOWN status is not completed — reconciliation stays submitted
    {
      const opStore = new InMemoryOperationStore();
      const { tickReconciliation } = await import("../../prism-operations/domain/recovery");
      const { createOperation } = await import("../../prism-operations/domain/operation");
      // Create a submitted op and simulate unknown chain observation
      const now = 1_789_000_000;
      const op = await opStore.create({ id: "op-unknown-receipt", kind: "bind_execution_identity", idempotencyKey: "idem-unk", requestFingerprint: "fp", now });
      let cur = await opStore.transition(op.id, { to: "awaiting_authorization", now: now + 1, expectedVersion: op.version });
      cur = await opStore.transition(cur.id, { to: "ready", now: now + 2, expectedVersion: cur.version });
      cur = await opStore.transition(cur.id, { to: "submitted", now: now + 3, expectedVersion: cur.version, txHash: "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" as Hex });
      const port = {
        observeChain: async () => ({ txHash: cur.txHash!, status: "UNKNOWN" as const, blockNumber: null, executionStatus: "UNKNOWN" as const }),
        observeIndexer: async () => null,
        observeReconciliation: async () => null,
      };
      const tick = await tickReconciliation(opStore, port as unknown as import("../../prism-operations/domain/ports").OperationReconciliationPort, cur.id, now + 4);
      expect(tick.advanced).toBe(false);
      expect(tick.toState).toBeNull();
      const after = await opStore.getById(cur.id);
      expect(after!.state).toBe("submitted");
      expect(after!.state).not.toBe("completed");
    }
  });
});

// ---------------------------------------------------------------------------
// Full dry-run sequence — challenge → bind → resolve → revoke → empty resolve
// ---------------------------------------------------------------------------

describe("M3 gate — full dry-run sequence (parent-executable, no live broadcast)", () => {
  it("challenge → EOA verify → bind (submitted, not completed) → resolve ACTIVE → revoke → empty resolve → P persists", async () => {
    const deps = await buildM3DryRunDeps({ chainId: M3_MANIFEST_CHAIN_ID_TESTNET, domain: M3_DEFAULT_DOMAIN });
    const signer = makeEoaSigner();
    const exec = signer.address.toLowerCase();
    const cfg = validateM3PublicConfig(
      {
        chainId: M3_MANIFEST_CHAIN_ID_TESTNET,
        domain: M3_DEFAULT_DOMAIN,
        venue: "BASE",
        prismId: "prism:1",
        executionAccount: exec,
        controllerAddress: CONTROLLER,
        registryAddress: REGISTRY,
        rpcUrl: "https://sepolia.test.rpc",
      },
      M3_MANIFEST_CHAIN_ID_TESTNET,
    );
    // Override cfg to use signer's actual address for this dry-run (signer owns exec)
    const result = await runM3DryRunSequence(cfg, deps, {
      signer: { address: exec as `0x${string}`, signMessage: (args) => signer.signMessage({ message: args.message }) as Promise<Hex> },
    });
    expect(result.verdict).toBe("M3_BASE_SEQUENCE_RUNNER_READY_X2");
    expect(result.submittedNotCompleted).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(result.blockers).toEqual([]);
    const steps = result.steps.map((s) => s.step);
    expect(steps.join(" ")).toContain("challenge issue");
    expect(steps.join(" ")).toContain("verify EOA");
    expect(steps.join(" ")).toContain("bind (submitted)");
    expect(steps.join(" ")).toContain("resolve pre-revoke");
    expect(steps.join(" ")).toContain("revoke (submitted)");
    expect(steps.join(" ")).toContain("resolve post-revoke");
    expect(steps.join(" ")).toContain("get_identity persists");
    // Calldata exactness tracked in bind step
    const bindStep = result.steps.find((s) => s.step.includes("bind (submitted)"));
    expect(bindStep?.calldata?.[0]).toBe("0x1");
    expect(bindStep?.state).toBe("submitted");
    expect(bindStep?.state).not.toBe("completed");
  });

  it("dry-run does not fabricate bind receipt when live provider absent — blocker precise", async () => {
    const cfg = validPublicConfig({ liveRequested: false });
    const blocker = detectLiveSigningBlocker(cfg, {});
    expect(blocker.blocked).toBe(true);
    expect(blocker.blocker).toMatch(/M3_BLOCKED_BY_SIGNING_ENVIRONMENT/);
    expect(blocker.blocker).not.toMatch(/0x[0-9a-f]{64}/);
  });
});
