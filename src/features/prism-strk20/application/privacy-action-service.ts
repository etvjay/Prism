// Application-level STRK20 privacy action orchestration.
//
// This module is deliberately transport-neutral. It composes the two existing
// Wallet API boundaries:
//   - WalletStrk20ActionAdapter for WalletAccountV6 prepare/proof/submit/receipt;
//   - InjectedWalletStrk20Adapter for capability, registration, fee, consent,
//     and the wallet-managed shield/transfer fallback.
//
// The service owns lifecycle state, but never owns viewing keys, notes, or
// proving secrets. A submitted hash is always pending until a matching,
// successful, final receipt with a canonical STRK20 pool event is observed.

import { InjectedWalletStrk20Adapter } from "../adapters/injected-wallet";
import { WalletStrk20ActionAdapter } from "../adapters/wallet-strk20-action-adapter";
import type { Strk20ActionPort } from "../adapters/wallet-strk20-action-adapter";
import { assertNoViewingKey } from "../domain/privacy-guard";
import { Strk20Error, STRK20_ERROR_CODE, type Strk20ErrorCode } from "../domain/errors";
import {
  assertCallAndProofShape,
  assertNotEmptyProofForSubmission,
  isEmptyProof,
  type Strk20Call,
  type Strk20CallAndProof,
  type Strk20Proof,
} from "../domain/strk20-proof";
import type {
  CapabilityObservation,
  DepositObservation,
  Strk20WalletPort,
  TransferObservation,
} from "../domain/ports";
import {
  classifyStrk20Capability,
  classifyWalletEnvironment,
  getExpectedWalletEnvironment,
  type ExpectedWalletEnvironment,
} from "../domain/wallet-capability";
import { normalizeShadowAccountObservation, type ShadowAccountObservation } from "../domain/shadow-account";
import {
  normalizeHex,
  STRK20_POOL_ADDRESS,
  validateActions,
  type CapabilityResult as ActionCapabilityResult,
  type Hex,
  type NormalizedReceipt,
  type ReceiptExecutionStatus,
  type ReceiptFinalityStatus,
  type Strk20Action,
} from "../domain/strk20-action-port";

/** A privacy action can use explicit prepared proof or one of two wallet-owned proving routes. */
export type PrivacyActionExecution = "prepared_proof" | "wallet_action" | "wallet_managed";
export type PrivacyActionKind = "shield" | "private_transfer" | "application";

/** Application state is intentionally more explicit than the transport port. */
export type PrivacyActionState =
  | "capability_unknown"
  | "mismatch"
  | "registration_required"
  | "fee_pending"
  | "consent_required"
  | "proving"
  | "proof_ready"
  | "shielding"
  | "transfer_pending"
  | "receipt_pending"
  | "confirmed"
  | "transfer_confirmed"
  | "rejected"
  | "dependency_failure";

export type PrivacyActionPhase =
  | "created"
  | "preflight"
  | "simulated"
  | "proof_ready"
  | "submitted"
  | "receipt_pending"
  | "confirmed"
  | "terminal"
  | "failed";

export type RegistrationStatus = "unknown" | "registered" | "required";
export type ConsentStatus = "not_requested" | "required" | "granted" | "denied";
export type ProofStatus = "not_requested" | "simulated_empty" | "ready" | "wallet_managed";

export interface PrivacyActionRequest {
  readonly id: string;
  readonly kind: PrivacyActionKind;
  /** Product correlation only; never used as execution authority. */
  readonly prismId?: string | null;
  /** Opaque wallet/session reference; keys and provider objects never enter this type. */
  readonly walletSessionRef?: string | null;
  /** Required for the WalletAccountV6 prepared-proof route. */
  readonly actions?: readonly Strk20Action[];
  readonly execution?: PrivacyActionExecution;
  readonly expectedChainId?: string | null;
  readonly quotedFee?: bigint | null;
  readonly requireConsent?: boolean;
  readonly consentTokens?: readonly Hex[];
  /** Required by the wallet-managed shield/transfer route. */
  readonly token?: Hex;
  readonly amount?: bigint;
  readonly recipient?: Hex;
  readonly spender?: Hex;
}

export interface PrivacyCapabilityObservation {
  readonly capable: boolean;
  readonly status: "supported" | "unsupported" | "unknown";
  readonly apiVersions: readonly string[];
  readonly specs: readonly string[];
  readonly chainId: string;
  readonly environment: "SN_MAIN" | "SN_SEPOLIA" | "UNKNOWN";
  readonly mismatch: boolean;
  readonly expected: ExpectedWalletEnvironment;
  /** Optional provider metadata; not an action route or receipt mechanism. */
  readonly shadowAccount?: ShadowAccountObservation;
}

export interface PrivacyFeeObservation {
  readonly fee: bigint;
  readonly blockNumber: number | null;
  readonly quotedFee: bigint;
}

export interface PrivacyReceiptObservation {
  readonly transactionHash: Hex;
  readonly executionStatus: ReceiptExecutionStatus;
  readonly finalityStatus: ReceiptFinalityStatus;
  readonly blockNumber: number | null;
  readonly poolEventFound: boolean;
}

