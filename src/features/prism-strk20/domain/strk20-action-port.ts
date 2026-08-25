// Provider-injected STRK20 action port for Wallet API route.
// Authority: docs/STRK20_CONTEXT, @starknet-io/types-js 0.10.3, and
// starknet.js 10.4.0 WalletAccountV6. Raw provider data is validated at this
// boundary; the domain never imports a wallet SDK directly.

import { Strk20Error, STRK20_ERROR_CODE } from "./errors";
import { assertNoViewingKey } from "./privacy-guard";
import { classifyStrk20Capability, classifyWalletEnvironment, getExpectedWalletEnvironment } from "./wallet-capability";
import {
  assertCallAndProofShape,
  assertNotEmptyProofForSubmission,
  assertProofPresent,
  isEmptyProof,
  type Strk20Call,
  type Strk20CallAndProof,
  type Strk20Proof,
} from "./strk20-proof";

// Re-export for adapter consumers.
export type { Strk20Call, Strk20CallAndProof, Strk20Proof } from "./strk20-proof";

export type Hex = `0x${string}`;

// STRK20 actions mirrored from @starknet-io/types-js STRK20_ACTION.
export type Strk20DepositAction = { type: "deposit"; token: Hex; amount: string };
export type Strk20WithdrawAction = { type: "withdraw"; token: Hex; amount: string; recipient: Hex };
export type Strk20TransferAction = { type: "transfer"; token: Hex; amount: string | "OPEN"; recipient: Hex };
export type Strk20InvokeAction = { type: "invoke"; contract: Hex; calldata: readonly string[] };
export type Strk20Action = Strk20DepositAction | Strk20WithdrawAction | Strk20TransferAction | Strk20InvokeAction;

export interface CapabilityResult {
  capable: boolean;
  capabilityStatus: "supported" | "unsupported" | "unknown";
  apiVersions: string[];
  specs: string[];
  chainId: string;
  environment: "SN_MAIN" | "SN_SEPOLIA" | "UNKNOWN";
  mismatch: boolean;
  expected: "SN_MAIN" | "SN_SEPOLIA";
}

export interface PoolFeeObservation {
  fee: bigint;
  blockNumber: number | null;
}

// Receipt normalization — unknown provider values remain UNKNOWN and cannot
// satisfy a finality/completion gate.
export type ReceiptExecutionStatus = "SUCCEEDED" | "REVERTED" | "RECEIVED" | "PENDING" | "UNKNOWN";
export type ReceiptFinalityStatus = "ACCEPTED_ON_L2" | "ACCEPTED_ON_L1" | "RECEIVED" | "PENDING" | "UNKNOWN";

export interface NormalizedReceipt {
  readonly transactionHash: Hex;
  readonly executionStatus: ReceiptExecutionStatus;
  readonly finalityStatus: ReceiptFinalityStatus;
  readonly blockNumber: number | null;
  readonly poolEventFound: boolean;
  readonly attributedDepositor: Hex | null;
  readonly senderIgnored: Hex | null;
  readonly events: readonly { address: string; keys: string[]; data?: string[] }[];
  readonly rawExecutionStatus: string;
}

export const STRK20_POOL_ADDRESS = "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a" as Hex;
const STARKNET_FIELD_PRIME = (1n << 251n) + (17n << 192n) + 1n;
const CONTRACT_ADDRESS_LIMIT = 1n << 251n;

/** Canonical numeric comparison for valid Starknet hex values. */
export function normalizeHex(value: unknown): string {
  if (typeof value !== "string") {
    throw new Strk20Error(STRK20_ERROR_CODE.DEPENDENCY_FAILURE, "malformed_hex_value");
  }
  const text = value.trim().toLowerCase();
  if (!/^0x[0-9a-f]{1,64}$/.test(text)) {
    throw new Strk20Error(STRK20_ERROR_CODE.DEPENDENCY_FAILURE, "malformed_hex_value");
  }
  return `0x${text.slice(2).toLowerCase().padStart(64, "0")}`;
}

