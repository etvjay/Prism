import { describe, expect, it } from "vitest";
import { StarknetSubmitAdapterV2 } from "../adapters/starknet-submit-v2";
import { normalizeStarknetContractAddress } from "../../prism-identity/domain/starknet-boundary";

const ACCOUNT = "0x111";
const REGISTRY = "0x67b2f847d7805501c3db79474bdb33e7538825fa0f83aa3cd0083f02ee655c4";
const EXECUTION_ACCOUNT = normalizeStarknetContractAddress("0xabc");

function account(calls: Array<unknown[]>, address = ACCOUNT) {
  return {
    address,
    execute: async (items: Array<{ calldata: unknown[] }>) => {
      calls.push(items[0].calldata);
      return { transaction_hash: "0x1" };
    },
  };
}

describe("StarknetSubmitAdapterV2 construction validation", () => {
  it("rejects malformed, zero, and out-of-range injected account addresses before execute", () => {
    const invalidAddresses = ["not-an-address", "0x0", `0x${(1n << 251n).toString(16)}`];
    for (const address of invalidAddresses) {
      let executeCalls = 0;
      const injected = {
        address,
        execute: async () => {
          executeCalls += 1;
          return { transaction_hash: "0x1" };
        },
      };
      expect(() => new StarknetSubmitAdapterV2({ account: injected, registryAddress: REGISTRY })).toThrow(/invalid_starknet_address|ERR-005/);
      expect(executeCalls).toBe(0);
    }
  });

  it("rejects account and registry equality after shared canonical normalization", () => {
    expect(() => new StarknetSubmitAdapterV2({
      account: account([], "0XABC"),
      registryAddress: normalizeStarknetContractAddress("0xabc"),
    })).toThrow(/account_registry_address_mismatch/);
  });

  it("canonicalizes valid account and registry addresses at the concrete boundary", async () => {
    const calls: Array<{ contractAddress: string; calldata: unknown[] }> = [];
    const injected = {
      address: "0XABC",
      execute: async (items: Array<{ contractAddress: string; calldata: unknown[] }>) => {
        calls.push(items[0]);
        return { transaction_hash: "0x1" };
      },
    };
    const adapter = new StarknetSubmitAdapterV2({ account: injected, registryAddress: " 0XDEF " });
    await adapter.submitCreateIdentity({ operationId: "op-v2-construction", controllerAddress: "0xabc" });
    expect(calls[0]?.contractAddress).toBe(normalizeStarknetContractAddress("0xdef"));
  });

  it("rejects zero and out-of-range registry addresses at construction", () => {
    for (const registryAddress of ["0x0", `0x${(1n << 251n).toString(16)}`]) {
      expect(() => new StarknetSubmitAdapterV2({ account: account([]), registryAddress })).toThrow(/invalid_starknet_address|ERR-005/);
    }
  });
});

describe("StarknetSubmitAdapterV2", () => {
  it("uses exact low/high u256 bind calldata and normalizes tx hash", async () => {
    const calls: Array<unknown[]> = [];
    const adapter = new StarknetSubmitAdapterV2({ account: account(calls), registryAddress: REGISTRY });
    const result = await adapter.submitBind({
      operationId: "op-v2",
      prismId: "prism:1",
      venue: "BASE",
      executionAccount: "0xabc",
      controllerAddress: ACCOUNT,
      proofDigest: "0x1234567890abcdef1234567890abcdef00000000000000000000000000000042",
    });
    expect(result.txHash).toBe(`0x${"0".repeat(63)}1`);
    expect(calls[0]).toEqual([
      "0x1",
      "BASE",
      EXECUTION_ACCOUNT,
      "0x00000000000000000000000000000042",
      "0x1234567890abcdef1234567890abcdef",
    ]);
  });

  it("canonicalizes accepted venue casing before ABI calldata", async () => {
    const calls: Array<unknown[]> = [];
    const adapter = new StarknetSubmitAdapterV2({ account: account(calls), registryAddress: REGISTRY });
    await adapter.submitBind({
      operationId: "op-v2-venue",
      prismId: "prism:1",
      venue: " base ",
      executionAccount: "0xabc",
      controllerAddress: ACCOUNT,
      proofDigest: `0x${"1".repeat(64)}` as never,
    });
    expect(calls[0][1]).toBe("BASE");
  });

  it("rejects noncanonical prism IDs before execute", async () => {
    const calls: Array<unknown[]> = [];
    const adapter = new StarknetSubmitAdapterV2({ account: account(calls), registryAddress: REGISTRY });
    await expect(adapter.submitBind({ operationId: "op", prismId: "prism:001", venue: "BASE", executionAccount: "0xabc", controllerAddress: ACCOUNT, proofDigest: `0x${"1".repeat(64)}` as never })).rejects.toMatchObject({ code: "ERR-002" });
    expect(calls).toHaveLength(0);
  });

  it("rejects malformed exact digest before execute", async () => {
    const calls: Array<unknown[]> = [];
    const adapter = new StarknetSubmitAdapterV2({ account: account(calls), registryAddress: REGISTRY });
    await expect(adapter.submitBind({ operationId: "op", prismId: "prism:1", venue: "BASE", executionAccount: "0xabc", controllerAddress: ACCOUNT, proofDigest: "0x1" as never })).rejects.toMatchObject({ code: "ERR-023" });
    expect(calls).toHaveLength(0);
  });

  it("preserves embedded contract error codes from V2 execute failures", async () => {
    const adapter = new StarknetSubmitAdapterV2({
      account: { address: ACCOUNT, execute: async () => { throw new Error("ERR-007: DIGEST CONSUMED"); } },
      registryAddress: REGISTRY,
    });
    await expect(adapter.submitBind({ operationId: "op", prismId: "prism:1", venue: "BASE", executionAccount: "0xabc", controllerAddress: ACCOUNT, proofDigest: `0x${"1".repeat(64)}` as never })).rejects.toMatchObject({ code: "ERR-007" });
  });

  it("marks an unclassified execute failure as ambiguous rather than retryable", async () => {
    const adapter = new StarknetSubmitAdapterV2({
      account: { address: ACCOUNT, execute: async () => { throw new Error("transport reset after broadcast"); } },
      registryAddress: REGISTRY,
    });
    await expect(adapter.submitCreateIdentity({ operationId: "op-ambiguous", controllerAddress: ACCOUNT })).rejects.toMatchObject({
      code: "ERR-021",
      ambiguous: true,
      terminal: false,
    });
  });

  it("does not route V2 through the V1 felt-mask function", async () => {
    const calls: Array<unknown[]> = [];
    const adapter = new StarknetSubmitAdapterV2({ account: account(calls), registryAddress: REGISTRY });
    await adapter.submitBind({ operationId: "op", prismId: "prism:1", venue: "BASE", executionAccount: "0xabc", controllerAddress: ACCOUNT, proofDigest: `0x${"f".repeat(64)}` as never });
    expect(calls[0][3]).toBe(`0x${"f".repeat(32)}`);
    expect(calls[0][4]).toBe(`0x${"f".repeat(32)}`);
  });
});
