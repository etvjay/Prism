// WalletAccountV6 → M5Provider adapter — provider-injected boundary.
// Current pins: starknet 10.4.0, get-starknet 6.0.3, types-js 0.10.3
// The dapp never touches viewing keys; wallet owns keys/notes/proofs.

import type { M5Provider, Strk20Action, Strk20CallAndProof, M5TransactionObservation } from "./ports";
import type { Hex } from "../domain/receipt";
import { assertNoViewingKey } from "../domain/privacy-guard";

// Minimal WalletAccountV6 shape we depend on — matches starknet 10.4.0 WalletAccountV6
export interface WalletAccountV6Like {
  address: string;
  provider: {
    getChainId(): Promise<string>;
    // optional call for balance_of
    callContract?(call: { contractAddress: string; entrypoint: string; calldata: string[] }): Promise<string[]>;
    getTransactionReceipt?(txHash: string): Promise<unknown>;
    getTransaction?(txHash: string): Promise<unknown>;
  };
  // STRK20 methods added in V6
  strk20PrepareInvoke(actions: Strk20Action[], simulate?: boolean): Promise<Strk20CallAndProof>;
  strk20InvokeTransaction(actions: Strk20Action[]): Promise<{ transaction_hash: Hex }>;
  // Optional fee — not all wallets expose; fallback to RPC
  getFeeAmount?(): Promise<{ fee: bigint; blockNumber: number | null }>;
}

export interface WalletV6AdapterDeps {
  wallet: WalletAccountV6Like;
  // Wallet-standard provider for capability queries (walletV6 helpers)
  capabilityProvider: {
    supportedWalletApi(wallet: unknown): Promise<string[]>;
    supportedSpecs(wallet: unknown): Promise<string[]>;
    requestChainId(wallet: unknown): Promise<string>;
  };
  walletFeatures: unknown; // WalletWithStarknetFeatures
  // Optional RPC fallback for fee
  feeReader?: { getFeeAmount(): Promise<{ fee: bigint; blockNumber: number | null }> };
  // Optional receipt polling via RPC
  rpcReader?: {
    getTransactionReceipt(txHash: Hex): Promise<{ transactionHash?: string; executionStatus: string; finalityStatus?: string; blockNumber: number | null; senderAddress?: string | null; events: { address: string; keys: string[]; data?: string[] }[] } | null>;
    getBalance?(token: string, account: string): Promise<bigint>;
    getTransaction?(txHash: Hex): Promise<{ transactionHash?: string; calldata: string[] } | null>;
  };
}

export class WalletV6M5Adapter implements M5Provider {
  private deps: WalletV6AdapterDeps;
  _isMock = false;

  constructor(deps: WalletV6AdapterDeps) {
    assertNoViewingKey(deps, "WalletV6M5Adapter_deps");
    this.deps = deps;
  }

