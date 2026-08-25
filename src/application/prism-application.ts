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
import { isConcreteStarknetSubmitAdapter, type IdGenerator, type RegistryReadPort, type StarknetSubmitPort } from "./ports";
import type { OperationStore } from "../features/prism-operations/domain/operation-store";
import type { Hex, OperationState } from "../features/prism-operations/domain/operation";
import type { Clock } from "../features/prism-identity/domain/ports";
import { PrismChallengeService } from "../features/prism-identity/application/challenge-service";
import { assertValidPrismId, assertSupportedVenue, assertValidExecutionAccount } from "../features/prism-identity/domain/identifiers";
import { toFieldBoundedDigest } from "../features/prism-identity/domain/felt-digest";
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
  | { kind: "bind_execution_identity"; prismId: string; venue: string; executionAccount: string; proofDigest: Hex; controllerAddress: string }
  | { kind: "revoke_binding"; prismId: string; venue: string; executionAccount: string; controllerAddress: string };

function parseRetrySubmission(operationKind: string, requestFingerprint: string): RetrySubmission {
  try {
    const value = JSON.parse(requestFingerprint) as Record<string, unknown>;
    const kind = typeof value.kind === "string" ? value.kind : operationKind;
    if (kind === "create_identity" && typeof value.controllerAddress === "string") {
      return { kind, controllerAddress: normalizeStarknetAddress(value.controllerAddress) };
    }
    if (kind === "bind_execution_identity" && typeof value.prismId === "string" && typeof value.venue === "string" && typeof value.executionAccount === "string" && typeof value.proofDigest === "string" && typeof value.controllerAddress === "string") {
      const proofDigest = value.proofDigest;
      if (!/^0x[0-9a-fA-F]{64}$/.test(proofDigest)) throw new Error("malformed_proof_digest");
      return {
        kind,
        prismId: assertValidPrismId(value.prismId),
        venue: assertSupportedVenue(value.venue),
        executionAccount: assertValidExecutionAccount(value.executionAccount),
        proofDigest: proofDigest as Hex,
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

function errorCodeFrom(cause: unknown): typeof APP_ERROR_CODE[keyof typeof APP_ERROR_CODE] {
  const maybeCode = (cause as { code?: string })?.code;
  if (typeof maybeCode === "string" && Object.values(APP_ERROR_CODE).includes(maybeCode as never)) {
    return maybeCode as typeof APP_ERROR_CODE[keyof typeof APP_ERROR_CODE];
  }
  return APP_ERROR_CODE.RPC_UNAVAILABLE;
}

function errorDetailFrom(cause: unknown): string {
  return (cause as { detail?: string })?.detail ?? (cause as Error)?.message ?? "submit_failed";
}

export class PrismApplicationService {
  constructor(private readonly deps: PrismApplicationDeps) {
    if (deps.registryVersion !== "v1" && deps.registryVersion !== "v2") {
      throw new Error("invariant_violation: registryVersion must be explicitly v1 or v2");
    }
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

      // 3) Attempt chain submission — fail-closed on dependency.
      try {
        const { txHash } = await this.deps.submitPort.submitCreateIdentity({ operationId: op.id, controllerAddress });
        op = await this.deps.operationStore.transition(op.id, { to: "submitted", now: now + 3, expectedVersion: op.version, txHash });
        return ok<CreateIdentityData>({ operationId: op.id, state: op.state }, { operationId: op.id, state: op.state, version: op.version }, requestId);
      } catch (cause) {
        // Map submit failure to dependency error without inventing completion.
        const detail = (cause as { code?: string })?.code ?? (cause as Error)?.message ?? "submit_failed";
        // Transition to failed_retryable (requires errorCode)
        try {
          op = await this.deps.operationStore.transition(op.id, { to: "failed_retryable", now: now + 3, expectedVersion: op.version, errorCode: APP_ERROR_CODE.RPC_UNAVAILABLE, errorDetail: detail });
        } catch {}
        throw new AppError(APP_ERROR_CODE.RPC_UNAVAILABLE, `dependency_failure:op_${op.id}:${detail}`);
      }
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
      const proofDigest = req.payload.proofDigest;
      if (!proofDigest || !/^0x[0-9a-fA-F]{64}$/.test(proofDigest)) throw new AppError(APP_ERROR_CODE.STALE_STATE_CONFLICT, "malformed_proof_digest");

      // Execution-authority checks separate from session auth:
      // - identity must exist (ERR-002)
      const identity = await this.deps.registry.getIdentity(prismId);
      if (!identity) throw new AppError(APP_ERROR_CODE.IDENTITY_NOT_FOUND, `identity_not_found:${prismId}`);
      // - controller must match (ERR-004) — never infer from session.
      const identityController = normalizeStarknetAddress(identity.controller);
      if (!sameStarknetContractAddress(identityController, controllerAddress)) throw new AppError(APP_ERROR_CODE.NOT_CONTROLLER, `controller_mismatch:expected_${identityController}_got_${controllerAddress}`);
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

      const kind = "bind_execution_identity";
      const fingerprint = fingerprintFor({ prismId, venue, executionAccount, proofDigest, controllerAddress });
      const operationId = this.deps.idGenerator.generateOperationId();

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

      try {
        const { txHash } = await this.deps.submitPort.submitBind({
          operationId: op.id,
          prismId,
          venue,
          executionAccount,
          proofDigest: proofDigest as Hex,
          controllerAddress,
        });
        op = await this.deps.operationStore.transition(op.id, { to: "submitted", now: now + 3, expectedVersion: op.version, txHash });
        return ok<BindData>({ operationId: op.id, state: op.state }, { operationId: op.id, state: op.state, version: op.version }, requestId);
      } catch (cause) {
        const maybeCode = (cause as { code?: string })?.code;
        if (maybeCode && [APP_ERROR_CODE.NOT_CONTROLLER, APP_ERROR_CODE.PROOF_DIGEST_ALREADY_CONSUMED, APP_ERROR_CODE.BINDING_ALREADY_ACTIVE, APP_ERROR_CODE.IDENTITY_NOT_FOUND].includes(maybeCode as never)) {
          // Map registry revert codes to stable catalogue.
          try {
            await this.deps.operationStore.transition(op.id, { to: "failed_terminal", now: now + 3, expectedVersion: op.version, errorCode: maybeCode, errorDetail: String((cause as Error).message) });
          } catch {}
          throw new AppError(maybeCode as typeof APP_ERROR_CODE[keyof typeof APP_ERROR_CODE], String((cause as Error).message));
        }
        const detail = maybeCode ?? (cause as Error)?.message ?? "submit_failed";
        try {
          op = await this.deps.operationStore.transition(op.id, { to: "failed_retryable", now: now + 3, expectedVersion: op.version, errorCode: APP_ERROR_CODE.RPC_UNAVAILABLE, errorDetail: detail });
        } catch {}
        throw new AppError(APP_ERROR_CODE.RPC_UNAVAILABLE, `dependency_failure:op_${op.id}:${detail}`);
      }
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
      try {
        const { txHash } = await this.deps.submitPort.submitRevoke({ operationId: op.id, prismId, venue, executionAccount, controllerAddress });
        op = await this.deps.operationStore.transition(op.id, { to: "submitted", now: now + 3, expectedVersion: op.version, txHash });
        return ok<RevokeData>({ operationId: op.id, state: op.state }, { operationId: op.id, state: op.state, version: op.version }, requestId);
      } catch (cause) {
        const maybeCode = (cause as { code?: string })?.code;
        if (maybeCode && [APP_ERROR_CODE.NOT_CONTROLLER].includes(maybeCode as never)) {
          try { await this.deps.operationStore.transition(op.id, { to: "failed_terminal", now: now + 3, expectedVersion: op.version, errorCode: maybeCode, errorDetail: String((cause as Error).message) }); } catch {}
          throw new AppError(maybeCode as typeof APP_ERROR_CODE[keyof typeof APP_ERROR_CODE], String((cause as Error).message));
        }
        const detail = maybeCode ?? (cause as Error)?.message ?? "submit_failed";
        try { op = await this.deps.operationStore.transition(op.id, { to: "failed_retryable", now: now + 3, expectedVersion: op.version, errorCode: APP_ERROR_CODE.RPC_UNAVAILABLE, errorDetail: detail }); } catch {}
        throw new AppError(APP_ERROR_CODE.RPC_UNAVAILABLE, `dependency_failure:op_${op.id}:${detail}`);
      }
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
      const submission = parseRetrySubmission(op.kind, op.requestFingerprint);

      // The ready state is persisted before the adapter is called. If the
      // adapter fails, the operation is moved back to failed_retryable; it is
      // never promoted to submitted without its returned, validated hash.
      const ready = await this.deps.operationStore.transition(op.id, { to: "ready", now: now + 1, expectedVersion: op.version });
      let submittedResult: { txHash: Hex };
      try {
        switch (submission.kind) {
          case "create_identity":
            submittedResult = await this.deps.submitPort.submitCreateIdentity({ operationId: op.id, controllerAddress: submission.controllerAddress });
            break;
          case "bind_execution_identity":
            submittedResult = await this.deps.submitPort.submitBind({ operationId: op.id, ...submission });
            break;
          case "revoke_binding":
            submittedResult = await this.deps.submitPort.submitRevoke({ operationId: op.id, ...submission });
            break;
        }
      } catch (cause) {
        const code = errorCodeFrom(cause);
        const detail = errorDetailFrom(cause);
        try {
          await this.deps.operationStore.transition(op.id, { to: "failed_retryable", now: now + 2, expectedVersion: ready.version, errorCode: code, errorDetail: detail });
        } catch {
          // Preserve the original dependency failure; a concurrent worker can
          // reconcile the row if the compensating CAS loses.
        }
        throw new AppError(code, `dependency_failure:op_${op.id}:${detail}`);
      }

      if (!isValidTxHash(submittedResult?.txHash)) {
        const detail = "submit_invalid_tx_hash";
        try {
          await this.deps.operationStore.transition(op.id, { to: "failed_retryable", now: now + 2, expectedVersion: ready.version, errorCode: APP_ERROR_CODE.RPC_UNAVAILABLE, errorDetail: detail });
        } catch {
          // Best effort only; do not fabricate a submitted state.
        }
        throw new AppError(APP_ERROR_CODE.RPC_UNAVAILABLE, detail);
      }

      const next = await this.deps.operationStore.transition(op.id, {
        to: "submitted",
        now: now + 2,
        expectedVersion: ready.version,
        txHash: submittedResult.txHash,
      });
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
