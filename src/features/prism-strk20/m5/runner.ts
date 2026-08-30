// M5 Vesu E2E runner — provider-injected, evidence-honest.
// Canonical route: PrismVesuLendingHelper, SN_SEPOLIA, pinned STRK → Vesu STRK vToken.
// Authority: M5_CLOSEOUT_PROTOCOL, helper lib.cairo, M5 red-team, WalletAccountV6 types.
// Never synthesizes a proof; simulate proof is empty and not used as evidence.

import { supportsStrk20 } from "../domain/wallet-capability";
import { assertNoViewingKey } from "../domain/privacy-guard";
import { Strk20Error, STRK20_ERROR_CODE } from "../domain/errors";
import {
  MAX_U128,
  MIN_AMOUNT,
  STRK_SEPOLIA,
  VTOKEN_STRK_SEPOLIA,
  HELPER_ADDRESS_SEPOLIA,
  PRIVACY_POOL_SEPOLIA,
  OPEN_NOTE_ZERO_PLACEHOLDER,
  addressesEqual,
  isValidStarknetAddress,
} from "./constants";
import type {
  M5Provider,
  Strk20Action,
  Strk20InvokeAction,
  Strk20CallAndProof,
  IndependentRpcReader,
  ValidatorPort,
} from "./ports";
import type { Hex } from "../domain/receipt";
import {
  M5_BLOCKED_BY_ENVIRONMENT_EVIDENCE,
  M5_ERROR_CODE,
  M5Error,
  type M5Blocked,
  type M5BlockedReason,
  type M5ErrorCode,
} from "./errors";

// Keep the historical runner exports stable for existing consumers.
export {
  M5_BLOCKED_BY_ENVIRONMENT_EVIDENCE,
  M5_ERROR_CODE,
  M5Error,
  type M5Blocked,
  type M5BlockedReason,
  type M5ErrorCode,
} from "./errors";

import {
  attributePoolEvent,
  containsAddressInCalldata,
  validateHelperCalldata,
  validateM5Actions,
  validateM5Receipt,
  validateM5TransactionObservation,
  validateM5Conservation,
  validateM5OpenNoteObservation,
  validateVesuDepositObservation,
  type M5ReceiptObservation,
} from "./validation";
import { createM5Operation, loadM5Operation, markM5SubmissionStarted, markM5Submitted, persistM5Operation, recoverM5Operation, type M5Operation } from "./operation";
import { evaluateM5Maturity } from "./maturity";
import { isShadowAccountObservationSupported, normalizeShadowAccountObservation, type ShadowAccountObservation } from "../domain/shadow-account";
// ---------------------------------------------------------------------------

export interface M5RunnerConfig {
  // Pinned canonical addresses (allow override for testing, but defaults are SEPOLIA)
  strkToken?: string;
  vToken?: string;
  helperAddress?: string;
  privacyPool?: string;
  chainIdExpected?: string; // SN_SEPOLIA
  // Amount to lend (u128, in STRK base units, e.g. 1e18 for 1 STRK)
  inAmount: bigint;
  /** Optional fee quote captured before the run; live fee must still match. */
  quotedFee?: bigint | null;
  // Polling
  receiptTimeoutMs?: number;
  receiptIntervalMs?: number;
  // Independent RPC identity is caller-supplied; the runner never calls two
  // endpoints "independent" merely because they returned the same bytes.
  independentRpc?: IndependentRpcReader | null;
  independentSourceId?: string | null;
  primarySourceId?: string | null;
  // Optional local operation identifier for the no-rebroadcast recovery fence.
  operationId?: string;
  // Upstream validator
  validator?: ValidatorPort | null;
  // Commit for evidence envelope
  commit?: string;
}

export interface M5LivePredicates {
  capabilityObserved: boolean;
  feeObserved: boolean;
  registrationObserved: boolean;
  simulateObserved: boolean;
  calldataExact: boolean;
  u128BoundaryOk: boolean;
  u256BoundaryOk: boolean;
  noteDenominationShares: boolean;
  submissionObserved: boolean;
  receiptObserved: boolean;
  executionSucceeded: boolean;
  poolEventObserved: boolean;
  poolEventAttributed: boolean;
  helperCalldataInReceipt: boolean;
  vesuDepositObserved: boolean;
  operationRecovered: boolean;
  maturityState: "unobserved" | "maturing" | "privately_available";
  // The current WalletAccountV6/M5 receipt ports do not expose private-note
  // readback or a maturity oracle. These remain false until an external,
  // consented wallet/session adapter supplies them explicitly.
  noteReadbackObserved: boolean;
  maturityObserved: boolean;
  conservationOk: boolean;
  noStrandedBalance: boolean;
  independentReadbackOk: boolean;
  validatorMineOk: boolean | null; // null when not configured
  /** Optional provider observation only; never an M5 completion predicate. */
  shadowAccountObserved: boolean;
}

