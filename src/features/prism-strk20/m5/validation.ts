// M5 route-local validation. These checks are deliberately limited to facts
// proven by the pinned Cairo helper, the STRK20 Wallet API types, and the
// Starknet JSON-RPC receipt/transaction shapes. No event ABI is invented here.

import { assertNoViewingKey } from "../domain/privacy-guard";
import {
  addressesEqual,
  isValidStarknetAddress,
  MAX_U128,
  OPEN_NOTE_ZERO_PLACEHOLDER,
  normalizeHex,
  STARKNET_ADDRESS_LIMIT,
} from "./constants";
import { M5_ERROR_CODE, M5Error } from "./errors";
import type { M5TransactionObservation } from "./ports";

const STARKNET_FIELD_PRIME = (1n << 251n) + (17n << 192n) + 1n;
const HASH_RE = /^0x[0-9a-fA-F]{1,64}$/;

export interface M5RouteFacts {
  readonly strkToken: string;
  readonly vToken: string;
  readonly helperAddress: string;
  readonly privacyPool: string;
}

export interface M5CalldataExpectation extends M5RouteFacts {
  readonly inAmount: bigint;
}

export interface M5ReceiptEventInput {
  readonly address: string;
  readonly keys: readonly string[];
  readonly data?: readonly string[];
}

export interface M5ReceiptInput {
  readonly transactionHash?: string;
  readonly executionStatus: string;
  readonly finalityStatus?: string;
  readonly blockNumber: number | null;
  readonly senderAddress?: string | null;
  readonly events: readonly M5ReceiptEventInput[];
}

export interface M5ReceiptObservation extends M5ReceiptInput {
  readonly transactionHash: string;
  readonly executionStatus: "SUCCEEDED" | "REVERTED" | "RECEIVED" | "PENDING" | "UNKNOWN";
  readonly finalityStatus: "ACCEPTED_ON_L2" | "ACCEPTED_ON_L1" | "RECEIVED" | "PENDING" | "UNKNOWN";
  readonly events: readonly M5ReceiptEventInput[];
  /** Set by pool attribution; absent means the event fact was not evaluated. */
  readonly poolEventFound?: boolean;
}

export interface PoolEventAttribution {
  readonly eventIndex: number;
  readonly poolAddress: string;
  readonly keys: readonly string[];
  readonly data: readonly string[];
  /** Sender is retained only as an ignored observation, never as identity. */
  readonly senderIgnored: string | null;
  /** M5 privacy-invoke event layout is not proven; do not infer a user key. */
  readonly attributedDepositor: string | null;
}

export interface VesuDepositObservation {
  /** Address of the vToken contract that emitted/was decoded for the event. */
  readonly contractAddress: string;
  readonly receiver: string;
  readonly assets: bigint;
  readonly shares?: bigint;
}

function fail(code: typeof M5_ERROR_CODE[keyof typeof M5_ERROR_CODE], detail: string): never {
  throw new M5Error(code, detail);
}

function assertAddress(value: unknown, context: string, code: "config" | "receipt" = "config"): string {
  if (!isValidStarknetAddress(value) || BigInt(value) >= STARKNET_ADDRESS_LIMIT) {
    fail(code === "config" ? M5_ERROR_CODE.CONFIG_INVALID : M5_ERROR_CODE.RECEIPT_INVALID, `${context}_must_be_starknet_address`);
  }
  return normalizeHex(value);
}

function parseFelt(value: unknown, context: string): bigint {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0) {
    fail(M5_ERROR_CODE.RECEIPT_INVALID, `${context}_must_be_felt_string`);
  }
  try {
    const n = BigInt(value);
    if (n < 0n || n >= STARKNET_FIELD_PRIME) throw new Error("out_of_range");
    return n;
  } catch {
    fail(M5_ERROR_CODE.RECEIPT_INVALID, `${context}_must_be_felt`);
  }
}