export interface PrivacyActionView {
  readonly id: string;
  readonly kind: PrivacyActionKind;
  readonly execution: PrivacyActionExecution;
  readonly state: PrivacyActionState;
  readonly phase: PrivacyActionPhase;
  readonly version: number;
  readonly updatedAt: number;
  readonly capability: PrivacyCapabilityObservation | null;
  readonly registration: { readonly status: RegistrationStatus };
  readonly fee: PrivacyFeeObservation | null;
  readonly consent: { readonly status: ConsentStatus };
  /** Proof fields are intentionally not returned; only lifecycle status/call shape is exposed. */
  readonly proof: { readonly status: ProofStatus; readonly call: Strk20Call | null };
  /** Monotonic fence: once provider submission may have started, no retry is safe. */
  readonly submissionAttempted: boolean;
  readonly approvalTransactionHash: Hex | null;
  readonly transactionHash: Hex | null;
  readonly receipt: PrivacyReceiptObservation | null;
  readonly terminal: boolean;
  readonly errorCode: Strk20ErrorCode | null;
  readonly errorDetail: string | null;
}

export interface PrivacyActionServiceDeps {
  /** WalletAccountV6-shaped prepare/proof/submit/receipt boundary. */
  readonly actionPort?: Strk20ActionPort | null;
  /** Capability/registration/fee/consent and optional wallet-managed execution. */
  readonly walletPort?: Strk20WalletPort | null;
  readonly now?: () => number;
}

interface ActionRecord {
  readonly id: string;
  readonly request: PrivacyActionRequest;
  readonly kind: PrivacyActionKind;
  readonly execution: PrivacyActionExecution;
  state: PrivacyActionState;
  phase: PrivacyActionPhase;
  version: number;
  updatedAt: number;
  capability: PrivacyCapabilityObservation | null;
  registration: { status: RegistrationStatus };
  fee: PrivacyFeeObservation | null;
  consent: { status: ConsentStatus };
  proofStatus: ProofStatus;
  prepared: Strk20CallAndProof | null;
  submissionAttempted: boolean;
  approvalTransactionHash: Hex | null;
  transactionHash: Hex | null;
  receipt: PrivacyReceiptObservation | null;
  errorCode: Strk20ErrorCode | null;
  errorDetail: string | null;
  preflightComplete: boolean;
}

const TERMINAL_PRIVACY_STATES: ReadonlySet<PrivacyActionState> = new Set([
  "transfer_confirmed",
  "rejected",
]);

const ACCEPTED_FINALITY: ReadonlySet<ReceiptFinalityStatus> = new Set([
  "ACCEPTED_ON_L2",
  "ACCEPTED_ON_L1",
]);

function isTerminalState(state: PrivacyActionState): boolean {
  return TERMINAL_PRIVACY_STATES.has(state);
}

function isM5Error(value: unknown): value is Error & { code: string } {
  const code = (value as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^M5-\d{3}$/.test(code);
}

function isStrk20Code(value: unknown): value is Strk20ErrorCode {
  return typeof value === "string" && (Object.values(STRK20_ERROR_CODE) as string[]).includes(value);
}

function safeProviderFailure(): string {
  // Provider messages may contain sensitive wallet material. The application
  // boundary therefore uses a stable generic detail for unknown failures.
  return "provider_failure";
}

function normalizeTransactionHash(value: unknown): Hex {
  try {
    return normalizeHex(value) as Hex;
  } catch {
    throw new Strk20Error(STRK20_ERROR_CODE.DEPENDENCY_FAILURE, "malformed_transaction_hash");
  }
}

function normalizeBlockNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Strk20Error(STRK20_ERROR_CODE.DEPENDENCY_FAILURE, "malformed_receipt_block_number");
  }
  return value;
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

function isPoolEventAddress(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    return normalizeHex(value) === normalizeHex(STRK20_POOL_ADDRESS);
  } catch {
    return false;
  }
}

function tokenFromAction(action: Strk20Action): Hex | null {
  if (action.type === "invoke") return null;
  return action.token;
}

function actionTokens(actions: readonly Strk20Action[] | undefined): Hex[] {
  if (!actions) return [];
  const values = actions.map(tokenFromAction).filter((value): value is Hex => value !== null);
  return [...new Set(values.map((value) => value.toLowerCase()))] as Hex[];
}

function capabilityFromAction(
  observation: ActionCapabilityResult,
  expectedOverride?: string | null,
): PrivacyCapabilityObservation {
  assertNoViewingKey(observation, "privacy_action.action_capability");
  if (
    !observation
    || !Array.isArray(observation.apiVersions)
    || !Array.isArray(observation.specs)
    || !observation.apiVersions.every((value) => typeof value === "string")
    || !observation.specs.every((value) => typeof value === "string")
    || typeof observation.chainId !== "string"
    || observation.chainId.trim().length === 0
  ) {
    throw new Strk20Error(STRK20_ERROR_CODE.CAPABILITY_UNKNOWN, "malformed_capability_observation");
  }
  const computedStatus = classifyStrk20Capability(observation.apiVersions, observation.specs);
  const declaredStatus = observation.capabilityStatus;
  if (declaredStatus !== "supported" && declaredStatus !== "unsupported" && declaredStatus !== "unknown") {
    throw new Strk20Error(STRK20_ERROR_CODE.CAPABILITY_UNKNOWN, "malformed_capability_status");
  }
  if (declaredStatus !== computedStatus || observation.capable !== (computedStatus === "supported")) {
    throw new Strk20Error(
      computedStatus === "unsupported" ? STRK20_ERROR_CODE.UNSUPPORTED_WALLET : STRK20_ERROR_CODE.CAPABILITY_UNKNOWN,
      "capability_observation_inconsistent",
    );
  }
  const expected = getExpectedWalletEnvironment(expectedOverride ?? observation.expected);
  const shadowAccount = normalizeShadowAccountObservation(observation.shadowAccount);
  return {
    capable: observation.capable,
    status: observation.capabilityStatus,
    apiVersions: [...observation.apiVersions],
    specs: [...observation.specs],
    chainId: observation.chainId,
    environment: observation.environment,
    mismatch: observation.environment !== expected,
    expected,
    ...(shadowAccount === undefined ? {} : { shadowAccount }),
  };
}