function normalizeActionAddress(value: unknown, context: string): Hex {
  try {
    const normalized = normalizeHex(value);
    const numeric = BigInt(normalized);
    if (numeric === 0n || numeric >= CONTRACT_ADDRESS_LIMIT) throw new Error("out_of_range");
    return normalized as Hex;
  } catch {
    throw new Strk20Error(STRK20_ERROR_CODE.INVALID_AMOUNT, `invalid_address:${context}`);
  }
}

function isFeltLiteral(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) return false;
  try {
    const numeric = value.startsWith("0x") || value.startsWith("0X") ? BigInt(value) : BigInt(value);
    return numeric >= 0n && numeric < STARKNET_FIELD_PRIME;
  } catch {
    return false;
  }
}

function validateFelt(value: unknown, context: string): void {
  if (!isFeltLiteral(value)) throw new Strk20Error(STRK20_ERROR_CODE.INVALID_AMOUNT, `invalid_felt:${context}`);
}

function validateInvokeCalldata(value: unknown, context: string): void {
  if (!Array.isArray(value)) throw new Strk20Error(STRK20_ERROR_CODE.INVALID_AMOUNT, `invalid_calldata:${context}`);
  for (const [index, item] of value.entries()) {
    if (typeof item === "string" && /^\$\{(?:openNoteIds\[\d+\]|poolAddress)\}$/.test(item)) continue;
    validateFelt(item, `${context}[${index}]`);
  }
}

/** Strict runtime validation against the wallet-standard STRK20 action union. */
export function validateActions(actions: readonly Strk20Action[]): void {
  assertNoViewingKey(actions, "validateActions");
  if (!Array.isArray(actions) || actions.length === 0) {
    throw new Strk20Error(STRK20_ERROR_CODE.INVALID_AMOUNT, "actions_must_be_non_empty_array");
  }
  for (const [index, action] of actions.entries()) {
    if (!action || typeof action !== "object" || typeof (action as Record<string, unknown>).type !== "string") {
      throw new Strk20Error(STRK20_ERROR_CODE.INVALID_AMOUNT, `action_missing_type:${index}`);
    }
    const item = action as Record<string, unknown>;
    switch (item.type) {
      case "deposit":
        normalizeActionAddress(item.token, `actions[${index}].token`);
        validateFelt(item.amount, `actions[${index}].amount`);
        break;
      case "withdraw":
        normalizeActionAddress(item.token, `actions[${index}].token`);
        validateFelt(item.amount, `actions[${index}].amount`);
        normalizeActionAddress(item.recipient, `actions[${index}].recipient`);
        break;
      case "transfer":
        normalizeActionAddress(item.token, `actions[${index}].token`);
        if (item.amount !== "OPEN") validateFelt(item.amount, `actions[${index}].amount`);
        normalizeActionAddress(item.recipient, `actions[${index}].recipient`);
        break;
      case "invoke":
        normalizeActionAddress(item.contract, `actions[${index}].contract`);
        validateInvokeCalldata(item.calldata, `actions[${index}].calldata`);
        break;
      default:
        throw new Strk20Error(STRK20_ERROR_CODE.INVALID_AMOUNT, `unsupported_action_type:${String(item.type)}`);
    }
  }
}

function normalizeExecutionStatus(value: unknown): ReceiptExecutionStatus {
  const status = String(value ?? "UNKNOWN").toUpperCase();
  if (status === "SUCCEEDED") return "SUCCEEDED";
  if (status === "REVERTED") return "REVERTED";
  if (status === "RECEIVED" || status === "PRE_CONFIRMED") return "RECEIVED";
  if (status === "PENDING") return "PENDING";
  return "UNKNOWN";
}

function normalizeFinalityStatus(value: unknown): ReceiptFinalityStatus {
  const status = String(value ?? "UNKNOWN").toUpperCase();
  if (status === "ACCEPTED_ON_L1") return "ACCEPTED_ON_L1";
  if (status === "ACCEPTED_ON_L2") return "ACCEPTED_ON_L2";
  if (status === "RECEIVED" || status === "PRE_CONFIRMED") return "RECEIVED";
  if (status === "PENDING") return "PENDING";
  return "UNKNOWN";
}

function normalizeBlockNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Strk20Error(STRK20_ERROR_CODE.DEPENDENCY_FAILURE, "malformed_receipt_block_number");
  }
  return value;
}

/**
 * Normalize a Starknet receipt. `expectedTxHash` binds a response returned by
 * a keyed provider call to the requested transaction; a conflicting provider
 * hash is an observation failure, never repaired by overwriting it.
 */
export function normalizeReceipt(raw: Record<string, unknown>, expectedTxHash?: Hex): NormalizedReceipt {
  assertNoViewingKey(raw, "normalizeReceipt.raw");
  if (!raw || typeof raw !== "object") {
    throw new Strk20Error(STRK20_ERROR_CODE.DEPENDENCY_FAILURE, "malformed_receipt");
  }

  const returnedHash = raw.transactionHash ?? raw.transaction_hash ?? expectedTxHash;
  if (returnedHash === undefined) {
    throw new Strk20Error(STRK20_ERROR_CODE.DEPENDENCY_FAILURE, "receipt_transaction_hash_missing");
  }
  const txHash = normalizeHex(returnedHash) as Hex;
  if (expectedTxHash !== undefined && txHash !== normalizeHex(expectedTxHash)) {
    throw new Strk20Error(STRK20_ERROR_CODE.DEPENDENCY_FAILURE, "receipt_transaction_hash_mismatch");
  }

  const executionStatus = normalizeExecutionStatus(raw.executionStatus ?? raw.execution_status);
  const finalityStatus = normalizeFinalityStatus(raw.finalityStatus ?? raw.finality_status);
  const rawEvents = raw.events ?? [];
  if (!Array.isArray(rawEvents)) {
    throw new Strk20Error(STRK20_ERROR_CODE.DEPENDENCY_FAILURE, "malformed_receipt_events");
  }
  const events = rawEvents.map((event, index) => {
    if (!event || typeof event !== "object") {
      throw new Strk20Error(STRK20_ERROR_CODE.DEPENDENCY_FAILURE, `malformed_receipt_event:${index}`);
    }
    const item = event as Record<string, unknown>;
    const address = item.address ?? item.from_address;
    const keys = item.keys ?? [];
    if (typeof address !== "string" || !Array.isArray(keys) || !keys.every((key) => typeof key === "string")) {
      throw new Strk20Error(STRK20_ERROR_CODE.DEPENDENCY_FAILURE, `malformed_receipt_event:${index}`);
    }
    const data = item.data;
    if (data !== undefined && (!Array.isArray(data) || !data.every((value) => typeof value === "string"))) {
      throw new Strk20Error(STRK20_ERROR_CODE.DEPENDENCY_FAILURE, `malformed_receipt_event_data:${index}`);
    }
    return {
      address: normalizeHex(address),
      keys: keys.map((key) => normalizeHex(key)),
      ...(data === undefined ? {} : { data: data as string[] }),
    };
  });

  const poolFound = executionStatus === "SUCCEEDED" && events.some((event) => event.address === normalizeHex(STRK20_POOL_ADDRESS));
  const poolEvent = events.find((event) => event.address === normalizeHex(STRK20_POOL_ADDRESS));
  const senderValue = raw.senderAddress ?? raw.sender_address;
  const sender = senderValue === null || senderValue === undefined ? null : (normalizeHex(senderValue) as Hex);

  return {
    transactionHash: txHash,
    executionStatus,
    finalityStatus,
    blockNumber: normalizeBlockNumber(raw.blockNumber ?? raw.block_number),
    poolEventFound: poolFound,
    attributedDepositor: poolFound && poolEvent && poolEvent.keys.length > 0 ? (poolEvent.keys[0] as Hex) : null,
    senderIgnored: sender,
    events,
    rawExecutionStatus: String(raw.executionStatus ?? raw.execution_status ?? "UNKNOWN").toUpperCase(),
  };
}

