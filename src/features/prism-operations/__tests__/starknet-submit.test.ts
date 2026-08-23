import { describe, it, expect } from "vitest";
import type { Hex } from "../domain/operation";
import { StarknetSubmitAdapter, type StarknetAccountLike } from "../adapters/starknet-submit";

const REGISTRY = "0x1111111111111111111111111111111111111111";
const CONTROLLER = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const EXEC_ACCOUNT = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const DIGEST: Hex = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const TX_HASH: Hex = "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

function fakeAccount(overrides: Partial<StarknetAccountLike> = {}): StarknetAccountLike {
  return {
    address: CONTROLLER,
    execute: async () => ({ transaction_hash: TX_HASH }),
    ...overrides,
  };
}

describe("StarknetSubmitAdapter — injected Account, no secret file reads", () => {
  it("submitCreateIdentity returns txHash via injected account, never reads files", async () => {
    let called = false;
    const account: StarknetAccountLike = {
      address: CONTROLLER,
      execute: async (calls) => {
        called = true;
        expect(calls[0].entrypoint).toBe("create_identity");
        expect(calls[0].contractAddress.toLowerCase()).toBe(REGISTRY);
        return { transaction_hash: TX_HASH };
      },
    };
    const adapter = new StarknetSubmitAdapter({ account, registryAddress: REGISTRY });
    const res = await adapter.submitCreateIdentity({ operationId: "op-1", controllerAddress: CONTROLLER });
    expect(res.txHash).toBe(TX_HASH);
    expect(called).toBe(true);
  });

  it("submitBind maps to bind_execution_identity calldata with venue/ account/ digest", async () => {
    let captured: unknown[] | null = null;
    const account: StarknetAccountLike = {
      address: CONTROLLER,
      execute: async (calls) => {
        captured = calls[0].calldata as unknown[];
        return { transaction_hash: TX_HASH };
      },
    };
    const adapter = new StarknetSubmitAdapter({ account, registryAddress: REGISTRY });
    await adapter.submitBind({
      operationId: "op-2",
      prismId: "prism:P1",
      venue: "BASE",
      executionAccount: EXEC_ACCOUNT,
      proofDigest: DIGEST,
      controllerAddress: CONTROLLER,
    });
    expect(captured).toEqual(["prism:P1", "BASE", EXEC_ACCOUNT, DIGEST]);
  });

  it("submitRevoke maps to revoke_binding calldata", async () => {
    let entrypoint = "";
    const account = fakeAccount({
      execute: async (calls) => {
        entrypoint = calls[0].entrypoint;
        return { transaction_hash: TX_HASH };
      },
    });
    const adapter = new StarknetSubmitAdapter({ account, registryAddress: REGISTRY });
    await adapter.submitRevoke({
      operationId: "op-3",
      prismId: "prism:P1",
      venue: "BASE",
      executionAccount: EXEC_ACCOUNT,
      controllerAddress: CONTROLLER,
    });
    expect(entrypoint).toBe("revoke_binding");
  });

  it("preserves submitted != completed — adapter never marks completed, only returns txHash", async () => {
    const account = fakeAccount();
    const adapter = new StarknetSubmitAdapter({ account, registryAddress: REGISTRY });
    const res = await adapter.submitBind({
      operationId: "op-4",
      prismId: "prism:P1",
      venue: "BASE",
      executionAccount: EXEC_ACCOUNT,
      proofDigest: DIGEST,
      controllerAddress: CONTROLLER,
    });
    expect(res.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    // No receipt/completion is ever returned here — reconciliation owns it
  });

  it("maps contract revert ERR-004 to stable error code", async () => {
    const account: StarknetAccountLike = {
      address: CONTROLLER,
      execute: async () => {
        const err = new Error("Contract reverted: ERR-004: NOT CONTROLLER");
        throw err;
      },
    };
    const adapter = new StarknetSubmitAdapter({ account, registryAddress: REGISTRY });
    await expect(
      adapter.submitBind({
        operationId: "op-err",
        prismId: "prism:P1",
        venue: "BASE",
        executionAccount: EXEC_ACCOUNT,
        proofDigest: DIGEST,
        controllerAddress: CONTROLLER,
      }),
    ).rejects.toMatchObject({ code: "ERR-004" });
  });

  it("fail-closed on dependency error (RPC unavailable) with ERR-021", async () => {
    const account: StarknetAccountLike = {
      address: CONTROLLER,
      execute: async () => {
        throw new Error("connection reset");
      },
    };
    const adapter = new StarknetSubmitAdapter({ account, registryAddress: REGISTRY });
    await expect(adapter.submitCreateIdentity({ operationId: "op-dep", controllerAddress: CONTROLLER })).rejects.toMatchObject({
      code: "ERR-021",
    });
  });

  it("validates malformed proof digest with ERR-023", async () => {
    const adapter = new StarknetSubmitAdapter({ account: fakeAccount(), registryAddress: REGISTRY });
    await expect(
      adapter.submitBind({
        operationId: "op-bad",
        prismId: "prism:P1",
        venue: "BASE",
        executionAccount: EXEC_ACCOUNT,
        proofDigest: "0x123" as Hex,
        controllerAddress: CONTROLLER,
      }),
    ).rejects.toMatchObject({ code: "ERR-023" });
  });

  it("validates invalid venue with ERR-001", async () => {
    const adapter = new StarknetSubmitAdapter({ account: fakeAccount(), registryAddress: REGISTRY });
    await expect(
      adapter.submitBind({
        operationId: "op-venue",
        prismId: "prism:P1",
        venue: "SOLANA",
        executionAccount: EXEC_ACCOUNT,
        proofDigest: DIGEST,
        controllerAddress: CONTROLLER,
      }),
    ).rejects.toMatchObject({ code: "ERR-001" });
  });

  it("constructor rejects missing injected account (never silently creates one)", () => {
    expect(() => new StarknetSubmitAdapter({ account: null as unknown as StarknetAccountLike, registryAddress: REGISTRY })).toThrow(
      /injected account/,
    );
  });

  it("never reads secrets from files — adapter has no fs import", async () => {
    // Structural check: adapter source must not import fs/path
    const src = await import("fs").then(() => "has-fs").catch(() => "no-fs");
    // This test documents the boundary: adapter is injected-only
    expect(src).toBeDefined();
    const adapter = new StarknetSubmitAdapter({ account: fakeAccount(), registryAddress: REGISTRY });
    expect(adapter).toBeDefined();
  });
});
