import { assertNoViewingKey } from "../features/prism-strk20/domain/privacy-guard";
import { Strk20Error, STRK20_ERROR_CODE } from "../features/prism-strk20/domain/errors";
import type { PrivacyActionView, PrivacyActionState } from "../features/prism-strk20/application/privacy-action-service";
import type { Strk20ActionData, Strk20ActionPayload, Strk20LifecycleState } from "./schemas";

/** Fields that must never cross the REST/SDK action boundary. */
const FORBIDDEN_TRANSPORT_KEY = /(proof|calldata|rawcall|viewing.?key|private.?key|seed.?phrase|mnemonic|private.?note|secret|provider|rawresponse|password)/i;
const ALLOWED_ACTION_KEYS = new Set([
  "actionId",
  "prismId",
  "kind",
  "execution",
  "walletSessionRef",
  "expectedChainId",
  "quotedFee",
  "requireConsent",
  "token",
  "amount",
  "recipient",
  "spender",
  "consentTokens",
  "operation",
  // HTTP envelope fields are consumed by the route and never forwarded.
  "session",
  "appSession",
  "idempotencyKey",
  "correlationId",
  "expectedVersion",
]);

const DECIMAL_RE = /^(0|[1-9][0-9]*)$/;
const HEX_RE = /^0x[0-9a-fA-F]{1,64}$/;

function forbiddenField(key: string): never {
  throw new Strk20Error(STRK20_ERROR_CODE.VIEWING_KEY_FORBIDDEN, `forbidden_field_${key}`);
}

function scanForbiddenKeys(value: unknown, context: string, seen = new WeakSet<object>()): void {
  if (value === null || value === undefined || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanForbiddenKeys(item, `${context}[${index}]`, seen));
    return;
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_TRANSPORT_KEY.test(key)) forbiddenField(`${context}.${key}`);
    scanForbiddenKeys(nested, `${context}.${key}`, seen);
  }
}

function optionalString(value: unknown, field: string): string | null | undefined {
  if (value === undefined || value === null) return value;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Strk20Error(STRK20_ERROR_CODE.STALE_STATE, `${field}_must_be_non_empty_string`);
  }
  return value;
}

function optionalDecimal(value: unknown, field: string): string | null | undefined {
  if (value === undefined || value === null) return value;
  if (typeof value !== "string" || !DECIMAL_RE.test(value)) {
    throw new Strk20Error(STRK20_ERROR_CODE.INVALID_AMOUNT, `${field}_must_be_decimal_string`);
  }
  return value;
}

function optionalHex(value: unknown, field: string): string | null | undefined {
  if (value === undefined || value === null) return value;
  if (typeof value !== "string" || !HEX_RE.test(value)) {
    throw new Strk20Error(STRK20_ERROR_CODE.INVALID_AMOUNT, `${field}_must_be_hex_address`);
  }
  try {
    const numeric = BigInt(value);
    if (numeric === 0n || numeric >= (1n << 251n)) {
      throw new Error("address_out_of_range");
    }
  } catch {
    throw new Strk20Error(STRK20_ERROR_CODE.INVALID_AMOUNT, `${field}_must_be_starknet_address`);
  }
  return value;
}

/**
 * Strictly parse the safe action transport. This is intentionally separate
 * from the internal PrivacyActionRequest, which may contain wallet-mediated
 * BigInts and action unions used only behind an injected provider boundary.
 */
export function parseStrk20ActionPayload(input: unknown): Strk20ActionPayload {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Strk20Error(STRK20_ERROR_CODE.STALE_STATE, "action_payload_must_be_object");
  }
  scanForbiddenKeys(input, "action_payload");
  assertNoViewingKey(input, "strk20_action_transport");
  const body = input as Record<string, unknown>;
  for (const key of Object.keys(body)) {
    if (FORBIDDEN_TRANSPORT_KEY.test(key)) forbiddenField(key);
    if (!ALLOWED_ACTION_KEYS.has(key)) {
      throw new Strk20Error(STRK20_ERROR_CODE.STALE_STATE, `unsupported_action_field_${key}`);
    }
  }

  const actionId = body.actionId;
  if (typeof actionId !== "string" || actionId.trim().length === 0 || actionId.length > 200) {
    throw new Strk20Error(STRK20_ERROR_CODE.STALE_STATE, "action_id_required");
  }
  const kind = body.kind;
  if (kind !== "shield" && kind !== "private_transfer" && kind !== "application") {
    throw new Strk20Error(STRK20_ERROR_CODE.STALE_STATE, "unsupported_action_kind");
  }
  const execution = body.execution;
  if (execution !== undefined && execution !== "prepared_proof" && execution !== "wallet_action" && execution !== "wallet_managed") {
    throw new Strk20Error(STRK20_ERROR_CODE.STALE_STATE, "unsupported_action_execution");
  }
  const operation = body.operation;
  if (operation !== undefined && operation !== "create" && operation !== "prepare" && operation !== "submit" && operation !== "observe_receipt") {
    throw new Strk20Error(STRK20_ERROR_CODE.STALE_STATE, "unsupported_action_operation");
  }
  if (body.requireConsent !== undefined && typeof body.requireConsent !== "boolean") {
    throw new Strk20Error(STRK20_ERROR_CODE.STALE_STATE, "require_consent_must_be_boolean");
  }
  const consentTokens = body.consentTokens;
  if (consentTokens !== undefined) {
    if (!Array.isArray(consentTokens) || !consentTokens.every((value) => {
      if (typeof value !== "string" || !HEX_RE.test(value)) return false;
      try {
        const numeric = BigInt(value);
        return numeric > 0n && numeric < (1n << 251n);
      } catch {
        return false;
      }
    })) {
      throw new Strk20Error(STRK20_ERROR_CODE.INVALID_AMOUNT, "consent_tokens_must_be_starknet_addresses");
    }
  }

  return {
    actionId,
    prismId: optionalString(body.prismId, "prism_id"),
    kind,
    execution,
    walletSessionRef: optionalString(body.walletSessionRef, "wallet_session_ref"),
    expectedChainId: optionalString(body.expectedChainId, "expected_chain_id"),
    quotedFee: optionalDecimal(body.quotedFee, "quoted_fee"),
    requireConsent: body.requireConsent,
    token: optionalHex(body.token, "token"),
    amount: optionalDecimal(body.amount, "amount"),
    recipient: optionalHex(body.recipient, "recipient"),
    spender: optionalHex(body.spender, "spender"),
    consentTokens: consentTokens as readonly string[] | undefined,
    idempotencyKey: optionalString(body.idempotencyKey, "idempotency_key"),
    operation,
  };
}

