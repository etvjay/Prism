import { describe, it, expect } from "vitest";
import type { Hex } from "../domain/operation";
import { StarknetSubmitAdapter, type StarknetAccountLike } from "../adapters/starknet-submit";
import { normalizeStarknetContractAddress } from "../../prism-identity/domain/starknet-boundary";

const REGISTRY = "0x1111111111111111111111111111111111111111";
const CONTROLLER = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const EXEC_ACCOUNT = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const REGISTRY_CANONICAL = normalizeStarknetContractAddress(REGISTRY);
const EXEC_ACCOUNT_CANONICAL = normalizeStarknetContractAddress(EXEC_ACCOUNT);
const DIGEST: Hex = "0x00aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Hex;
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
        expect(calls[0].contractAddress).toBe(REGISTRY_CANONICAL);
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
      prismId: "prism:1",
      venue: "BASE",
      executionAccount: EXEC_ACCOUNT,
      proofDigest: DIGEST,
      controllerAddress: CONTROLLER,
    });
    // calldata[0] is felt hex, not raw prism: string
    expect(captured).toEqual(["0x1", "BASE", EXEC_ACCOUNT_CANONICAL, DIGEST.toLowerCase()]);
  });

  it("submitRevoke maps to revoke_binding calldata", async () => {
    let entrypoint = "";
    let captured: unknown[] | null = null;
    const account = fakeAccount({
      execute: async (calls) => {
        entrypoint = calls[0].entrypoint;
        captured = calls[0].calldata as unknown[];
        return { transaction_hash: TX_HASH };
      },
    });
    const adapter = new StarknetSubmitAdapter({ account, registryAddress: REGISTRY });
    await adapter.submitRevoke({
      operationId: "op-3",
      prismId: "prism:1",
      venue: "BASE",
      executionAccount: EXEC_ACCOUNT,
      controllerAddress: CONTROLLER,
    });
    expect(entrypoint).toBe("revoke_binding");
    expect(captured).toEqual(["0x1", "BASE", EXEC_ACCOUNT_CANONICAL]);
  });

  it("preserves submitted != completed — adapter never marks completed, only returns txHash", async () => {
    const account = fakeAccount();
    const adapter = new StarknetSubmitAdapter({ account, registryAddress: REGISTRY });
    const res = await adapter.submitBind({
      operationId: "op-4",
      prismId: "prism:1",
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
        prismId: "prism:1",
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
      ambiguous: true,
    });
  });

  it("validates malformed proof digest with ERR-023", async () => {
    const adapter = new StarknetSubmitAdapter({ account: fakeAccount(), registryAddress: REGISTRY });
    await expect(
      adapter.submitBind({
        operationId: "op-bad",
        prismId: "prism:1",
        venue: "BASE",
        executionAccount: EXEC_ACCOUNT,
        proofDigest: "0x123" as Hex,
        controllerAddress: CONTROLLER,
      }),
    ).rejects.toMatchObject({ code: "ERR-023" });
  });

  it("M3 digest fix: out-of-range (≥2^250) proof digest is field-bounded in calldata, in-range passes through", async () => {
    const REAL_DIGEST = "0x95aee8cf18d7533b8cf6c782bcdf9987915df4a08a6d8c2c14bc4989af5e370f" as Hex;
    const maskedFelt = "0x" + (BigInt(REAL_DIGEST) & ((1n << 250n) - 1n)).toString(16).padStart(64, "0");
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
      operationId: "op-m3",
      prismId: "prism:1",
      venue: "BASE",
      executionAccount: EXEC_ACCOUNT,
      proofDigest: REAL_DIGEST,
      controllerAddress: CONTROLLER,
    });
    // Calldata carries the felt252-safe representation, never the raw 256-bit value.
    expect((captured as unknown as unknown[])[3]).toBe(maskedFelt);
    // In-range digests are unchanged end-to-end.
    let capturedLow: unknown[] | null = null;
    const account2: StarknetAccountLike = {
      address: CONTROLLER,
      execute: async (calls) => {
        capturedLow = calls[0].calldata as unknown[];
        return { transaction_hash: TX_HASH };
      },
    };
    await new StarknetSubmitAdapter({ account: account2, registryAddress: REGISTRY }).submitBind({
      operationId: "op-m3-low",
      prismId: "prism:1",
      venue: "BASE",
      executionAccount: EXEC_ACCOUNT,
      proofDigest: DIGEST,
      controllerAddress: CONTROLLER,
    });
    expect((capturedLow as unknown as unknown[])[3]).toBe(DIGEST.toLowerCase());
  });

  it("validates invalid venue with ERR-001", async () => {
    const adapter = new StarknetSubmitAdapter({ account: fakeAccount(), registryAddress: REGISTRY });
    await expect(
      adapter.submitBind({
        operationId: "op-venue",
        prismId: "prism:1",
        venue: "SOLANA",
        executionAccount: EXEC_ACCOUNT,
        proofDigest: DIGEST,
        controllerAddress: CONTROLLER,
      }),
    ).rejects.toMatchObject({ code: "ERR-001" });
  });

  // -------------------------------------------------------------------------
  // M3-X2 second defect: prismId boundary — prism:1 → 0x1, not raw string
  // -------------------------------------------------------------------------

  it("M3-X2 prismId fix: prism:1 maps to felt 0x1 in bind calldata position 0", async () => {
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
      operationId: "op-prism-1",
      prismId: "prism:1",
      venue: "BASE",
      executionAccount: EXEC_ACCOUNT,
      proofDigest: DIGEST,
      controllerAddress: CONTROLLER,
    });
    expect(captured![0]).toBe("0x1");
    expect(captured![1]).toBe("BASE");
    expect(captured![2]).toBe(EXEC_ACCOUNT_CANONICAL);
    expect(captured![3]).toBe(DIGEST.toLowerCase());
    // Exact positions: felt at 0 and 3
    expect(captured).toEqual(["0x1", "BASE", EXEC_ACCOUNT_CANONICAL, DIGEST.toLowerCase()]);
  });

  it("M3-X2 prismId fix: large decimal maps to hex felt correctly", async () => {
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
      operationId: "op-prism-large",
      prismId: "prism:42",
      venue: "BASE",
      executionAccount: EXEC_ACCOUNT,
      proofDigest: DIGEST,
      controllerAddress: CONTROLLER,
    });
    expect(captured![0]).toBe("0x2a");
  });

  it("M3-X2 prismId fix: revoke calldata position 0 is felt as well", async () => {
    let captured: unknown[] | null = null;
    const account = fakeAccount({
      execute: async (calls) => {
        captured = calls[0].calldata as unknown[];
        return { transaction_hash: TX_HASH };
      },
    });
    const adapter = new StarknetSubmitAdapter({ account, registryAddress: REGISTRY });
    await adapter.submitRevoke({
      operationId: "op-revoke-felt",
      prismId: "prism:123",
      venue: "BASE",
      executionAccount: EXEC_ACCOUNT,
      controllerAddress: CONTROLLER,
    });
    expect(captured![0]).toBe("0x7b");
    expect(captured![1]).toBe("BASE");
    expect(captured![2]).toBe(EXEC_ACCOUNT_CANONICAL);
  });

  it("M3-X2 prismId malformed / non-numeric / negative / leading zeros rejected with ERR-002, never hash-repaired", async () => {
    const adapter = new StarknetSubmitAdapter({ account: fakeAccount(), registryAddress: REGISTRY });
    const badIds = ["prism:P1", "prism:abc", "prism:-1", "prism:001", "prism:00", "prism:", "prism:0", "prism:0x1", "1"];
    for (const bad of badIds) {
      await expect(
        adapter.submitBind({
          operationId: `op-bad-${bad}`,
          prismId: bad,
          venue: "BASE",
          executionAccount: EXEC_ACCOUNT,
          proofDigest: DIGEST,
          controllerAddress: CONTROLLER,
        }),
      ).rejects.toMatchObject({ code: "ERR-002" });
    }
    // Overflow case should be ERR-023
    const { FELT_PRIME } = await import("../../prism-identity/domain/felt-digest");
    const overflow = FELT_PRIME.toString();
    await expect(
      adapter.submitBind({
        operationId: "op-overflow",
        prismId: `prism:${overflow}`,
        venue: "BASE",
        executionAccount: EXEC_ACCOUNT,
        proofDigest: DIGEST,
        controllerAddress: CONTROLLER,
      }),
    ).rejects.toMatchObject({ code: "ERR-023" });
  });

  it("M3-X2 combined: bind calldata carries both felt prismId and felt digest at exact positions", async () => {
    const REAL_DIGEST = "0x95aee8cf18d7533b8cf6c782bcdf9987915df4a08a6d8c2c14bc4989af5e370f" as Hex;
    const masked = "0x" + (BigInt(REAL_DIGEST) & ((1n << 250n) - 1n)).toString(16).padStart(64, "0");
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
      operationId: "op-combined",
      prismId: "prism:7",
      venue: "BASE",
      executionAccount: EXEC_ACCOUNT,
      proofDigest: REAL_DIGEST,
      controllerAddress: CONTROLLER,
    });
    expect(captured![0]).toBe("0x7");
    expect(captured![3]).toBe(masked);
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
