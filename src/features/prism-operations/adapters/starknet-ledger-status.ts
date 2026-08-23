import { RpcProvider } from "starknet";
import type { Hex } from "../domain/operation";
import type {
  ChainTxObservation,
  LedgerStatusPort,
  TxExecutionStatus,
  TxFinalityStatus,
} from "../domain/ports";

/** Minimal reader surface needed from starknet.js; easy to replace in tests. */
export interface StarknetRpcReader {
  getTransactionStatus(txHash: string): Promise<Record<string, unknown>>;
  getTransactionReceipt(txHash: string): Promise<Record<string, unknown>>;
}

export type StarknetLedgerStatusOptions = {
  rpcUrl: string;
  reader?: StarknetRpcReader;
};

export class StarknetLedgerStatusError extends Error {
  readonly code = "ledger_status_unavailable" as const;

  constructor(message: string, cause?: unknown) {
    super(`${message}${cause instanceof Error ? `: ${cause.message}` : ""}`);
    this.name = "StarknetLedgerStatusError";
  }
}

function isNotFound(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /TRANSACTION_HASH_NOT_FOUND|TRANSACTION_NOT_FOUND|not found/i.test(message);
}

function finality(value: unknown): TxFinalityStatus {
  if (value === "ACCEPTED_ON_L1") return "ACCEPTED_ON_L1";
  if (value === "ACCEPTED_ON_L2") return "ACCEPTED_ON_L2";
  return "RECEIVED";
}

function execution(value: unknown): TxExecutionStatus | null {
  if (value === "SUCCEEDED") return "SUCCEEDED";
  if (value === "REVERTED") return "REVERTED";
  if (value === "RECEIVED") return "RECEIVED";
  return null;
}

/**
 * Real starknet.js adapter for the transport-neutral LedgerStatusPort.
 * It observes only; it never advances an Operation or claims completion.
 */
export class StarknetLedgerStatusAdapter implements LedgerStatusPort {
  private readonly reader: StarknetRpcReader;

  constructor(options: StarknetLedgerStatusOptions) {
    this.reader =
      options.reader ??
      (new RpcProvider({ nodeUrl: options.rpcUrl }) as unknown as StarknetRpcReader);
  }

  async observeChain(txHash: Hex): Promise<ChainTxObservation | null> {
    let status: Record<string, unknown>;
    try {
      status = await this.reader.getTransactionStatus(txHash);
    } catch (error) {
      if (isNotFound(error)) return null;
      throw new StarknetLedgerStatusError(`status lookup failed for ${txHash}`, error);
    }

    let receipt: Record<string, unknown> | null = null;
    try {
      receipt = await this.reader.getTransactionReceipt(txHash);
    } catch (error) {
      if (!isNotFound(error)) {
        throw new StarknetLedgerStatusError(`receipt lookup failed for ${txHash}`, error);
      }
    }

    const finalityStatus = finality(receipt?.finality_status ?? status.finality_status);
    const executionStatus = execution(receipt?.execution_status ?? status.execution_status);
    const blockNumber =
      typeof receipt?.block_number === "number"
        ? receipt.block_number
        : typeof status.block_number === "number"
          ? status.block_number
          : null;

    return {
      txHash,
      finality: finalityStatus,
      execution: executionStatus,
      revertCode:
        executionStatus === "REVERTED"
          ? typeof receipt?.revert_reason === "string"
            ? receipt.revert_reason
            : null
          : null,
      blockNumber,
    };
  }
}
