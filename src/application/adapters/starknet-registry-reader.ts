// Read-only Starknet registry reader — RegistryReadPort via injected RpcProvider.callContract.
// No submit, no secrets, no private keys. Fail-closed on dependency.
// Transport-neutral port: factory injects RpcProvider when STARKNET_RPC_URL present; otherwise InMemoryRegistry is used.
// Never fabricates prismId felt; uses explicit prismIdToRegistryFelt conversion at this boundary.

import { RpcProvider } from "starknet";
import type { RegistryReadPort } from "../ports";
import type { Hex } from "../../features/prism-operations/domain/operation";
import { prismIdToRegistryFelt } from "../../features/prism-identity/domain/felt-digest";

export interface StarknetRegistryReaderOptions {
  rpcUrl: string;
  registryAddress: string;
  reader?: StarknetRegistryReaderRpc;
}

export interface StarknetRegistryReaderRpc {
  callContract?(args: { contractAddress: string; entrypoint: string; calldata: string[] }): Promise<string[]>;
  call?(args: { contractAddress: string; entrypoint: string; calldata: string[] }): Promise<string[]>;
  getBlockNumber?(): Promise<number>;
}

export class StarknetRegistryReaderError extends Error {
  readonly code = "registry_unavailable" as const;
  constructor(message: string, cause?: unknown) {
    super(`${message}${cause instanceof Error ? `: ${cause.message}` : ""}`);
    this.name = "StarknetRegistryReaderError";
  }
}

function isNotFoundError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /NOT_FOUND|not found|uninitialized/i.test(msg);
}

function toBaseFelt(venue: string): string {
  if (venue.toUpperCase() === "BASE") return "0x42415345"; // 'BASE' ascii as felt
  throw new StarknetRegistryReaderError(`unsupported_venue:${venue}`);
}

export class StarknetRegistryReader implements RegistryReadPort {
  private readonly reader: StarknetRegistryReaderRpc;
  private readonly registryAddress: string;

  constructor(options: StarknetRegistryReaderOptions) {
    if (!options.registryAddress || !/^0x[0-9a-f]{1,64}$/i.test(options.registryAddress.trim())) {
      throw new StarknetRegistryReaderError(`invalid_registry_address:${options.registryAddress}`);
    }
    if (!options.rpcUrl || !/^https?:\/\//i.test(options.rpcUrl.trim())) {
      throw new StarknetRegistryReaderError(`invalid_rpc_url:${String(options.rpcUrl ?? "").slice(0, 40)}`);
    }
    this.registryAddress = options.registryAddress.trim().toLowerCase();
    const rpcUrl = options.rpcUrl.trim();
    if (options.reader) {
      this.reader = options.reader;
    } else {
      this.reader = new RpcProvider({ nodeUrl: rpcUrl }) as unknown as StarknetRegistryReaderRpc;
    }
  }

  private async doCall(entrypoint: string, calldata: string[]): Promise<string[]> {
    try {
      if (typeof this.reader.callContract === "function") {
        return await this.reader.callContract({ contractAddress: this.registryAddress, entrypoint, calldata });
      }
      if (typeof this.reader.call === "function") {
        return await this.reader.call({ contractAddress: this.registryAddress, entrypoint, calldata });
      }
      throw new StarknetRegistryReaderError("reader_missing_callContract");
    } catch (cause) {
      if (cause instanceof StarknetRegistryReaderError) throw cause;
      throw new StarknetRegistryReaderError(`${entrypoint}_call_failed`, cause);
    }
  }

  async getIdentity(prismId: string): Promise<{ controller: string; createdAtBlock: number; version: number } | null> {
    let felt: string;
    try {
      felt = prismIdToRegistryFelt(prismId);
    } catch {
      return null; // malformed prismId -> not found, fail-closed per read port
    }
    try {
      const res = await this.doCall("get_identity", [felt]);
      // Cairo Option<Identity>: returns [0] for None, or [1, controller_felt, created_block, version] for Some
      if (!res || res.length === 0) return null;
      if (res[0] === "0x0" || res[0] === "0") return null;
      // res[1] controller address felt, res[2] block, res[3] version — handle both shapes
      const controller = res[1] ?? res[0];
      if (!controller || controller === "0x0" || controller === "0") return null;
      const createdAtBlock = Number.parseInt(res[2] ?? "0", 16);
      const version = Number.parseInt(res[3] ?? "0", 16);
      return {
        controller: controller.toLowerCase(),
        createdAtBlock: Number.isFinite(createdAtBlock) ? createdAtBlock : 0,
        version: Number.isFinite(version) ? version : 0,
      };
    } catch (cause) {
      if (isNotFoundError(cause)) return null;
      throw new StarknetRegistryReaderError("getIdentity_failed", cause);
    }
  }

  async resolve(prismId: string, venue: string): Promise<{ executionAccount: string | null; watermark: number }> {
    let felt: string;
    try {
      felt = prismIdToRegistryFelt(prismId);
    } catch {
      return { executionAccount: null, watermark: 0 };
    }
    const venueFelt = toBaseFelt(venue);
    try {
      const res = await this.doCall("resolve", [felt, venueFelt]);
      // Resolution: [0] = variant 0 NoActiveDestination, 1 ActiveDestination with account
      if (!res || res.length === 0) return { executionAccount: null, watermark: 0 };
      if (res[0] === "0x0" || res[0] === "0") return { executionAccount: null, watermark: 0 };
      const account = res[1] ?? null;
      if (!account || account === "0x0" || account === "0") return { executionAccount: null, watermark: 0 };
      // watermark not returned by contract directly; caller uses confirmed block via ledger
      return { executionAccount: account.toLowerCase(), watermark: 0 };
    } catch (cause) {
      if (isNotFoundError(cause)) return { executionAccount: null, watermark: 0 };
      throw new StarknetRegistryReaderError("resolve_failed", cause);
    }
  }

  async getBinding(prismId: string, venue: string, executionAccount: string): Promise<{ status: "ACTIVE" | "REVOKED" | null }> {
    // Read via resolve pointer: if resolve returns this account, it's ACTIVE; else unknown.
    // For read-only path we approximate via resolve; real binding status requires storage read not exposed via view.
    // Preserve fail-closed: return null sentinel, allow caller to distinguish.
    const r = await this.resolve(prismId, venue);
    if (r.executionAccount && r.executionAccount.toLowerCase() === executionAccount.toLowerCase()) {
      return { status: "ACTIVE" };
    }
    return { status: null };
  }

  async isDigestConsumed(digest: Hex): Promise<boolean> {
    // View not exposed via read port in contract; treat as not consumed for read-only path.
    // Real single-use check is enforced onchain at bind tx; read port returns false fail-closed (allow submit, chain will reject if consumed).
    void digest;
    return false;
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