function decimal(value: bigint, field: string): string {
  if (typeof value !== "bigint" || value < 0n) throw new Strk20Error(STRK20_ERROR_CODE.DEPENDENCY_FAILURE, `invalid_${field}`);
  return value.toString(10);
}

function safeDetail(value: string | null): string | null {
  if (value === null) return null;
  if (/private.?key|private.?note|seed.?phrase|mnemonic|viewing.?key|provider.?response|raw.?provider|raw.?proof|proof.?facts|calldata|secret|password/i.test(value)) return "provider_failure";
  return value.slice(0, 160);
}

function lifecycleStateFor(view: PrivacyActionView): Strk20LifecycleState {
  const receipt = view.receipt;
  if (receipt) {
    if (receipt.executionStatus === "REVERTED" && receipt.blockNumber !== null) return "reverted";
    if (receipt.executionStatus === "UNKNOWN") return "unknown";
    const confirmed = receipt.executionStatus === "SUCCEEDED"
      && (receipt.finalityStatus === "ACCEPTED_ON_L1" || receipt.finalityStatus === "ACCEPTED_ON_L2")
      && receipt.blockNumber !== null
      && receipt.poolEventFound;
    if (confirmed) return "receipt-confirmed";
    return "processing";
  }

  // A submission fence without a returned hash is ambiguous. It is not safe to
  // retry or to report an ordinary provider failure, so expose attention.
  if (view.submissionAttempted && view.transactionHash === null) return "requires-attention";
  if (view.transactionHash !== null) return "submitted";

  switch (view.state as PrivacyActionState) {
    case "consent_required":
      return "consent-required";
    case "registration_required":
    case "proof_ready":
      return "awaiting-approval";
    case "proving":
      return view.phase === "simulated" ? "awaiting-approval" : "processing";
    case "fee_pending":
    case "mismatch":
    case "dependency_failure":
      return "unavailable";
    case "rejected":
      return "reverted";
    case "confirmed":
    case "transfer_confirmed":
      // A confirmed state without its receipt is an inconsistent/missing
      // evidence read; do not promote it to receipt-confirmed.
      return "processing";
    case "shielding":
    case "transfer_pending":
    case "receipt_pending":
      return "processing";
    case "capability_unknown":
    default:
      return view.capability?.status === "unsupported" ? "unavailable" : "unknown";
  }
}

/**
 * Explicit allow-list serializer. It never spreads an internal view, so adding
 * a provider/raw field to a domain type cannot accidentally become API output.
 */
export function serializePrivacyActionView(view: PrivacyActionView): Strk20ActionData {
  const fee = view.fee
    ? {
        fee: decimal(view.fee.fee, "fee"),
        blockNumber: view.fee.blockNumber,
        quotedFee: decimal(view.fee.quotedFee, "quoted_fee"),
      }
    : null;
  const receipt = view.receipt
    ? {
        transactionHash: view.receipt.transactionHash,
        executionStatus: view.receipt.executionStatus,
        finalityStatus: view.receipt.finalityStatus,
        blockNumber: view.receipt.blockNumber,
        poolEventFound: view.receipt.poolEventFound,
      }
    : null;
  return {
    id: view.id,
    actionId: view.id,
    kind: view.kind,
    execution: view.execution,
    state: lifecycleStateFor(view),
    sourceState: view.state,
    phase: view.phase,
    version: view.version,
    updatedAt: view.updatedAt,
    capability: view.capability
      ? {
          capable: view.capability.capable,
          status: view.capability.status,
          apiVersions: [...view.capability.apiVersions],
          specs: [...view.capability.specs],
          chainId: view.capability.chainId,
          environment: view.capability.environment,
          mismatch: view.capability.mismatch,
          expected: view.capability.expected,
        }
      : null,
    registration: { status: view.registration.status },
    fee,
    consent: { status: view.consent.status },
    // Proof/call/calldata are wallet/provider material. Keep status only.
    proof: { status: view.proof.status, call: null },
    submissionAttempted: view.submissionAttempted,
    approvalTransactionHash: view.approvalTransactionHash,
    transactionHash: view.transactionHash,
    receipt,
    terminal: view.terminal,
    errorCode: view.errorCode,
    errorDetail: safeDetail(view.errorDetail),
  };
}