function capabilityFromWallet(
  observation: CapabilityObservation,
  expectedOverride?: string | null,
): PrivacyCapabilityObservation {
  assertNoViewingKey(observation, "privacy_action.wallet_capability");
  if (
    !observation ||
    !Array.isArray(observation.apiVersions) ||
    !Array.isArray(observation.specs) ||
    !observation.apiVersions.every((value) => typeof value === "string") ||
    !observation.specs.every((value) => typeof value === "string") ||
    typeof observation.chainId !== "string" ||
    observation.chainId.trim().length === 0
  ) {
    throw new Strk20Error(STRK20_ERROR_CODE.CAPABILITY_UNKNOWN, "malformed_capability_observation");
  }
  const status = classifyStrk20Capability(observation.apiVersions, observation.specs);
  const expected = getExpectedWalletEnvironment(expectedOverride ?? "SN_SEPOLIA");
  const environment = classifyWalletEnvironment(observation.chainId, {
    mainnet: "SN_MAIN",
    sepolia: "SN_SEPOLIA",
  });
  const shadowAccount = normalizeShadowAccountObservation(observation.shadowAccount);
  return {
    capable: status === "supported",
    status,
    apiVersions: [...observation.apiVersions],
    specs: [...observation.specs],
    chainId: observation.chainId,
    environment,
    mismatch: environment !== expected,
    expected,
    ...(shadowAccount === undefined ? {} : { shadowAccount }),
  };
}

function normalizeWalletReceipt(
  observation: DepositObservation | TransferObservation,
  expectedHash: Hex,
): PrivacyReceiptObservation {
  assertNoViewingKey(observation, "privacy_action.wallet_receipt");
  const value = observation as unknown as Record<string, unknown>;
  const transactionHash = normalizeTransactionHash(value.txHash);
  if (transactionHash !== normalizeHex(expectedHash)) {
    throw new Strk20Error(STRK20_ERROR_CODE.DEPENDENCY_FAILURE, "receipt_transaction_hash_mismatch");
  }
  const executionStatus = normalizeExecutionStatus(value.executionStatus);
  const finalityStatus = normalizeFinalityStatus(value.finalityStatus);
  const blockNumber = normalizeBlockNumber(value.blockNumber);
  const events = value.receiptEvents;
  const poolEventFound = executionStatus === "SUCCEEDED" && Array.isArray(events)
    && events.some((event) => isPoolEventAddress((event as { address?: unknown })?.address));
  return { transactionHash, executionStatus, finalityStatus, blockNumber, poolEventFound };
}

function normalizeActionReceipt(receipt: NormalizedReceipt, expectedHash: Hex): PrivacyReceiptObservation {
  assertNoViewingKey(receipt, "privacy_action.action_receipt");
  if (normalizeHex(receipt.transactionHash) !== normalizeHex(expectedHash)) {
    throw new Strk20Error(STRK20_ERROR_CODE.DEPENDENCY_FAILURE, "receipt_transaction_hash_mismatch");
  }
  const poolEventFound = receipt.executionStatus === "SUCCEEDED"
    && Array.isArray(receipt.events)
    && receipt.events.some((event) => isPoolEventAddress(event?.address));
  return {
    transactionHash: normalizeTransactionHash(receipt.transactionHash),
    executionStatus: receipt.executionStatus,
    finalityStatus: receipt.finalityStatus,
    blockNumber: receipt.blockNumber,
    // Recompute from the concrete event list instead of trusting a detached
    // adapter boolean. Event-less/unknown receipts must remain unconfirmed.
    poolEventFound,
  };
}

export class PrivacyActionService {
  private readonly records = new Map<string, ActionRecord>();
  private readonly nowFn: () => number;

  constructor(private readonly deps: PrivacyActionServiceDeps) {
    if (!deps.actionPort && !deps.walletPort) {
      throw new Error("invariant_violation: at least one Wallet API port is required");
    }
    assertNoViewingKey(deps, "privacy_action.service_deps");
    this.nowFn = deps.now ?? (() => Date.now());
  }

  /** Creates a local action record; no provider call or transaction occurs. */
  create(request: PrivacyActionRequest): PrivacyActionView {
    assertNoViewingKey(request, "privacy_action.create_request");
    if (!request || typeof request.id !== "string" || request.id.trim().length === 0) {
      throw new Strk20Error(STRK20_ERROR_CODE.STALE_STATE, "missing_action_id");
    }
    if (this.records.has(request.id)) {
      throw new Strk20Error(STRK20_ERROR_CODE.STALE_STATE, `duplicate_action_id:${request.id}`);
    }

    const execution = request.execution ?? (this.deps.actionPort ? "prepared_proof" : "wallet_managed");
    if ((execution === "prepared_proof" || execution === "wallet_action") && !this.deps.actionPort) {
      throw new Strk20Error(STRK20_ERROR_CODE.UNSUPPORTED_WALLET_METHOD, "prepared_proof_requires_action_port");
    }
    if (execution === "wallet_managed" && request.kind === "application") {
      throw new Strk20Error(STRK20_ERROR_CODE.UNSUPPORTED_WALLET_METHOD, "application_action_requires_prepared_proof");
    }
    if (request.actions && request.actions.length > 0) {
      validateActions([...request.actions]);
    } else if (execution === "prepared_proof") {
      throw new Strk20Error(STRK20_ERROR_CODE.INVALID_AMOUNT, "actions_required_for_prepared_proof");
    }

    const now = this.now();
    const record: ActionRecord = {
      id: request.id,
      request,
      kind: request.kind,
      execution,
      state: "capability_unknown",
      phase: "created",
      version: 0,
      updatedAt: now,
      capability: null,
      registration: { status: "unknown" },
      fee: null,
      consent: { status: request.requireConsent === false || request.kind === "shield" ? "not_requested" : "required" },
      proofStatus: "not_requested",
      prepared: null,
      submissionAttempted: false,
      approvalTransactionHash: null,
      transactionHash: null,
      receipt: null,
      errorCode: null,
      errorDetail: null,
      preflightComplete: false,
    };
    this.records.set(record.id, record);
    return this.toView(record);
  }