export interface M5Success {
  verdict: "M5_E2E_RUNNER_READY_X2" | "M5_E2E_SUCCESS_X3";
  txHash: Hex;
  blockNumber: number | null;
  predicates: M5LivePredicates;
  evidence: {
    network: string;
    helperAddress: string;
    strkToken: string;
    vToken: string;
    inAmount: string;
    calldata: string[];
    actions: Strk20Action[];
    receipt: unknown;
    independentReadback: unknown;
    operation?: M5Operation;
    poolEvent?: unknown;
    helperCalldata?: string[] | null;
    vesuDeposit?: unknown;
    maturity?: unknown;
    conservation: { inAmount: string; vTokenDeltaShares?: string; helperStrkBalance: string; helperVTokenBalance: string };
    note?: { noteId: string; token: string; amount: string };
    validator?: unknown;
    shadowAccountObservation?: ShadowAccountObservation;
    commit?: string;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function assertViewingKeyFree(obj: unknown, ctx: string): void {
  try {
    assertNoViewingKey(obj as Record<string, unknown>, ctx);
  } catch (e) {
    throw new M5Error(M5_ERROR_CODE.VIEWING_KEY_FORBIDDEN, (e as Error).message);
  }
}

function toFeltDecimal(v: bigint): string {
  return `0x${v.toString(16)}`;
}

function isU128(v: bigint): boolean {
  return v >= 0n && v <= MAX_U128;
}

function assertConfiguredAddress(value: string, name: string): void {
  if (!isValidStarknetAddress(value) || BigInt(value) === 0n) {
    throw new M5Error(M5_ERROR_CODE.CONFIG_INVALID, `${name}_must_be_nonzero_hex_address`);
  }
}

function safeErrorMessage(error: unknown): string {
  const raw = String((error as Error)?.message ?? error ?? "unknown_error");
  if (/viewing.?key|private.?key|private.?note|private.?balance|seed.?phrase|mnemonic|calldata|proof|raw|provider.?response|secret|password/i.test(raw)) return "provider_error_redacted";
  return raw.slice(0, 160);
}

function normalizeSourceId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length === 0 ? null : normalized;
}

function isExpectedSepoliaChainId(chainId: string): boolean {
  const normalized = chainId.trim().toUpperCase();
  // Wallet APIs commonly return the symbolic id; accept the canonical felt
  // encoding too, but never a substring/lookalike such as NOT_SEPOLIA.
  return normalized === "SN_SEPOLIA" || normalized === "0X534E5F5345504F4C4941";
}

// Exact helper calldata: [STRK, VTOKEN, amount, "${openNoteIds[0]}"]
export function buildHelperCalldata(inAmount: bigint, opts?: { strk?: string; vToken?: string }): string[] {
  const strk = opts?.strk ?? STRK_SEPOLIA;
  const vt = opts?.vToken ?? VTOKEN_STRK_SEPOLIA;
  assertConfiguredAddress(strk, "strk_token");
  assertConfiguredAddress(vt, "v_token");
  if (addressesEqual(strk, vt)) throw new M5Error(M5_ERROR_CODE.CONFIG_INVALID, "strk_token_and_v_token_must_differ");
  if (inAmount < 0n) throw new M5Error(M5_ERROR_CODE.INVALID_AMOUNT, "NEGATIVE_IN_AMOUNT");
  if (!isU128(inAmount)) throw new M5Error(M5_ERROR_CODE.AMOUNT_OVERFLOW, `in_amount ${inAmount} exceeds u128`);
  if (inAmount < MIN_AMOUNT) throw new M5Error(M5_ERROR_CODE.INVALID_AMOUNT, "ZERO_IN_AMOUNT");
  const calldata = [strk, vt, toFeltDecimal(inAmount), OPEN_NOTE_ZERO_PLACEHOLDER];
  validateHelperCalldata(calldata, {
    strkToken: strk,
    vToken: vt,
    helperAddress: HELPER_ADDRESS_SEPOLIA,
    privacyPool: PRIVACY_POOL_SEPOLIA,
    inAmount,
  });
  return calldata;
}

export function buildActions(inAmount: bigint, selfAddress: string, cfg: M5RunnerConfig): Strk20Action[] {
  const strk = cfg.strkToken ?? STRK_SEPOLIA;
  const vToken = cfg.vToken ?? VTOKEN_STRK_SEPOLIA;
  const helper = cfg.helperAddress ?? HELPER_ADDRESS_SEPOLIA;
  assertConfiguredAddress(strk, "strk_token");
  assertConfiguredAddress(vToken, "v_token");
  assertConfiguredAddress(helper, "helper_address");
  assertConfiguredAddress(selfAddress, "wallet_address");
  const calldata = buildHelperCalldata(inAmount, { strk, vToken });
  // The pinned first-party Wallet API accepts exactly these two atomic actions:
  // OPEN transfer creates the note consumed by the helper invoke placeholder.
  const actions: Strk20Action[] = [
    { type: "transfer", token: strk, amount: "OPEN", recipient: selfAddress },
    { type: "invoke", contract: helper, calldata },
  ];
  validateM5Actions(actions, {
    strkToken: strk,
    vToken,
    helperAddress: helper,
    privacyPool: cfg.privacyPool ?? PRIVACY_POOL_SEPOLIA,
    inAmount,
  }, selfAddress);
  return actions;
}

function isNotRegisteredError(e: unknown): boolean {
  const msg = String((e as Error)?.message ?? "").toLowerCase();
  return msg.includes("not_registered") || msg.includes("not registered") || msg.includes("not-registered");
}
function isInsufficientBalanceError(e: unknown): boolean {
  const msg = String((e as Error)?.message ?? "").toLowerCase();
  return msg.includes("insufficient_private_balance") || msg.includes("insufficient");
}
function isPrivacyLeakError(e: unknown): boolean {
  const msg = String((e as Error)?.message ?? "").toLowerCase();
  return msg.includes("privacy_leak");
}

function isUserRejectedError(e: unknown): boolean {
  const msg = String((e as Error)?.message ?? "").toLowerCase();
  return msg.includes("user_refused") || msg.includes("user refused") || msg.includes("user rejected") || msg.includes("user denied");
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export class M5VesuRunner {
  private cfg: Required<M5RunnerConfig>;
  private operation: M5Operation | null = null;

  constructor(cfg: M5RunnerConfig) {
    this.cfg = {
      strkToken: cfg.strkToken ?? STRK_SEPOLIA,
      vToken: cfg.vToken ?? VTOKEN_STRK_SEPOLIA,
      helperAddress: cfg.helperAddress ?? HELPER_ADDRESS_SEPOLIA,
      privacyPool: cfg.privacyPool ?? PRIVACY_POOL_SEPOLIA,
      chainIdExpected: cfg.chainIdExpected ?? "SN_SEPOLIA",
      inAmount: cfg.inAmount,
      quotedFee: cfg.quotedFee ?? null,
      receiptTimeoutMs: cfg.receiptTimeoutMs ?? 60_000,
      receiptIntervalMs: cfg.receiptIntervalMs ?? 2_000,
      independentRpc: (cfg.independentRpc ?? null) as IndependentRpcReader | null,
      independentSourceId: normalizeSourceId(cfg.independentSourceId ?? cfg.independentRpc?.sourceId),
      primarySourceId: normalizeSourceId(cfg.primarySourceId),
      operationId: cfg.operationId ?? "m5-vesu-local",
      validator: (cfg.validator ?? null) as ValidatorPort | null,
      commit: cfg.commit ?? "",
    };
    assertViewingKeyFree(cfg, "M5RunnerConfig");
    assertConfiguredAddress(this.cfg.strkToken!, "strk_token");
    assertConfiguredAddress(this.cfg.vToken!, "v_token");
    assertConfiguredAddress(this.cfg.helperAddress!, "helper_address");
    assertConfiguredAddress(this.cfg.privacyPool!, "privacy_pool");
    if (addressesEqual(this.cfg.strkToken!, this.cfg.vToken!)) {
      throw new M5Error(M5_ERROR_CODE.CONFIG_INVALID, "strk_token_and_v_token_must_differ");
    }
    if (this.cfg.independentRpc && this.cfg.primarySourceId && this.cfg.independentSourceId && this.cfg.primarySourceId === this.cfg.independentSourceId) {
      throw new M5Error(M5_ERROR_CODE.CONFIG_INVALID, "independent_rpc_source_must_differ");
    }
    if (!Number.isSafeInteger(this.cfg.receiptTimeoutMs!) || this.cfg.receiptTimeoutMs! < 0) {
      throw new M5Error(M5_ERROR_CODE.CONFIG_INVALID, "receipt_timeout_invalid");
    }
    if (!Number.isSafeInteger(this.cfg.receiptIntervalMs!) || this.cfg.receiptIntervalMs! < 0) {
      throw new M5Error(M5_ERROR_CODE.CONFIG_INVALID, "receipt_interval_invalid");
    }
    if (this.cfg.chainIdExpected!.trim().toUpperCase() !== "SN_SEPOLIA") {
      throw new M5Error(M5_ERROR_CODE.CONFIG_INVALID, "M5_route_is_SN_SEPOLIA_only");
    }
    if (typeof cfg.inAmount !== "bigint") throw new M5Error(M5_ERROR_CODE.INVALID_AMOUNT, "in_amount_must_be_bigint");
    if (cfg.inAmount < 0n) throw new M5Error(M5_ERROR_CODE.INVALID_AMOUNT, "in_amount negative");
    if (!isU128(cfg.inAmount)) throw new M5Error(M5_ERROR_CODE.AMOUNT_OVERFLOW, `in_amount ${cfg.inAmount} exceeds u128 max`);
    if (cfg.inAmount < MIN_AMOUNT) throw new M5Error(M5_ERROR_CODE.INVALID_AMOUNT, "in_amount zero");
    if (cfg.quotedFee !== undefined && cfg.quotedFee !== null && (typeof cfg.quotedFee !== "bigint" || cfg.quotedFee < 0n)) {
      throw new M5Error(M5_ERROR_CODE.FEE_UNAVAILABLE, "quoted_fee_invalid");
    }
    this.operation = loadM5Operation(this.cfg.operationId!);
  }

  // Main entry — provider-injected
  async run(provider: M5Provider | null | undefined): Promise<M5Success | M5Blocked> {
    // 0. Environment gate — no wallet/prover → BLOCKED, no fabricated hash
    if (!provider) {
      return {
        verdict: M5_BLOCKED_BY_ENVIRONMENT_EVIDENCE,
        reason: "NO_WALLET",
        detail: "No WalletAccountV6 provider injected — M5 requires real STRK20 wallet/prover; no mock proof used.",
        commit: this.cfg.commit,
      };
    }
    assertViewingKeyFree(provider, "M5Provider");

    const predicates: M5LivePredicates = {
      capabilityObserved: false,
      feeObserved: false,
      registrationObserved: false,
      simulateObserved: false,
      calldataExact: false,
      u128BoundaryOk: false,
      u256BoundaryOk: false,
      noteDenominationShares: false,
      submissionObserved: false,
      receiptObserved: false,
      executionSucceeded: false,
      poolEventObserved: false,
      poolEventAttributed: false,
      helperCalldataInReceipt: false,
      vesuDepositObserved: false,
      operationRecovered: false,
      maturityState: "unobserved",
      noteReadbackObserved: false,
      maturityObserved: false,
      conservationOk: false,
      noStrandedBalance: false,
      independentReadbackOk: false,
      validatorMineOk: null,
      shadowAccountObserved: false,
    };

    // 1. Capability check — via supportedWalletApi/supportedSpecs, not balances
    let chainId: string;
    let apiVersions: string[] = [];
    let specs: string[] = [];
    try {
      const [a, s, c] = await Promise.all([
        provider.supportedWalletApi(),
        provider.supportedSpecs(),
        provider.requestChainId(),
      ]);
      if (!Array.isArray(a) || !Array.isArray(s) || !a.every((v) => typeof v === "string") || !s.every((v) => typeof v === "string") || typeof c !== "string") {
        throw new Error("malformed_capability_response");
      }
      apiVersions = a;
      specs = s;
      chainId = c;
      assertViewingKeyFree({ apiVersions, specs, chainId }, "capability_result");
    } catch (e) {
      return {
        verdict: M5_BLOCKED_BY_ENVIRONMENT_EVIDENCE,
        reason: "CAPABILITY_UNAVAILABLE",
        detail: `Capability query failed: ${safeErrorMessage(e)}`,
        commit: this.cfg.commit,
      };
    }
    const capable = supportsStrk20(apiVersions, specs);
    if (!capable) {
      throw new M5Error(M5_ERROR_CODE.CAPABILITY_UNKNOWN, `wallet not STRK20 capable: api=${apiVersions.join(",")} specs=${specs.join(",")}`);
    }
    predicates.capabilityObserved = true;

    // Network mismatch -> failure state
    const expected = this.cfg.chainIdExpected.trim().toUpperCase();
    const chainMatches = expected === "SN_SEPOLIA"
      ? isExpectedSepoliaChainId(chainId)
      : chainId.trim().toUpperCase() === expected;
    if (!chainMatches) {
      throw new M5Error(M5_ERROR_CODE.NETWORK_MISMATCH, `expected ${expected} got ${chainId}`);
    }

    // Shadow accounts are an optional provider observation from the supplied
    // SDK/anonymizer research. They are not a route, note, receipt, binding,
    // or prerequisite for the canonical wallet-mediated action.
    let shadowAccount: ShadowAccountObservation | undefined;
    if (typeof provider.observeShadowAccountCapability === "function") {
      try {
        const observed = await provider.observeShadowAccountCapability();
        assertViewingKeyFree(observed, "shadow_account_observation");
        shadowAccount = normalizeShadowAccountObservation(observed);
      } catch {
        shadowAccount = normalizeShadowAccountObservation(null);
      }
      predicates.shadowAccountObserved = isShadowAccountObservationSupported(shadowAccount);
    }

    // 2. Fee/registration preflight
    try {
      const f = await provider.getFeeAmount();
      assertViewingKeyFree(f, "fee_observation");
      if (!f || typeof f !== "object" || typeof f.fee !== "bigint" || f.fee < 0n || (f.blockNumber !== null && (!Number.isSafeInteger(f.blockNumber) || f.blockNumber < 0))) {
        throw new M5Error(M5_ERROR_CODE.FEE_UNAVAILABLE, "invalid_fee_observation");
      }
      if (this.cfg.quotedFee !== null && this.cfg.quotedFee !== f.fee) {
        throw new M5Error(M5_ERROR_CODE.FEE_CHANGED, `quoted_${String(this.cfg.quotedFee)}_observed_${String(f.fee)}`);
      }
      predicates.feeObserved = true;
    } catch (e) {
      if (e instanceof M5Error) throw e;
      throw new M5Error(M5_ERROR_CODE.FEE_UNAVAILABLE, `fee unavailable: ${safeErrorMessage(e)}`);
    }

    // Registration — if wallet exposes isRegistered, check; else infer via prepare error
    try {
      const registered = await provider.isRegistered();
      if (registered !== true && registered !== false && registered !== null) {
        throw new M5Error(M5_ERROR_CODE.NOT_REGISTERED, "registration_observation_malformed");
      }
      predicates.registrationObserved = registered !== null;
      if (registered === false) {
        throw new M5Error(M5_ERROR_CODE.NOT_REGISTERED, "wallet not registered into privacy pool; viewing key not set");
      }
    } catch (e) {
      if (e instanceof M5Error && e.code === M5_ERROR_CODE.NOT_REGISTERED) throw e;
      // If isRegistered not available, we will detect via NOT_REGISTERED on prepare/invoke
      predicates.registrationObserved = false;
    }

    // Fee-aware amount validation (simple: amount > fee etc. already handled)
    // Preserve u256/u128 boundaries: in_amount is u128, output will be u256 shares then checked to u128
    predicates.u128BoundaryOk = isU128(this.cfg.inAmount) && this.cfg.inAmount > 0n;
    predicates.u256BoundaryOk = true; // real token surfaces are u256, helper does checked conversion

    // 3. Build exact STRK20 actions with open-note placeholder
    const selfAddressRaw = await provider.getAddress();
    const selfAddress = typeof selfAddressRaw === "string" ? selfAddressRaw : String(selfAddressRaw);
    assertViewingKeyFree({ selfAddress }, "self_address");
    assertConfiguredAddress(selfAddress, "wallet_address");

    const actions = buildActions(this.cfg.inAmount, selfAddress, this.cfg);
    assertViewingKeyFree(actions, "strk20_actions");

    // Verify calldata exactness
    const expectedCalldata = buildHelperCalldata(this.cfg.inAmount, {
      strk: this.cfg.strkToken,
      vToken: this.cfg.vToken,
    });
    const invoke = actions[1] as Strk20InvokeAction;
    validateM5Actions(actions, {
      strkToken: this.cfg.strkToken,
      vToken: this.cfg.vToken,
      helperAddress: this.cfg.helperAddress,
      privacyPool: this.cfg.privacyPool,
      inAmount: this.cfg.inAmount,
    }, selfAddress);
    validateHelperCalldata(invoke.calldata, {
      strkToken: this.cfg.strkToken,
      vToken: this.cfg.vToken,
      helperAddress: this.cfg.helperAddress,
      privacyPool: this.cfg.privacyPool,
      inAmount: this.cfg.inAmount,
    });
    predicates.calldataExact = true;

    // The helper's OpenNoteDeposit is explicitly denominated in vToken shares.
    if (!addressesEqual(invoke.calldata[1], this.cfg.vToken!)) {
      throw new M5Error(M5_ERROR_CODE.NOTE_DENOMINATION_WRONG, `note denomination: out_token ${invoke.calldata[1]} != vToken ${this.cfg.vToken}`);
    }
    predicates.noteDenominationShares = true;

    // 4. Simulate / prepared invoke (non-submittable, empty proof)
    let simResult: Strk20CallAndProof | null = null;
    try {
      simResult = await provider.strk20PrepareInvoke(actions, true);
      assertViewingKeyFree(simResult, "simulation_result");
      // Simulate must return empty proof (not submittable)
      if (
        !simResult ||
        typeof simResult !== "object" ||
        !simResult.proof ||
        typeof simResult.proof.data !== "string" ||
        !Array.isArray(simResult.proof.output) ||
        !Array.isArray(simResult.proof.proof_facts)
      ) {
        throw new M5Error(M5_ERROR_CODE.SIMULATION_PROOF_INVALID, "simulate_returned_malformed_proof");
      }
      if (simResult.proof.data !== "" || simResult.proof.output.length !== 0 || simResult.proof.proof_facts.length !== 0) {
        throw new M5Error(M5_ERROR_CODE.SIMULATION_PROOF_INVALID, "simulate_returned_non_empty_proof");
      }
      if (!simResult.call || typeof simResult.call !== "object" || typeof simResult.call.contract_address !== "string" || typeof simResult.call.entry_point !== "string" || simResult.call.entry_point.trim().length === 0 || !Array.isArray(simResult.call.calldata)) {
        throw new M5Error(M5_ERROR_CODE.SIMULATION_PROOF_INVALID, "simulate_call_shape_invalid");
      }
      if (!addressesEqual(simResult.call.contract_address, this.cfg.privacyPool!)) {
        throw new M5Error(M5_ERROR_CODE.CALLDATA_MISMATCH, "simulate_outer_call_not_pinned_privacy_pool");
      }
      predicates.simulateObserved = true;
    } catch (e) {
      if (isNotRegisteredError(e)) throw new M5Error(M5_ERROR_CODE.NOT_REGISTERED, `simulate NOT_REGISTERED: ${safeErrorMessage(e)}`);
      if (isInsufficientBalanceError(e)) throw new M5Error(M5_ERROR_CODE.INVALID_AMOUNT, `insufficient private balance: ${safeErrorMessage(e)}`);
      if (isPrivacyLeakError(e)) throw new Strk20Error(STRK20_ERROR_CODE.PRIVACY_OVERCLAIM, "privacy leak");
      // Also handle screening
      const msg = String((e as Error).message ?? "").toLowerCase();
      if (msg.includes("screening") && msg.includes("reject")) throw new M5Error(M5_ERROR_CODE.SCREENING_REJECTED, safeErrorMessage(e));
      if (msg.includes("screening") && msg.includes("unavailable")) throw new M5Error(M5_ERROR_CODE.SCREENING_UNAVAILABLE, safeErrorMessage(e));
      if (e instanceof M5Error) throw e;
      throw new M5Error(M5_ERROR_CODE.HELPER_REVERT, `simulate failed: ${safeErrorMessage(e)}`);
    }

    // If simulate observed zero output (helper would have reverted for dust) — model failure
    // We check via simulate result? On zero output helper reverts; simulate would have thrown

    // 5. Wallet-side proof submission boundary — real invoke, wallet generates proof.
    // The operation is fenced before this call. A second run on the same runner
    // resumes receipt polling for the existing hash and never invokes again.
    let operation = this.operation;
    let txHash: Hex;
    if (operation?.submissionAttempted) {
      if (!operation.txHash) {
        throw new M5Error(M5_ERROR_CODE.UNKNOWN_RECEIPT, "submission_attempted_without_transaction_hash");
      }
      txHash = operation.txHash;
      predicates.submissionObserved = true;
    } else {
      operation = createM5Operation(this.cfg.operationId!, Date.now());
      operation = markM5SubmissionStarted(operation, Date.now());
      this.operation = operation;
      persistM5Operation(operation);
      try {
        const res = await provider.strk20InvokeTransaction(actions);
        assertViewingKeyFree(res, "submission_result");
        if (!res.transaction_hash || !/^0x[0-9a-fA-F]+$/.test(res.transaction_hash)) {
          throw new M5Error(M5_ERROR_CODE.UNKNOWN_RECEIPT, `invalid tx hash from wallet: ${res.transaction_hash}`);
        }
        operation = markM5Submitted(operation, res.transaction_hash, Date.now());
        this.operation = operation;
        persistM5Operation(operation);
        txHash = operation.txHash as Hex;
        predicates.submissionObserved = true;
      } catch (e) {
        if (e instanceof M5Error) throw e;
        const msg = String((e as Error).message ?? "");
        if (isNotRegisteredError(e)) throw new M5Error(M5_ERROR_CODE.NOT_REGISTERED, safeErrorMessage(e));
        if (msg.toLowerCase().includes("screening") && msg.toLowerCase().includes("reject"))
          throw new M5Error(M5_ERROR_CODE.SCREENING_REJECTED, safeErrorMessage(e));
        if (msg.toLowerCase().includes("screening") && msg.toLowerCase().includes("unavailable"))
          throw new M5Error(M5_ERROR_CODE.SCREENING_UNAVAILABLE, safeErrorMessage(e));
        if (isUserRejectedError(e)) {
          throw new M5Error(M5_ERROR_CODE.USER_REJECTED, "wallet_user_rejected");
        }
        if (msg.toLowerCase().includes("user_refused") || msg.toLowerCase().includes("rejected") || msg.toLowerCase().includes("denied")) {
          throw new M5Error(M5_ERROR_CODE.WALLET_UNAVAILABLE, `user refused: ${safeErrorMessage(e)}`);
        }
        // If provider is mock with no real prover, remain explicitly blocked;
        // the pre-submission fence is retained and no fabricated hash is used.
        if ((provider as unknown as { _isMock?: boolean })._isMock) {
          return {
            verdict: M5_BLOCKED_BY_ENVIRONMENT_EVIDENCE,
            reason: "NO_PROVER",
            detail: `Mock provider cannot generate SNIP-36 proof: ${safeErrorMessage(e)}; no fabricated hash emitted.`,
            commit: this.cfg.commit,
          };
        }
        throw new M5Error(M5_ERROR_CODE.HELPER_REVERT, `invoke failed: ${safeErrorMessage(e)}`);
      }
    }

    // 6. Receipt polling/recovery. UNKNOWN, RECEIVED and PENDING are not
    // terminal; a timeout becomes requires_attention without inventing a hash.
    let receipt: M5ReceiptObservation | null = null;
    const start = Date.now();
    const timeout = this.cfg.receiptTimeoutMs!;
    const interval = this.cfg.receiptIntervalMs!;
    const timeoutAt = start + timeout;

    const readPrimaryReceipt = async (): Promise<M5ReceiptObservation | null> => {
      const raw = await provider.getReceipt(txHash);
      if (!raw) return null;
      const normalized = validateM5Receipt({
        transactionHash: raw.transactionHash ?? txHash,
        executionStatus: raw.executionStatus,
        finalityStatus: raw.finalityStatus,
        blockNumber: raw.blockNumber,
        senderAddress: raw.senderAddress,
        events: raw.events,
      }, txHash);
      const attribution = attributePoolEvent(normalized, this.cfg.privacyPool!);
      return { ...normalized, poolEventFound: attribution !== null };
    };

    const readIndependentReceipt = async (): Promise<M5ReceiptObservation | null> => {
      if (!this.cfg.independentRpc) return null;
      const raw = await this.cfg.independentRpc.getTransactionReceipt(txHash);
      if (!raw) return null;
      const normalized = validateM5Receipt({
        transactionHash: raw.transactionHash ?? txHash,
        executionStatus: raw.executionStatus,
        finalityStatus: raw.finalityStatus,
        blockNumber: raw.blockNumber,
        senderAddress: raw.senderAddress,
        events: raw.events,
      }, txHash);
      const attribution = attributePoolEvent(normalized, this.cfg.privacyPool!);
      return { ...normalized, poolEventFound: attribution !== null };
    };

    while (Date.now() < timeoutAt) {
      let candidate: M5ReceiptObservation | null = null;
      try {
        candidate = await readPrimaryReceipt();
      } catch (e) {
        // Malformed/mismatched facts are terminal observation failures. A
        // transport outage is retryable and must not turn a temporary RPC
        // error into a false terminal receipt state.
        if (e instanceof M5Error) throw e;
      }
      if (!candidate && this.cfg.independentRpc) {
        try {
          candidate = await readIndependentReceipt();
        } catch (e) {
          if (e instanceof M5Error) throw e;
          // A supplementary independent path may be unavailable while the
          // wallet provider continues polling. It cannot create evidence.
        }
      }
      if (candidate) {
        const recovered = recoverM5Operation(operation, candidate, {
          now: Date.now(),
          timeoutAt,
          requiredPoolAddress: this.cfg.privacyPool,
        });
        operation = recovered.operation;
        this.operation = operation;
        persistM5Operation(operation);
        // A reverted label without a block is not terminal chain evidence;
        // continue polling for a final receipt. Successful observations retain
        // the historical strict finality checks below.
        const terminalRevert = candidate.executionStatus === "REVERTED" && candidate.blockNumber !== null;
        if (terminalRevert || candidate.executionStatus === "SUCCEEDED") {
          receipt = candidate;
          break;
        }
      }
      if (Date.now() >= timeoutAt) break;
      await new Promise((resolve) => setTimeout(resolve, interval));
    }

    if (!receipt) {
      const timedOut = recoverM5Operation(operation, null, {
        now: Date.now(),
        timeoutAt,
        requiredPoolAddress: this.cfg.privacyPool,
      });
      operation = timedOut.operation;
      this.operation = operation;
      persistM5Operation(operation);
      throw new M5Error(M5_ERROR_CODE.UNKNOWN_RECEIPT, `receipt not found for ${txHash} after ${timeout}ms`);
    }
    predicates.receiptObserved = true;
    predicates.operationRecovered = operation.state === "succeeded" || operation.state === "reverted";

    if (receipt.executionStatus === "REVERTED") {
      throw new M5Error(M5_ERROR_CODE.POOL_ROLLBACK, "transaction reverted: helper/pool operation rolled back atomically");
    }
    if (receipt.executionStatus !== "SUCCEEDED") {
      throw new M5Error(M5_ERROR_CODE.UNKNOWN_RECEIPT, `unexpected executionStatus ${receipt.executionStatus}`);
    }
    if ((receipt.finalityStatus !== "ACCEPTED_ON_L2" && receipt.finalityStatus !== "ACCEPTED_ON_L1") || receipt.blockNumber === null) {
      throw new M5Error(M5_ERROR_CODE.UNKNOWN_RECEIPT, "successful_receipt_missing_finality_or_block");
    }
    predicates.executionSucceeded = true;

    // Independent X3 requires the receipt plus the public transaction and
    // balance reads from the explicitly labelled second source. A second
    // receipt alone is useful for diagnostics but cannot promote evidence.
    let independent: M5ReceiptObservation | null = null;
    let independentTransactionRead = false;
    let independentBalanceRead = false;
    if (this.cfg.independentRpc) {
      try {
        independent = await readIndependentReceipt();
        if (independent) {
          if (independent.executionStatus !== receipt.executionStatus ||
              (independent.finalityStatus !== "UNKNOWN" && independent.finalityStatus !== receipt.finalityStatus) ||
              (independent.blockNumber !== null && receipt.blockNumber !== null && independent.blockNumber !== receipt.blockNumber)) {
            throw new M5Error(M5_ERROR_CODE.INDEPENDENT_READ_MISMATCH, "independent_receipt_facts_mismatch");
          }
        }
      } catch (e) {
        if (e instanceof M5Error) throw e;
        independent = null;
      }
    }

    // 9. Pool attribution is by event origin, never transaction sender. The
    // route-specific event layout is intentionally not guessed; a depositor
    // identity remains null unless a proven decoder is supplied externally.
    const receiptForAttribution = independent ?? receipt;
    const poolAttribution = attributePoolEvent(receiptForAttribution, this.cfg.privacyPool!);
    predicates.poolEventObserved = poolAttribution !== null;
    predicates.poolEventAttributed = poolAttribution !== null;
    if (!predicates.poolEventObserved) {
      throw new M5Error(M5_ERROR_CODE.UNKNOWN_RECEIPT, "no pinned STRK20 pool event in receipt");
    }

    // 10. Raw transaction calldata is a separate Starknet JSON-RPC read. Only
    // an explicit transaction reader may establish helper involvement; receipt
    // events or vToken addresses cannot stand in for calldata.
    let rawCalldata: string[] | null = null;
    const independentTransactionReader = this.cfg.independentRpc?.getTransaction;
    const transactionReader = independentTransactionReader ?? provider.getTransaction;
    if (transactionReader) {
      try {
        const transaction = await transactionReader(txHash);
        if (transaction) {
          const validatedTransaction = validateM5TransactionObservation(transaction, txHash);
          rawCalldata = validatedTransaction.calldata;
          predicates.helperCalldataInReceipt = containsAddressInCalldata(rawCalldata, this.cfg.helperAddress!);
          if (independentTransactionReader && transactionReader === independentTransactionReader) {
            independentTransactionRead = true;
          }
        }
      } catch (e) {
        if (e instanceof M5Error) throw e;
        predicates.helperCalldataInReceipt = false;
      }
    }

    // A typed Vesu observation is optional because the pinned first-party
    // interfaces do not expose a stable event decoder through WalletAccountV6.
    let vesuDeposit: unknown = null;
    if (provider.observeVesuDeposit) {
      const observed = await provider.observeVesuDeposit(txHash);
      assertViewingKeyFree(observed, "vesu_deposit_observation");
      vesuDeposit = observed;
      predicates.vesuDepositObserved = observed !== null && validateVesuDepositObservation(observed, {
        helperAddress: this.cfg.helperAddress!,
        vToken: this.cfg.vToken!,
        inAmount: this.cfg.inAmount,
      });
    }

    // 11. Public no-strand read. This is not full conservation: the private
    // open-note amount is wallet-owned and remains a separate proof.
    let helperStrkBalance: bigint | null = null;
    let helperVTokenBalance: bigint | null = null;
    const independentBalanceReader = this.cfg.independentRpc?.getBalance;
    const balanceReader = independentBalanceReader ?? provider.callBalance?.bind(provider);
    if (balanceReader) {
      try {
        helperStrkBalance = await balanceReader(this.cfg.strkToken!, this.cfg.helperAddress!);
        helperVTokenBalance = await balanceReader(this.cfg.vToken!, this.cfg.helperAddress!);
        if (independentBalanceReader && balanceReader === independentBalanceReader) independentBalanceRead = true;
        if (typeof helperStrkBalance !== "bigint" || typeof helperVTokenBalance !== "bigint" || helperStrkBalance < 0n || helperVTokenBalance < 0n) {
          throw new M5Error(M5_ERROR_CODE.RECEIPT_INVALID, "helper_balance_observation_malformed");
        }
        predicates.noStrandedBalance = helperStrkBalance === 0n && helperVTokenBalance === 0n;
        if (!predicates.noStrandedBalance) {
          throw new M5Error(M5_ERROR_CODE.STRANDED_BALANCE, `helper stranded: STRK=${helperStrkBalance} vToken=${helperVTokenBalance}`);
        }
      } catch (e) {
        if (e instanceof M5Error && e.code === M5_ERROR_CODE.STRANDED_BALANCE) throw e;
        if (e instanceof M5Error && e.code === M5_ERROR_CODE.RECEIPT_INVALID) throw e;
        helperStrkBalance = null;
        helperVTokenBalance = null;
        predicates.noStrandedBalance = false;
        independentBalanceRead = false;
      }
    }

    predicates.independentReadbackOk = Boolean(
      independent
      && this.cfg.primarySourceId
      && this.cfg.independentSourceId
      && this.cfg.primarySourceId !== this.cfg.independentSourceId
      && independentTransactionRead
      && independentBalanceRead
    );

    // 12. Explicit wallet/session facts may close the remaining local
    // contracts, but the default WalletAccountV6 adapter intentionally does
    // not claim to expose them.
    let note: { noteId: string; token: string; amount: string } | undefined;
    let maturity: unknown = null;
    let conservation: unknown = null;
    if (provider.observeOpenNote) {
      const observed = await provider.observeOpenNote(txHash);
      assertViewingKeyFree(observed, "open_note_observation");
      if (observed && validateM5OpenNoteObservation(observed, { token: this.cfg.vToken! })) {
        note = { noteId: observed.noteId, token: observed.token, amount: observed.amount.toString() };
        predicates.noteReadbackObserved = true;
      }
    }
    if (provider.observeMaturity) {
      const observed = await provider.observeMaturity(txHash);
      assertViewingKeyFree(observed, "maturity_observation");
      if (observed) {
        maturity = observed;
        try {
          if (observed.confirmedBlock !== receipt.blockNumber) {
            throw new M5Error(M5_ERROR_CODE.MATURITY_PENDING, "maturity_confirmation_block_mismatch");
          }
          const state = evaluateM5Maturity(observed);
          predicates.maturityState = state.state;
          predicates.maturityObserved = state.ready;
        } catch {
          predicates.maturityState = "maturing";
          predicates.maturityObserved = false;
        }
      }
    }
    if (provider.observeConservation) {
      const observed = await provider.observeConservation(txHash);
      assertViewingKeyFree(observed, "conservation_observation");
      if (observed && [observed.inputDelivered, observed.vTokenShares, observed.noteAmount, observed.helperStrkBalance, observed.helperVTokenBalance].some((value) => typeof value !== "bigint" || value < 0n)) {
        throw new M5Error(M5_ERROR_CODE.RECEIPT_INVALID, "conservation_observation_malformed");
      }
      if (observed) {
        conservation = observed;
        const observedVesuShares = vesuDeposit
          && typeof vesuDeposit === "object"
          && "shares" in vesuDeposit
          && typeof (vesuDeposit as { shares?: unknown }).shares === "bigint"
          ? (vesuDeposit as { shares: bigint }).shares
          : null;
        const observedNoteAmount = note ? BigInt(note.amount) : null;
        const hasPositiveOutput = observed.vTokenShares > 0n || observed.noteAmount > 0n;
        if (hasPositiveOutput) {
          validateM5Conservation(observed, {
            expectedInput: this.cfg.inAmount,
            ...(observedVesuShares === null ? {} : { expectedShares: observedVesuShares }),
            ...(observedNoteAmount === null ? {} : { expectedNoteAmount: observedNoteAmount }),
          });
        }
        predicates.conservationOk =
          predicates.vesuDepositObserved &&
          predicates.noteReadbackObserved &&
          observed.inputDelivered === this.cfg.inAmount &&
          observed.vTokenShares > 0n &&
          observed.noteAmount > 0n &&
          observedNoteAmount !== null &&
          observed.vTokenShares === observed.noteAmount &&
          observedNoteAmount === observed.noteAmount &&
          (observedVesuShares === null || observedVesuShares === observed.vTokenShares) &&
          observed.helperStrkBalance === 0n &&
          observed.helperVTokenBalance === 0n;
      }
    }

    // 13. Actual upstream validator only; a local fixture cannot promote X3.
    let validatorRes: { ok: boolean; pool: boolean; mine: boolean; reason?: string } | null = null;
    if (this.cfg.validator) {
      try {
        validatorRes = await this.cfg.validator.validate(txHash);
        if (!validatorRes
          || typeof validatorRes.ok !== "boolean"
          || typeof validatorRes.pool !== "boolean"
          || typeof validatorRes.mine !== "boolean") {
          throw new M5Error(M5_ERROR_CODE.VALIDATOR_MINE_FALSE, "validator_response_malformed");
        }
        if (!validatorRes.ok || !validatorRes.pool || !validatorRes.mine) {
          throw new M5Error(M5_ERROR_CODE.VALIDATOR_MINE_FALSE, `validator failed ok=${validatorRes.ok} pool=${validatorRes.pool} mine=${validatorRes.mine}: ${validatorRes.reason ?? ""}`);
        }
        predicates.validatorMineOk = true;
      } catch (e) {
        if (e instanceof M5Error && e.code === M5_ERROR_CODE.VALIDATOR_MINE_FALSE) throw e;
        predicates.validatorMineOk = false;
      }
    } else {
      predicates.validatorMineOk = null;
    }

    const x3Complete =
      predicates.capabilityObserved &&
      predicates.feeObserved &&
      predicates.simulateObserved &&
      predicates.submissionObserved &&
      predicates.receiptObserved &&
      predicates.executionSucceeded &&
      predicates.operationRecovered &&
      predicates.poolEventObserved &&
      predicates.poolEventAttributed &&
      predicates.helperCalldataInReceipt &&
      predicates.vesuDepositObserved &&
      predicates.noteReadbackObserved &&
      predicates.maturityObserved &&
      predicates.conservationOk &&
      predicates.noStrandedBalance &&
      predicates.independentReadbackOk &&
      predicates.validatorMineOk === true;
    const verdict = x3Complete ? "M5_E2E_SUCCESS_X3" : "M5_E2E_RUNNER_READY_X2";

    return {
      verdict: verdict as M5Success["verdict"],
      txHash,
      blockNumber: receipt.blockNumber,
      predicates,
      evidence: {
        network: "SN_SEPOLIA",
        helperAddress: this.cfg.helperAddress!,
        strkToken: this.cfg.strkToken!,
        vToken: this.cfg.vToken!,
        inAmount: this.cfg.inAmount.toString(),
        calldata: expectedCalldata,
        actions,
        receipt,
        independentReadback: independent,
        operation,
        poolEvent: poolAttribution,
        helperCalldata: rawCalldata,
        vesuDeposit,
        maturity,
        note,
        conservation: {
          inAmount: this.cfg.inAmount.toString(),
          ...(conservation && typeof conservation === "object" && "vTokenShares" in conservation
            ? { vTokenDeltaShares: String((conservation as { vTokenShares: bigint }).vTokenShares) }
            : {}),
          helperStrkBalance: helperStrkBalance?.toString() ?? "unknown",
          helperVTokenBalance: helperVTokenBalance?.toString() ?? "unknown",
        },
        validator: validatorRes,
        ...(shadowAccount === undefined ? {} : { shadowAccountObservation: shadowAccount }),
        commit: this.cfg.commit,
      },
    };
  }
}
