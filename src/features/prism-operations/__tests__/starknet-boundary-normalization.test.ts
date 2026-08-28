import { afterEach, describe, expect, it, vi } from "vitest";
import {
  normalizeStarknetContractAddress,
  sameStarknetContractAddress,
} from "../../prism-identity/domain/starknet-boundary";
import { StarknetRegistryReadAdapter } from "../adapters/starknet-registry-read";
import { StarknetSubmitAdapter, type StarknetAccountLike } from "../adapters/starknet-submit";
import { StarknetSubmitAdapterV2 } from "../adapters/starknet-submit-v2";
import { StarknetEventIndexerAdapter, PRISM_EVENT_SELECTORS } from "../adapters/starknet-event-indexer";
import { isStarknetReadConfigured } from "../../../application/adapters/starknet-registry-reader";
import { InMemoryOperationStore } from "../adapters/memory-operation-store";
import { PrismApplicationService } from "../../../application/prism-application";
import { validateM3PublicConfig, M3_MANIFEST_CHAIN_ID_TESTNET } from "../../evidence/m3-base-sequence-runner";
import type { Hex } from "../domain/operation";

const REGISTRY = "0x1111";
const REGISTRY_CANONICAL = `0x${"0".repeat(60)}1111`;
const CONTROLLER = "0x2222";
const CONTROLLER_CANONICAL = `0x${"0".repeat(60)}2222`;
const EXECUTION_ACCOUNT = "0xabc";
const EXECUTION_ACCOUNT_CANONICAL = `0x${"0".repeat(61)}abc`;
const BASE_ACCOUNT = "0x1111111111111111111111111111111111111111";
const DIGEST = `0x${"a".repeat(64)}` as Hex;
const TX_HASH = `0x${"b".repeat(64)}` as Hex;

function appSession() {
  return { sessionId: "sess_boundary", userId: "user-1", issuedAt: 1, expiresAt: 10_000 };
}

describe("shared Starknet ContractAddress boundary", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("normalizes valid addresses to one padded lowercase form and compares numerically", () => {
    expect(normalizeStarknetContractAddress(" 0XABC ")).toBe(EXECUTION_ACCOUNT_CANONICAL);
    expect(sameStarknetContractAddress("0xabc", EXECUTION_ACCOUNT_CANONICAL)).toBe(true);
  });

  it("rejects zero, out-of-range, and malformed ContractAddresses", () => {
    for (const value of ["0x0", "0x00", "not-hex", `0x${(1n << 251n).toString(16)}`]) {
      expect(() => normalizeStarknetContractAddress(value)).toThrow();
    }
  });

  it("rejects zero and out-of-range registry config in the read gate", () => {
    for (const value of ["0x0", `0x${(1n << 251n).toString(16)}`]) {
      vi.stubEnv("STARKNET_RPC_URL", "https://fake.rpc");
      vi.stubEnv("STARKNET_REGISTRY_ADDRESS", value);
      expect(isStarknetReadConfigured()).toBe(false);
      vi.unstubAllEnvs();
    }
  });
});

