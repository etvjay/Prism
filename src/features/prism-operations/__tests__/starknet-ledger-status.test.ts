import { describe, expect, it } from "vitest";
import type { Hex } from "../domain/operation";
import { StarknetLedgerStatusAdapter, StarknetLedgerStatusError, type StarknetRpcReader } from "../adapters/starknet-ledger-status";

const TX = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Hex;

function reader(overrides: Partial<StarknetRpcReader> = {}): StarknetRpcReader {
  return {
    getTransactionStatus: async () => ({ finality_status: "ACCEPTED_ON_L2", execution_status: "SUCCEEDED" }),
    getTransactionReceipt: async () => ({ finality_status: "ACCEPTED_ON_L2", execution_status: "SUCCEEDED", block_number: 42 }),
    ...overrides,
  };
}

describe("StarknetLedgerStatusAdapter", () => {
  it("maps a successful receipt to a canonical chain observation", async () => {
    await expect(new StarknetLedgerStatusAdapter({ rpcUrl: "http://rpc.invalid", reader: reader() }).observeChain(TX)).resolves.toEqual({
      txHash: TX,
      finality: "ACCEPTED_ON_L2",
      execution: "SUCCEEDED",
      revertCode: null,
      blockNumber: 42,
    });
  });

  it("maps a pending status without inventing a receipt", async () => {
    const pending = reader({
      getTransactionStatus: async () => ({ finality_status: "RECEIVED", execution_status: null }),
      getTransactionReceipt: async () => {
        throw new Error("TRANSACTION_HASH_NOT_FOUND");
      },
    });
    await expect(new StarknetLedgerStatusAdapter({ rpcUrl: "http://rpc.invalid", reader: pending }).observeChain(TX)).resolves.toEqual({
      txHash: TX,
      finality: "RECEIVED",
      execution: null,
      revertCode: null,
      blockNumber: null,
    });
  });

  it("maps a reverted receipt and preserves its reason", async () => {
    const reverted = reader({
      getTransactionStatus: async () => ({ finality_status: "ACCEPTED_ON_L2", execution_status: "REVERTED" }),
      getTransactionReceipt: async () => ({ finality_status: "ACCEPTED_ON_L2", execution_status: "REVERTED", revert_reason: "ERR-008" }),
    });
    await expect(new StarknetLedgerStatusAdapter({ rpcUrl: "http://rpc.invalid", reader: reverted }).observeChain(TX)).resolves.toMatchObject({
      execution: "REVERTED",
      revertCode: "ERR-008",
    });
  });

  it("returns null for a transaction hash that is not known yet", async () => {
    const unknown = reader({
      getTransactionStatus: async () => {
        throw new Error("TRANSACTION_HASH_NOT_FOUND");
      },
    });
    await expect(new StarknetLedgerStatusAdapter({ rpcUrl: "http://rpc.invalid", reader: unknown }).observeChain(TX)).resolves.toBeNull();
  });

  it("fails closed for dependency errors instead of returning optimistic state", async () => {
    const broken = reader({
      getTransactionStatus: async () => {
        throw new Error("connection reset");
      },
    });
    await expect(new StarknetLedgerStatusAdapter({ rpcUrl: "http://rpc.invalid", reader: broken }).observeChain(TX)).rejects.toBeInstanceOf(
      StarknetLedgerStatusError,
    );
  });
});