  /** Alias used by callers that call the local record an action attempt. */
  createAction(request: PrivacyActionRequest): PrivacyActionView {
    return this.create(request);
  }

  get(id: string): PrivacyActionView | null {
    const record = this.records.get(id);
    return record ? this.toView(record) : null;
  }

  getAction(id: string): PrivacyActionView | null {
    return this.get(id);
  }

  /** Runs capability, registration, fee, consent, and real-proof preflight. */
  async prepare(idOrRequest: string | PrivacyActionRequest): Promise<PrivacyActionView> {
    const id = typeof idOrRequest === "string" ? idOrRequest : this.create(idOrRequest).id;
    const record = this.requireRecord(id);
    if (isTerminalState(record.state)) return this.toView(record);
    if (record.submissionAttempted || record.transactionHash !== null) {
      throw new Strk20Error(STRK20_ERROR_CODE.ILLEGAL_TRANSITION, "prepare_after_submission_attempt");
    }
    if (record.phase === "proof_ready") return this.toView(record);
    if (record.phase === "submitted" || record.phase === "receipt_pending") {
      throw new Strk20Error(STRK20_ERROR_CODE.ILLEGAL_TRANSITION, `prepare_after_submit:${record.state}`);
    }

    try {
      await this.preflight(record);
      if (record.execution === "wallet_managed" || record.execution === "wallet_action") {
        this.touch(record, {
          state: "proof_ready",
          phase: "proof_ready",
          proofStatus: "wallet_managed",
          errorCode: null,
          errorDetail: null,
        });
        return this.toView(record);
      }

      const actionPort = this.deps.actionPort;
      if (!actionPort || !record.request.actions) {
        throw new Strk20Error(STRK20_ERROR_CODE.UNSUPPORTED_WALLET_METHOD, "prepared_proof_port_unavailable");
      }
      this.touch(record, { state: "proving", phase: "preflight", errorCode: null, errorDetail: null });
      const prepared = await actionPort.prepare([...record.request.actions], { simulate: false });
      assertNoViewingKey(prepared, "privacy_action.prepare_result");
      assertCallAndProofShape(prepared, "privacy_action.prepare_result");
      assertNotEmptyProofForSubmission(prepared);
      this.touch(record, {
        state: "proof_ready",
        phase: "proof_ready",
        proofStatus: "ready",
        prepared,
        errorCode: null,
        errorDetail: null,
      });
      return this.toView(record);
    } catch (cause) {
      throw this.fail(record, cause);
    }
  }

  prepareAction(idOrRequest: string | PrivacyActionRequest): Promise<PrivacyActionView> {
    return this.prepare(idOrRequest);
  }

  /** Performs a simulation only. Its empty proof is never retained as submittable. */
  async simulate(idOrRequest: string | PrivacyActionRequest): Promise<PrivacyActionView> {
    const id = typeof idOrRequest === "string" ? idOrRequest : this.create(idOrRequest).id;
    const record = this.requireRecord(id);
    if (record.execution !== "prepared_proof" || !this.deps.actionPort || !record.request.actions) {
      throw new Strk20Error(STRK20_ERROR_CODE.UNSUPPORTED_WALLET_METHOD, "simulation_requires_prepared_proof_port");
    }
    if (isTerminalState(record.state) || record.submissionAttempted || record.transactionHash !== null || record.phase === "submitted" || record.phase === "receipt_pending") {
      throw new Strk20Error(STRK20_ERROR_CODE.ILLEGAL_TRANSITION, `simulate_after_submit:${record.state}`);
    }

    try {
      await this.preflight(record);
      this.touch(record, { state: "proving", phase: "preflight", errorCode: null, errorDetail: null });
      const simulated = await this.deps.actionPort.simulate([...record.request.actions]);
      assertNoViewingKey(simulated, "privacy_action.simulate_result");
      assertCallAndProofShape(simulated, "privacy_action.simulate_result");
      if (!isEmptyProof(simulated.proof)) {
        throw new Strk20Error(STRK20_ERROR_CODE.DEPENDENCY_FAILURE, "simulate_expected_empty_proof");
      }
      this.touch(record, {
        state: "proving",
        phase: "simulated",
        proofStatus: "simulated_empty",
        prepared: null,
        errorCode: null,
        errorDetail: null,
      });
      return this.toView(record);
    } catch (cause) {
      throw this.fail(record, cause);
    }
  }

  simulateAction(idOrRequest: string | PrivacyActionRequest): Promise<PrivacyActionView> {
    return this.simulate(idOrRequest);
  }