function providerMessage(error: unknown): string {
  return error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
}

/** Map provider failures to stable, non-sensitive domain errors. */
export function classifyProviderError(error: unknown): never {
  const msg = providerMessage(error);
  // Screening must be checked before generic "rejected"/"denied" matching.
  if (msg.includes("screening_unavailable") || msg.includes("screening unavailable")) {
    throw new Strk20Error(STRK20_ERROR_CODE.SCREENING_UNAVAILABLE, "screening_unavailable");
  }
  if (msg.includes("screening_rejected") || msg.includes("screening rejected") || msg.includes("privacy_leak") || msg.includes("privacy leak")) {
    throw new Strk20Error(STRK20_ERROR_CODE.SCREENING_REJECTED, "screening_rejected");
  }
  if (msg.includes("not_registered") || msg.includes("not registered")) {
    throw new Strk20Error(STRK20_ERROR_CODE.REGISTRATION_REQUIRED, "not_registered");
  }
  if (msg.includes("insufficient_private_balance") || msg.includes("insufficient")) {
    throw new Strk20Error(STRK20_ERROR_CODE.INVALID_AMOUNT, "insufficient_private_balance");
  }
  if (msg.includes("user_refused") || msg.includes("user refused") || msg.includes("user rejected") || msg.includes("denied") || msg.includes("cancel")) {
    throw new Strk20Error(STRK20_ERROR_CODE.PROVIDER_REFUSED, "wallet_user_refused");
  }
  if (msg.includes("api_version_not_supported") || msg.includes("unsupported")) {
    throw new Strk20Error(STRK20_ERROR_CODE.UNSUPPORTED_WALLET, "wallet_api_unsupported");
  }
  throw new Strk20Error(STRK20_ERROR_CODE.DEPENDENCY_FAILURE, "provider_error");
}

/** Capability detection pure helper (least-privilege, no balance reads). */
export function evaluateCapability(apiVersions: readonly string[], specs: readonly string[]): { capable: boolean; status: CapabilityResult["capabilityStatus"] } {
  assertNoViewingKey({ apiVersions, specs }, "evaluateCapability");
  const status = classifyStrk20Capability(apiVersions, specs);
  return { capable: status === "supported", status };
}

export function ensureCapabilityOrThrow(apiVersions: readonly string[], specs: readonly string[]): void {
  const { capable, status } = evaluateCapability(apiVersions, specs);
  if (status === "unknown") throw new Strk20Error(STRK20_ERROR_CODE.CAPABILITY_UNKNOWN, "wallet_capability_unknown");
  if (!capable) {
    throw new Strk20Error(STRK20_ERROR_CODE.UNSUPPORTED_WALLET, "wallet_api_below_0_10_3");
  }
}

export interface NetworkGuardInput {
  chainId: string;
  expectedChainId?: string | null;
}

export function evaluateNetworkGuard(input: NetworkGuardInput): CapabilityResult & { mismatch: boolean } {
  assertNoViewingKey(input, "evaluateNetworkGuard");
  if (typeof input.chainId !== "string") throw new Strk20Error(STRK20_ERROR_CODE.CAPABILITY_UNKNOWN, "chain_id_unknown");
  const expected = getExpectedWalletEnvironment(input.expectedChainId ?? "SN_SEPOLIA");
  const env = classifyWalletEnvironment(input.chainId, { mainnet: "SN_MAIN", sepolia: "SN_SEPOLIA" });
  return {
    capable: false,
    capabilityStatus: "unknown",
    apiVersions: [],
    specs: [],
    chainId: input.chainId,
    environment: env,
    expected,
    mismatch: env !== expected,
  };
}

