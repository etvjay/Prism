// Application command/query boundary around domain + OperationStore.
// Transport-neutral: no HTTP framework imports. Separates app-session
// authentication (AppSession) from Starknet/Base execution authority
// (controllerAddress, proofDigest). Enforces idempotencyKey + expectedVersion
// at the boundary, persists operation_id before any chain submission, and
// preserves submitted != completed (INV-SYS-005). Never infers canonical
// identity from backend state — queries hit RegistryReadPort.

import { assertValidAppSession, type AppSession } from "./auth";
import { AppError, APP_ERROR_CODE } from "./errors";
import type {
  AppCommandRequest,
  AppResponse,
  BindData,
  BindPayload,
  CreateIdentityData,
  CreateIdentityPayload,
  GetIdentityData,
  GetIdentityQuery,
  IssueChallengeData,
  IssueChallengePayload,
  ResolveData,
  ResolveQuery,
  RevokeData,
  RevokePayload,
  SubmitProofData,
  SubmitProofPayload,
} from "./schemas";
import { ok, err } from "./schemas";
import { isConcreteStarknetSubmitAdapter, type ChallengeProofApplicationPort, type IdGenerator, type RegistryReadPort, type StarknetSubmitPort } from "./ports";
import type { OperationStore, PersistedOperation } from "../features/prism-operations/domain/operation-store";
import type { Hex, OperationState } from "../features/prism-operations/domain/operation";
import type { Clock } from "../features/prism-identity/domain/ports";
import { PrismChallengeService } from "../features/prism-identity/application/challenge-service";
import { CHALLENGE_SCHEMA_VERSION } from "../features/prism-identity/domain/ports";
import { hasVerifiedEvidence } from "../features/prism-identity/domain/ownership-challenge-validation";
import { assertValidPrismId, assertSupportedVenue, assertValidExecutionAccount, isValidChainId, type EvmAddress, type Venue } from "../features/prism-identity/domain/identifiers";
import { toFieldBoundedDigest } from "../features/prism-identity/domain/felt-digest";
import { normalizeProofDigestIdentity } from "../features/prism-identity/domain/proof-digest";
import { normalizeStarknetContractAddress, sameStarknetContractAddress, StarknetContractAddressError } from "../features/prism-identity/domain/starknet-boundary";
import { OperationError } from "../features/prism-operations/domain/errors";
import { PrismError } from "../features/prism-identity/domain/errors";

export interface PrismApplicationDeps {
  readonly challengeService: PrismChallengeService;
  readonly operationStore: OperationStore;
  readonly registry: RegistryReadPort;
  readonly submitPort: StarknetSubmitPort;
  /** Factory wiring metadata; absent on legacy direct test harnesses and inferred from the port. */
  readonly submitPortMode?: "TEST_DOUBLE_X2" | "STARKNET_INJECTED";
  readonly isStarknetSubmitConfigured?: boolean;
  /** Explicit registry ABI version; omission must never silently select V1. */
  readonly registryVersion: "v1" | "v2";
  readonly clock: Clock;
  readonly idGenerator: IdGenerator;
}

function nowOrThrow(clock: Clock): number {
  const v = clock.now();
  if (!Number.isFinite(v)) throw new AppError(APP_ERROR_CODE.RPC_UNAVAILABLE, "clock_unavailable");
  return Math.floor(v);
}

function fingerprintFor(payload: unknown): string {
  // Stable request fingerprint for idempotency same-key/same-body check.
  return JSON.stringify(payload);
}

function normalizeStarknetAddress(value: string): string {
  try {
    return normalizeStarknetContractAddress(value, "starknetAddress");
  } catch (cause) {
    const reason = cause instanceof StarknetContractAddressError ? cause.reason : "malformed";
    throw new AppError(APP_ERROR_CODE.INVALID_EXECUTION_ACCOUNT, `${reason === "malformed" ? "malformed" : "invalid"}_starknet_address`);
  }
}

type RetrySubmission =
  | { kind: "create_identity"; controllerAddress: string }
  | { kind: "bind_execution_identity"; prismId: string; venue: Venue; executionAccount: EvmAddress; proofDigest: Hex; challengeId: Hex; chainId: number; expiresAt: number; controllerAddress: string }
  | { kind: "revoke_binding"; prismId: string; venue: string; executionAccount: string; controllerAddress: string };

function parseRetrySubmission(operationKind: string, requestFingerprint: string): RetrySubmission {
  try {
    const value = JSON.parse(requestFingerprint) as Record<string, unknown>;
    if (typeof value.kind === "string" && value.kind !== operationKind) {
      throw new Error("retry_operation_kind_mismatch");
    }
    const kind = operationKind;
    if (kind === "create_identity" && typeof value.controllerAddress === "string") {
      return { kind, controllerAddress: normalizeStarknetAddress(value.controllerAddress) };
    }
    if (kind === "bind_execution_identity" && typeof value.prismId === "string" && typeof value.venue === "string" && typeof value.executionAccount === "string" && typeof value.proofDigest === "string" && typeof value.challengeId === "string" && typeof value.chainId === "number" && typeof value.expiresAt === "number" && typeof value.controllerAddress === "string") {
      const proofDigest = normalizeProofDigestIdentity(value.proofDigest);
      const challengeId = value.challengeId;
      if (!/^0x[0-9a-fA-F]{64}$/.test(proofDigest) || !/^0x[0-9a-fA-F]{64}$/.test(challengeId) || !isValidChainId(value.chainId) || !Number.isSafeInteger(value.expiresAt)) throw new Error("malformed_proof_binding_reference");
      return {
        kind,
        prismId: assertValidPrismId(value.prismId),
        venue: assertSupportedVenue(value.venue),
        executionAccount: assertValidExecutionAccount(value.executionAccount),
        proofDigest: proofDigest as Hex,
        challengeId: normalizeProofDigestIdentity(challengeId),
        chainId: value.chainId,
        expiresAt: value.expiresAt,
        controllerAddress: normalizeStarknetAddress(value.controllerAddress),
      };
    }
    if (kind === "revoke_binding" && typeof value.prismId === "string" && typeof value.venue === "string" && typeof value.executionAccount === "string" && typeof value.controllerAddress === "string") {
      return {
        kind,
        prismId: assertValidPrismId(value.prismId),
        venue: assertSupportedVenue(value.venue),
        executionAccount: assertValidExecutionAccount(value.executionAccount),
        controllerAddress: normalizeStarknetAddress(value.controllerAddress),
      };
    }
  } catch {
    // Retry must never reconstruct a partially valid submission from a bad row.
  }
  throw new AppError(APP_ERROR_CODE.STALE_STATE_CONFLICT, "retry_operation_invalid");
}

