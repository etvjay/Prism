// Concrete StarknetSubmitPort adapter via injected starknet.js Account.
// Never reads secrets from files; never submits live transactions in tests —
// the Account/provider are injected dependencies supplied by the caller.
// Transport-neutral port boundary is preserved: this adapter is the only place
// that imports starknet.js types, and failures are mapped to stable ERR codes
// without leaking stack traces.
//
// Config validation is explicit via `validateStarknetSubmitConfig` /
// `parseStarknetSubmitEnv` — the adapter never reads process.env on its own;
// the caller supplies an env record. Tests use injected objects only (X2).

import type { Hex } from "../domain/operation";
import type { StarknetSubmitPort } from "../../../application/ports";
import { toFieldBoundedDigest, prismIdToRegistryFelt } from "../../prism-identity/domain/felt-digest";
import {
  normalizeStarknetContractAddress,
  sameStarknetContractAddress,
  StarknetContractAddressError,
} from "../../prism-identity/domain/starknet-boundary";

/** Minimal Account surface required for submission — injectable for tests. */
export interface StarknetAccountLike {
  /** Starknet account address (0x hex). */
  readonly address: string;
  /** Execute contract calls; returns transaction_hash. */
  execute(calls: Array<{ contractAddress: string; entrypoint: string; calldata: unknown[] }>): Promise<{ transaction_hash: string }>;
}

/** Minimal RpcProvider surface for optional tx simulation (not required). */
export interface StarknetProviderLike {
  waitForTransaction?(txHash: string): Promise<unknown>;
}

export type StarknetSubmitAdapterOptions = {
  /** Injected Account instance — caller owns key management; adapter never reads files. */
  account: StarknetAccountLike;
  /** Registry contract address (0x hex, 64 chars after 0x). */
  registryAddress: string;
  /** Optional provider for future waitForTransaction; not used for pre-submit. */
  provider?: StarknetProviderLike;
};

export class StarknetSubmitError extends Error {
  readonly code: string;
  readonly ambiguous: boolean;
  readonly terminal: boolean;
  constructor(code: string, message: string, cause?: unknown, options?: { ambiguous?: boolean; terminal?: boolean }) {
    super(`${message}${cause instanceof Error ? `: ${cause.message}` : ""}`);
    this.name = "StarknetSubmitError";
    this.code = code;
    this.ambiguous = options?.ambiguous === true;
    this.terminal = options?.terminal ?? isTerminalSubmitCode(code);
  }
}

/** Stable adapter errors that prove a fresh submission must not be retried. */
export function isTerminalSubmitCode(code: string | undefined): boolean {
  return !!code && new Set([
    "ERR-001",
    "ERR-002",
    "ERR-003",
    "ERR-004",
    "ERR-005",
    "ERR-006",
    "ERR-007",
    "ERR-008",
    "ERR-009",
    "ERR-010",
    "ERR-011",
    "ERR-012",
    "ERR-013",
    "ERR-014",
    "ERR-023",
  ]).has(code);
}

function assertHex64(value: string): Hex {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    // execute() returned, so a malformed response may still follow a broadcast.
    throw new StarknetSubmitError("ERR-023", `malformed_tx_hash:${value}`, undefined, { ambiguous: true, terminal: false });
  }
  return value as Hex;
}

function assertHexAddress(value: unknown, label = "address"): string {
  try {
    return normalizeStarknetContractAddress(value, label);
  } catch (cause) {
    const reason = cause instanceof StarknetContractAddressError ? cause.reason : "malformed";
    throw new StarknetSubmitError("ERR-005", `${reason === "malformed" ? "malformed" : "address_out_of_range"}:${label}:${String(value)}`, cause);
  }
}

function mapRevertToCode(cause: unknown): string | null {
  if ((cause as { ambiguous?: unknown })?.ambiguous === true) return null;
  const msg = cause instanceof Error ? cause.message : String(cause);
  // Contract reverts carry ERR-00x inside message (also handle ERR-023 for adapter validation)
  const match = msg.match(/ERR-0\d{2,3}/)?.[0] ?? (cause as { code?: string })?.code;
  return isTerminalSubmitCode(match) ? match! : null;
}

// ---------------------------------------------------------------------------
// Explicit env/config validation — no file/secret reads.
// The adapter never reads `process.env`; the caller passes an env record.
// Tests inject minimal objects, never secrets.
// ---------------------------------------------------------------------------

export type StarknetSubmitEnv = Record<string, string | undefined>;

export type ValidatedStarknetSubmitConfig = {
  rpcUrl: string;
  registryAddress: string;
  /** Optional account address for mismatch guard when env supplies it. */
  accountAddress?: string;
};

export class StarknetSubmitConfigError extends Error {
  readonly code = "ERR-023" as const;
  readonly ambiguous = false;
  readonly terminal = true;
  constructor(message: string) {
    super(message);
    this.name = "StarknetSubmitConfigError";
  }
}