export function ensureNetworkOrThrow(chainId: string, expectedChainId?: string | null): void {
  const g = evaluateNetworkGuard({ chainId, expectedChainId });
  if (g.environment === "UNKNOWN") {
    throw new Strk20Error(STRK20_ERROR_CODE.NETWORK_MISMATCH, "unknown_network");
  }
  if (g.mismatch) {
    throw new Strk20Error(STRK20_ERROR_CODE.NETWORK_MISMATCH, `expected_${g.expected}_got_${g.environment}`);
  }
}

// Long-running proof state helpers.
export type ProvingState = "idle" | "preparing" | "proving" | "ready" | "submitting" | "confirmed" | "failed";

export interface ProvingTracker {
  state: ProvingState;
  startedAt: number | null;
  elapsedMs: number | null;
  callAndProof: Strk20CallAndProof | null;
  errorCode: string | null;
}

export function createProvingTracker(now: number): ProvingTracker {
  return { state: "idle", startedAt: now, elapsedMs: null, callAndProof: null, errorCode: null };
}

export function transitionProving(
  tracker: ProvingTracker,
  to: ProvingState,
  now: number,
  callAndProof?: Strk20CallAndProof | null,
  errorCode?: string | null,
): ProvingTracker {
  assertNoViewingKey({ to, callAndProof }, "transitionProving");
  const allowed: Record<ProvingState, ProvingState[]> = {
    idle: ["preparing"],
    preparing: ["proving", "ready", "failed"],
    proving: ["ready", "failed"],
    ready: ["submitting", "failed"],
    submitting: ["confirmed", "failed"],
    confirmed: [],
    failed: ["preparing", "idle"],
  };
  if (!Number.isFinite(now)) throw new Strk20Error(STRK20_ERROR_CODE.STALE_STATE, "invalid_proving_time");
  if (!allowed[tracker.state].includes(to) && tracker.state !== to) {
    throw new Strk20Error(STRK20_ERROR_CODE.ILLEGAL_TRANSITION, `illegal_proving:${tracker.state}->${to}`);
  }

  const candidate = callAndProof !== undefined ? callAndProof : tracker.callAndProof;
  if (callAndProof !== undefined && callAndProof !== null) {
    assertCallAndProofShape(callAndProof, "transitionProving.callAndProof");
  }
  // A ready/submitting/confirmed tracker must carry a real, validated proof.
  if (to === "ready" || to === "submitting" || to === "confirmed") {
    assertNotEmptyProofForSubmission(candidate);
  } else if ((to === "preparing" || to === "proving") && candidate !== null && candidate !== undefined) {
    assertCallAndProofShape(candidate, "transitionProving.callAndProof");
  }

  const elapsed = tracker.startedAt !== null ? now - tracker.startedAt : null;
  return {
    state: to,
    startedAt: tracker.startedAt,
    elapsedMs: elapsed,
    callAndProof: callAndProof !== undefined ? callAndProof : tracker.callAndProof,
    errorCode: errorCode !== undefined ? errorCode : tracker.errorCode,
  };
}

// Screening distinction helpers.
export type ScreeningOutcome = "approved" | "rejected" | "unavailable";

export function mapScreeningToError(outcome: ScreeningOutcome, detail?: string): never {
  if (outcome === "rejected") throw new Strk20Error(STRK20_ERROR_CODE.SCREENING_REJECTED, detail ?? "screening_rejected");
  if (outcome === "unavailable") throw new Strk20Error(STRK20_ERROR_CODE.SCREENING_UNAVAILABLE, detail ?? "screening_unavailable");
  throw new Strk20Error(STRK20_ERROR_CODE.DEPENDENCY_FAILURE, detail ?? "unknown_screening");
}

export function isSimulatedCallAndProof(v: Strk20CallAndProof): boolean {
  return isEmptyProof(v.proof);
}

export function assertSimulatedNotSubmittable(v: Strk20CallAndProof): void {
  if (isEmptyProof(v.proof)) {
    throw new Strk20Error(STRK20_ERROR_CODE.PROOF_REQUIRED, "simulated_call_not_submittable_use_non_simulate_prepare");
  }
}

export { isEmptyProof, assertProofPresent };