function isValidTxHash(value: unknown): value is Hex {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

type AppCode = typeof APP_ERROR_CODE[keyof typeof APP_ERROR_CODE];
type SubmitFailureState = "failed_retryable" | "failed_terminal" | "requires_attention";
type SubmitFailure = { code: AppCode; detail: string; state: SubmitFailureState };

// These codes describe a deterministic contract/input fact. They must never
// return to failed_retryable after an adapter has been called: a retry could
// replay an already-rejected or already-consumed operation.
const TERMINAL_SUBMIT_CODES = new Set<string>([
  APP_ERROR_CODE.INVALID_VENUE,
  APP_ERROR_CODE.IDENTITY_NOT_FOUND,
  APP_ERROR_CODE.INVALID_SIGNER,
  APP_ERROR_CODE.NOT_CONTROLLER,
  APP_ERROR_CODE.INVALID_EXECUTION_ACCOUNT,
  APP_ERROR_CODE.NONCE_ALREADY_USED,
  APP_ERROR_CODE.PROOF_DIGEST_ALREADY_CONSUMED,
  APP_ERROR_CODE.BINDING_ALREADY_ACTIVE,
  APP_ERROR_CODE.BINDING_NOT_FOUND,
  APP_ERROR_CODE.IDENTITY_NOT_FOUND_READ,
  APP_ERROR_CODE.BINDING_ALREADY_REVOKED,
  APP_ERROR_CODE.ALTERED_MESSAGE,
  APP_ERROR_CODE.PROOF_EXPIRED,
  APP_ERROR_CODE.UNSUPPORTED_SIGNATURE_CLASS,
  APP_ERROR_CODE.STALE_STATE_CONFLICT,
]);

function stableAppCode(cause: unknown): AppCode {
  const maybeCode = (cause as { code?: string })?.code;
  if (typeof maybeCode === "string" && Object.values(APP_ERROR_CODE).includes(maybeCode as never)) {
    return maybeCode as AppCode;
  }
  return APP_ERROR_CODE.RPC_UNAVAILABLE;
}

function submitFailure(cause: unknown): SubmitFailure {
  const code = stableAppCode(cause);
  const detail = (cause as { detail?: string })?.detail ?? (cause as Error)?.message ?? "submit_failed";
  const ambiguous = (cause as { ambiguous?: unknown })?.ambiguous === true || code === APP_ERROR_CODE.TIMEOUT_UNKNOWN_STATUS;
  if (ambiguous) {
    return { code: APP_ERROR_CODE.TIMEOUT_UNKNOWN_STATUS, detail, state: "requires_attention" };
  }
  const terminal = (cause as { terminal?: unknown })?.terminal === true || TERMINAL_SUBMIT_CODES.has(code);
  return { code, detail, state: terminal ? "failed_terminal" : "failed_retryable" };
}

function failureResponseDetail(operationId: string, failure: SubmitFailure): string {
  if (failure.state === "failed_retryable") return `dependency_failure:op_${operationId}:${failure.detail}`;
  if (failure.state === "requires_attention") return `submission_status_unknown:op_${operationId}:${failure.detail}`;
  return `terminal_submission_failure:op_${operationId}:${failure.detail}`;
}

export class PrismApplicationService implements ChallengeProofApplicationPort {
  constructor(private readonly deps: PrismApplicationDeps) {
    if (deps.registryVersion !== "v1" && deps.registryVersion !== "v2") {
      throw new Error("invariant_violation: registryVersion must be explicitly v1 or v2");
    }
    if (deps.submitPort.registryVersion !== undefined && deps.submitPort.registryVersion !== deps.registryVersion) {
      throw new Error(`invariant_violation: registryVersion mismatch application=${deps.registryVersion} submitPort=${deps.submitPort.registryVersion}`);
    }
  }

  /**
   * Persist the no-duplicate fence before crossing into any submit adapter.
   * `requires_attention` is deliberately poll-only; the monotonic field also
   * protects rows classified as failed_retryable after a definite adapter
   * error, because a transport error cannot prove that no broadcast occurred.
   */
  private async markSubmissionAttempted(op: PersistedOperation, now: number): Promise<PersistedOperation> {
    return this.deps.operationStore.transition(op.id, {
      to: "requires_attention",
      now: now + 3,
      expectedVersion: op.version,
      errorCode: APP_ERROR_CODE.TIMEOUT_UNKNOWN_STATUS,
      errorDetail: "submission_attempted_poll_only",
      submissionAttempted: true,
    });
  }

  private markerFailure(operationId: string, cause: unknown): AppError {
    const detail = (cause as { detail?: string })?.detail ?? (cause as Error)?.message ?? "submission_attempt_marker_failed";
    return new AppError(APP_ERROR_CODE.RPC_UNAVAILABLE, `dependency_failure:op_${operationId}:submission_attempt_marker_failed:${detail}`);
  }

  private submissionPersistenceFailure(operationId: string, cause: unknown): AppError {
    const detail = (cause as { detail?: string })?.detail ?? (cause as Error)?.message ?? "submission_persistence_failed";
    return new AppError(APP_ERROR_CODE.TIMEOUT_UNKNOWN_STATUS, `submission_status_unknown:op_${operationId}:submission_persistence_failed:${detail}`);
  }

  // -------------------------------------------------------------------------
  // Issue / Verify (challenge lifecycle — sync, no Operation row)
  // -------------------------------------------------------------------------

  async issueChallenge(req: AppCommandRequest<IssueChallengePayload>): Promise<AppResponse<IssueChallengeData>> {
    const requestId = req.headers.requestId ?? null;
    try {
      const now = nowOrThrow(this.deps.clock);
      assertValidAppSession(req.session, now);
      // Venue / account / prismId validation at boundary (maps to ERR-001/002/005)
      assertSupportedVenue(req.payload.venue);
      assertValidExecutionAccount(req.payload.executionAccount);
      assertValidPrismId(req.payload.prismId);
      const view = await this.deps.challengeService.issueChallenge({
        prismId: req.payload.prismId,
        venue: req.payload.venue,
        executionAccount: req.payload.executionAccount,
        ttlSeconds: req.payload.ttlSeconds,
      });
      return ok<IssueChallengeData>(
        {
          challengeId: view.challengeId,
          digest: view.digest,
          messageToSign: view.messageToSign,
          issuedAt: view.issuedAt,
          expiresAt: view.expiresAt,
          domain: view.domain,
          venue: view.venue,
          executionAccount: view.executionAccount,
          prismId: view.prismId,
          nonce: view.nonce,
          chainId: view.chainId,
          schemaVersion: view.schemaVersion,
        },
        undefined,
        requestId,
      );
    } catch (e) {
      return this.mapError(e, requestId);
    }
  }

  async submitProof(req: AppCommandRequest<SubmitProofPayload>): Promise<AppResponse<SubmitProofData>> {
    const requestId = req.headers.requestId ?? null;
    try {
      const now = nowOrThrow(this.deps.clock);
      assertValidAppSession(req.session, now);
      const result = await this.deps.challengeService.submitProof({
        challengeId: req.payload.challengeId,
        presented: req.payload.presented as unknown as import("../features/prism-identity/domain/verification").PresentedChallengeFields,
        signature: req.payload.signature,
      });
      return ok<SubmitProofData>(
        { status: "verified", signatureClass: result.signatureClass, digest: result.digest, verifiedAt: result.verifiedAt },
        undefined,
        requestId,
      );
    } catch (e) {
      return this.mapError(e, requestId);
    }
  }

  // -------------------------------------------------------------------------
  // Chain-touching commands — operation_id persisted BEFORE submission
  // -------------------------------------------------------------------------

  async createIdentity(req: AppCommandRequest<CreateIdentityPayload>): Promise<AppResponse<CreateIdentityData>> {
    const requestId = req.headers.requestId ?? null;
    const correlationId = req.headers.correlationId ?? null;
    const idempotencyKey = req.headers.idempotencyKey;
    try {
      const now = nowOrThrow(this.deps.clock);
      assertValidAppSession(req.session, now);
      if (!idempotencyKey || idempotencyKey.trim().length === 0) throw new AppError(APP_ERROR_CODE.STALE_STATE_CONFLICT, "missing_idempotency_key");
      const controllerAddress = req.payload.controllerAddress ? normalizeStarknetAddress(req.payload.controllerAddress) : null;
      if (!controllerAddress) throw new AppError(APP_ERROR_CODE.INVALID_EXECUTION_ACCOUNT, "missing_controller_address");
      const kind = req.payload.kind ?? "create_identity";
      const fingerprint = fingerprintFor({ kind, controllerAddress });
      const operationId = this.deps.idGenerator.generateOperationId();

      // 1) Persist operation row BEFORE any chain work.
      let op = await this.deps.operationStore.create({
        id: operationId,
        kind,
        idempotencyKey,
        requestFingerprint: fingerprint,
        now,
        correlationId,
      });
      // Idempotent same-key/same-fingerprint returns existing row without duplicate submission.
      if (op.id !== operationId) {
        // Existing operation returned — do not re-submit.
        return ok<CreateIdentityData>({ operationId: op.id, state: op.state }, { operationId: op.id, state: op.state, version: op.version }, requestId);
      }

      // 2) Walk workflow states to ready (allowed transitions: created -> awaiting_authorization -> ready)
      op = await this.deps.operationStore.transition(op.id, { to: "awaiting_authorization", now: now + 1, expectedVersion: op.version });
      op = await this.deps.operationStore.transition(op.id, { to: "ready", now: now + 2, expectedVersion: op.version });

      // 3) Fence the operation before any chain submission. A store failure
      // here is a pre-submit dependency failure, so the adapter is not called.
      let attempted: PersistedOperation;
      try {
        attempted = await this.markSubmissionAttempted(op, now);
      } catch (cause) {
        throw this.markerFailure(op.id, cause);
      }

      let txHash: Hex;
      try {
        const result = await this.deps.submitPort.submitCreateIdentity({ operationId: attempted.id, controllerAddress });
        if (!isValidTxHash(result?.txHash)) throw new AppError(APP_ERROR_CODE.TIMEOUT_UNKNOWN_STATUS, "submit_invalid_tx_hash");
        txHash = result.txHash;
      } catch (cause) {
        if (cause instanceof AppError && cause.code === APP_ERROR_CODE.TIMEOUT_UNKNOWN_STATUS) throw cause;
        const failure = submitFailure(cause);
        try {
          await this.deps.operationStore.transition(attempted.id, {
            to: failure.state,
            now: now + 4,
            expectedVersion: attempted.version,
            errorCode: failure.code,
            errorDetail: failure.detail,
          });
        } catch {}
        throw new AppError(failure.code, failureResponseDetail(attempted.id, failure));
      }

      try {
        op = await this.deps.operationStore.transition(attempted.id, {
          to: "submitted",
          now: now + 4,
          expectedVersion: attempted.version,
          txHash,
        });
      } catch (cause) {
        // The fence is already durable. Never compensate with failed_retryable:
        // that state plus a null hash would make a second broadcast possible.
        throw this.submissionPersistenceFailure(attempted.id, cause);
      }
      return ok<CreateIdentityData>({ operationId: op.id, state: op.state }, { operationId: op.id, state: op.state, version: op.version }, requestId);
    } catch (e) {
      if (e instanceof AppError && e.code === APP_ERROR_CODE.RPC_UNAVAILABLE) {
        // Preserve operation linkage for dependency failure case — caller can fetch via store.
        return this.mapError(e, requestId);
      }
      return this.mapError(e, requestId);
    }
  }

  async bind(req: AppCommandRequest<BindPayload>): Promise<AppResponse<BindData>> {
    const requestId = req.headers.requestId ?? null;
    const correlationId = req.headers.correlationId ?? null;
    const idempotencyKey = req.headers.idempotencyKey;
    const expectedVersion = req.headers.expectedVersion;
    try {
      const now = nowOrThrow(this.deps.clock);
      assertValidAppSession(req.session, now);
      if (!idempotencyKey || idempotencyKey.trim().length === 0) throw new AppError(APP_ERROR_CODE.STALE_STATE_CONFLICT, "missing_idempotency_key");

      // Boundary validation (distinct ERR codes, never stack leaks)
      const prismId = assertValidPrismId(req.payload.prismId);
      const venue = assertSupportedVenue(req.payload.venue);
      const executionAccount = assertValidExecutionAccount(req.payload.executionAccount);
      const controllerAddress = normalizeStarknetAddress(req.payload.controllerAddress);
      const proofDigest = normalizeProofDigestIdentity(req.payload.proofDigest);
      if (!proofDigest || !/^0x[0-9a-fA-F]{64}$/.test(proofDigest)) throw new AppError(APP_ERROR_CODE.STALE_STATE_CONFLICT, "malformed_proof_digest");
      // A digest is evidence only when it resolves to the server-issued
      // challenge record. Legacy callers may omit challengeId, but the digest
      // is then used only as a lookup key — never accepted on format alone.
      const challengeId = normalizeProofDigestIdentity(req.payload.challengeId ?? proofDigest);
      if (!/^0x[0-9a-fA-F]{64}$/.test(challengeId)) throw new AppError(APP_ERROR_CODE.ALTERED_MESSAGE, "malformed_challenge_reference");

      // Execution-authority checks separate from session auth:
      // - identity must exist (ERR-002)
      const identity = await this.deps.registry.getIdentity(prismId);
      if (!identity) throw new AppError(APP_ERROR_CODE.IDENTITY_NOT_FOUND, `identity_not_found:${prismId}`);
      // - controller must match (ERR-004) — never infer from session.
      const identityController = normalizeStarknetAddress(identity.controller);
      if (!sameStarknetContractAddress(identityController, controllerAddress)) throw new AppError(APP_ERROR_CODE.NOT_CONTROLLER, `controller_mismatch:expected_${identityController}_got_${controllerAddress}`);

      const challengeReference = normalizeProofDigestIdentity(challengeId);
      const challenge = await this.deps.challengeService.getChallenge(challengeReference);
      if (!challenge) throw new AppError(APP_ERROR_CODE.ALTERED_MESSAGE, "challenge_not_found");
      const mismatchedFields: string[] = [];
      if (normalizeProofDigestIdentity(challenge.challengeId) !== challengeReference) mismatchedFields.push("challenge_id");
      if (normalizeProofDigestIdentity(challenge.digest) !== proofDigest) mismatchedFields.push("digest");
      if (challenge.schemaVersion !== CHALLENGE_SCHEMA_VERSION) mismatchedFields.push("schema_version");
      if (challenge.prismId !== prismId) mismatchedFields.push("prism_id");
      if (challenge.venue !== venue) mismatchedFields.push("venue");
      if (challenge.executionAccount.toLowerCase() !== executionAccount.toLowerCase()) mismatchedFields.push("execution_account");
      if (!isValidChainId(challenge.chainId)) mismatchedFields.push("chain_id");
      if (req.payload.chainId !== undefined && (!isValidChainId(req.payload.chainId) || req.payload.chainId !== challenge.chainId)) mismatchedFields.push("chain_id");
      if (!Number.isSafeInteger(challenge.expiresAt)) mismatchedFields.push("expiry");
      if (req.payload.expiresAt !== undefined && (req.payload.expiresAt !== challenge.expiresAt || !Number.isSafeInteger(req.payload.expiresAt))) mismatchedFields.push("expiry");
      if (mismatchedFields.length > 0) {
        throw new AppError(APP_ERROR_CODE.ALTERED_MESSAGE, `challenge_binding_mismatch:${[...new Set(mismatchedFields)].sort().join("+")}`);
      }

      const fingerprint = fingerprintFor({
        prismId,
        venue,
        executionAccount,
        proofDigest,
        challengeId: challengeReference,
        chainId: challenge.chainId,
        expiresAt: challenge.expiresAt,
        controllerAddress,
      });
      const kind = "bind_execution_identity";
      const operationId = this.deps.idGenerator.generateOperationId();
      // Resolve an existing idempotency key before dynamic proof state checks:
      // a retry of the same submitted request must return its durable operation,
      // not be mistaken for a fresh proof replay.
      const existingByKey = await this.deps.operationStore.getByIdempotencyKey(idempotencyKey);
      if (existingByKey) {
        const existing = await this.deps.operationStore.create({ id: operationId, kind, idempotencyKey, requestFingerprint: fingerprint, now, correlationId });
        return ok<BindData>({ operationId: existing.id, state: existing.state }, { operationId: existing.id, state: existing.state, version: existing.version }, requestId);
      }

      if (challenge.bindingUseState === "CONSUMED") throw new AppError(APP_ERROR_CODE.PROOF_DIGEST_ALREADY_CONSUMED, `digest_already_claimed:${proofDigest}`);
      if (challenge.state === "EXPIRED" || now >= challenge.expiresAt) throw new AppError(APP_ERROR_CODE.PROOF_EXPIRED, `proof_expired:${challengeReference}`);
      if (
        challenge.state !== "VERIFIED" ||
        challenge.nonceState !== "CONSUMED" ||
        !hasVerifiedEvidence(challenge)
      ) {
        throw new AppError(APP_ERROR_CODE.ALTERED_MESSAGE, `challenge_not_verified:${challenge.state.toLowerCase()}`);
      }

      // Digest replay boundary is versioned with the registry ABI. V1 uses
      // the legacy felt mask; V2 preserves the full u256 digest and lets the
      // exact V2 registry enforce onchain single-use.
      let digestForCheck: Hex;
      try {
        digestForCheck = this.deps.registryVersion === "v2" ? (proofDigest as Hex) : toFieldBoundedDigest(proofDigest as Hex).felt;
      } catch {
        throw new AppError(APP_ERROR_CODE.STALE_STATE_CONFLICT, `malformed_proof_digest:${proofDigest}`);
      }
      let digestConsumed: boolean;
      try {
        digestConsumed = await this.deps.registry.isDigestConsumed(digestForCheck);
      } catch {
        throw new AppError(APP_ERROR_CODE.RPC_UNAVAILABLE, "digest_replay_check_unavailable");
      }
      if (digestConsumed) throw new AppError(APP_ERROR_CODE.PROOF_DIGEST_ALREADY_CONSUMED, `digest_already_consumed:${proofDigest}`);

      let op = await this.deps.operationStore.create({ id: operationId, kind, idempotencyKey, requestFingerprint: fingerprint, now, correlationId });
      if (op.id !== operationId) {
        return ok<BindData>({ operationId: op.id, state: op.state }, { operationId: op.id, state: op.state, version: op.version }, requestId);
      }

      // Validate expectedVersion if supplied for first transitions (stale guard demonstration)
      if (expectedVersion !== undefined && expectedVersion !== null && expectedVersion !== op.version) {
        throw new AppError(APP_ERROR_CODE.STALE_STATE_CONFLICT, `stale_version:expected_${expectedVersion}_got_${op.version}`);
      }

      op = await this.deps.operationStore.transition(op.id, { to: "awaiting_authorization", now: now + 1, expectedVersion: op.version });
      op = await this.deps.operationStore.transition(op.id, { to: "ready", now: now + 2, expectedVersion: op.version });

      // Durable proof-to-bind CAS: exact fields and VERIFIED state are checked
      // again at the write boundary, so concurrent requests have one winner.
      const claimResult = await this.deps.challengeService.claimVerifiedProof({
        challengeId: challengeReference,
        proofDigest: proofDigest as Hex,
        prismId,
        venue,
        executionAccount,
        chainId: challenge.chainId,
        expiresAt: challenge.expiresAt,
        now,
      });
      if (claimResult !== "claimed") {
        const claimCode = claimResult === "already_claimed"
          ? APP_ERROR_CODE.PROOF_DIGEST_ALREADY_CONSUMED
          : claimResult === "expired"
            ? APP_ERROR_CODE.PROOF_EXPIRED
            : claimResult === "unknown"
              ? APP_ERROR_CODE.RPC_UNAVAILABLE
              : APP_ERROR_CODE.ALTERED_MESSAGE;
        const claimDetail = `proof_bind_claim_${claimResult}:${challengeReference}`;
        try {
          await this.deps.operationStore.transition(op.id, {
            to: "failed_terminal",
            now: now + 3,
            expectedVersion: op.version,
            errorCode: claimCode,
            errorDetail: claimDetail,
          });
        } catch {}
        throw new AppError(claimCode, claimDetail);
      }

      let attempted: PersistedOperation;
      try {
        attempted = await this.markSubmissionAttempted(op, now);
      } catch (cause) {
        throw this.markerFailure(op.id, cause);
      }

      let txHash: Hex;
      try {
        const result = await this.deps.submitPort.submitBind({
          operationId: attempted.id,
          prismId,
          venue,
          executionAccount,
          proofDigest: proofDigest as Hex,
          controllerAddress,
        });
        if (!isValidTxHash(result?.txHash)) throw new AppError(APP_ERROR_CODE.TIMEOUT_UNKNOWN_STATUS, "submit_invalid_tx_hash");
        txHash = result.txHash;
      } catch (cause) {
        if (cause instanceof AppError && cause.code === APP_ERROR_CODE.TIMEOUT_UNKNOWN_STATUS) throw cause;
        const failure = submitFailure(cause);
        try {
          await this.deps.operationStore.transition(attempted.id, {
            to: failure.state,
            now: now + 4,
            expectedVersion: attempted.version,
            errorCode: failure.code,
            errorDetail: failure.detail,
          });
        } catch {}
        throw new AppError(failure.code, failureResponseDetail(attempted.id, failure));
      }

      try {
        op = await this.deps.operationStore.transition(attempted.id, {
          to: "submitted",
          now: now + 4,
          expectedVersion: attempted.version,
          txHash,
        });
      } catch (cause) {
        throw this.submissionPersistenceFailure(attempted.id, cause);
      }
      return ok<BindData>({ operationId: op.id, state: op.state }, { operationId: op.id, state: op.state, version: op.version }, requestId);
    } catch (e) {
      return this.mapError(e, requestId);
    }
  }

  async revoke(req: AppCommandRequest<RevokePayload>): Promise<AppResponse<RevokeData>> {
    const requestId = req.headers.requestId ?? null;
    const correlationId = req.headers.correlationId ?? null;
    const idempotencyKey = req.headers.idempotencyKey;
    try {
      const now = nowOrThrow(this.deps.clock);
      assertValidAppSession(req.session, now);
      if (!idempotencyKey || idempotencyKey.trim().length === 0) throw new AppError(APP_ERROR_CODE.STALE_STATE_CONFLICT, "missing_idempotency_key");
      const prismId = assertValidPrismId(req.payload.prismId);
      const venue = assertSupportedVenue(req.payload.venue);
      const executionAccount = assertValidExecutionAccount(req.payload.executionAccount);
      const controllerAddress = normalizeStarknetAddress(req.payload.controllerAddress);

      const identity = await this.deps.registry.getIdentity(prismId);
      if (!identity) throw new AppError(APP_ERROR_CODE.IDENTITY_NOT_FOUND, `identity_not_found:${prismId}`);
      const identityController = normalizeStarknetAddress(identity.controller);
      if (!sameStarknetContractAddress(identityController, controllerAddress)) throw new AppError(APP_ERROR_CODE.NOT_CONTROLLER, `controller_mismatch`);
      const binding = await this.deps.registry.getBinding(prismId, venue, executionAccount);
      if (binding.status === null) throw new AppError(APP_ERROR_CODE.BINDING_NOT_FOUND, `binding_not_found:${prismId}:${venue}:${executionAccount}`);
      if (binding.status === "REVOKED") {
        // Idempotent benign — ERR-011 semantics (200-with-state), no operation needed.
        return ok<RevokeData>({ operationId: `noop-revoked-${prismId}`, state: "completed" as OperationState }, undefined, requestId);
      }

      const kind = "revoke_binding";
      const fingerprint = fingerprintFor({ prismId, venue, executionAccount, controllerAddress });
      const operationId = this.deps.idGenerator.generateOperationId();
      let op = await this.deps.operationStore.create({ id: operationId, kind, idempotencyKey, requestFingerprint: fingerprint, now, correlationId });
      if (op.id !== operationId) {
        return ok<RevokeData>({ operationId: op.id, state: op.state }, { operationId: op.id, state: op.state, version: op.version }, requestId);
      }
      op = await this.deps.operationStore.transition(op.id, { to: "awaiting_authorization", now: now + 1, expectedVersion: op.version });
      op = await this.deps.operationStore.transition(op.id, { to: "ready", now: now + 2, expectedVersion: op.version });
      let attempted: PersistedOperation;
      try {
        attempted = await this.markSubmissionAttempted(op, now);
      } catch (cause) {
        throw this.markerFailure(op.id, cause);
      }

      let txHash: Hex;
      try {
        const result = await this.deps.submitPort.submitRevoke({ operationId: attempted.id, prismId, venue, executionAccount, controllerAddress });
        if (!isValidTxHash(result?.txHash)) throw new AppError(APP_ERROR_CODE.TIMEOUT_UNKNOWN_STATUS, "submit_invalid_tx_hash");
        txHash = result.txHash;
      } catch (cause) {
        if (cause instanceof AppError && cause.code === APP_ERROR_CODE.TIMEOUT_UNKNOWN_STATUS) throw cause;
        const failure = submitFailure(cause);
        try {
          await this.deps.operationStore.transition(attempted.id, {
            to: failure.state,
            now: now + 4,
            expectedVersion: attempted.version,
            errorCode: failure.code,
            errorDetail: failure.detail,
          });
        } catch {}
        throw new AppError(failure.code, failureResponseDetail(attempted.id, failure));
      }

      try {
        op = await this.deps.operationStore.transition(attempted.id, {
          to: "submitted",
          now: now + 4,
          expectedVersion: attempted.version,
          txHash,
        });
      } catch (cause) {
        throw this.submissionPersistenceFailure(attempted.id, cause);
      }
      return ok<RevokeData>({ operationId: op.id, state: op.state }, { operationId: op.id, state: op.state, version: op.version }, requestId);
    } catch (e) {
      return this.mapError(e, requestId);
    }
  }

  // -------------------------------------------------------------------------
  // Queries — never infer canonical state from backend; always hit registry
  // -------------------------------------------------------------------------

  async getIdentity(req: { payload: GetIdentityQuery; headers?: { requestId?: string | null } }): Promise<AppResponse<GetIdentityData>> {
    const requestId = req.headers?.requestId ?? null;
    try {
      const prismId = assertValidPrismId(req.payload.prismId);
      const identity = await this.deps.registry.getIdentity(prismId);
      if (!identity) {
        return err({ code: APP_ERROR_CODE.IDENTITY_NOT_FOUND_READ, name: "identity_not_found_read", category: "not_found", retryable: "no", userAction: "n_a", httpStatusHint: 404, detail: `identity_not_found:${prismId}` }, requestId);
      }
      return ok<GetIdentityData>({ prismId, controller: identity.controller, exists: true, watermark: identity.createdAtBlock }, undefined, requestId, identity.createdAtBlock);
    } catch (e) {
      return this.mapError(e, requestId);
    }
  }

  async resolve(req: { payload: ResolveQuery; headers?: { requestId?: string | null } }): Promise<AppResponse<ResolveData>> {
    const requestId = req.headers?.requestId ?? null;
    try {
      const prismId = assertValidPrismId(req.payload.prismId);
      const venue = assertSupportedVenue(req.payload.venue);
      // Never infer from backend state — authoritative source is RegistryReadPort (INV-SYS-007).
      const identity = await this.deps.registry.getIdentity(prismId);
      if (!identity) {
        return err({ code: APP_ERROR_CODE.IDENTITY_NOT_FOUND_READ, name: "identity_not_found_read", category: "not_found", retryable: "no", userAction: "n_a", httpStatusHint: 404, detail: `identity_not_found:${prismId}` }, requestId);
      }
      const result = await this.deps.registry.resolve(prismId, venue);
      if (result.executionAccount !== null) normalizeStarknetAddress(result.executionAccount);
      const executionAccount = result.executionAccount;
      return ok<ResolveData>(
        { prismId, venue, executionAccount, exists: executionAccount !== null, watermark: result.watermark },
        undefined,
        requestId,
        result.watermark,
      );
    } catch (e) {
      return this.mapError(e, requestId);
    }
  }

  async getOperation(req: { payload: { operationId: string }; headers?: { requestId?: string | null } }): Promise<AppResponse<import("../features/prism-operations/domain/operation-store").PersistedOperation | null>> {
    const requestId = req.headers?.requestId ?? null;
    try {
      const op = await this.deps.operationStore.getById(req.payload.operationId);
      if (!op) return err({ code: APP_ERROR_CODE.IDENTITY_NOT_FOUND, name: "identity_not_found", category: "not_found", retryable: "no", userAction: "check_identifier", httpStatusHint: 404, detail: `unknown_operation:${req.payload.operationId}` }, requestId);
      return ok(op, { operationId: op.id, state: op.state, version: op.version }, requestId);
    } catch (e) {
      return this.mapError(e, requestId);
    }
  }

  // Retry only a durable, pre-submit failure with a concrete Starknet adapter.
  // Generic retries must not synthesize a tx hash or replay an operation whose
  // chain status is already unknown.
  async retryOperation(operationId: string, requestedNow: number): Promise<AppResponse<{ operationId: string; state: OperationState }>> {
    const requestId = null;
    try {
      const clockNow = nowOrThrow(this.deps.clock);
      const now = Number.isFinite(requestedNow) ? Math.floor(requestedNow) : clockNow;
      const op = await this.deps.operationStore.getById(operationId);
      if (!op) throw new AppError(APP_ERROR_CODE.IDENTITY_NOT_FOUND, `unknown_operation:${operationId}`);
      if (op.state !== "failed_retryable") {
        throw new AppError(APP_ERROR_CODE.STALE_STATE_CONFLICT, `retry_state_not_supported:${op.state}`);
      }
      // A retryable failure eligible for a fresh broadcast cannot already have a
      // chain hash. A hash means submission happened and reconciliation owns it.
      if (op.txHash !== null) {
        throw new AppError(APP_ERROR_CODE.STALE_STATE_CONFLICT, "retry_tx_hash_present");
      }
      const mode = this.deps.submitPortMode;
      if (mode === "TEST_DOUBLE_X2" || this.deps.isStarknetSubmitConfigured === false || !isConcreteStarknetSubmitAdapter(this.deps.submitPort)) {
        throw new AppError(APP_ERROR_CODE.RPC_UNAVAILABLE, "submit_unconfigured");
      }
      // A durable fence survives a failed_retryable classification. Such a row
      // may be reconciled, but it can never be automatically broadcast again.
      if (op.submissionAttempted) {
        throw new AppError(APP_ERROR_CODE.STALE_STATE_CONFLICT, "retry_submission_already_attempted");
      }
      const submission = parseRetrySubmission(op.kind, op.requestFingerprint);

      // Legacy operation rows may predate the proof-to-bind fence. A retry of
      // a bind must acquire that same durable claim before it can re-enter the
      // ready/submission path; never replay from the operation fingerprint
      // alone. A consumed or otherwise invalid proof is terminal for this
      // retry, while an unavailable store remains fail-closed and retryable.
      if (submission.kind === "bind_execution_identity") {
        const claimResult = await this.deps.challengeService.claimVerifiedProof({
          challengeId: submission.challengeId,
          proofDigest: submission.proofDigest,
          prismId: submission.prismId,
          venue: submission.venue,
          executionAccount: submission.executionAccount,
          chainId: submission.chainId,
          expiresAt: submission.expiresAt,
          now,
        });
        if (claimResult !== "claimed") {
          const claimCode = claimResult === "already_claimed"
            ? APP_ERROR_CODE.PROOF_DIGEST_ALREADY_CONSUMED
            : claimResult === "expired"
              ? APP_ERROR_CODE.PROOF_EXPIRED
              : claimResult === "unknown"
                ? APP_ERROR_CODE.RPC_UNAVAILABLE
                : APP_ERROR_CODE.ALTERED_MESSAGE;
          const claimDetail = `proof_bind_claim_${claimResult}:${submission.challengeId}`;
          if (claimCode !== APP_ERROR_CODE.RPC_UNAVAILABLE) {
            try {
              await this.deps.operationStore.transition(op.id, {
                to: "failed_terminal",
                now: now + 1,
                expectedVersion: op.version,
                errorCode: claimCode,
                errorDetail: claimDetail,
              });
            } catch {
              // A concurrent retry may have advanced the row; either way no
              // adapter call is permitted after a failed proof claim.
            }
          }
          throw new AppError(claimCode, claimDetail);
        }
      }

      // Move back to ready only for an unfenced, pre-submit failure, then fence
      // it again immediately before crossing into the adapter.
      const ready = await this.deps.operationStore.transition(op.id, { to: "ready", now: now + 1, expectedVersion: op.version });
      let attempted: PersistedOperation;
      try {
        attempted = await this.markSubmissionAttempted(ready, now + 1);
      } catch (cause) {
        throw this.markerFailure(ready.id, cause);
      }

      let submittedResult: { txHash: Hex };
      try {
        switch (submission.kind) {
          case "create_identity":
            submittedResult = await this.deps.submitPort.submitCreateIdentity({ operationId: attempted.id, controllerAddress: submission.controllerAddress });
            break;
          case "bind_execution_identity":
            submittedResult = await this.deps.submitPort.submitBind({ operationId: attempted.id, ...submission });
            break;
          case "revoke_binding":
            submittedResult = await this.deps.submitPort.submitRevoke({ operationId: attempted.id, ...submission });
            break;
        }
        if (!isValidTxHash(submittedResult?.txHash)) throw new AppError(APP_ERROR_CODE.TIMEOUT_UNKNOWN_STATUS, "submit_invalid_tx_hash");
      } catch (cause) {
        if (cause instanceof AppError && cause.code === APP_ERROR_CODE.TIMEOUT_UNKNOWN_STATUS) throw cause;
        const failure = submitFailure(cause);
        try {
          await this.deps.operationStore.transition(attempted.id, {
            to: failure.state,
            now: now + 3,
            expectedVersion: attempted.version,
            errorCode: failure.code,
            errorDetail: failure.detail,
          });
        } catch {
          // Preserve the original dependency failure; the durable fence remains
          // the no-duplicate boundary if the compensating CAS loses.
        }
        throw new AppError(failure.code, failureResponseDetail(attempted.id, failure));
      }

      let next: PersistedOperation;
      try {
        next = await this.deps.operationStore.transition(attempted.id, {
          to: "submitted",
          now: now + 3,
          expectedVersion: attempted.version,
          txHash: submittedResult.txHash,
        });
      } catch (cause) {
        throw this.submissionPersistenceFailure(attempted.id, cause);
      }
      return ok({ operationId: next.id, state: next.state }, { operationId: next.id, state: next.state, version: next.version }, requestId);
    } catch (e) {
      return this.mapError(e, requestId);
    }
  }

  // Direct version-guarded transition exposure for T12 stale-version tests.
  async transitionOperation(operationId: string, to: OperationState, expectedVersion: number, opts?: { txHash?: Hex; errorCode?: string }): Promise<AppResponse<{ operationId: string; state: OperationState }>> {
    const requestId = null;
    try {
      const now = nowOrThrow(this.deps.clock);
      const op = await this.deps.operationStore.transition(operationId, {
        to,
        now,
        expectedVersion,
        txHash: opts?.txHash,
        errorCode: opts?.errorCode,
      });
      return ok({ operationId: op.id, state: op.state }, { operationId: op.id, state: op.state, version: op.version }, requestId);
    } catch (e) {
      return this.mapError(e, requestId);
    }
  }

  private mapError(e: unknown, requestId: string | null): AppResponse<never> {
    // Preserve stable code if any error carries ERR-xxx, regardless of class identity.
    const maybeCode = (e as { code?: string })?.code;
    const maybeDetail = (e as { detail?: string })?.detail;
    if (typeof maybeCode === "string" && Object.values(APP_ERROR_CODE).includes(maybeCode as never)) {
      const app = new AppError(maybeCode as typeof APP_ERROR_CODE[keyof typeof APP_ERROR_CODE], maybeDetail ?? (e instanceof Error ? e.message : String(e)));
      // Keep original detail if it contains more info
      const detail = maybeDetail ?? (e instanceof Error ? e.message : String(e));
      // If original had distinct detail like altered_fields, keep it
      if (maybeDetail) app.detail !== undefined;
      return err({ code: app.code, name: app.name, category: app.category, retryable: app.retryable, userAction: app.userAction, httpStatusHint: app.httpStatusHint, ...(detail ? { detail } : {}) }, requestId);
    }
    if (e instanceof AppError) {
      return err({ code: e.code, name: e.name, category: e.category, retryable: e.retryable, userAction: e.userAction, httpStatusHint: e.httpStatusHint, ...(e.detail ? { detail: e.detail } : {}) }, requestId);
    }
    if (e instanceof PrismError) {
      const code = (e.code as string) in APP_ERROR_CODE ? (e.code as typeof APP_ERROR_CODE[keyof typeof APP_ERROR_CODE]) : APP_ERROR_CODE.STALE_STATE_CONFLICT;
      const app = new AppError(code as unknown as typeof APP_ERROR_CODE[keyof typeof APP_ERROR_CODE], e.detail);
      return err({ code: app.code, name: app.name, category: app.category, retryable: app.retryable, userAction: app.userAction, httpStatusHint: app.httpStatusHint, ...(app.detail ? { detail: app.detail } : {}) }, requestId);
    }
    if (e instanceof OperationError) {
      const code = (e.code as string) in APP_ERROR_CODE ? (e.code as typeof APP_ERROR_CODE[keyof typeof APP_ERROR_CODE]) : APP_ERROR_CODE.STALE_STATE_CONFLICT;
      const app = new AppError(code as unknown as typeof APP_ERROR_CODE[keyof typeof APP_ERROR_CODE], e.detail);
      return err({ code: app.code, name: app.name, category: app.category, retryable: app.retryable, userAction: app.userAction, httpStatusHint: app.httpStatusHint, ...(app.detail ? { detail: app.detail } : {}) }, requestId);
    }
    if (e instanceof Error && (e as unknown as { code?: string }).code && Object.values(APP_ERROR_CODE).includes((e as unknown as { code: string }).code as never)) {
      const code = (e as unknown as { code: string }).code as typeof APP_ERROR_CODE[keyof typeof APP_ERROR_CODE];
      const app = new AppError(code, e.message);
      return err({ code: app.code, name: app.name, category: app.category, retryable: app.retryable, userAction: app.userAction, httpStatusHint: app.httpStatusHint, detail: e.message }, requestId);
    }
    const msg = e instanceof Error ? e.message : String(e);
    if ((e as { code?: string })?.code === "ERR-013" || msg.includes("session_expired")) {
      const app = new AppError(APP_ERROR_CODE.PROOF_EXPIRED, msg);
      return err({ code: app.code, name: app.name, category: app.category, retryable: app.retryable, userAction: app.userAction, httpStatusHint: app.httpStatusHint, detail: msg }, requestId);
    }
    const app = new AppError(APP_ERROR_CODE.STALE_STATE_CONFLICT, msg);
    return err({ code: app.code, name: app.name, category: app.category, retryable: app.retryable, userAction: app.userAction, httpStatusHint: app.httpStatusHint, detail: msg }, requestId);
  }
}