  async supportedWalletApi(): Promise<string[]> {
    return this.deps.capabilityProvider.supportedWalletApi(this.deps.walletFeatures);
  }
  async supportedSpecs(): Promise<string[]> {
    return this.deps.capabilityProvider.supportedSpecs(this.deps.walletFeatures);
  }
  async requestChainId(): Promise<string> {
    try {
      return await this.deps.capabilityProvider.requestChainId(this.deps.walletFeatures);
    } catch {
      return this.deps.wallet.provider.getChainId();
    }
  }
  async isRegistered(): Promise<boolean | null> {
    // WalletAccountV6 owns registration and the pinned Wallet API surface does
    // not expose a proven read-only registration query. Do not turn that
    // absence into a fabricated `true`; the prepare/submit boundary still maps
    // an explicit NOT_REGISTERED rejection.
    return null;
  }
  async getFeeAmount(): Promise<{ fee: bigint; blockNumber: number | null }> {
    if (this.deps.feeReader) return this.deps.feeReader.getFeeAmount();
    if (this.deps.wallet.getFeeAmount) return this.deps.wallet.getFeeAmount();
    // Fallback: read from pool via RPC if available — pool get_fee_amount is view
    // For now throw unavailable so runner surfaces FEE_UNAVAILABLE distinctly
    throw new Error("FEE_UNAVAILABLE: no fee reader configured");
  }
  async strk20PrepareInvoke(actions: Strk20Action[], simulate: boolean): Promise<Strk20CallAndProof> {
    assertNoViewingKey(actions, "strk20PrepareInvoke_actions");
    return this.deps.wallet.strk20PrepareInvoke(actions, simulate);
  }
  async strk20InvokeTransaction(actions: Strk20Action[]): Promise<{ transaction_hash: Hex }> {
    assertNoViewingKey(actions, "strk20InvokeTransaction_actions");
    return this.deps.wallet.strk20InvokeTransaction(actions);
  }
  async getReceipt(txHash: Hex): Promise<{ transactionHash?: string; executionStatus: "SUCCEEDED" | "REVERTED" | "RECEIVED" | string; finalityStatus?: string; blockNumber: number | null; senderAddress?: string | null; events: { address: string; keys: string[]; data?: string[] }[] } | null> {
    // Prefer wallet provider, fallback to RPC reader
    if (this.deps.rpcReader) {
      const r = await this.deps.rpcReader.getTransactionReceipt(txHash);
      if (r) return r;
    }
    const prov = this.deps.wallet.provider as { getTransactionReceipt?: (h: string) => Promise<unknown> };
    if (prov.getTransactionReceipt) {
      const raw = (await prov.getTransactionReceipt(txHash)) as {
        transaction_hash?: string;
        transactionHash?: string;
        execution_status?: string;
        executionStatus?: string;
        finality_status?: string;
        finalityStatus?: string;
        block_number?: number | null;
        blockNumber?: number | null;
        sender_address?: string | null;
        senderAddress?: string | null;
        events?: { from_address?: string; address?: string; keys?: string[]; data?: string[] }[];
      } | null;
      if (!raw) return null;
      const exec = (raw.execution_status ?? raw.executionStatus ?? "UNKNOWN") as string;
      const finalityStatus = raw.finality_status ?? raw.finalityStatus;
      const blockNumber = (raw.block_number ?? raw.blockNumber ?? null) as number | null;
      const events = (raw.events ?? []).map((e) => ({
        address: (e.from_address ?? e.address ?? "0x0") as string,
        keys: e.keys ?? [],
        data: e.data ?? [],
      }));
      return {
        transactionHash: raw.transaction_hash ?? raw.transactionHash ?? txHash,
        executionStatus: exec as "SUCCEEDED" | "REVERTED" | "RECEIVED",
        ...(finalityStatus === undefined ? {} : { finalityStatus }),
        blockNumber,
        senderAddress: raw.sender_address ?? raw.senderAddress ?? null,
        events,
      };
    }
    return null;
  }
  async getTransaction(txHash: Hex): Promise<M5TransactionObservation | null> {
    if (this.deps.rpcReader?.getTransaction) return this.deps.rpcReader.getTransaction(txHash);
    const provider = this.deps.wallet.provider as { getTransaction?: (h: string) => Promise<unknown> };
    if (!provider.getTransaction) return null;
    const raw = await provider.getTransaction(txHash);
    assertNoViewingKey(raw, "getTransaction.raw");
    if (!raw || typeof raw !== "object") return null;
    const calldata = (raw as { calldata?: unknown }).calldata;
    if (!Array.isArray(calldata) || !calldata.every((value) => typeof value === "string")) {
      throw new Error("transaction_calldata_missing_or_malformed");
    }
    const transactionHash = (raw as { transaction_hash?: unknown; transactionHash?: unknown }).transaction_hash
      ?? (raw as { transactionHash?: unknown }).transactionHash;
    return {
      ...(typeof transactionHash === "string" ? { transactionHash } : {}),
      calldata,
    };
  }
  async callBalance(token: string, account: string): Promise<bigint> {
    if (this.deps.rpcReader?.getBalance) return this.deps.rpcReader.getBalance(token, account);
    const prov = this.deps.wallet.provider as { callContract?: (c: { contractAddress: string; entrypoint: string; calldata: string[] }) => Promise<string[]> };
    if (prov.callContract) {
      const res = await prov.callContract({ contractAddress: token, entrypoint: "balance_of", calldata: [account] });
      const low = BigInt(res[0] ?? "0x0");
      const high = res.length > 1 ? BigInt(res[1]) : 0n;
      return low + (high << 128n);
    }
    throw new Error("balance reader unavailable");
  }
  async getAddress(): Promise<string> {
    return this.deps.wallet.address;
  }
}
