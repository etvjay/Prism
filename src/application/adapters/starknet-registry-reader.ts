// Read-only Starknet registry reader — thin compatibility wrapper over canonical M1 StarknetRegistryReadAdapter.
// No submit, no secrets, no private keys. Fail-closed on dependency.
// This file is a delegating wrapper; authoritative parsing/normalization lives in StarknetRegistryReadAdapter
// (stable ERR-002 / ERR-023 / ERR-021, Option/bare-struct handling, controller/prismId felt conversion).
// Factory now uses the single shared provider; this wrapper exists so legacy import paths behave identically.
// Never fabricates prismId felt; conversion at canonical boundary only.

import { RpcProvider } from "starknet";
import type { RegistryReadPort } from "../ports";
import type { Hex } from "../../features/prism-operations/domain/operation";
import {
  StarknetRegistryReadAdapter,
  StarknetRegistryReadError,
} from "../../features/prism-operations/adapters/starknet-registry-read";
import type { StarknetCallReader } from "../../features/prism-operations/adapters/starknet-registry-read";

export interface StarknetRegistryReaderOptions {
  rpcUrl: string;
  registryAddress: string;
  reader?: StarknetRegistryReaderRpc;
}

export interface StarknetRegistryReaderRpc {
  callContract?(args: { contractAddress: string; entrypoint: string; calldata: string[] }, blockIdentifier?: string): Promise<string[]>;
  call?(args: { contractAddress: string; entrypoint: string; calldata: string[] }): Promise<string[]>;
  getBlockNumber?(): Promise<number>;
}

// Re-export canonical error as legacy name so callers catching StarknetRegistryReaderError catch the same codes.
export { StarknetRegistryReadError as StarknetRegistryReaderError };

const CONTRACT_ADDRESS_LIMIT = 1n << 251n;

function isValidContractAddress(value: string): boolean {
  if (!/^0x[0-9a-f]{1,64}$/i.test(value.trim())) return false;
  const n = BigInt(value.trim());
  return n > 0n && n < CONTRACT_ADDRESS_LIMIT;
}

export class StarknetRegistryReader implements RegistryReadPort {
  private readonly delegate: StarknetRegistryReadAdapter;

  constructor(options: StarknetRegistryReaderOptions) {
    if (!options.registryAddress || !isValidContractAddress(options.registryAddress)) {
      throw new StarknetRegistryReadError("ERR-002", `invalid_registry_address:${options.registryAddress}`);
    }
    if (!options.rpcUrl || !/^https?:\/\//i.test(options.rpcUrl.trim())) {
      throw new StarknetRegistryReadError("ERR-021", `invalid_rpc_url:${String(options.rpcUrl ?? "").slice(0, 40)}`);
    }
    let callReader: StarknetCallReader;
    if (options.reader) {
      const r = options.reader as unknown as StarknetCallReader & StarknetRegistryReaderRpc;
      if (typeof r.callContract === "function") {
        callReader = {
          callContract: (req, blockId) => (r.callContract as unknown as (request: { contractAddress: string; entrypoint: string; calldata: string[] }, identifier?: string) => Promise<string[]>)(req, blockId),
          getBlockNumber: r.getBlockNumber?.bind(r),
        };
      } else if (typeof (r as unknown as { call?: unknown }).call === "function") {
        const withCall = r as unknown as { call: (args: { contractAddress: string; entrypoint: string; calldata: string[] }) => Promise<string[]>; getBlockNumber?: () => Promise<number> };
        callReader = {
          callContract: (req) => withCall.call(req),
          getBlockNumber: withCall.getBlockNumber?.bind(withCall),
        };
      } else {
        throw new StarknetRegistryReadError("ERR-021", "reader_missing_callContract");
      }
    } else {
      callReader = new RpcProvider({ nodeUrl: options.rpcUrl.trim() }) as unknown as StarknetCallReader;
    }
    this.delegate = new StarknetRegistryReadAdapter({ reader: callReader, registryAddress: options.registryAddress });
  }

  async getIdentity(prismId: string): Promise<{ controller: string; createdAtBlock: number; version: number } | null> {
    return this.delegate.getIdentity(prismId);
  }

  async resolve(prismId: string, venue: string): Promise<{ executionAccount: string | null; watermark: number }> {
    return this.delegate.resolve(prismId, venue);
  }

  async getBinding(prismId: string, venue: string, executionAccount: string): Promise<{ status: "ACTIVE" | "REVOKED" | null }> {
    return this.delegate.getBinding(prismId, venue, executionAccount);
  }

  async isDigestConsumed(digest: Hex): Promise<boolean> {
    return this.delegate.isDigestConsumed(digest);
  }
}

// Validators for env gating — never log secrets
export function getStarknetRpcUrl(): string | null {
  const raw = (process.env.STARKNET_RPC_URL ?? process.env.NEXT_PUBLIC_STARKNET_RPC_URL ?? "").trim();
  if (!raw) return null;
  return raw;
}

export function getStarknetRegistryAddress(): string | null {
  const raw = (process.env.STARKNET_REGISTRY_ADDRESS ?? process.env.PRISM_REGISTRY_ADDRESS ?? "").trim();
  if (!raw) return null;
  return raw;
}

export function isStarknetReadConfigured(): boolean {
  const rpc = getStarknetRpcUrl();
  const addr = getStarknetRegistryAddress();
  if (!rpc || !addr) return false;
  if (!/^https?:\/\//i.test(rpc)) return false;
  if (!/^0x[0-9a-f]{1,64}$/i.test(addr.trim())) return false;
  return true;
}

export function isStarknetRpcUrlValid(url: string): boolean {
  return /^https?:\/\//i.test(url);
}
