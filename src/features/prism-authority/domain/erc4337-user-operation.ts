import type { EvmAddress } from "../../prism-identity/domain/identifiers";

export type Hex = `0x${string}`;
export type Erc4337Hex32 = `0x${string}`;

/** ERC-4337 EntryPoint v0.7 packed UserOperation sent to eth_sendUserOperation. */
export interface Erc4337PackedUserOperationV07 {
  readonly sender: EvmAddress;
  readonly nonce: bigint;
  /** factory address + factory calldata, or 0x for an already deployed account. */
  readonly initCode: Hex;
  readonly callData: Hex;
  /** verificationGasLimit (uint128) || callGasLimit (uint128), each 16 bytes. */
  readonly accountGasLimits: Erc4337Hex32;
  readonly preVerificationGas: bigint;
  /** maxPriorityFeePerGas (uint128) || maxFeePerGas (uint128), each 16 bytes. */
  readonly gasFees: Erc4337Hex32;
  /** paymaster fields, or 0x when no paymaster is used. */
  readonly paymasterAndData: Hex;
  /** account signature; never generated or persisted by this repository. */
  readonly signature: Hex;
}

function isHex(value: unknown): value is Hex {
  return typeof value === "string" && /^0x[0-9a-fA-F]*$/.test(value);
}

function isNonNegativeBigint(value: unknown): value is bigint {
  return typeof value === "bigint" && value >= 0n;
}

/**
 * Structural validation only. It does not prove sender deployment, EntryPoint
 * compatibility, signature validity, nonce freshness, or on-chain execution.
 */
export function isErc4337PackedUserOperationV07(value: unknown): value is Erc4337PackedUserOperationV07 {
  if (typeof value !== "object" || value === null) return false;
  const op = value as Record<string, unknown>;
  return typeof op.sender === "string"
    && /^0x[0-9a-fA-F]{40}$/.test(op.sender)
    && isNonNegativeBigint(op.nonce)
    && isHex(op.initCode)
    && isHex(op.callData)
    && isHex(op.accountGasLimits)
    && op.accountGasLimits.length === 66
    && isNonNegativeBigint(op.preVerificationGas)
    && isHex(op.gasFees)
    && op.gasFees.length === 66
    && isHex(op.paymasterAndData)
    && isHex(op.signature);
}

export function assertErc4337PackedUserOperationV07(value: unknown, context = "user_operation"): asserts value is Erc4337PackedUserOperationV07 {
  if (!isErc4337PackedUserOperationV07(value)) throw new Error(`malformed_erc4337_v07_${context}`);
}

/** The v0.7 fields whose values must be read back from a real bundler/EntryPoint. */
export const ERC4337_V07_READBACK_REQUIREMENTS = [
  "userOperationHash",
  "entryPoint",
  "sender",
  "nonce",
  "receipt.transactionHash",
  "receipt.blockNumber",
  "receipt.success",
] as const;