export function validateStarknetSubmitConfig(input: {
  registryAddress: string;
  account: StarknetAccountLike;
  rpcUrl?: string;
}): ValidatedStarknetSubmitConfig {
  if (!input.account || typeof input.account.execute !== "function") {
    throw new StarknetSubmitConfigError("invariant_violation: account with execute() required");
  }
  let accountAddr: string;
  let registryAddr: string;
  try {
    accountAddr = normalizeStarknetContractAddress(input.account.address, "account");
    registryAddr = normalizeStarknetContractAddress(input.registryAddress, "registryAddress");
  } catch (cause) {
    const reason = cause instanceof StarknetContractAddressError ? cause.reason : "malformed";
    throw new StarknetSubmitConfigError(`invalid_starknet_address:${reason}`);
  }
  if (sameStarknetContractAddress(accountAddr, registryAddr)) {
    throw new StarknetSubmitConfigError(`account_registry_address_mismatch: account ${accountAddr} must not equal registry ${registryAddr}`);
  }
  if (input.rpcUrl !== undefined) {
    if (input.rpcUrl.trim().length === 0) throw new StarknetSubmitConfigError("missing_rpc_url");
    try {
      const u = new URL(input.rpcUrl);
      if (!["http:", "https:"].includes(u.protocol)) throw new StarknetSubmitConfigError(`invalid_rpc_url_protocol:${input.rpcUrl}`);
    } catch {
      throw new StarknetSubmitConfigError(`invalid_rpc_url:${input.rpcUrl}`);
    }
  }
  return { rpcUrl: input.rpcUrl ?? "", registryAddress: registryAddr, accountAddress: accountAddr };
}

export function parseStarknetSubmitEnv(env: StarknetSubmitEnv, overrides?: { account?: StarknetAccountLike }): ValidatedStarknetSubmitConfig {
  const rpcUrl = (env.STARKNET_RPC_URL ?? env.NEXT_PUBLIC_STARKNET_RPC_URL ?? "").trim();
  const registryAddress = (env.STARKNET_REGISTRY_ADDRESS ?? env.PRISM_REGISTRY_ADDRESS ?? "").trim();
  if (!rpcUrl) throw new StarknetSubmitConfigError("missing STARKNET_RPC_URL");
  if (!registryAddress) throw new StarknetSubmitConfigError("missing STARKNET_REGISTRY_ADDRESS");
  let normalizedRegistryAddress: string;
  try {
    normalizedRegistryAddress = normalizeStarknetContractAddress(registryAddress, "registryAddress");
  } catch (cause) {
    const reason = cause instanceof StarknetContractAddressError ? cause.reason : "malformed";
    throw new StarknetSubmitConfigError(`invalid_starknet_registry_address:${reason}`);
  }
  try {
    const u = new URL(rpcUrl);
    if (!["http:", "https:"].includes(u.protocol)) throw new StarknetSubmitConfigError(`invalid STARKNET_RPC_URL protocol:${rpcUrl}`);
  } catch {
    throw new StarknetSubmitConfigError(`invalid STARKNET_RPC_URL:${rpcUrl}`);
  }
  if (overrides?.account) {
    return validateStarknetSubmitConfig({ registryAddress: normalizedRegistryAddress, account: overrides.account, rpcUrl });
  }
  return { rpcUrl, registryAddress: normalizedRegistryAddress };
}

function assertAccountMatchesController(accountAddr: string, controllerAddr: string): void {
  if (!sameStarknetContractAddress(accountAddr, controllerAddr)) {
    throw new StarknetSubmitError("ERR-004", `account_controller_mismatch: account ${accountAddr} != controller ${controllerAddr}`);
  }
}

/**
 * Concrete submit adapter — injected Account, no secret-file reads.
 * Each method produces a single contract invoke and returns the txHash.
 * No receipt is awaited; reconciliation owns completion (INV-SYS-005).
 */
export class StarknetSubmitAdapter implements StarknetSubmitPort {
  readonly isTestDouble = false;
  readonly registryVersion = "v1" as const;
  private readonly account: StarknetAccountLike;
  readonly registryAddress: string;

  constructor(options: StarknetSubmitAdapterOptions) {
    if (!options.account || typeof options.account.execute !== "function") {
      throw new Error("invariant_violation: StarknetSubmitAdapter requires injected account with execute()");
    }
    if (!options.registryAddress) throw new Error("invariant_violation: registryAddress required");
    const validated = validateStarknetSubmitConfig({ registryAddress: options.registryAddress, account: options.account, rpcUrl: undefined });
    this.account = options.account;
    this.registryAddress = validated.registryAddress;
  }

  async submitCreateIdentity(input: { operationId: string; controllerAddress: string }): Promise<{ txHash: Hex }> {
    const ctrl = assertHexAddress(input.controllerAddress, "controllerAddress");
    const accountAddress = assertHexAddress(this.account.address, "account");
    assertAccountMatchesController(accountAddress, ctrl);
    try {
      const result = await this.account.execute([
        { contractAddress: this.registryAddress, entrypoint: "create_identity", calldata: [] },
      ]);
      const txHash = assertHex64(result.transaction_hash);
      return { txHash };
    } catch (cause) {
      const maybeCode = mapRevertToCode(cause);
      if (maybeCode) throw new StarknetSubmitError(maybeCode, String((cause as Error).message), cause);
      throw new StarknetSubmitError("ERR-021", "submit_create_identity_failed", cause, { ambiguous: true, terminal: false });
    }
  }

