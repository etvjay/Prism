// Provider-injected STRK20 action port for Wallet API route.
// Authority: docs/STRK20_CONTEXT + wallet-api-route.md + starknet.js 10.4.0 WalletAccountV6 + @starknet-io/types-js 0.10.3
// Covers: supportedWalletApi >=0.10.3 / supportedSpecs, SN_SEPOLIA guard, simulate/preflight, long-running proof state,
// screening distinction, receipt normalization, fail-closed unsupported/unknown.

import { Strk20Error, STRK20_ERROR_CODE } from "./errors";
import { assertNoViewingKey } from "./privacy-guard";
import { supportsStrk20, classifyWalletEnvironment, getExpectedWalletEnvironment } from "./wallet-capability";
import {
  isEmptyProof,
  assertProofPresent,
  assertNotEmptyProofForSubmission,
  makeEmptyProof,
  type Strk20CallAndProof,
  type Strk20Proof,
} from "./strk20-proof";

// Re-export for adapter consumers
export type { Strk20CallAndProof, Strk20Proof, Strk20Call } from "./strk20-proof";

export type Hex = `0x${string}`;

// STRK20 actions mirrored from @starknet-io/types-js STRK20_ACTION
export type Strk20DepositAction = { type: "deposit"; token: Hex; amount: string };
export type Strk20WithdrawAction = { type: "withdraw"; token: Hex; amount: string; recipient: Hex };
export type Strk20TransferAction = { type: "transfer"; token: Hex; amount: string | "OPEN"; recipient: Hex };
export type Strk20InvokeAction = { type: "invoke"; contract: Hex; calldata: readonly (string | Hex)[] };
export type Strk20Action = Strk20DepositAction | Strk20WithdrawAction | Strk20TransferAction | Strk20InvokeAction;

export interface CapabilityResult {
  capable: boolean;
  apiVersions: string[];
  specs: string[];
  environment: "SN_MAIN" | "SN_SEPOLIA" | "UNKNOWN";
  mismatch: boolean;
  expected: "SN_MAIN" | "SN_SEPOLIA";
}

export interface PoolFeeObservation {
  fee: bigint;
  blockNumber: number | null;
}

// Receipt normalization – unified shape for all STRK20 executions
export type ReceiptExecutionStatus = "SUCCEEDED" | "REVERTED" | "RECEIVED" | "PENDING";
export type ReceiptFinalityStatus = "ACCEPTED_ON_L2" | "ACCEPTED_ON_L1" | "RECEIVED" | "PENDING" | "UNKNOWN";

export interface NormalizedReceipt {
  readonly transactionHash: Hex;
  readonly executionStatus: ReceiptExecutionStatus;
  readonly finalityStatus: ReceiptFinalityStatus;
  readonly blockNumber: number | null;
  readonly poolEventFound: boolean;
  readonly attributedDepositor: Hex | null;
  readonly senderIgnored: Hex | null;
  readonly events: readonly { address: string; keys: string[] }[];
  readonly rawExecutionStatus: string;
}

export const STRK20_POOL_ADDRESS = "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a" as Hex;