describe("StarknetRegistryReadAdapter boundary normalization", () => {
  it("uses canonical registry/controller/execution addresses and compares bindings numerically", async () => {
    const requests: Array<{ contractAddress: string; calldata: string[] }> = [];
    const adapter = new StarknetRegistryReadAdapter({
      registryAddress: REGISTRY,
      reader: {
        async callContract(request) {
          requests.push(request);
          if (request.entrypoint === "get_identity") return ["0x0", CONTROLLER, "10", "0"];
          if (request.entrypoint === "resolve") return ["0x0", EXECUTION_ACCOUNT];
          return ["0x1"];
        },
      },
    });

    await expect(adapter.getIdentity("prism:1")).resolves.toMatchObject({ controller: CONTROLLER_CANONICAL });
    await expect(adapter.resolve("prism:1", "BASE")).resolves.toEqual({ executionAccount: EXECUTION_ACCOUNT_CANONICAL, watermark: 0 });
    await expect(adapter.getBinding("prism:1", "BASE", EXECUTION_ACCOUNT_CANONICAL)).rejects.toMatchObject({ code: "ERR-021" });
    expect(requests.every((request) => request.contractAddress === REGISTRY_CANONICAL)).toBe(true);
  });

  it("rejects malformed/alphanumeric Prism IDs on every registry read path", async () => {
    const adapter = new StarknetRegistryReadAdapter({
      registryAddress: REGISTRY,
      reader: { async callContract() { return ["0x1"]; } },
    });
    await expect(adapter.getIdentity("prism:P1")).rejects.toMatchObject({ code: "ERR-002" });
    await expect(adapter.resolve("prism:P1", "BASE")).rejects.toMatchObject({ code: "ERR-002" });
    await expect(adapter.getBinding("prism:P1", "BASE", EXECUTION_ACCOUNT)).rejects.toMatchObject({ code: "ERR-002" });
  });
});

describe("Starknet submit adapters boundary normalization", () => {
  it("V1 accepts numerically equal account/controller forms and sends canonical ContractAddresses", async () => {
    let calls: Array<{ contractAddress: string; calldata: unknown[] }> = [];
    const account: StarknetAccountLike = {
      address: CONTROLLER_CANONICAL,
      async execute(items) {
        calls = items;
        return { transaction_hash: TX_HASH };
      },
    };
    const adapter = new StarknetSubmitAdapter({ account, registryAddress: REGISTRY });
    await adapter.submitBind({
      operationId: "op-v1-boundary",
      prismId: "prism:1",
      venue: "BASE",
      executionAccount: EXECUTION_ACCOUNT,
      proofDigest: DIGEST,
      controllerAddress: CONTROLLER,
    });
    expect(calls[0].contractAddress).toBe(REGISTRY_CANONICAL);
    expect(calls[0].calldata[2]).toBe(EXECUTION_ACCOUNT_CANONICAL);
  });

  it("V2 accepts numerically equal account/controller forms and sends canonical ContractAddresses", async () => {
    let calls: Array<{ contractAddress: string; calldata: unknown[] }> = [];
    const account: StarknetAccountLike = {
      address: CONTROLLER,
      async execute(items) {
        calls = items;
        return { transaction_hash: "0x1" };
      },
    };
    const adapter = new StarknetSubmitAdapterV2({ account, registryAddress: REGISTRY });
    await adapter.submitRevoke({
      operationId: "op-v2-boundary",
      prismId: "prism:1",
      venue: "BASE",
      executionAccount: EXECUTION_ACCOUNT,
      controllerAddress: CONTROLLER_CANONICAL,
    });
    expect(calls[0].contractAddress).toBe(REGISTRY_CANONICAL);
    expect(calls[0].calldata[2]).toBe(EXECUTION_ACCOUNT_CANONICAL);
  });

  it("rejects invalid submit addresses and catches numeric account/registry equality", () => {
    const account: StarknetAccountLike = {
      address: REGISTRY_CANONICAL,
      async execute() { return { transaction_hash: TX_HASH }; },
    };
    expect(() => new StarknetSubmitAdapter({ account, registryAddress: REGISTRY })).toThrow(/account_registry_address_mismatch/);
    expect(() => new StarknetSubmitAdapter({ account: { ...account, address: CONTROLLER_CANONICAL }, registryAddress: "0x0" })).toThrow(/invalid_starknet_address:zero/);
    expect(() => new StarknetSubmitAdapterV2({ account: { ...account, address: CONTROLLER_CANONICAL }, registryAddress: `0x${(1n << 251n).toString(16)}` })).toThrow(/ERR-005|address_out_of_range/);
  });
});

