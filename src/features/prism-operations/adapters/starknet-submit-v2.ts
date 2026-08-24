// Registry V2 submit adapter: exact u256 proof digest ABI.
// V1's felt-masked adapter remains separate and is never selected implicitly.
// The injected Account belongs to the caller; this adapter never reads secrets.

import type { Hex } from "../domain/operation";
import type { StarknetSubmitPort } from "../../../application/ports";
import { prismIdToRegistryFelt } from "../../prism-identity/domain/felt-digest";
import { toU256Calldata } from "../../prism-identity/domain/u256-digest";
import type { StarknetAccountLike } from "./starknet-submit";
import { StarknetSubmitError } from "./starknet-submit";

function address(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^0x[0-9a-f]{1,64}$/.test(normalized)) throw new StarknetSubmitError("ERR-005", `malformed_address:${value}`);
  const numeric = BigInt(normalized);
  if (numeric === 0n || numeric >= (1n << 251n)) throw new StarknetSubmitError("ERR-005", `address_out_of_range:${value}`);
  return normalized;
}

function txHash(value: string): Hex {
  const normalized = value.trim().toLowerCase();
  if (!/^0x[0-9a-f]{1,64}$/.test(normalized)) throw new StarknetSubmitError("ERR-023", `malformed_tx_hash:${value}`);
  return `0x${normalized.slice(2).padStart(64, "0")}` as Hex;
}

function assertController(account: StarknetAccountLike, controller: string): void {
  if (account.address.toLowerCase() !== address(controller)) throw new StarknetSubmitError("ERR-004", "account_controller_mismatch");
}

function mapContractError(cause: unknown): string | null {
  const message = cause instanceof Error ? cause.message : String(cause);
  return message.match(/ERR-0\d{2,3}/)?.[0] ?? (cause as { code?: string })?.code ?? null;
}
function registryId(value: string): string {
  try {
    return prismIdToRegistryFelt(value);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    const code = message.match(/ERR-0\d{2,3}/)?.[0] ?? "ERR-002";
    throw new StarknetSubmitError(code, `malformed_prism_id:${value}`, cause);
  }
}

export class StarknetSubmitAdapterV2 implements StarknetSubmitPort {
  readonly registryVersion = "v2" as const;
  private readonly account: StarknetAccountLike;
  private readonly registryAddress: string;

  constructor(options: { account: StarknetAccountLike; registryAddress: string }) {
    if (!options.account || typeof options.account.execute !== "function") throw new Error("invariant_violation: V2 account required");
    this.account = options.account;
    this.registryAddress = address(options.registryAddress);
  }

  async submitCreateIdentity(input: { operationId: string; controllerAddress: string }): Promise<{ txHash: Hex }> {
    assertController(this.account, input.controllerAddress);
    try {
      const result = await this.account.execute([{ contractAddress: this.registryAddress, entrypoint: "create_identity", calldata: [] }]);
      return { txHash: txHash(result.transaction_hash) };
    } catch (cause) {
      const code = mapContractError(cause);
      throw new StarknetSubmitError(code ?? "ERR-021", code ? String((cause as Error).message) : "submit_v2_create_identity_failed", cause);
    }
  }

  async submitBind(input: { operationId: string; prismId: string; venue: string; executionAccount: string; proofDigest: Hex; controllerAddress: string }): Promise<{ txHash: Hex }> {
    assertController(this.account, input.controllerAddress);
    const executionAccount = address(input.executionAccount);
    const venue = input.venue.trim().toUpperCase();
    if (venue !== "BASE") throw new StarknetSubmitError("ERR-001", `invalid_venue:${input.venue}`);
    let digestLimbs: readonly [Hex, Hex];
    try {
      digestLimbs = toU256Calldata(input.proofDigest);
    } catch (cause) {
      throw new StarknetSubmitError("ERR-023", `malformed_proof_digest:${input.proofDigest}`, cause);
    }
    const [digestLow, digestHigh] = digestLimbs;
    const prismIdFelt = registryId(input.prismId);
    try {
      const result = await this.account.execute([{
        contractAddress: this.registryAddress,
        entrypoint: "bind_execution_identity",
        calldata: [prismIdFelt, venue, executionAccount, digestLow, digestHigh],
      }]);
      return { txHash: txHash(result.transaction_hash) };
    } catch (cause) {
      const code = mapContractError(cause);
      throw new StarknetSubmitError(code ?? "ERR-021", code ? String((cause as Error).message) : "submit_v2_bind_failed", cause);
    }
  }

  async submitRevoke(input: { operationId: string; prismId: string; venue: string; executionAccount: string; controllerAddress: string }): Promise<{ txHash: Hex }> {
    assertController(this.account, input.controllerAddress);
    const executionAccount = address(input.executionAccount);
    const venue = input.venue.trim().toUpperCase();
    if (venue !== "BASE") throw new StarknetSubmitError("ERR-001", `invalid_venue:${input.venue}`);
    const prismIdFelt = registryId(input.prismId);
    try {
      const result = await this.account.execute([{
        contractAddress: this.registryAddress,
        entrypoint: "revoke_binding",
        calldata: [prismIdFelt, venue, executionAccount],
      }]);
      return { txHash: txHash(result.transaction_hash) };
    } catch (cause) {
      const code = mapContractError(cause);
      throw new StarknetSubmitError(code ?? "ERR-021", code ? String((cause as Error).message) : "submit_v2_revoke_failed", cause);
    }
  }
}
