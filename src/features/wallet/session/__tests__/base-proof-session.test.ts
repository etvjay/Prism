import { describe, expect, it } from "vitest";
import { makeEoaSigner } from "../../../prism-identity/testing/fixtures";
import { fixedClock } from "../../../prism-identity/adapters/clock";
import { InMemoryOwnershipProofStore } from "../../../prism-identity/adapters/memory-ownership-proof-store";
import { viemChallengeCrypto } from "../../../prism-identity/adapters/viem-crypto";
import { LocalErc1271SemanticsChecker } from "../../../prism-identity/testing/fixtures";
import { PrismChallengeService } from "../../../prism-identity/application/challenge-service";
import { InMemoryOperationStore } from "../../../prism-operations/adapters/memory-operation-store";
import { Eip1193BaseProofAdapter } from "../base-proof-adapter";
import { BaseProofSession } from "../base-proof-session";
import { InMemoryRegistry } from "../../../../application/adapters/in-memory-registry";
import { PrismApplicationService } from "../../../../application/prism-application";
import type { Eip1193Provider } from "../base-proof-adapter";
import type { AppSession } from "../../../../application/auth";
import { bytesToUtf8, hexToBytes, isHexString, type Hex } from "../../../prism-identity/domain/hex";

const CHAIN_ID_HEX = "0x14a34" as const;
const PRISM_ID = "prism:P7F21";

function appSession(now: number): AppSession {
  return {
    sessionId: "sess_base_123",
    userId: "user-base",
    issuedAt: now - 10,
    expiresAt: now + 600,
  };
}

function buildApplication(now = 1_789_000_000) {
  const clock = fixedClock(now);
  const ownershipStore = new InMemoryOwnershipProofStore();
  const checker = new LocalErc1271SemanticsChecker();
  const challengeService = new PrismChallengeService({
    clock,
    crypto: viemChallengeCrypto,
    checker,
    store: ownershipStore,
    policy: { defaultTtlSeconds: 600, defaultDomain: "prism.example", defaultChainId: 84532 },
  });
  const registry = new InMemoryRegistry();
  const application = new PrismApplicationService({
    challengeService,
    operationStore: new InMemoryOperationStore(),
    registry,
    submitPort: registry,
    registryVersion: "v1",
    clock,
    idGenerator: { generateOperationId: () => "unused-in-proof-flow" },
  });
  return { application, clock };
}

describe("Base proof session application integration", () => {
  it("injects the EIP-1193 adapter into issue → sign → verify without a transaction port", async () => {
    const signer = makeEoaSigner();
    const account = signer.address.toLowerCase();
    const provider: Eip1193Provider = {
      request: async ({ method, params }) => {
        if (method === "eth_requestAccounts" || method === "eth_accounts") return [account];
        if (method === "eth_chainId") return CHAIN_ID_HEX;
        if (method === "personal_sign") {
          const encoded = params?.[0];
          if (!isHexString(encoded)) throw new Error("personal_sign_requires_hex_message");
          return signer.signMessage({ message: bytesToUtf8(hexToBytes(encoded as Hex)) });
        }
        throw new Error(`unexpected method ${method}`);
      },
    };
    const base = new Eip1193BaseProofAdapter(provider);
    const { application, clock } = buildApplication();
    const flow = new BaseProofSession({ provider: base, application });

    const result = await flow.prove({
      session: appSession(clock.now()),
      prismId: PRISM_ID,
    });

    expect(result.status).toBe("verified");
    if (result.status !== "verified") throw new Error("expected verified proof");
    expect(result.account).toBe(account);
    expect(result.chainId).toBe(84532);
    expect(result.signature).toMatch(/^0x[0-9a-f]+$/i);
    expect(result.challenge.data.executionAccount).toBe(account);
    expect(result.proof.data.status).toBe("verified");
    expect(result.proof.data.signatureClass).toBe("EOA");
    expect(JSON.stringify(result)).not.toMatch(/privateKey|seedPhrase|viewingKey/i);
  });

  it("returns provider rejection/unknown/mismatch states without calling challenge ports", async () => {
    const calls: string[] = [];
    const application = {
      issueChallenge: async () => {
        calls.push("issue");
        throw new Error("must not be called");
      },
      submitProof: async () => {
        calls.push("verify");
        throw new Error("must not be called");
      },
    };
    const provider = {
      connect: async () => ({
        status: "network_mismatch" as const,
        code: "BASE_PROOF_NETWORK_MISMATCH" as const,
        operation: "connect" as const,
        detail: "wrong_network" as const,
        expectedChainId: 84532 as const,
        actualChainId: 1,
        actualChainIdHex: "0x1",
      }),
      observe: async () => ({
        status: "network_mismatch" as const,
        code: "BASE_PROOF_NETWORK_MISMATCH" as const,
        operation: "observe" as const,
        detail: "wrong_network" as const,
        expectedChainId: 84532 as const,
        actualChainId: 1,
        actualChainIdHex: "0x1",
      }),
      signMessage: async () => {
        throw new Error("must not be called");
      },
    };
    const flow = new BaseProofSession({ provider, application });

    const result = await flow.prove({
      session: appSession(1_789_000_000),
      prismId: PRISM_ID,
    });

    expect(result).toMatchObject({ status: "network_mismatch", code: "BASE_PROOF_NETWORK_MISMATCH" });
    expect(calls).toEqual([]);
  });

  it("maps an injected application error without exposing a thrown dependency", async () => {
    const account = "0x1111111111111111111111111111111111111111" as const;
    const provider = {
      connect: async () => ({ status: "connected" as const, account, chainId: 84532 as const, chainIdHex: CHAIN_ID_HEX }),
      observe: async () => ({ status: "connected" as const, account, chainId: 84532 as const, chainIdHex: CHAIN_ID_HEX }),
      signMessage: async () => ({
        status: "signed" as const,
        account,
        chainId: 84532 as const,
        chainIdHex: CHAIN_ID_HEX,
        signature: `0x${"ab".repeat(65)}` as `0x${string}`,
      }),
    };
    const application = {
      issueChallenge: async () => ({
        ok: false as const,
        error: {
          code: "ERR-021",
          name: "rpc_unavailable",
          category: "dependency",
          retryable: "true_backoff",
          userAction: "wait_retry",
          httpStatusHint: 503,
          detail: "challenge_store_unavailable",
        },
      }),
      submitProof: async () => {
        throw new Error("must not be called");
      },
    };
    const flow = new BaseProofSession({ provider, application });

    const result = await flow.prove({ session: appSession(1_789_000_000), prismId: PRISM_ID });

    expect(result).toEqual({
      status: "application_error",
      error: expect.objectContaining({ code: "ERR-021", detail: "challenge_store_unavailable" }),
    });
  });
});