  /** Submits only a real prepared proof or an explicit wallet-managed action. */
  async submit(id: string): Promise<PrivacyActionView> {
    const record = this.requireRecord(id);
    if (isTerminalState(record.state)) {
      throw new Strk20Error(STRK20_ERROR_CODE.ILLEGAL_TRANSITION, `submit_terminal_action:${record.state}`);
    }
    // Replaying the same submit request is safe once a hash is recorded: the
    // M5 submission fence makes this a read of the existing attempt, never a
    // second Wallet API/prover call.
    if (record.submissionAttempted && record.transactionHash !== null) {
      return this.toView(record);
    }
    if (record.phase !== "proof_ready") {
      throw new Strk20Error(
        record.proofStatus === "simulated_empty" ? STRK20_ERROR_CODE.PROOF_REQUIRED : STRK20_ERROR_CODE.ILLEGAL_TRANSITION,
        record.proofStatus === "simulated_empty" ? "simulated_proof_not_submittable" : `submit_requires_proof_ready:${record.phase}`,
      );
    }
    if (record.submissionAttempted || record.transactionHash !== null) {
      throw new Strk20Error(STRK20_ERROR_CODE.ILLEGAL_TRANSITION, "submit_after_submission_attempt");
    }
    if (record.execution === "prepared_proof" && (!record.prepared || isEmptyProof(record.prepared.proof))) {
      throw new Strk20Error(STRK20_ERROR_CODE.PROOF_REQUIRED, "non_empty_proof_required_before_submit");
    }
    if (!record.preflightComplete) {
      throw new Strk20Error(STRK20_ERROR_CODE.STALE_STATE, "preflight_required_before_submit");
    }

    try {
      await this.recheckRegistrationAndFee(record);
      if (record.request.requireConsent !== false && record.kind !== "shield" && record.consent.status !== "granted") {
        throw new Strk20Error(STRK20_ERROR_CODE.CONSENT_REQUIRED, "consent_required_before_submit");
      }

      if (
        (record.execution === "prepared_proof" && (!this.deps.actionPort || !record.prepared))
        || (record.execution === "wallet_action" && (!this.deps.actionPort || !record.request.actions))
        || (record.execution === "wallet_managed" && !this.deps.walletPort)
      ) {
        throw new Strk20Error(STRK20_ERROR_CODE.UNSUPPORTED_WALLET_METHOD, "submission_port_unavailable");
      }

      // Set the monotonic fence immediately before crossing into any provider
      // submission boundary. A provider timeout may mean the chain accepted the
      // transaction even when no hash was returned, so reopening proof is not
      // safe.
      this.touch(record, { submissionAttempted: true });

      let transactionHash: Hex;
      let approvalTransactionHash: Hex | null = null;
      if (record.execution === "prepared_proof") {
        const actionPort = this.deps.actionPort;
        const prepared = record.prepared;
        if (!actionPort || !prepared) throw new Strk20Error(STRK20_ERROR_CODE.UNSUPPORTED_WALLET_METHOD, "prepared_proof_port_unavailable");
        const submitted = await actionPort.executeWithProof(prepared.call, prepared.proof);
        assertNoViewingKey(submitted, "privacy_action.submit_result");
        transactionHash = normalizeTransactionHash(submitted.transactionHash);
      } else if (record.execution === "wallet_action") {
        const actionPort = this.deps.actionPort;
        const actions = record.request.actions;
        if (!actionPort || !actions) throw new Strk20Error(STRK20_ERROR_CODE.UNSUPPORTED_WALLET_METHOD, "wallet_action_port_unavailable");
        const submitted = await actionPort.execute([...actions]);
        assertNoViewingKey(submitted, "privacy_action.wallet_action_submit_result");
        transactionHash = normalizeTransactionHash(submitted.transactionHash);
      } else {
        const walletPort = this.deps.walletPort;
        if (!walletPort) throw new Strk20Error(STRK20_ERROR_CODE.UNSUPPORTED_WALLET_METHOD, "wallet_managed_port_unavailable");
        const request = this.walletRequest(record);
        if (record.kind === "shield") {
          const approval = await walletPort.requestApproval({
            token: request.token,
            amount: request.amount,
            spender: request.spender,
          });
          approvalTransactionHash = normalizeTransactionHash(approval);
          this.touch(record, { approvalTransactionHash });
          const deposited = await walletPort.requestShield({
            token: request.token,
            amount: request.amount,
            quotedFee: record.fee!.fee,
          });
          assertNoViewingKey(deposited, "privacy_action.shield_result");
          if (deposited.screening === "rejected") {
            throw new Strk20Error(STRK20_ERROR_CODE.SCREENING_REJECTED, "deposit_screening_rejected");
          }
          if (deposited.screening === "unavailable") {
            throw new Strk20Error(STRK20_ERROR_CODE.SCREENING_UNAVAILABLE, "screening_unavailable");
          }
          transactionHash = normalizeTransactionHash(deposited.txHash);
        } else {
          const transferred = await walletPort.requestPrivateTransfer({
            token: request.token,
            amount: request.amount,
            recipient: request.recipient,
            quotedFee: record.fee!.fee,
          });
          assertNoViewingKey(transferred, "privacy_action.transfer_result");
          transactionHash = normalizeTransactionHash(transferred.txHash);
        }
      }

      this.touch(record, {
        state: record.kind === "shield" ? "shielding" : "transfer_pending",
        phase: "submitted",
        proofStatus: record.execution === "prepared_proof" ? record.proofStatus : "wallet_managed",
        approvalTransactionHash,
        transactionHash,
        receipt: null,
        errorCode: null,
        errorDetail: null,
      });
      return this.toView(record);
    } catch (cause) {
      throw this.fail(record, cause);
    }
  }

