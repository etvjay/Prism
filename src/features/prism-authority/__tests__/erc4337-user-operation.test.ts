import { describe, expect, it } from "vitest";
import {
  assertErc4337PackedUserOperationV07,
  isErc4337PackedUserOperationV07,
  ERC4337_V07_READBACK_REQUIREMENTS,
} from "../domain/erc4337-user-operation";

const valid = {
  sender: "0x1111111111111111111111111111111111111111",
  nonce: 0n,
  initCode: "0x",
  callData: "0x1234",
  accountGasLimits: `0x${"00".repeat(32)}`,
  preVerificationGas: 21_000n,
  gasFees: `0x${"00".repeat(32)}`,
  paymasterAndData: "0x",
  signature: "0x1234",
} as const;

describe("ERC-4337 EntryPoint v0.7 boundary", () => {
  it("accepts the exact packed UserOperation field shape", () => {
    expect(isErc4337PackedUserOperationV07(valid)).toBe(true);
    expect(ERC4337_V07_READBACK_REQUIREMENTS).toContain("receipt.success");
  });

  it("rejects v0.6-style unpacked gas fields and malformed bytes32 fields", () => {
    expect(isErc4337PackedUserOperationV07({ ...valid, accountGasLimits: undefined, verificationGasLimit: 1n, callGasLimit: 1n })).toBe(false);
    expect(isErc4337PackedUserOperationV07({ ...valid, accountGasLimits: "0x00" })).toBe(false);
    expect(() => assertErc4337PackedUserOperationV07({ ...valid, gasFees: "0x00" })).toThrow("malformed_erc4337_v07_user_operation");
  });

  it("does not treat structure as live authorization or inclusion evidence", () => {
    expect(ERC4337_V07_READBACK_REQUIREMENTS).toEqual([
      "userOperationHash",
      "entryPoint",
      "sender",
      "nonce",
      "receipt.transactionHash",
      "receipt.blockNumber",
      "receipt.success",
    ]);
  });
});