describe("application, event projection, and M3 Starknet boundaries", () => {
  it("normalizes application controller comparisons and submission", async () => {
    let submittedController = "";
    const app = new PrismApplicationService({
      challengeService: {} as never,
      operationStore: new InMemoryOperationStore(),
      registry: {
        async getIdentity() { return { controller: CONTROLLER_CANONICAL, createdAtBlock: 1, version: 0 }; },
        async listByController() { return []; },
        async resolve() { return { executionAccount: null, watermark: 0 }; },
        async getBinding() { return { status: null }; },
        async isDigestConsumed() { return false; },
      },
      submitPort: {
        async submitCreateIdentity(input) {
          submittedController = input.controllerAddress;
          return { txHash: TX_HASH };
        },
        async submitBind() { return { txHash: TX_HASH }; },
        async submitRevoke() { return { txHash: TX_HASH }; },
      },
      registryVersion: "v1",
      clock: { now: () => 100 },
      idGenerator: { generateOperationId: () => "op-boundary" },
    });

    const result = await app.createIdentity({
      headers: { idempotencyKey: "idem-boundary" },
      session: appSession(),
      payload: { controllerAddress: CONTROLLER },
    });
    expect(result.ok).toBe(true);
    expect(submittedController).toBe(CONTROLLER_CANONICAL);
  });

  it("projects only canonical nonzero Starknet addresses and rejects invalid event addresses", async () => {
    const tx = `0x${"c".repeat(64)}`;
    const adapter = new StarknetEventIndexerAdapter({
      registryAddress: REGISTRY,
      registryVersion: "v1",
      network: "SN_SEPOLIA",
      requireEventOrigin: false,
      reader: {
        async getEvents() {
          return {
            events: [{
              from_address: REGISTRY,
              block_number: 1,
              transaction_hash: tx,
              event_index: 0,
              keys: [PRISM_EVENT_SELECTORS.PrismIdentityCreated, "0x1"],
              data: [CONTROLLER],
            }],
            continuation_token: null,
          };
        },
      },
    });
    const result = await adapter.fetchRegistryEvents({ fromBlock: 0 });
    expect(result.events[0]?.registryAddress).toBe(REGISTRY_CANONICAL);
    expect(result.events[0]?.payload).toEqual({ prismId: "prism:1", controller: CONTROLLER_CANONICAL });

    const invalid = new StarknetEventIndexerAdapter({
      registryAddress: REGISTRY,
      registryVersion: "v1",
      network: "SN_SEPOLIA",
      requireEventOrigin: false,
      reader: {
        async getEvents() {
          return {
            events: [{
              from_address: REGISTRY,
              block_number: 1,
              transaction_hash: tx,
              event_index: 0,
              keys: [PRISM_EVENT_SELECTORS.PrismIdentityCreated, "0x1"],
              data: ["0x0"],
            }],
            continuation_token: null,
          };
        },
      },
    });
    await expect(invalid.fetchRegistryEvents({ fromBlock: 0 })).resolves.toMatchObject({ events: [] });
  });

  it("normalizes M3 controller/registry config and fails closed for alphanumeric IDs", () => {
    const config = validateM3PublicConfig({
      chainId: M3_MANIFEST_CHAIN_ID_TESTNET,
      domain: "prism.example",
      venue: "BASE",
      prismId: "prism:1",
      executionAccount: BASE_ACCOUNT,
      controllerAddress: CONTROLLER,
      registryAddress: REGISTRY,
      rpcUrl: "https://sepolia.test.rpc",
      registryVersion: "v1",
      liveRequested: false,
    });
    expect(config.normalizedControllerAddress).toBe(CONTROLLER_CANONICAL);
    expect(config.registryAddress).toBe(REGISTRY_CANONICAL);
    expect(() => validateM3PublicConfig({
      chainId: M3_MANIFEST_CHAIN_ID_TESTNET,
      domain: "prism.example",
      venue: "BASE",
      prismId: "prism:P1",
      executionAccount: BASE_ACCOUNT,
      controllerAddress: CONTROLLER,
    })).toThrow(/M3_CONFIG_BLOCKED.*ERR-002/);
  });
});
