import { describe, expect, it } from "vitest";
import {
  attributePoolEvent,
  containsAddressInCalldata,
  validateHelperCalldata,
  validateM5Actions,
  validateM5Receipt,
  validateM5TransactionObservation,
  validateVesuDepositObservation,
} from "../validation";
import {
  HELPER_ADDRESS_SEPOLIA,
  PRIVACY_POOL_SEPOLIA,
  STRK_SEPOLIA,
  VTOKEN_STRK_SEPOLIA,
} from "../constants";
import { M5_ERROR_CODE } from "../runner";

const TX = "0x05abc123abc123abc123abc123abc123abc123abc123abc123abc123abc123ab" as `0x${string}`;
const SELF = "0x047c0f8b01b9c7c75c669dc549bc305a0f2d796808117339a1c87730162b131c";
const AMOUNT = 1_000_000_000_000_000_000n;

function route() {
  return {
    strkToken: STRK_SEPOLIA,
    vToken: VTOKEN_STRK_SEPOLIA,
    helperAddress: HELPER_ADDRESS_SEPOLIA,
    privacyPool: PRIVACY_POOL_SEPOLIA,
  };
}

describe("M5 local validation contracts", () => {
  it("requires exactly the first-party helper calldata order and placeholder", () => {
    const calldata = [STRK_SEPOLIA, VTOKEN_STRK_SEPOLIA, `0x${AMOUNT.toString(16)}`, "${openNoteIds[0]}"];
    expect(() => validateHelperCalldata(calldata, { ...route(), inAmount: AMOUNT })).not.toThrow();
    expect(() => validateHelperCalldata([VTOKEN_STRK_SEPOLIA, STRK_SEPOLIA, calldata[2], calldata[3]], { ...route(), inAmount: AMOUNT })).toThrow(M5_ERROR_CODE.CALLDATA_MISMATCH);
    expect(() => validateHelperCalldata([...calldata.slice(0, 3), "${openNoteIds[1]}"], { ...route(), inAmount: AMOUNT })).toThrow(M5_ERROR_CODE.CALLDATA_MISMATCH);
  });

  it("validates the atomic transfer OPEN then invoke action order", () => {
    const actions = [
      { type: "transfer" as const, token: STRK_SEPOLIA, amount: "OPEN" as const, recipient: SELF },
      { type: "invoke" as const, contract: HELPER_ADDRESS_SEPOLIA, calldata: [STRK_SEPOLIA, VTOKEN_STRK_SEPOLIA, `0x${AMOUNT.toString(16)}`, "${openNoteIds[0]}"] },
    ];
    expect(() => validateM5Actions(actions, { ...route(), inAmount: AMOUNT }, SELF)).not.toThrow();
    expect(() => validateM5Actions([...actions].reverse(), { ...route(), inAmount: AMOUNT }, SELF)).toThrow(M5_ERROR_CODE.CALLDATA_MISMATCH);
  });

  it("attributes only a successful event emitted by the pinned pool and ignores sender", () => {
    const receipt = {
      transactionHash: TX,
      executionStatus: "SUCCEEDED",
      finalityStatus: "ACCEPTED_ON_L2",
      blockNumber: 123,
      senderAddress: SELF,
      events: [
        { address: "0x123", keys: ["0xaaa"], data: [] },
        { address: PRIVACY_POOL_SEPOLIA, keys: [SELF], data: ["0x1"] },
      ],
    };
    const attribution = attributePoolEvent(receipt, PRIVACY_POOL_SEPOLIA);
    expect(attribution).toMatchObject({ eventIndex: 1, poolAddress: PRIVACY_POOL_SEPOLIA });
    expect(attribution?.senderIgnored).toBe(SELF);
    expect(attribution?.attributedDepositor).toBeNull();
    expect(attributePoolEvent(receipt, PRIVACY_POOL_SEPOLIA, { depositorKeyIndex: 0 })?.attributedDepositor).toBe(`0x${BigInt(SELF).toString(16)}`);
    expect(attributePoolEvent({ ...receipt, executionStatus: "REVERTED" }, PRIVACY_POOL_SEPOLIA)).toBeNull();
    expect(attributePoolEvent({ ...receipt, events: [{ address: "0x123", keys: [SELF], data: [] }] }, PRIVACY_POOL_SEPOLIA)).toBeNull();
  });

  it("rejects malformed receipt facts instead of normalizing them into evidence", () => {
    expect(() => validateM5Receipt({
      transactionHash: TX,
      executionStatus: "SUCCEEDED",
      finalityStatus: "ACCEPTED_ON_L2",
      blockNumber: 1,
      events: [{ address: "not-hex", keys: [], data: [] }],
    }, TX)).toThrow(M5_ERROR_CODE.RECEIPT_INVALID);
  });

  it("checks helper involvement numerically in raw Starknet transaction calldata", () => {
    expect(containsAddressInCalldata(["0x1", HELPER_ADDRESS_SEPOLIA.slice(0, 6) + HELPER_ADDRESS_SEPOLIA.slice(6)], HELPER_ADDRESS_SEPOLIA)).toBe(true);
    expect(containsAddressInCalldata(["0x1", "0x2"], HELPER_ADDRESS_SEPOLIA)).toBe(false);
    expect(() => containsAddressInCalldata(["0xnot-a-felt"], HELPER_ADDRESS_SEPOLIA)).toThrow(M5_ERROR_CODE.RECEIPT_INVALID);
  });

  it("binds raw helper calldata to the requested transaction hash", () => {
    expect(validateM5TransactionObservation({ transactionHash: TX, calldata: ["0x1"] }, TX).calldata).toEqual(["0x1"]);
    expect(() => validateM5TransactionObservation({ transactionHash: "0x2", calldata: [HELPER_ADDRESS_SEPOLIA] }, TX)).toThrow(M5_ERROR_CODE.INDEPENDENT_READ_MISMATCH);
  });

  it("validates a typed Vesu observation only when receiver/assets/token facts are explicit", () => {
    expect(validateVesuDepositObservation({
      contractAddress: VTOKEN_STRK_SEPOLIA,
      receiver: HELPER_ADDRESS_SEPOLIA,
      assets: AMOUNT,
      shares: AMOUNT,
    }, { helperAddress: HELPER_ADDRESS_SEPOLIA, vToken: VTOKEN_STRK_SEPOLIA, inAmount: AMOUNT })).toBe(true);
    expect(validateVesuDepositObservation({
      contractAddress: VTOKEN_STRK_SEPOLIA,
      receiver: "0x123",
      assets: AMOUNT,
      shares: AMOUNT,
    }, { helperAddress: HELPER_ADDRESS_SEPOLIA, vToken: VTOKEN_STRK_SEPOLIA, inAmount: AMOUNT })).toBe(false);
  });
});