function normalizeHex(a: string): string {
  return `0x${a.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
}

export function normalizeReceipt(raw: {
  transaction_hash?: string;
  transactionHash?: string;
  executionStatus?: string;
  execution_status?: string;
  finalityStatus?: string;
  finality_status?: string;
  blockNumber?: number | null;
  block_number?: number | null;
  senderAddress?: string | null;
  sender_address?: string | null;
  events?: { address: string; keys: string[] }[];
}): NormalizedReceipt {
  const txHash = (raw.transactionHash ?? raw.transaction_hash ?? "") as Hex;
  assertNoViewingKey({ txHash }, "normalizeReceipt.txHash");
  const execRaw = String(raw.executionStatus ?? raw.execution_status ?? "PENDING").toUpperCase();
  const finRaw = String(raw.finalityStatus ?? raw.finality_status ?? "UNKNOWN").toUpperCase();
  const exec: ReceiptExecutionStatus = execRaw === "SUCCEEDED" ? "SUCCEEDED" : execRaw === "REVERTED" ? "REVERTED" : execRaw === "RECEIVED" ? "RECEIVED" : "PENDING";
  const fin: ReceiptFinalityStatus = finRaw === "ACCEPTED_ON_L1" ? "ACCEPTED_ON_L1" : finRaw === "ACCEPTED_ON_L2" ? "ACCEPTED_ON_L2" : finRaw === "RECEIVED" ? "RECEIVED" : finRaw === "PENDING" ? "PENDING" : "UNKNOWN";
  const events = raw.events ?? [];
  const poolFound = events.some((e) => normalizeHex(e.address) === normalizeHex(STRK20_POOL_ADDRESS));
  const poolEvent = events.find((e) => normalizeHex(e.address) === normalizeHex(STRK20_POOL_ADDRESS));
  const depositor = poolEvent && poolEvent.keys.length > 0 ? (poolEvent.keys[0] as Hex) : null;
  const sender = (raw.senderAddress ?? raw.sender_address ?? null) as Hex | null;
  return {
    transactionHash: txHash as Hex,
    executionStatus: exec,
    finalityStatus: fin,
    blockNumber: raw.blockNumber ?? raw.block_number ?? null,
    poolEventFound: poolFound,
    attributedDepositor: depositor,
    senderIgnored: sender,
    events,
    rawExecutionStatus: execRaw,
  };
}

// Fail-closed helpers

export function classifyProviderError(error: unknown): never {
  const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  // User refusal – wallet user denied approval
  if (msg.includes("user_refused") || msg.includes("user refused") || msg.includes("rejected") || msg.includes("denied") || msg.includes("cancel")) {
    // Avoid leaking raw stack; map to stable code
    if (msg.includes("user_refused") || msg.includes("rejected") || msg.includes("denied") || msg.includes("cancel")) {
      throw new Strk20Error(STRK20_ERROR_CODE.PROVIDER_REFUSED, "wallet_user_refused");
    }
  }
  if (msg.includes("not_registered") || msg.includes("not registered")) {
    throw new Strk20Error(STRK20_ERROR_CODE.REGISTRATION_REQUIRED, "not_registered");
  }
  if (msg.includes("insufficient_private_balance") || msg.includes("insufficient")) {
    throw new Strk20Error(STRK20_ERROR_CODE.INVALID_AMOUNT, "insufficient_private_balance");
  }
  if (msg.includes("privacy_leak") || msg.includes("privacy leak") || msg.includes("screening_rejected") || msg.includes("screening rejected")) {
    throw new Strk20Error(STRK20_ERROR_CODE.SCREENING_REJECTED, "privacy_leak_or_screening_rejected");
  }
  if (msg.includes("screening_unavailable") || msg.includes("screening unavailable")) {
    throw new Strk20Error(STRK20_ERROR_CODE.SCREENING_UNAVAILABLE, "screening_unavailable");
  }
  if (msg.includes("api_version_not_supported") || msg.includes("unsupported")) {
    throw new Strk20Error(STRK20_ERROR_CODE.UNSUPPORTED_WALLET, "wallet_api_unsupported");
  }
  // Unknown -> dependency failure (fail-closed, retryable backoff)
  throw new Strk20Error(STRK20_ERROR_CODE.DEPENDENCY_FAILURE, `provider_error:${msg.slice(0, 60)}`);
}

/**
 * Capability detection pure helper (least-privilege, no balance reads).
 * Throws CAPABILITY_UNKNOWN if versions empty/unknown, UNSUPPORTED_WALLET if below 0.10.3
 */
export function evaluateCapability(apiVersions: string[], specs: string[]): { capable: boolean } {
  assertNoViewingKey({ apiVersions, specs }, "evaluateCapability");
  const capable = supportsStrk20(apiVersions, specs);
  return { capable };
}

export function ensureCapabilityOrThrow(apiVersions: string[], specs: string[]): void {
  const { capable } = evaluateCapability(apiVersions, specs);
  if (!capable) {
    throw new Strk20Error(STRK20_ERROR_CODE.UNSUPPORTED_WALLET, `wallet_api_below_0_10_3:api[${apiVersions.join(",")}]_spec[${specs.join(",")}]`);
  }
}

export interface NetworkGuardInput {
  chainId: string;
  expectedChainId?: string | null; // expects "SN_SEPOLIA" by default; SN_MAIN only if explicit
}

export function evaluateNetworkGuard(input: NetworkGuardInput): CapabilityResult & { mismatch: boolean } {
  assertNoViewingKey(input, "evaluateNetworkGuard");
  const expected = getExpectedWalletEnvironment(input.expectedChainId ?? "SN_SEPOLIA");
  const env = classifyWalletEnvironment(input.chainId, {
    mainnet: "SN_MAIN",
    sepolia: "SN_SEPOLIA",
  });
  const mismatch = env !== expected;
  return {
    capable: false, // filled by caller if needed
    apiVersions: [],
    specs: [],
    environment: env,
    expected,
    mismatch,
  };
}

export function ensureNetworkOrThrow(chainId: string, expectedChainId?: string | null): void {
  const g = evaluateNetworkGuard({ chainId, expectedChainId });
  if (g.environment === "UNKNOWN") {
    throw new Strk20Error(STRK20_ERROR_CODE.NETWORK_MISMATCH, `unknown_network:${chainId}`);
  }
  if (g.mismatch) {
    throw new Strk20Error(STRK20_ERROR_CODE.NETWORK_MISMATCH, `expected_${g.expected}_got_${g.environment}`);
  }
}

export function validateActions(actions: readonly Strk20Action[]): void {
  assertNoViewingKey(actions, "validateActions");
  if (!Array.isArray(actions) || actions.length === 0) {
    throw new Strk20Error(STRK20_ERROR_CODE.INVALID_AMOUNT, "actions_must_be_non_empty_array");
  }
  for (const a of actions) {
    if (!a || typeof (a as Record<string, unknown>).type !== "string") {
      throw new Strk20Error(STRK20_ERROR_CODE.INVALID_AMOUNT, "action_missing_type");
    }
    // Token/address fields must be hex; basic shape guard (full Starknet address validation deferred to wallet)
    const rec = a as Record<string, unknown>;
    if (typeof rec.token === "string" && !(rec.token as string).startsWith("0x")) {
      throw new Strk20Error(STRK20_ERROR_CODE.INVALID_AMOUNT, "token_must_be_0x_hex");
    }
  }
}

// Long-running proof state helpers

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

export function transitionProving(tracker: ProvingTracker, to: ProvingState, now: number, callAndProof?: Strk20CallAndProof | null, errorCode?: string | null): ProvingTracker {
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
  if (!allowed[tracker.state].includes(to) && tracker.state !== to) {
    throw new Strk20Error(STRK20_ERROR_CODE.ILLEGAL_TRANSITION, `illegal_proving:${tracker.state}->${to}`);
  }
  // Proof invariant: ready must have non-empty proof; preparing/proving may have empty
  if (to === "ready" && callAndProof) {
    assertNotEmptyProofForSubmission(callAndProof);
  }
  if (to === "preparing" || to === "proving") {
    // simulate/preflight path may have empty proof – allowed
    if (callAndProof && !isEmptyProof(callAndProof.proof)) {
      assertProofPresent(callAndProof.proof, "proving_non_empty");
    }
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

// Screening distinction helpers

export type ScreeningOutcome = "approved" | "rejected" | "unavailable";

export function mapScreeningToError(outcome: ScreeningOutcome, detail?: string): never {
  if (outcome === "rejected") throw new Strk20Error(STRK20_ERROR_CODE.SCREENING_REJECTED, detail ?? "screening_rejected");
  if (outcome === "unavailable") throw new Strk20Error(STRK20_ERROR_CODE.SCREENING_UNAVAILABLE, detail ?? "screening_unavailable");
  throw new Strk20Error(STRK20_ERROR_CODE.DEPENDENCY_FAILURE, detail ?? "unknown_screening");
}

// Simulate/preflight helpers

export function isSimulatedCallAndProof(v: Strk20CallAndProof): boolean {
  return isEmptyProof(v.proof);
}

export function assertSimulatedNotSubmittable(v: Strk20CallAndProof): void {
  if (isEmptyProof(v.proof)) {
    throw new Strk20Error(STRK20_ERROR_CODE.PROOF_REQUIRED, "simulated_call_not_submittable_use_non_simulate_prepare");
  }
}

// Re-export hex helper for adapters
export { normalizeHex, isEmptyProof };
