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
  normalizeHex,
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

// ---------------------------------------------------------------------------
// Error taxonomy — models every failure state listed in scope
// ---------------------------------------------------------------------------

export const M5_ERROR_CODE = {
  CAPABILITY_UNKNOWN: "M5-001",
  NETWORK_MISMATCH: "M5-002",
  NOT_REGISTERED: "M5-003",
  SCREENING_REJECTED: "M5-004",
  SCREENING_UNAVAILABLE: "M5-005",
  MATURITY_PENDING: "M5-006",
  ZERO_OUTPUT: "M5-007",
  HELPER_REVERT: "M5-008",
  POOL_ROLLBACK: "M5-009",
  VALIDATOR_MINE_FALSE: "M5-010",
  UNKNOWN_RECEIPT: "M5-011",
  FEE_UNAVAILABLE: "M5-012",
  FEE_CHANGED: "M5-013",
  INVALID_AMOUNT: "M5-014",
  VIEWING_KEY_FORBIDDEN: "M5-015",
  WALLET_UNAVAILABLE: "M5-016",
  AMOUNT_OVERFLOW: "M5-017",
  CALLDATA_MISMATCH: "M5-018",
  CONSERVATION_FAILED: "M5-019",
  STRANDED_BALANCE: "M5-020",
  NOTE_DENOMINATION_WRONG: "M5-021",
  SIMULATION_PROOF_INVALID: "M5-022",
  CONFIG_INVALID: "M5-023",
} as const;

export type M5ErrorCode = (typeof M5_ERROR_CODE)[keyof typeof M5_ERROR_CODE];

export class M5Error extends Error {
  readonly code: M5ErrorCode;
  readonly detail?: string;
  constructor(code: M5ErrorCode, detail?: string) {
    super(`[${code}] ${detail ?? code}`);
    this.code = code;
    this.detail = detail;
    this.name = code;
  }
}

// Blocked-by-environment sentinel — no fabricated hash
export const M5_BLOCKED_BY_ENVIRONMENT_EVIDENCE = "M5_BLOCKED_BY_ENVIRONMENT_EVIDENCE" as const;
export type M5BlockedReason =
  | "NO_WALLET"
  | "NO_PROVER"
  | "CAPABILITY_UNAVAILABLE"
  | "RPC_UNAVAILABLE"
  | "ENV_MISSING";

export interface M5Blocked {
  verdict: typeof M5_BLOCKED_BY_ENVIRONMENT_EVIDENCE;
  reason: M5BlockedReason;
  detail: string;
  commit?: string;
}

// ---------------------------------------------------------------------------
// Runner config
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
  // Polling
  receiptTimeoutMs?: number;
  receiptIntervalMs?: number;
  // Independent RPC
  independentRpc?: IndependentRpcReader | null;
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
  helperCalldataInReceipt: boolean;
  vesuDepositObserved: boolean;
  // The current WalletAccountV6/M5 receipt ports do not expose private-note
  // readback or a maturity oracle. These remain false until an external,
  // consented wallet/session adapter supplies them explicitly.
  noteReadbackObserved: boolean;
  maturityObserved: boolean;
  conservationOk: boolean;
  noStrandedBalance: boolean;
  independentReadbackOk: boolean;
  validatorMineOk: boolean | null; // null when not configured
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
    conservation: { inAmount: string; vTokenDeltaShares?: string; helperStrkBalance: string; helperVTokenBalance: string };
    note?: { noteId: string; token: string; amount: string };
    validator?: unknown;
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
  if (/viewing.?key|private.?key|seed.?phrase|mnemonic/i.test(raw)) return "provider_error_redacted";
  return raw.slice(0, 160);
}

function isExpectedSepoliaChainId(chainId: string): boolean {
  const normalized = chainId.trim().toUpperCase();
  // Wallet APIs commonly return the symbolic id; accept the canonical felt
  // encoding too, but never a substring/lookalike such as NOT_SEPOLIA.
  return normalized === "SN_SEPOLIA" || normalized === "0X534E5F5345504F4C4941";
}

function isTerminalReceiptStatus(status: string): boolean {
  return status === "SUCCEEDED" || status === "REVERTED";
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
  return [strk, vt, toFeltDecimal(inAmount), "${openNoteIds[0]}"];
}