  submitAction(id: string): Promise<PrivacyActionView> {
    return this.submit(id);
  }

  /** Reads the exact submitted transaction; terminal promotion is receipt-gated. */
  async observeReceipt(id: string): Promise<PrivacyActionView> {
    const record = this.requireRecord(id);
    if (isTerminalState(record.state)) return this.toView(record);
    if (!record.transactionHash) {
      throw new Strk20Error(STRK20_ERROR_CODE.STALE_STATE, "receipt_requires_submitted_transaction");
    }
    if (record.phase !== "submitted" && record.phase !== "receipt_pending") {
      throw new Strk20Error(STRK20_ERROR_CODE.ILLEGAL_TRANSITION, `receipt_before_submit:${record.phase}`);
    }

    try {
      let receipt: PrivacyReceiptObservation | null;
      if (record.execution !== "wallet_managed") {
        if (!this.deps.actionPort) throw new Strk20Error(STRK20_ERROR_CODE.UNSUPPORTED_WALLET_METHOD, "receipt_port_unavailable");
        const observed = await this.deps.actionPort.observeReceipt(record.transactionHash);
        receipt = observed ? normalizeActionReceipt(observed, record.transactionHash) : null;
      } else {
        if (!this.deps.walletPort) throw new Strk20Error(STRK20_ERROR_CODE.UNSUPPORTED_WALLET_METHOD, "receipt_port_unavailable");
        const observed = await this.deps.walletPort.observeReceipt(record.transactionHash);
        receipt = observed ? normalizeWalletReceipt(observed, record.transactionHash) : null;
      }

      if (!receipt) {
        this.touch(record, { phase: "receipt_pending", state: record.kind === "shield" ? "shielding" : "transfer_pending" });
        return this.toView(record);
      }

      if (receipt.executionStatus === "REVERTED" && receipt.blockNumber !== null) {
        this.touch(record, {
          receipt,
          state: "rejected",
          phase: "terminal",
          errorCode: STRK20_ERROR_CODE.DEPENDENCY_FAILURE,
          errorDetail: "submitted_transaction_reverted",
        });
        return this.toView(record);
      }

      const finalSuccess = receipt.executionStatus === "SUCCEEDED"
        && ACCEPTED_FINALITY.has(receipt.finalityStatus)
        && receipt.blockNumber !== null
        && receipt.poolEventFound;
      if (!finalSuccess) {
        this.touch(record, {
          receipt,
          phase: "receipt_pending",
          state: record.kind === "shield" ? "shielding" : "transfer_pending",
          errorCode: null,
          errorDetail: null,
        });
        return this.toView(record);
      }

      this.touch(record, {
        receipt,
        state: record.kind === "shield" ? "confirmed" : "transfer_confirmed",
        phase: record.kind === "shield" ? "confirmed" : "terminal",
        errorCode: null,
        errorDetail: null,
      });
      return this.toView(record);
    } catch (cause) {
      throw this.fail(record, cause);
    }
  }

  observeActionReceipt(id: string): Promise<PrivacyActionView> {
    return this.observeReceipt(id);
  }

  isTerminal(id: string): boolean {
    return isTerminalState(this.requireRecord(id).state);
  }