function canonicalHash(value: unknown, context: string): string {
  if (typeof value !== "string" || !HASH_RE.test(value.trim())) {
    fail(M5_ERROR_CODE.RECEIPT_INVALID, `${context}_must_be_hex_hash`);
  }
  return `0x${value.trim().slice(2).toLowerCase().padStart(64, "0")}`;
}

function normalizeExecutionStatus(value: unknown): M5ReceiptObservation["executionStatus"] {
  const status = String(value ?? "UNKNOWN").toUpperCase();
  if (["SUCCEEDED", "REVERTED", "RECEIVED", "PENDING", "UNKNOWN"].includes(status)) {
    return status as M5ReceiptObservation["executionStatus"];
  }
  // Unknown provider labels remain unknown; never treat them as success.
  return "UNKNOWN";
}

function normalizeFinalityStatus(value: unknown): M5ReceiptObservation["finalityStatus"] {
  const status = String(value ?? "UNKNOWN").toUpperCase();
  if (["ACCEPTED_ON_L2", "ACCEPTED_ON_L1", "RECEIVED", "PENDING", "UNKNOWN"].includes(status)) {
    return status as M5ReceiptObservation["finalityStatus"];
  }
  return "UNKNOWN";
}

function validateEvent(event: unknown, index: number): M5ReceiptEventInput {
  if (!event || typeof event !== "object") fail(M5_ERROR_CODE.RECEIPT_INVALID, `event_${index}_malformed`);
  const item = event as Record<string, unknown>;
  const address = item.address ?? item.from_address;
  if (typeof address !== "string") fail(M5_ERROR_CODE.RECEIPT_INVALID, `event_${index}_address_missing`);
  assertAddress(address, `event_${index}_address`, "receipt");
  const keys = item.keys;
  if (!Array.isArray(keys) || !keys.every((v) => typeof v === "string")) {
    fail(M5_ERROR_CODE.RECEIPT_INVALID, `event_${index}_keys_malformed`);
  }
  keys.forEach((v, keyIndex) => parseFelt(v, `event_${index}_key_${keyIndex}`));
  const data = item.data;
  if (data !== undefined) {
    if (!Array.isArray(data) || !data.every((v) => typeof v === "string")) {
      fail(M5_ERROR_CODE.RECEIPT_INVALID, `event_${index}_data_malformed`);
    }
    data.forEach((v, dataIndex) => parseFelt(v, `event_${index}_data_${dataIndex}`));
  }
  return {
    address: normalizeHex(address),
    keys: keys.map((v) => `0x${parseFelt(v, "event_key").toString(16)}`),
    data: data === undefined ? [] : data.map((v) => `0x${parseFelt(v, "event_data").toString(16)}`),
  };
}

/** Validate the first-party helper's exact `[token, vToken, u128, openNote]` calldata. */
export function validateHelperCalldata(
  calldata: readonly unknown[],
  expected: M5CalldataExpectation,
): void {
  assertNoViewingKey({ calldata, expected }, "validateHelperCalldata");
  if (!Array.isArray(calldata) || calldata.length !== 4) {
    fail(M5_ERROR_CODE.CALLDATA_MISMATCH, "helper_calldata_must_have_four_items");
  }
  if (!addressesEqual(String(calldata[0]), expected.strkToken)) {
    fail(M5_ERROR_CODE.CALLDATA_MISMATCH, "helper_in_token_mismatch");
  }
  if (!addressesEqual(String(calldata[1]), expected.vToken)) {
    fail(M5_ERROR_CODE.CALLDATA_MISMATCH, "helper_out_token_mismatch");
  }
  const amount = calldata[2];
  if (typeof amount !== "string") fail(M5_ERROR_CODE.CALLDATA_MISMATCH, "helper_amount_not_felt");
  let amountValue: bigint;
  try {
    amountValue = BigInt(amount);
  } catch {
    fail(M5_ERROR_CODE.CALLDATA_MISMATCH, "helper_amount_not_felt");
  }
  if (amountValue !== expected.inAmount || amountValue <= 0n || amountValue > MAX_U128) {
    fail(M5_ERROR_CODE.CALLDATA_MISMATCH, "helper_amount_mismatch");
  }
  if (calldata[3] !== OPEN_NOTE_ZERO_PLACEHOLDER) {
    fail(M5_ERROR_CODE.CALLDATA_MISMATCH, "helper_open_note_placeholder_mismatch");
  }
}

