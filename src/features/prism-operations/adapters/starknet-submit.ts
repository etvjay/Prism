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
  constructor(code: string, message: string, cause?: unknown) {
    super(`${message}${cause instanceof Error ? `: ${cause.message}` : ""}`);
    this.name = "StarknetSubmitError";
    this.code = code;
  }
}

function assertHex64(value: string): Hex {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new StarknetSubmitError("ERR-023", `malformed_tx_hash:${value}`);
  }
  return value as Hex;
}

function assertHexAddress(value: string): string {
  if (!/^0x[0-9a-f]{1,64}$/.test(value.trim().toLowerCase())) {
    throw new StarknetSubmitError("ERR-005", `malformed_address:${value}`);
  }
  return value.trim().toLowerCase();
}

function mapRevertToCode(cause: unknown): string | null {
  const msg = cause instanceof Error ? cause.message : String(cause);
  // Contract reverts carry ERR-00x inside message
  const match = msg.match(/ERR-00[1-9]/);
  return match ? match[0] : null;
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
  const accountAddr = assertHexAddress(input.account.address);
  const registryAddr = assertHexAddress(input.registryAddress);
  if (accountAddr === registryAddr) {
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
  assertHexAddress(registryAddress);
  try {
    const u = new URL(rpcUrl);
    if (!["http:", "https:"].includes(u.protocol)) throw new StarknetSubmitConfigError(`invalid STARKNET_RPC_URL protocol:${rpcUrl}`);
  } catch {
    throw new StarknetSubmitConfigError(`invalid STARKNET_RPC_URL:${rpcUrl}`);
  }
  if (overrides?.account) {
    return validateStarknetSubmitConfig({ registryAddress, account: overrides.account, rpcUrl });
  }
  return { rpcUrl, registryAddress: registryAddress.toLowerCase() };
}

function assertAccountMatchesController(accountAddr: string, controllerAddr: string): void {
  if (accountAddr.toLowerCase() !== controllerAddr.toLowerCase()) {
    throw new StarknetSubmitError("ERR-004", `account_controller_mismatch: account ${accountAddr} != controller ${controllerAddr}`);
  }
}

/**
 * Concrete submit adapter — injected Account, no secret-file reads.
 * Each method produces a single contract invoke and returns the txHash.
 * No receipt is awaited; reconciliation owns completion (INV-SYS-005).
 */
export class StarknetSubmitAdapter implements StarknetSubmitPort {
  private readonly account: StarknetAccountLike;
  private readonly registryAddress: string;

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
    const ctrl = assertHexAddress(input.controllerAddress);
    assertAccountMatchesController(this.account.address, ctrl);
    try {
      const result = await this.account.execute([
        { contractAddress: this.registryAddress, entrypoint: "create_identity", calldata: [] },
      ]);
      const txHash = assertHex64(result.transaction_hash);
      return { txHash };
    } catch (cause) {
      const maybeCode = mapRevertToCode(cause);
      if (maybeCode) throw new StarknetSubmitError(maybeCode, String((cause as Error).message), cause);
      throw new StarknetSubmitError("ERR-021", "submit_create_identity_failed", cause);
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
    const ctrl = assertHexAddress(input.controllerAddress);
    assertAccountMatchesController(this.account.address, ctrl);
    assertHexAddress(input.executionAccount);
    if (!/^0x[0-9a-fA-F]{64}$/.test(input.proofDigest)) {
      throw new StarknetSubmitError("ERR-023", `malformed_proof_digest:${input.proofDigest}`);
    }
    // prismId is felt252; validate non-empty
    if (!input.prismId || input.prismId.trim().length === 0) {
      throw new StarknetSubmitError("ERR-002", "missing_prism_id");
    }
    if (input.venue.toUpperCase() !== "BASE") {
      throw new StarknetSubmitError("ERR-001", `invalid_venue:${input.venue}`);
    }
    try {
      const result = await this.account.execute([
        {
          contractAddress: this.registryAddress,
          entrypoint: "bind_execution_identity",
          calldata: [input.prismId, input.venue, input.executionAccount, input.proofDigest],
        },
      ]);
      const txHash = assertHex64(result.transaction_hash);
      return { txHash };
    } catch (cause) {
      const maybeCode = mapRevertToCode(cause);
      if (maybeCode) throw new StarknetSubmitError(maybeCode, String((cause as Error).message), cause);
      // Preserve contract-mapped codes if cause already carries code
      const code = (cause as { code?: string })?.code;
      if (code && /^ERR-00[0-9]$/.test(code)) throw new StarknetSubmitError(code, String((cause as Error).message), cause);
      throw new StarknetSubmitError("ERR-021", "submit_bind_failed", cause);
    }
  }

  async submitRevoke(input: {
    operationId: string;
    prismId: string;
    venue: string;
    executionAccount: string;
    controllerAddress: string;
  }): Promise<{ txHash: Hex }> {
    const ctrl = assertHexAddress(input.controllerAddress);
    assertAccountMatchesController(this.account.address, ctrl);
    assertHexAddress(input.executionAccount);
    if (!input.prismId || input.prismId.trim().length === 0) throw new StarknetSubmitError("ERR-002", "missing_prism_id");
    if (input.venue.toUpperCase() !== "BASE") throw new StarknetSubmitError("ERR-001", `invalid_venue:${input.venue}`);
    try {
      const result = await this.account.execute([
        {
          contractAddress: this.registryAddress,
          entrypoint: "revoke_binding",
          calldata: [input.prismId, input.venue, input.executionAccount],
        },
      ]);
      const txHash = assertHex64(result.transaction_hash);
      return { txHash };
    } catch (cause) {
      const maybeCode = mapRevertToCode(cause);
      if (maybeCode) throw new StarknetSubmitError(maybeCode, String((cause as Error).message), cause);
      const code = (cause as { code?: string })?.code;
      if (code && /^ERR-00[0-9]$/.test(code)) throw new StarknetSubmitError(code, String((cause as Error).message), cause);
      throw new StarknetSubmitError("ERR-021", "submit_revoke_failed", cause);
    }
  }
}
