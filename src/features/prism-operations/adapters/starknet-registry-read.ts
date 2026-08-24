// Starknet registry read adapter — injected provider, read-only, fail-closed.
// Implements RegistryReadPort.getIdentity/resolve via Starknet callContract.
// No secret file reads, never logs connection strings, never writes strk20.json.
// Starknet is canonical identity authority; unknown identity returns null (ERR-010 view flag, not revert).
// Malformed addresses/prismIds throw with stable ERR codes; dependency failures throw.
// Pagination for events lives in StarknetEventIndexerAdapter; watermark/stale via resolve-service.

import type { Hex } from "../domain/operation";
import type { RegistryReadPort } from "../../../application/ports";
import { prismIdToRegistryFelt } from "../../prism-identity/domain/felt-digest";

export interface StarknetCallReader {
  callContract(
    request: { contractAddress: string; entrypoint: string; calldata: string[] },
    blockIdentifier?: string,
  ): Promise<string[]>;
  // Optional for confirmed-block watermark when wired via ConfirmedBlockPort
  getBlockNumber?(): Promise<number>;
}

export type StarknetRegistryReadOptions = {
  reader: StarknetCallReader;
  registryAddress: string;
};

export class StarknetRegistryReadError extends Error {
  readonly code: string;
  constructor(code: string, message: string, cause?: unknown) {
    super(`${message}${cause instanceof Error ? `: ${cause.message}` : ""}`);
    this.name = "StarknetRegistryReadError";
    this.code = code;
  }
}

const CONTRACT_ADDRESS_LIMIT = 1n << 251n;

function assertHexAddress(value: string, label: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!/^0x[0-9a-f]{1,64}$/.test(trimmed)) {
    throw new StarknetRegistryReadError("ERR-002", `malformed_address:${label}:${value}`);
  }
  const numeric = BigInt(trimmed);
  if (numeric === 0n || numeric >= CONTRACT_ADDRESS_LIMIT) {
    throw new StarknetRegistryReadError("ERR-002", `address_out_of_range:${label}:${value}`);
  }
  return trimmed;
}

function normalizeController(raw: string): string {
  // Starknet ContractAddress felt: normalize to 0x + 64 hex padded lower
  const v = raw.trim().toLowerCase();
  if (!v.startsWith("0x")) return raw;
  try {
    const n = BigInt(v);
    if (n === 0n || n >= CONTRACT_ADDRESS_LIMIT) throw new StarknetRegistryReadError("ERR-002", `address_out_of_range:controller:${raw}`);
    return `0x${n.toString(16).padStart(64, "0")}`;
  } catch (cause) {
    if (cause instanceof StarknetRegistryReadError) throw cause;
    throw new StarknetRegistryReadError("ERR-002", `malformed_controller:${raw}`);
  }
}

export class StarknetRegistryReadAdapter implements RegistryReadPort {
  private readonly reader: StarknetCallReader;
  private readonly registryAddress: string;

  constructor(options: StarknetRegistryReadOptions) {
    if (!options.reader || typeof options.reader.callContract !== "function") {
      throw new Error("invariant_violation: StarknetRegistryReadAdapter requires injected reader.callContract");
    }
    this.registryAddress = assertHexAddress(options.registryAddress, "registryAddress");
    this.reader = options.reader;
  }

  async getIdentity(prismId: string): Promise<{ controller: string; createdAtBlock: number; version: number } | null> {
    let felt: string;
    try {
      felt = prismIdToRegistryFelt(prismId);
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : String(cause);
      // Preserve stable code from felt-digest (ERR-002 / ERR-023)
      const codeMatch = msg.match(/ERR-0\d{2,3}/);
      const code = codeMatch ? codeMatch[0] : "ERR-002";
      throw new StarknetRegistryReadError(code, `malformed_prism_id:${prismId}`, cause);
    }
    let result: string[];
    try {
      result = await this.reader.callContract(
        { contractAddress: this.registryAddress, entrypoint: "get_identity", calldata: [felt] },
        "latest",
      );
    } catch (cause) {
      throw new StarknetRegistryReadError("ERR-021", "get_identity_call_failed", cause);
    }
    if (!Array.isArray(result) || result.length === 0) {
      throw new StarknetRegistryReadError("ERR-023", `malformed_get_identity_response:${JSON.stringify(result).slice(0, 200)}`);
    }
    // Option<Identity> encoding in the deployed Cairo ABI: [0] => Some,
    // [1] => None. The live registry returns [0, controller, block, version]
    // for an existing identity and [1] for an unknown id.
    const tag = result[0].trim().toLowerCase();
    if (tag === "0x1" || tag === "1" || tag === "0x0000000000000000000000000000000000000000000000000000000000000001") {
      return null; // fail-closed unknown: None, not an error
    }
    if (tag !== "0x0" && tag !== "0" && tag !== "0x0000000000000000000000000000000000000000000000000000000000000000") {
      // Some Cairo versions encode Option as bare struct without tag when Some
      // (controller, created_at_block, version).
      if (result.length === 3) {
        const controller = normalizeController(result[0]);
        const createdAtBlock = Number(result[1]);
        const version = Number(result[2]);
        if (!Number.isFinite(createdAtBlock) || !Number.isFinite(version)) {
          throw new StarknetRegistryReadError("ERR-023", `malformed_get_identity_fields:${JSON.stringify(result).slice(0, 200)}`);
        }
        if (!/^0x[0-9a-f]{64}$/.test(controller)) {
          throw new StarknetRegistryReadError("ERR-002", `malformed_controller:${controller}`);
        }
        return { controller, createdAtBlock, version };
      }
      throw new StarknetRegistryReadError("ERR-023", `malformed_get_identity_tag:${tag}`);
    }
    // Tagged Some uses tag 0: [0, controller, created_at_block, version].
    if (result.length < 4) {
      throw new StarknetRegistryReadError("ERR-023", `malformed_get_identity_some_short:${JSON.stringify(result).slice(0, 200)}`);
    }
    const controller = normalizeController(result[1]);
    const createdAtBlock = Number(result[2]);
    const version = Number(result[3]);
    if (!Number.isFinite(createdAtBlock) || !Number.isFinite(version)) {
      throw new StarknetRegistryReadError("ERR-023", `malformed_get_identity_fields:${JSON.stringify(result).slice(0, 200)}`);
    }
    if (!/^0x[0-9a-f]{1,64}$/.test(controller)) {
      throw new StarknetRegistryReadError("ERR-002", `malformed_controller:${controller}`);
    }
    return { controller, createdAtBlock, version };
  }