  private async preflight(record: ActionRecord): Promise<void> {
    if (record.preflightComplete) return;
    this.touch(record, { phase: "preflight", state: "capability_unknown", errorCode: null, errorDetail: null });

    const walletCapability = this.deps.walletPort
      ? capabilityFromWallet(await this.deps.walletPort.observeCapability(), record.request.expectedChainId)
      : null;
    const actionCapability = this.deps.actionPort
      ? capabilityFromAction(await this.deps.actionPort.observeCapability(), record.request.expectedChainId)
      : null;
    const capability = actionCapability ?? walletCapability;
    if (!capability) throw new Strk20Error(STRK20_ERROR_CODE.CAPABILITY_UNKNOWN, "capability_port_unavailable");
    if (
      walletCapability
      && actionCapability
      && walletCapability.chainId.trim().toUpperCase() !== actionCapability.chainId.trim().toUpperCase()
    ) {
      throw new Strk20Error(STRK20_ERROR_CODE.NETWORK_MISMATCH, "wallet_ports_observed_different_chain");
    }
    if (walletCapability && actionCapability) {
      if (walletCapability.status === "unsupported" || actionCapability.status === "unsupported") {
        throw new Strk20Error(STRK20_ERROR_CODE.UNSUPPORTED_WALLET, "wallet_ports_capability_disagreement");
      }
      if (
        walletCapability.status !== actionCapability.status
        || walletCapability.capable !== actionCapability.capable
      ) {
        throw new Strk20Error(STRK20_ERROR_CODE.CAPABILITY_UNKNOWN, "wallet_ports_capability_disagreement");
      }
      if (
        walletCapability.environment !== actionCapability.environment
        || walletCapability.environment === "UNKNOWN"
        || walletCapability.mismatch
        || actionCapability.mismatch
      ) {
        throw new Strk20Error(STRK20_ERROR_CODE.NETWORK_MISMATCH, "wallet_ports_environment_disagreement");
      }
    }
    if (capability.status === "unknown") throw new Strk20Error(STRK20_ERROR_CODE.CAPABILITY_UNKNOWN, "wallet_capability_unknown");
    if (!capability.capable) throw new Strk20Error(STRK20_ERROR_CODE.UNSUPPORTED_WALLET, "wallet_api_below_0_10_3");
    if (capability.environment === "UNKNOWN" || capability.mismatch) {
      throw new Strk20Error(STRK20_ERROR_CODE.NETWORK_MISMATCH, `expected_${capability.expected}_got_${capability.environment}`);
    }
    this.touch(record, { capability, state: "capability_unknown" });

    if (this.deps.walletPort) {
      let registration: boolean | null;
      try {
        registration = await this.deps.walletPort.isRegistered();
      } catch {
        throw new Strk20Error(STRK20_ERROR_CODE.DEPENDENCY_FAILURE, "registration_observation_failed");
      }
      if (registration === false) {
        this.touch(record, { registration: { status: "required" } });
        throw new Strk20Error(STRK20_ERROR_CODE.REGISTRATION_REQUIRED, "wallet_registration_required");
      }
      this.touch(record, { registration: { status: registration === true ? "registered" : "unknown" } });
    }

    if (!this.deps.walletPort) throw new Strk20Error(STRK20_ERROR_CODE.FEE_UNAVAILABLE, "fee_port_unavailable");
    let fee: { fee: bigint; blockNumber: number | null };
    try {
      fee = await this.deps.walletPort.observeFee();
    } catch (cause) {
      if (cause instanceof Strk20Error) throw cause;
      throw new Strk20Error(STRK20_ERROR_CODE.FEE_UNAVAILABLE, "fee_observation_failed");
    }
    if (typeof fee.fee !== "bigint" || fee.fee < 0n) throw new Strk20Error(STRK20_ERROR_CODE.FEE_UNAVAILABLE, "invalid_fee_observation");
    const quotedFee = record.request.quotedFee ?? fee.fee;
    if (quotedFee < 0n) throw new Strk20Error(STRK20_ERROR_CODE.FEE_UNAVAILABLE, "negative_quoted_fee");
    if (record.request.quotedFee !== undefined && record.request.quotedFee !== null && quotedFee !== fee.fee) {
      throw new Strk20Error(STRK20_ERROR_CODE.FEE_CHANGED, `quoted_${String(quotedFee)}_observed_${String(fee.fee)}`);
    }
    this.touch(record, { fee: { fee: fee.fee, blockNumber: normalizeBlockNumber(fee.blockNumber), quotedFee } });

    const needsConsent = record.request.requireConsent !== false && record.kind !== "shield";
    if (needsConsent) {
      const derivedTokens = actionTokens(record.request.actions);
      const tokens = record.request.consentTokens
        ? [...record.request.consentTokens]
        : (derivedTokens.length > 0
          ? derivedTokens
          : (record.request.token ? [record.request.token] : []));
      if (tokens.length === 0) throw new Strk20Error(STRK20_ERROR_CODE.CONSENT_REQUIRED, "consent_tokens_required");
      try {
        const balanceObservation = await this.deps.walletPort.requestPrivateBalances({ tokens, requireConsent: true });
        assertNoViewingKey(balanceObservation, "privacy_action.balance_consent_result");
        if (balanceObservation.consent === "denied") {
          this.touch(record, { consent: { status: "denied" } });
          throw new Strk20Error(STRK20_ERROR_CODE.CONSENT_DENIED, "user_denied_balance_consent");
        }
        if (balanceObservation.consent !== "granted") {
          this.touch(record, { consent: { status: "required" } });
          throw new Strk20Error(STRK20_ERROR_CODE.CONSENT_REQUIRED, "consent_required");
        }
      } catch (cause) {
        if (cause instanceof Strk20Error) {
          if (cause.code === STRK20_ERROR_CODE.CONSENT_DENIED) this.touch(record, { consent: { status: "denied" } });
          throw cause;
        }
        this.touch(record, { consent: { status: "required" } });
        throw new Strk20Error(STRK20_ERROR_CODE.CONSENT_REQUIRED, "consent_observation_failed");
      }
      // Balances are deliberately discarded. The service records only consent.
      this.touch(record, { consent: { status: "granted" } });
    } else {
      this.touch(record, { consent: { status: "not_requested" } });
    }

    this.touch(record, { preflightComplete: true, state: "proving" });
  }

  private async recheckRegistrationAndFee(record: ActionRecord): Promise<void> {
    if (!this.deps.walletPort || !record.fee) throw new Strk20Error(STRK20_ERROR_CODE.FEE_UNAVAILABLE, "fee_port_unavailable");
    let registration: boolean | null;
    try {
      registration = await this.deps.walletPort.isRegistered();
    } catch {
      throw new Strk20Error(STRK20_ERROR_CODE.DEPENDENCY_FAILURE, "registration_observation_failed");
    }
    if (registration === false) {
      this.touch(record, { registration: { status: "required" } });
      throw new Strk20Error(STRK20_ERROR_CODE.REGISTRATION_REQUIRED, "wallet_registration_required");
    }
    this.touch(record, { registration: { status: registration === true ? "registered" : "unknown" } });

    let current: { fee: bigint; blockNumber: number | null };
    try {
      current = await this.deps.walletPort.observeFee();
    } catch (cause) {
      if (cause instanceof Strk20Error) throw cause;
      throw new Strk20Error(STRK20_ERROR_CODE.FEE_UNAVAILABLE, "fee_observation_failed");
    }
    if (typeof current.fee !== "bigint" || current.fee < 0n) throw new Strk20Error(STRK20_ERROR_CODE.FEE_UNAVAILABLE, "invalid_fee_observation");
    if (current.fee !== record.fee.fee) {
      throw new Strk20Error(STRK20_ERROR_CODE.FEE_CHANGED, `quoted_${String(record.fee.fee)}_current_${String(current.fee)}`);
    }
    this.touch(record, { fee: { ...record.fee, blockNumber: normalizeBlockNumber(current.blockNumber) } });
  }