/** Validate the proven Wallet API atomic action order without resolving wallet-owned placeholders. */
export function validateM5Actions(
  actions: readonly unknown[],
  expected: M5CalldataExpectation,
  selfAddress: string,
): void {
  assertNoViewingKey({ actions, expected, selfAddress }, "validateM5Actions");
  if (!Array.isArray(actions) || actions.length !== 2) {
    fail(M5_ERROR_CODE.CALLDATA_MISMATCH, "m5_actions_must_be_transfer_then_invoke");
  }
  const transfer = actions[0];
  const invoke = actions[1];
  if (!transfer || typeof transfer !== "object" || !invoke || typeof invoke !== "object") {
    fail(M5_ERROR_CODE.CALLDATA_MISMATCH, "m5_actions_malformed");
  }
  const transferItem = transfer as Record<string, unknown>;
  const invokeItem = invoke as Record<string, unknown>;
  if (
    transferItem.type !== "transfer" ||
    transferItem.amount !== "OPEN" ||
    typeof transferItem.token !== "string" ||
    !addressesEqual(transferItem.token, expected.strkToken) ||
    typeof transferItem.recipient !== "string" ||
    !addressesEqual(transferItem.recipient, selfAddress)
  ) {
    fail(M5_ERROR_CODE.CALLDATA_MISMATCH, "m5_transfer_open_action_mismatch");
  }
  if (
    invokeItem.type !== "invoke" ||
    typeof invokeItem.contract !== "string" ||
    !addressesEqual(invokeItem.contract, expected.helperAddress) ||
    !Array.isArray(invokeItem.calldata)
  ) {
    fail(M5_ERROR_CODE.CALLDATA_MISMATCH, "m5_invoke_action_mismatch");
  }
  validateHelperCalldata(invokeItem.calldata, expected);
}

/** Normalize and validate a receipt without treating unknown provider labels as success. */
export function validateM5Receipt(raw: M5ReceiptInput, expectedTxHash?: string): M5ReceiptObservation {
  assertNoViewingKey(raw as unknown as Record<string, unknown>, "validateM5Receipt");
  if (!raw || typeof raw !== "object") fail(M5_ERROR_CODE.RECEIPT_INVALID, "receipt_malformed");
  const transactionHash = canonicalHash(raw.transactionHash ?? expectedTxHash, "receipt_transaction_hash");
  if (expectedTxHash && transactionHash !== canonicalHash(expectedTxHash, "expected_transaction_hash")) {
    fail(M5_ERROR_CODE.INDEPENDENT_READ_MISMATCH, "receipt_transaction_hash_mismatch");
  }
  if (!Number.isSafeInteger(raw.blockNumber) && raw.blockNumber !== null) {
    fail(M5_ERROR_CODE.RECEIPT_INVALID, "receipt_block_number_malformed");
  }
  if (raw.blockNumber !== null && raw.blockNumber < 0) fail(M5_ERROR_CODE.RECEIPT_INVALID, "receipt_block_number_negative");
  if (!Array.isArray(raw.events)) fail(M5_ERROR_CODE.RECEIPT_INVALID, "receipt_events_malformed");
  const events = raw.events.map(validateEvent);
  const senderIgnored = raw.senderAddress == null ? null : normalizeHex(assertAddress(raw.senderAddress, "receipt_sender", "receipt"));
  return {
    transactionHash,
    executionStatus: normalizeExecutionStatus(raw.executionStatus),
    finalityStatus: normalizeFinalityStatus(raw.finalityStatus),
    blockNumber: raw.blockNumber,
    senderAddress: senderIgnored,
    events,
  };
}

