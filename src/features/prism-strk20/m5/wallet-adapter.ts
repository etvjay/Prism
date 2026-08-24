// WalletAccountV6 → M5Provider adapter — provider-injected boundary.
// Current pins: starknet 10.4.0, get-starknet 6.0.3, types-js 0.10.3
// The dapp never touches viewing keys; wallet owns keys/notes/proofs.

import type { M5Provider, Strk20Action, Strk20CallAndProof } from "./ports";
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
    getTransactionReceipt(txHash: Hex): Promise<{ executionStatus: string; blockNumber: number | null; events: { address: string; keys: string[] }[] } | null>;
    getBalance?(token: string, account: string): Promise<bigint>;
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
  async isRegistered(): Promise<boolean> {
    // Wallet handles registration; we probe via a simulate that would throw NOT_REGISTERED
    // If wallet exposes isRegistered we would use it, but spec says wallet manages it.
    // We try a lightweight prepare with empty actions to test, but that would be privacy leak.
    // Instead, we return true and let the prepare/invoke surface NOT_REGISTERED distinctly.
    // This preserves distinct error code per spec.
    return true;
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
  async getReceipt(txHash: Hex): Promise<{ executionStatus: "SUCCEEDED" | "REVERTED" | "RECEIVED" | string; blockNumber: number | null; events: { address: string; keys: string[] }[] } | null> {
    // Prefer wallet provider, fallback to RPC reader
    if (this.deps.rpcReader) {
      const r = await this.deps.rpcReader.getTransactionReceipt(txHash);
      if (r) return r as { executionStatus: "SUCCEEDED" | "REVERTED" | "RECEIVED"; blockNumber: number | null; events: { address: string; keys: string[] }[] };
    }
    const prov = this.deps.wallet.provider as { getTransactionReceipt?: (h: string) => Promise<unknown> };
    if (prov.getTransactionReceipt) {
      const raw = (await prov.getTransactionReceipt(txHash)) as {
        execution_status?: string;
        executionStatus?: string;
        block_number?: number | null;
        blockNumber?: number | null;
        events?: { from_address?: string; address?: string; keys?: string[] }[];
        finality_status?: string;
      } | null;
      if (!raw) return null;
      const exec = (raw.execution_status ?? raw.executionStatus ?? "UNKNOWN") as string;
      const blockNumber = (raw.block_number ?? raw.blockNumber ?? null) as number | null;
      const events = (raw.events ?? []).map((e) => ({
        address: (e.from_address ?? e.address ?? "0x0") as string,
        keys: e.keys ?? [],
      }));
      return { executionStatus: exec as "SUCCEEDED" | "REVERTED" | "RECEIVED", blockNumber, events };
    }
    return null;
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
  async getBlockNumber(): Promise<number> {
    // Not required for core flow
    return 0;
  }
}