  private walletRequest(record: ActionRecord): { token: Hex; amount: bigint; recipient: Hex; spender: Hex } {
    const token = record.request.token ?? actionTokens(record.request.actions)[0];
    const amount = record.request.amount;
    const recipient = record.request.recipient;
    if (typeof token !== "string" || token.length === 0) throw new Strk20Error(STRK20_ERROR_CODE.INVALID_AMOUNT, "token_required");
    if (typeof amount !== "bigint" || amount <= 0n) throw new Strk20Error(STRK20_ERROR_CODE.INVALID_AMOUNT, "amount_must_be_positive");
    if (record.kind !== "shield" && (typeof recipient !== "string" || recipient.length === 0)) {
      throw new Strk20Error(STRK20_ERROR_CODE.INVALID_AMOUNT, "recipient_required");
    }
    return {
      token,
      amount,
      recipient: (recipient ?? token) as Hex,
      spender: (record.request.spender ?? STRK20_POOL_ADDRESS) as Hex,
    };
  }

  private requireRecord(id: string): ActionRecord {
    const record = this.records.get(id);
    if (!record) throw new Strk20Error(STRK20_ERROR_CODE.STALE_STATE, `action_not_found:${id}`);
    return record;
  }

  private now(): number {
    const value = this.nowFn();
    if (!Number.isFinite(value)) throw new Strk20Error(STRK20_ERROR_CODE.STALE_STATE, "clock_unavailable");
    return Math.floor(value);
  }

  private touch(record: ActionRecord, patch: Partial<ActionRecord>): void {
    Object.assign(record, patch);
    record.version += 1;
    record.updatedAt = this.now();
  }

  private fail(record: ActionRecord, cause: unknown): never {
    if (isM5Error(cause)) throw cause;
    const error = cause instanceof Strk20Error
      ? cause
      : isStrk20Code((cause as { code?: unknown } | null)?.code)
        ? new Strk20Error((cause as { code: Strk20ErrorCode }).code, safeProviderFailure())
        : new Strk20Error(STRK20_ERROR_CODE.DEPENDENCY_FAILURE, safeProviderFailure());
    let state: PrivacyActionState = record.state;
    if (error.code === STRK20_ERROR_CODE.NETWORK_MISMATCH) state = "mismatch";
    else if (error.code === STRK20_ERROR_CODE.CAPABILITY_UNKNOWN || error.code === STRK20_ERROR_CODE.UNSUPPORTED_WALLET || error.code === STRK20_ERROR_CODE.UNSUPPORTED_WALLET_METHOD) state = "capability_unknown";
    else if (error.code === STRK20_ERROR_CODE.REGISTRATION_REQUIRED) state = "registration_required";
    else if (error.code === STRK20_ERROR_CODE.CONSENT_REQUIRED || error.code === STRK20_ERROR_CODE.CONSENT_DENIED) state = "consent_required";
    else if (error.code === STRK20_ERROR_CODE.SCREENING_REJECTED) state = "rejected";
    else if (error.code === STRK20_ERROR_CODE.PROOF_REQUIRED) state = "proving";
    else if (error.code === STRK20_ERROR_CODE.FEE_UNAVAILABLE) state = "fee_pending";
    else if (record.phase !== "submitted" && record.phase !== "receipt_pending") state = "dependency_failure";
    const patch: Partial<ActionRecord> = {
      state,
      phase: state === "rejected" ? "terminal" : "failed",
      errorCode: error.code,
      errorDetail: error.detail ?? null,
    };
    if (error.code === STRK20_ERROR_CODE.REGISTRATION_REQUIRED) patch.registration = { status: "required" };
    if (error.code === STRK20_ERROR_CODE.CONSENT_DENIED) patch.consent = { status: "denied" };
    this.touch(record, patch);
    throw error;
  }

  private toView(record: ActionRecord): PrivacyActionView {
    return {
      id: record.id,
      kind: record.kind,
      execution: record.execution,
      state: record.state,
      phase: record.phase,
      version: record.version,
      updatedAt: record.updatedAt,
      capability: record.capability,
      registration: { ...record.registration },
      fee: record.fee ? { ...record.fee } : null,
      consent: { ...record.consent },
      // The prepared call contains raw calldata and is an internal provider
      // artifact. Keep the transport-facing view status-only.
      proof: { status: record.proofStatus, call: null },
      submissionAttempted: record.submissionAttempted,
      approvalTransactionHash: record.approvalTransactionHash,
      transactionHash: record.transactionHash,
      receipt: record.receipt,
      terminal: isTerminalState(record.state),
      errorCode: record.errorCode,
      errorDetail: record.errorDetail,
    };
  }
}

export function isPrivacyActionTerminal(state: PrivacyActionState): boolean {
  return isTerminalState(state);
}

// Keep these imports part of the boundary contract: callers can pass either
// concrete adapter without depending on their implementation details.
export type WalletStrk20ActionAdapterPort = WalletStrk20ActionAdapter;
export type InjectedWalletStrk20AdapterPort = InjectedWalletStrk20Adapter;
export type { Strk20Proof };