/** Attribute a receipt event to the configured pool address, never to tx.sender. */
export function attributePoolEvent(
  receipt: M5ReceiptInput,
  privacyPool: string,
  options: { depositorKeyIndex?: number } = {},
): PoolEventAttribution | null {
  const normalized = validateM5Receipt(receipt);
  if (normalized.executionStatus !== "SUCCEEDED") return null;
  const pool = assertAddress(privacyPool, "privacy_pool");
  const index = normalized.events.findIndex((event) => addressesEqual(event.address, pool));
  if (index < 0) return null;
  const event = normalized.events[index];
  return {
    eventIndex: index,
    poolAddress: event.address,
    keys: event.keys,
    data: event.data ?? [],
    senderIgnored: normalized.senderAddress ?? null,
    // Only a caller that has proven the event's key layout may request key
    // attribution (the existing STRK20 Deposit path uses key 0). M5's private
    // invoke event layout is not assumed, so the runner leaves this null.
    attributedDepositor: options.depositorKeyIndex === undefined
      ? null
      : event.keys[options.depositorKeyIndex] ?? null,
  };
}

/** Check the helper's numeric address appears in raw invoke calldata. */
export function containsAddressInCalldata(calldata: readonly unknown[], address: string): boolean {
  if (!Array.isArray(calldata)) fail(M5_ERROR_CODE.RECEIPT_INVALID, "transaction_calldata_malformed");
  const target = assertAddress(address, "helper_address");
  for (const [index, item] of calldata.entries()) {
    parseFelt(item, `transaction_calldata_${index}`);
    if (typeof item === "string" && addressesEqual(item, target)) return true;
  }
  return false;
}

/**
 * Bind raw calldata to the transaction read that returned it. A keyed RPC
 * request is not enough when a provider returns a contradictory hash; do not
 * let calldata from another transaction satisfy the helper predicate.
 */
export function validateM5TransactionObservation(
  raw: M5TransactionObservation,
  expectedTxHash: string,
): M5TransactionObservation {
  assertNoViewingKey(raw as unknown as Record<string, unknown>, "validateM5TransactionObservation");
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.calldata) || !raw.calldata.every((value) => typeof value === "string")) {
    fail(M5_ERROR_CODE.RECEIPT_INVALID, "transaction_calldata_malformed");
  }
  if (raw.transactionHash !== undefined && canonicalHash(raw.transactionHash, "transaction_hash") !== canonicalHash(expectedTxHash, "expected_transaction_hash")) {
    fail(M5_ERROR_CODE.INDEPENDENT_READ_MISMATCH, "transaction_hash_mismatch");
  }
  return {
    ...(raw.transactionHash === undefined ? {} : { transactionHash: canonicalHash(raw.transactionHash, "transaction_hash") }),
    calldata: [...raw.calldata],
  };
}

/** Validate a typed Vesu adapter observation; no event ABI parser is assumed. */
export function validateVesuDepositObservation(
  observation: VesuDepositObservation,
  expected: { helperAddress: string; vToken: string; inAmount: bigint },
): boolean {
  assertNoViewingKey(observation as unknown as Record<string, unknown>, "validateVesuDepositObservation");
  if (!observation || typeof observation !== "object") return false;
  if (!isValidStarknetAddress(observation.contractAddress) || !isValidStarknetAddress(observation.receiver)) return false;
  if (!addressesEqual(observation.contractAddress, expected.vToken) || !addressesEqual(observation.receiver, expected.helperAddress)) return false;
  if (typeof observation.assets !== "bigint" || observation.assets !== expected.inAmount) return false;
  return observation.shares === undefined || (typeof observation.shares === "bigint" && observation.shares > 0n);
}
