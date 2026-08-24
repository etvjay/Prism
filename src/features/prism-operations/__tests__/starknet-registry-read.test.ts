import { describe, it, expect } from "vitest";
import type { Hex } from "../domain/operation";
import { StarknetRegistryReadAdapter, StarknetRegistryReadError } from "../adapters/starknet-registry-read";

const REGISTRY = "0x1111111111111111111111111111111111111111111111111111111111111111";
const CONTROLLER = "0x2222222222222222222222222222222222222222222222222222222222222222";
const PRISM_ID = "prism:1";
const PRISM_ID_2 = "prism:2";

function readerReturning(result: string[]) {
  return {
    callContract: async () => result,
  };
}
function readerThrowing(msg: string) {
  return {
    callContract: async () => { throw new Error(msg); },
  };
}

describe("StarknetRegistryReadAdapter — get_identity / resolve (injected, fail-closed)", () => {
  it("getIdentity returns parsed identity for Some via injected reader", async () => {
    const adapter = new StarknetRegistryReadAdapter({
      reader: readerReturning(["0x1", CONTROLLER, "12345", "0"]),
      registryAddress: REGISTRY,
    });
    const res = await adapter.getIdentity(PRISM_ID);
    expect(res).toEqual({
      controller: "0x2222222222222222222222222222222222222222222222222222222222222222",
      createdAtBlock: 12345,
      version: 0,
    });
  });

  it("getIdentity returns null for None (unknown prismId) — fail-closed, not throw", async () => {
    const adapter = new StarknetRegistryReadAdapter({
      reader: readerReturning(["0x0"]),
      registryAddress: REGISTRY,
    });
    const res = await adapter.getIdentity(PRISM_ID);
    expect(res).toBeNull();
  });

  it("getIdentity handles bare-struct Some without tag (length 3)", async () => {
    const adapter = new StarknetRegistryReadAdapter({
      reader: readerReturning([CONTROLLER, "99", "0"]),
      registryAddress: REGISTRY,
    });
    const res = await adapter.getIdentity(PRISM_ID);
    expect(res?.createdAtBlock).toBe(99);
  });

  it("getIdentity throws ERR-002 for malformed prismId", async () => {
    const adapter = new StarknetRegistryReadAdapter({
      reader: readerReturning(["0x0"]),
      registryAddress: REGISTRY,
    });
    await expect(adapter.getIdentity("bad-id")).rejects.toBeInstanceOf(StarknetRegistryReadError);
    await expect(adapter.getIdentity("bad-id")).rejects.toMatchObject({ code: "ERR-002" });
    await expect(adapter.getIdentity("prism:0")).rejects.toMatchObject({ code: "ERR-002" });
    await expect(adapter.getIdentity("prism:001")).rejects.toMatchObject({ code: "ERR-002" });
  });

  it("constructor throws for malformed registry address", () => {
    expect(() => new StarknetRegistryReadAdapter({ reader: readerReturning(["0x0"]), registryAddress: "not-hex" })).toThrow(/malformed_address/);
    expect(() => new StarknetRegistryReadAdapter({ reader: null as unknown as never, registryAddress: REGISTRY })).toThrow(/injected reader/);
  });

  it("getIdentity throws for malformed address field via reader (fail-closed not fabricated)", async () => {
    const adapter = new StarknetRegistryReadAdapter({
      reader: readerReturning(["0x1", "not-hex", "10", "0"]),
      registryAddress: REGISTRY,
    });
    await expect(adapter.getIdentity(PRISM_ID)).rejects.toBeInstanceOf(StarknetRegistryReadError);
  });

  it("getIdentity throws ERR-021 on dependency failure (rpc unavailable) — fail-closed", async () => {
    const adapter = new StarknetRegistryReadAdapter({
      reader: readerThrowing("rpc_unavailable"),
      registryAddress: REGISTRY,
    });
    await expect(adapter.getIdentity(PRISM_ID)).rejects.toBeInstanceOf(StarknetRegistryReadError);
    await expect(adapter.getIdentity(PRISM_ID)).rejects.toMatchObject({ code: "ERR-021" });
  });

  it("resolve returns NO_ACTIVE for unknown prismId", async () => {
    const adapter = new StarknetRegistryReadAdapter({
      reader: readerReturning(["0x0"]),
      registryAddress: REGISTRY,
    });
    const res = await adapter.resolve(PRISM_ID, "BASE");
    expect(res.executionAccount).toBeNull();
  });

  it("resolve returns ACTIVE when tagged Some", async () => {
    const acct = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const adapter = new StarknetRegistryReadAdapter({
      reader: readerReturning(["0x1", acct]),
      registryAddress: REGISTRY,
    });
    const res = await adapter.resolve(PRISM_ID, "BASE");
    expect(res.executionAccount?.toLowerCase()).toBe(acct);
  });

  it("resolve for unsupported venue returns null without calling chain (fail-closed)", async () => {
    let called = false;
    const adapter = new StarknetRegistryReadAdapter({
      reader: { callContract: async () => { called = true; return ["0x0"]; } },
      registryAddress: REGISTRY,
    });
    const res = await adapter.resolve(PRISM_ID, "ETH");
    expect(res.executionAccount).toBeNull();
    expect(called).toBe(false);
  });

  it("isDigestConsumed throws for malformed digest", async () => {
    const adapter = new StarknetRegistryReadAdapter({
      reader: readerReturning(["0x0"]),
      registryAddress: REGISTRY,
    });
    await expect(adapter.isDigestConsumed("not-hex" as Hex)).rejects.toBeInstanceOf(StarknetRegistryReadError);
    await expect(adapter.isDigestConsumed("0x123" as Hex)).rejects.toMatchObject({ code: "ERR-023" });
  });

  it("never logs or persists connection strings (adapter stores only address, no rpcUrl)", () => {
    const adapter = new StarknetRegistryReadAdapter({
      reader: readerReturning(["0x0"]),
      registryAddress: REGISTRY,
    });
    // adapter should not have rpcUrl property; inspection should not expose secret
    expect((adapter as unknown as Record<string, unknown>).rpcUrl).toBeUndefined();
    expect((adapter as unknown as Record<string, unknown>).connectionString).toBeUndefined();
  });

  it("preserves Starknet canonical authority: getIdentity via felt conversion prism:2 -> 0x2", async () => {
    let captured: string[] = [];
    const adapter = new StarknetRegistryReadAdapter({
      reader: { callContract: async (req) => { captured = req.calldata; return ["0x0"]; } },
      registryAddress: REGISTRY,
    });
    await adapter.getIdentity(PRISM_ID_2);
    expect(captured[0]).toBe("0x2");
  });

  it("malformed controller in response throws, not fabricated as identity", async () => {
    const adapter = new StarknetRegistryReadAdapter({
      reader: readerReturning(["0x1", "not-hex-controller", "10", "0"]),
      registryAddress: REGISTRY,
    });
    await expect(adapter.getIdentity(PRISM_ID)).rejects.toBeInstanceOf(StarknetRegistryReadError);
  });
});
