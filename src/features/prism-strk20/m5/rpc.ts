// Independent RPC readback — public/read-only, no secrets, second path.
// Uses starknet.js Provider when available, otherwise fetch-based JSON-RPC.
// No private state, no viewing keys.

import type { Hex } from "../domain/receipt";

// starknet.js 10.4.0 `hash.getSelectorFromName("balance_of")`, encoded as
// the felt selector required by the Starknet JSON-RPC `starknet_call` schema.
export const BALANCE_OF_SELECTOR = "0x35a73cd311a05d46deda634c5ee045db92f811b4e74bca4437fcb5302b7af33" as const;

export interface StarknetRpcConfig {
  url: string;
  // Optional second URL for independent verification (X3 requires distinct read)
  secondUrl?: string | null;
}

export async function fetchReceiptViaRpc(
  rpcUrl: string,
  txHash: Hex,
): Promise<{
  executionStatus: string;
  finalityStatus: string;
  blockNumber: number | null;
  events: { address: string; keys: string[]; data?: string[] }[];
} | null> {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "starknet_getTransactionReceipt",
    params: [txHash],
  });
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  if (!res.ok) return null;
  const json = (await res.json()) as {
    result?: {
      execution_status?: string;
      finality_status?: string;
      block_number?: number | null;
      block_hash?: string | null;
      events?: { from_address?: string; keys?: string[]; data?: string[]; address?: string }[];
    };
    error?: { message: string };
  };
  if (json.error) return null;
  const r = json.result;
  if (!r) return null;
  const exec = r.execution_status ?? "UNKNOWN";
  const fin = r.finality_status ?? "UNKNOWN";
  const blockNumber = typeof r.block_number === "number" ? r.block_number : null;
  const events = (r.events ?? []).map((e) => ({
    address: e.from_address ?? e.address ?? "0x0",
    keys: e.keys ?? [],
    data: e.data ?? [],
  }));
  return { executionStatus: exec, finalityStatus: fin, blockNumber, events };
}

export async function fetchBalanceViaRpc(rpcUrl: string, token: string, account: string): Promise<bigint> {
  // balance_of(account) — standard ERC20
  const calldata = [account];
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "starknet_call",
    params: [{ contract_address: token, entry_point_selector: BALANCE_OF_SELECTOR, calldata }, "latest"],
  });
  const res = await fetch(rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body });
  if (!res.ok) throw new Error(`balance_of RPC failed: ${res.status}`);
  const json = (await res.json()) as { result?: string[]; error?: { message: string } };
  if (json.error) throw new Error(json.error.message);
  const result = json.result ?? [];
  if (result.length === 0) return 0n;
  // u256 is two felts: low, high
  const low = BigInt(result[0]);
  const high = result.length > 1 ? BigInt(result[1]) : 0n;
  return low + (high << 128n);
}

export async function fetchBlockNumberViaRpc(rpcUrl: string): Promise<number> {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "starknet_blockNumber", params: [] });
  const res = await fetch(rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body });
  if (!res.ok) throw new Error(`blockNumber RPC failed: ${res.status}`);
  const json = (await res.json()) as { result?: number; error?: { message: string } };
  if (json.error) throw new Error(json.error.message);
  return json.result ?? 0;
}

export function createIndependentRpcReader(rpcUrl: string) {
  return {
    getTransactionReceipt: (txHash: Hex) => fetchReceiptViaRpc(rpcUrl, txHash),
    getBalance: (token: string, account: string) => fetchBalanceViaRpc(rpcUrl, token, account),
    getBlockNumber: () => fetchBlockNumberViaRpc(rpcUrl),
  };
}

export function hasIndependentRead(secondUrl: string | null | undefined, primaryUrl: string): boolean {
  return !!secondUrl && secondUrl !== primaryUrl;
}