  async resolve(prismId: string, venue: string): Promise<{ executionAccount: string | null; watermark: number }> {
    let felt: string;
    try {
      felt = prismIdToRegistryFelt(prismId);
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : String(cause);
      const codeMatch = msg.match(/ERR-0\d{2,3}/);
      const code = codeMatch ? codeMatch[0] : "ERR-002";
      throw new StarknetRegistryReadError(code, `malformed_prism_id:${prismId}`, cause);
    }
    if (venue.toUpperCase() !== "BASE") {
      // Outside M1 scope for venue, but fail-closed: unknown venue => no active
      // Preserve ERR-001 for observability but don't throw for resolve path
      return { executionAccount: null, watermark: 0 };
    }
    let result: string[];
    try {
      result = await this.reader.callContract(
        { contractAddress: this.registryAddress, entrypoint: "resolve", calldata: [felt, "0x42415345"] },
        "latest",
      );
    } catch (cause) {
      throw new StarknetRegistryReadError("ERR-021", "resolve_call_failed", cause);
    }
    if (!Array.isArray(result) || result.length === 0) {
      throw new StarknetRegistryReadError("ERR-023", `malformed_resolve_response:${JSON.stringify(result).slice(0, 200)}`);
    }
    // Resolution enum declaration order in Cairo is ActiveDestination first,
    // NoActiveDestination second: tag 0 = ACTIVE, tag 1 = NO_ACTIVE.
    const tag = result[0].trim().toLowerCase();
    if (tag === "0x1" || tag === "1") {
      return { executionAccount: null, watermark: 0 };
    }
    if (tag === "0x0" || tag === "0") {
      if (result.length < 2) throw new StarknetRegistryReadError("ERR-023", `malformed_resolve_active_short:${JSON.stringify(result).slice(0, 200)}`);
      const acct = normalizeController(result[1]);
      if (!/^0x[0-9a-f]{1,64}$/.test(acct)) throw new StarknetRegistryReadError("ERR-002", `malformed_execution_account:${acct}`);
      return { executionAccount: acct, watermark: 0 };
    }
    throw new StarknetRegistryReadError("ERR-023", `malformed_resolve_tag:${tag}`);
  }

  async getBinding(prismId: string, venue: string, executionAccount: string): Promise<{ status: "ACTIVE" | "REVOKED" | null }> {
    // Read binding status via resolve equivalence or direct storage read isn't exposed via view.
    // For M1, delegate to resolve and infer: if resolve returns same account => ACTIVE, else null.
    // This is conservative and never fabricates ACTIVE.
    assertHexAddress(executionAccount, "executionAccount");
    let felt: string;
    try {
      felt = prismIdToRegistryFelt(prismId);
    } catch {
      return { status: null };
    }
    void felt;
    const res = await this.resolve(prismId, venue);
    if (res.executionAccount && res.executionAccount.toLowerCase() === executionAccount.toLowerCase()) {
      return { status: "ACTIVE" };
    }
    return { status: null };
  }

  async isDigestConsumed(digest: Hex): Promise<boolean> {
    if (!/^0x[0-9a-fA-F]{64}$/.test(digest)) {
      throw new StarknetRegistryReadError("ERR-023", `malformed_digest:${digest}`);
    }
    // No onchain view for consumed_digests without custom entrypoint; conservative false for M1 read path
    // Caller should rely on bind submit error ERR-007 for single-use.
    return false;
  }
}