  async submitBind(input: {
    operationId: string;
    prismId: string;
    venue: string;
    executionAccount: string;
    proofDigest: Hex;
    controllerAddress: string;
  }): Promise<{ txHash: Hex }> {
    const ctrl = assertHexAddress(input.controllerAddress, "controllerAddress");
    const accountAddress = assertHexAddress(this.account.address, "account");
    assertAccountMatchesController(accountAddress, ctrl);
    const executionAccount = assertHexAddress(input.executionAccount, "executionAccount");
    if (!/^0x[0-9a-fA-F]{64}$/.test(input.proofDigest)) {
      throw new StarknetSubmitError("ERR-023", `malformed_proof_digest:${input.proofDigest}`);
    }
    // M3 digest-format fix: the full 256-bit keccak proof_digest is canonical
    // everywhere offchain; the ONLY conversion to felt252-safe calldata
    // happens here (named mapping, see felt-digest.ts / DEC-PRISM-SYS-004
    // proposal). No silent truncation: boundedness is recorded and surfaced.
    let feltDigest: Hex;
    try {
      feltDigest = toFieldBoundedDigest(input.proofDigest).felt;
    } catch (cause) {
      throw new StarknetSubmitError("ERR-023", `malformed_proof_digest:${input.proofDigest}`, cause);
    }
    // M3-X2 prismId fix: application Prism IDs are canonical `prism:<decimal>`
    // offchain; the registry expects felt252 `0x<hex>`. Explicit named
    // conversion prismIdToRegistryFelt is applied at this Starknet boundary
    // only — application/Product IDs remain unchanged offchain. No base36,
    // hash, or silent repair.
    let registryPrismId: string;
    try {
      if (!input.prismId || input.prismId.trim().length === 0) {
        throw new Error("ERR-002: missing_prism_id");
      }
      registryPrismId = prismIdToRegistryFelt(input.prismId);
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : String(cause);
      const codeMatch = msg.match(/ERR-0\d{2,3}/);
      const code = codeMatch ? codeMatch[0] : "ERR-002";
      throw new StarknetSubmitError(code, `malformed_prism_id:${input.prismId}`, cause);
    }
    if (input.venue.toUpperCase() !== "BASE") {
      throw new StarknetSubmitError("ERR-001", `invalid_venue:${input.venue}`);
    }
    try {
      const result = await this.account.execute([
        {
          contractAddress: this.registryAddress,
          entrypoint: "bind_execution_identity",
          calldata: [registryPrismId, input.venue, executionAccount, feltDigest],
        },
      ]);
      const txHash = assertHex64(result.transaction_hash);
      return { txHash };
    } catch (cause) {
      const maybeCode = mapRevertToCode(cause);
      if (maybeCode) throw new StarknetSubmitError(maybeCode, String((cause as Error).message), cause);
      throw new StarknetSubmitError("ERR-021", "submit_bind_failed", cause, { ambiguous: true, terminal: false });
    }
  }

  async submitRevoke(input: {
    operationId: string;
    prismId: string;
    venue: string;
    executionAccount: string;
    controllerAddress: string;
  }): Promise<{ txHash: Hex }> {
    const ctrl = assertHexAddress(input.controllerAddress, "controllerAddress");
    const accountAddress = assertHexAddress(this.account.address, "account");
    assertAccountMatchesController(accountAddress, ctrl);
    const executionAccount = assertHexAddress(input.executionAccount, "executionAccount");
    // Same prismId boundary conversion as bind — registry expects felt.
    let registryPrismId: string;
    try {
      if (!input.prismId || input.prismId.trim().length === 0) throw new Error("ERR-002: missing_prism_id");
      registryPrismId = prismIdToRegistryFelt(input.prismId);
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : String(cause);
      const codeMatch = msg.match(/ERR-0\d{2,3}/);
      const code = codeMatch ? codeMatch[0] : "ERR-002";
      throw new StarknetSubmitError(code, `malformed_prism_id:${input.prismId}`, cause);
    }
    if (input.venue.toUpperCase() !== "BASE") throw new StarknetSubmitError("ERR-001", `invalid_venue:${input.venue}`);
    try {
      const result = await this.account.execute([
        {
          contractAddress: this.registryAddress,
          entrypoint: "revoke_binding",
          calldata: [registryPrismId, input.venue, executionAccount],
        },
      ]);
      const txHash = assertHex64(result.transaction_hash);
      return { txHash };
    } catch (cause) {
      const maybeCode = mapRevertToCode(cause);
      if (maybeCode) throw new StarknetSubmitError(maybeCode, String((cause as Error).message), cause);
      throw new StarknetSubmitError("ERR-021", "submit_revoke_failed", cause, { ambiguous: true, terminal: false });
    }
  }
}