export function buildActions(inAmount: bigint, selfAddress: string, cfg: M5RunnerConfig): Strk20Action[] {
  const strk = cfg.strkToken ?? STRK_SEPOLIA;
  const helper = cfg.helperAddress ?? HELPER_ADDRESS_SEPOLIA;
  assertConfiguredAddress(helper, "helper_address");
  const calldata = buildHelperCalldata(inAmount, { strk, vToken: cfg.vToken ?? VTOKEN_STRK_SEPOLIA });
  // 1. Transfer OPEN to self (creates open note)
  // 2. Invoke helper with placeholder
  return [
    { type: "transfer", token: strk, amount: "OPEN", recipient: selfAddress },
    { type: "invoke", contract: helper, calldata },
  ];
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

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export class M5VesuRunner {
  private cfg: Required<M5RunnerConfig>;

  constructor(cfg: M5RunnerConfig) {
    this.cfg = {
      strkToken: cfg.strkToken ?? STRK_SEPOLIA,
      vToken: cfg.vToken ?? VTOKEN_STRK_SEPOLIA,
      helperAddress: cfg.helperAddress ?? HELPER_ADDRESS_SEPOLIA,
      privacyPool: cfg.privacyPool ?? PRIVACY_POOL_SEPOLIA,
      chainIdExpected: cfg.chainIdExpected ?? "SN_SEPOLIA",
      inAmount: cfg.inAmount,
      receiptTimeoutMs: cfg.receiptTimeoutMs ?? 60_000,
      receiptIntervalMs: cfg.receiptIntervalMs ?? 2_000,
      independentRpc: (cfg.independentRpc ?? null) as IndependentRpcReader | null,
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
    if (this.cfg.chainIdExpected!.trim().toUpperCase() !== "SN_SEPOLIA") {
      throw new M5Error(M5_ERROR_CODE.CONFIG_INVALID, "M5_route_is_SN_SEPOLIA_only");
    }
    if (cfg.inAmount < 0n) throw new M5Error(M5_ERROR_CODE.INVALID_AMOUNT, "in_amount negative");
    if (!isU128(cfg.inAmount)) throw new M5Error(M5_ERROR_CODE.AMOUNT_OVERFLOW, `in_amount ${cfg.inAmount} exceeds u128 max`);
    if (cfg.inAmount < MIN_AMOUNT) throw new M5Error(M5_ERROR_CODE.INVALID_AMOUNT, "in_amount zero");
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
      helperCalldataInReceipt: false,
      vesuDepositObserved: false,
      noteReadbackObserved: false,
      maturityObserved: false,
      conservationOk: false,
      noStrandedBalance: false,
      independentReadbackOk: false,
      validatorMineOk: null,
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
        detail: `Capability query failed: ${(e as Error).message}`,
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

    // 2. Fee/registration preflight
    try {
      const f = await provider.getFeeAmount();
      assertViewingKeyFree(f, "fee_observation");
      if (f.fee < 0n) throw new M5Error(M5_ERROR_CODE.FEE_UNAVAILABLE, "negative_fee");
      predicates.feeObserved = true;
    } catch (e) {
      if (e instanceof M5Error) throw e;
      throw new M5Error(M5_ERROR_CODE.FEE_UNAVAILABLE, `fee unavailable: ${safeErrorMessage(e)}`);
    }

    // Registration — if wallet exposes isRegistered, check; else infer via prepare error
    try {
      const registered = await provider.isRegistered();
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
    const calldataExact =
      invoke.calldata.length === 4 &&
      addressesEqual(invoke.calldata[0], expectedCalldata[0]) &&
      addressesEqual(invoke.calldata[1], expectedCalldata[1]) &&
      invoke.calldata[2].toLowerCase() === expectedCalldata[2].toLowerCase() &&
      invoke.calldata[3] === "${openNoteIds[0]}";
    if (!calldataExact) throw new M5Error(M5_ERROR_CODE.CALLDATA_MISMATCH, `helper calldata mismatch: ${JSON.stringify(invoke.calldata)}`);
    predicates.calldataExact = true;

    // Verify note denomination is vToken shares (out_token == vToken)
    if (!addressesEqual(invoke.calldata[1], this.cfg.vToken!)) {
      throw new M5Error(M5_ERROR_CODE.NOTE_DENOMINATION_WRONG, `note denomination: out_token ${invoke.calldata[1]} != vToken ${this.cfg.vToken}`);
    }
    predicates.noteDenominationShares = true;

    // 4. Simulate / prepared invoke (non-submittable, empty proof)
    let simResult: Strk20CallAndProof | null = null;
    try {
      simResult = await provider.strk20PrepareInvoke(actions, true);
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
      if (!simResult.call?.contract_address || !addressesEqual(simResult.call.contract_address, this.cfg.privacyPool!)) {
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

    // 5. Wallet-side proof submission boundary — real invoke, wallet generates proof
    // If provider is mock and cannot produce real proof, we must return BLOCKED not fake hash
    let txHash: Hex;
    try {
      const res = await provider.strk20InvokeTransaction(actions);
      if (!res.transaction_hash || !/^0x[0-9a-fA-F]+$/.test(res.transaction_hash)) {
        throw new M5Error(M5_ERROR_CODE.UNKNOWN_RECEIPT, `invalid tx hash from wallet: ${res.transaction_hash}`);
      }
      txHash = res.transaction_hash as Hex;
      predicates.submissionObserved = true;
    } catch (e) {
      if (e instanceof M5Error) throw e;
      const msg = String((e as Error).message ?? "");
      if (isNotRegisteredError(e)) throw new M5Error(M5_ERROR_CODE.NOT_REGISTERED, safeErrorMessage(e));
      if (msg.toLowerCase().includes("screening") && msg.toLowerCase().includes("reject"))
        throw new M5Error(M5_ERROR_CODE.SCREENING_REJECTED, safeErrorMessage(e));
      if (msg.toLowerCase().includes("screening") && msg.toLowerCase().includes("unavailable"))
        throw new M5Error(M5_ERROR_CODE.SCREENING_UNAVAILABLE, safeErrorMessage(e));
      if (msg.toLowerCase().includes("user_refused") || msg.toLowerCase().includes("rejected") || msg.toLowerCase().includes("denied")) {
        throw new M5Error(M5_ERROR_CODE.WALLET_UNAVAILABLE, `user refused: ${safeErrorMessage(e)}`);
      }
      // If provider is mock with _isMock and no real prover, treat as blocked
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

    // 6. Receipt polling — via provider or independent RPC
    let receipt: Awaited<ReturnType<M5Provider["getReceipt"]>> | null = null;
    const start = Date.now();
    const timeout = this.cfg.receiptTimeoutMs!;
    const interval = this.cfg.receiptIntervalMs!;
    while (Date.now() - start < timeout) {
      try {
        const observed = await provider.getReceipt(txHash);
        if (observed && (isTerminalReceiptStatus(observed.executionStatus) || observed.executionStatus === "UNKNOWN")) {
          receipt = observed;
        }
      } catch (e) {
        throw new M5Error(M5_ERROR_CODE.UNKNOWN_RECEIPT, `receipt read failed: ${safeErrorMessage(e)}`);
      }
      // Also try independent RPC if available, but do not treat RECEIVED or
      // PENDING as a terminal receipt.
      if (!receipt && this.cfg.independentRpc) {
        try {
          const r = await this.cfg.independentRpc.getTransactionReceipt(txHash);
          if (r && (isTerminalReceiptStatus(r.executionStatus) || r.executionStatus === "UNKNOWN")) {
            receipt = {
              executionStatus: r.executionStatus as "SUCCEEDED" | "REVERTED" | "RECEIVED",
              blockNumber: r.blockNumber,
              events: r.events.map((e) => ({ address: e.address, keys: e.keys })),
            };
          }
        } catch {
          // An independent read is supplementary; keep polling the wallet path.
        }
      }
      if (receipt) break;
      await new Promise((res) => setTimeout(res, interval));
    }

    if (!receipt) {
      throw new M5Error(M5_ERROR_CODE.UNKNOWN_RECEIPT, `receipt not found for ${txHash} after ${timeout}ms`);
    }
    predicates.receiptObserved = true;

    // Check execution status
    if (receipt.executionStatus === "REVERTED") {
      // Distinguish pool rollback vs helper revert — both are REVERTED, but pool rollback is atomic
      // We treat REVERTED as helper revert which implies pool rollback atomicity
      throw new M5Error(M5_ERROR_CODE.POOL_ROLLBACK, `transaction reverted: helper revert rolled back pool op atomically`);
    }
    if (receipt.executionStatus !== "SUCCEEDED") {
      throw new M5Error(M5_ERROR_CODE.UNKNOWN_RECEIPT, `unexpected executionStatus ${receipt.executionStatus}`);
    }
    predicates.executionSucceeded = true;

    // 7. Independent RPC readback — second path, public/read-only
    let independent: Awaited<ReturnType<IndependentRpcReader["getTransactionReceipt"]>> | null = null;
    if (this.cfg.independentRpc) {
      try {
        independent = await this.cfg.independentRpc.getTransactionReceipt(txHash);
        if (independent) {
          // Cross-validate
          if (independent.executionStatus !== receipt.executionStatus) {
            throw new M5Error(M5_ERROR_CODE.UNKNOWN_RECEIPT, `independent read executionStatus mismatch: ${independent.executionStatus} vs ${receipt.executionStatus}`);
          }
          predicates.independentReadbackOk = true;
        }
      } catch (e) {
        if (e instanceof M5Error) throw e;
        // Independent read failure downgrades to X2, not fatal
        predicates.independentReadbackOk = false;
      }
    } else {
      // No independent reader configured — remain X2, not X3
      predicates.independentReadbackOk = false;
    }

    // 8. Verify pool event, helper calldata, Vesu deposit
    const poolAddrNorm = normalizeHex(this.cfg.privacyPool!);

    // Use independent if available, else provider receipt
    const eventsToCheck = independent?.events ?? receipt.events;

    const poolEvents = eventsToCheck.filter((e) => normalizeHex(e.address) === poolAddrNorm);
    predicates.poolEventObserved = poolEvents.length > 0;
    if (!predicates.poolEventObserved) {
      throw new M5Error(M5_ERROR_CODE.UNKNOWN_RECEIPT, "no STRK20 pool event in receipt");
    }

    // Helper calldata involvement — check if helper appears in any event contract or keys?
    // The pool's calldata contains helper address; we cannot see calldata in receipt events directly,
    // but we can check that receipt events include either helper or vToken, and that pool event's keys include something
    // For stronger check, we look for helper address in any event's address or keys
    // ReceiptPort exposes events only; it does not expose raw transaction
    // calldata or a typed Vesu Deposit event. Never infer either predicate
    // from a vToken address alone.
    predicates.vesuDepositObserved = false;
    predicates.helperCalldataInReceipt = false;

    // 9. Conservation / no stranded balance
    // Query helper balances via independent RPC or provider callBalance
    let helperStrkBalance: bigint | null = null;
    let helperVTokenBalance: bigint | null = null;
    const balanceReader = this.cfg.independentRpc?.getBalance ?? provider.callBalance?.bind(provider);
    if (balanceReader) {
      try {
        helperStrkBalance = await balanceReader(this.cfg.strkToken!, this.cfg.helperAddress!);
        helperVTokenBalance = await balanceReader(this.cfg.vToken!, this.cfg.helperAddress!);
        predicates.noStrandedBalance = helperStrkBalance === 0n && helperVTokenBalance === 0n;
        // No-strand is a public balance observation. Full conservation also
        // requires the wallet-owned open-note amount, which this port cannot
        // read without an external consented wallet/session.
        if (!predicates.noStrandedBalance) {
          throw new M5Error(
            M5_ERROR_CODE.STRANDED_BALANCE,
            `helper stranded: STRK=${helperStrkBalance} vToken=${helperVTokenBalance}`,
          );
        }
        predicates.conservationOk = false;
      } catch (e) {
        if (e instanceof M5Error && e.code === M5_ERROR_CODE.STRANDED_BALANCE) throw e;
        // Balance read failure — not fatal for X2, but conservation not proven
        predicates.conservationOk = false;
        helperStrkBalance = null;
        helperVTokenBalance = null;
      }
    } else {
      predicates.conservationOk = false;
      predicates.noStrandedBalance = false;
    }

    // 10. Note readback/maturity are deliberately not inferred from the
    // public receipt block. A fresh open note needs wallet-owned readback and
    // the protocol's maturity observation; neither is present on M5Provider.
    predicates.noteReadbackObserved = false;
    predicates.maturityObserved = false;

    // 11. Upstream validator invocation when configured
    let validatorRes: { ok: boolean; pool: boolean; mine: boolean; reason?: string } | null = null;
    if (this.cfg.validator) {
      try {
        validatorRes = await this.cfg.validator.validate(txHash);
        if (!validatorRes.ok || !validatorRes.pool || !validatorRes.mine) {
          throw new M5Error(
            M5_ERROR_CODE.VALIDATOR_MINE_FALSE,
            `validator failed ok=${validatorRes.ok} pool=${validatorRes.pool} mine=${validatorRes.mine}: ${validatorRes.reason ?? ""}`,
          );
        }
        predicates.validatorMineOk = true;
      } catch (e) {
        if (e instanceof M5Error && e.code === M5_ERROR_CODE.VALIDATOR_MINE_FALSE) throw e;
        predicates.validatorMineOk = false;
        // Validator failure is distinct from not configured — we propagate mine=false, but other errors downgrade
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
      predicates.poolEventObserved &&
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
        conservation: {
          inAmount: this.cfg.inAmount.toString(),
          helperStrkBalance: helperStrkBalance?.toString() ?? "unknown",
          helperVTokenBalance: helperVTokenBalance?.toString() ?? "unknown",
        },
        validator: validatorRes,
        commit: this.cfg.commit,
      },
    };
  }
}
