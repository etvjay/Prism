import { describe, expect, it } from "vitest";
import { StarknetSubmitAdapterV2 } from "../adapters/starknet-submit-v2";
import { normalizeStarknetContractAddress } from "../../prism-identity/domain/starknet-boundary";

const ACCOUNT = "0x111";
const REGISTRY = "0x67b2f847d7805501c3db79474bdb33e7538825fa0f83aa3cd0083f02ee655c4";
const EXECUTION_ACCOUNT = normalizeStarknetContractAddress("0xabc");

function account(calls: Array<unknown[]>) {
  return {
    address: ACCOUNT,
    execute: async (items: Array<{ calldata: unknown[] }>) => {
      calls.push(items[0].calldata);
      return { transaction_hash: "0x1" };
    },
  };
}

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
