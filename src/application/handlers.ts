// Transport-neutral API adapter/handler contracts for issue/verify/bind/resolve/revoke/operation read.
// No HTTP framework imports. Each handler preserves stable ERR codes, idempotency,
// expectedVersion CAS, and submitted != completed (INV-SYS-005). Thin mapping over
// PrismApplicationService — the only effectful boundary is the injected service.

import type { PrismApplicationService } from "./prism-application";
import { err } from "./schemas";
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
import type { PersistedOperation } from "../features/prism-operations/domain/operation-store";
import type { AppSession } from "./auth";

/** Handler is a pure async function over typed request envelope -> typed response. */
export type Handler<TPayload, TData> = (req: AppCommandRequest<TPayload>) => Promise<AppResponse<TData>>;
export type QueryHandler<TQuery, TData> = (req: { payload: TQuery; headers?: { requestId?: string | null } }) => Promise<AppResponse<TData>>;

/**
 * Wiring for all API handlers. Transport layer (HTTP/gRPC/queue) maps its own
 * wire format into these typed envelopes and maps AppResponse.error.httpStatusHint
 * to status codes — never fabricates chain truth.
 */
export interface PrismApiHandlersOptions {
  /** Factory-level runtime guard for identity/binding/revoke submissions. */
  readonly assertChainTouchingConfigured?: () => void;
}

export class PrismApiHandlers {
  private readonly assertChainTouchingConfigured?: () => void;

  constructor(private readonly app: PrismApplicationService, options?: PrismApiHandlersOptions) {
    this.assertChainTouchingConfigured = options?.assertChainTouchingConfigured;
  }

  private async runChainTouching<T>(action: () => Promise<AppResponse<T>>): Promise<AppResponse<T>> {
    try {
      this.assertChainTouchingConfigured?.();
      return await action();
    } catch (cause) {
      const appError = cause instanceof AppError ? cause : new AppError(APP_ERROR_CODE.RPC_UNAVAILABLE, "submit_unconfigured");
      return err(appError.toExternalShape(), null);
    }
  }

  // --- Issue / Verify (CMD-B-01/B-02) ---

  issue: Handler<IssueChallengePayload, IssueChallengeData> = (req) => this.app.issueChallenge(req);

  verify: Handler<SubmitProofPayload, SubmitProofData> = (req) => this.app.submitProof(req);

  // --- Chain-touching commands: operation_id persisted BEFORE submission, submitted != completed ---

  /** POST /v1/identity — create Prism ID on Starknet (OP-7-01). */
  createIdentity: Handler<CreateIdentityPayload, CreateIdentityData> = (req) => this.runChainTouching(() => this.app.createIdentity(req));

  /** POST /v1/identity/:prism_id/bindings — bind Base account (OP-8-01). */
  bind: Handler<BindPayload, BindData> = (req) => this.runChainTouching(() => this.app.bind(req));

  /** POST /v1/identity/:prism_id/bindings/:id/revoke — revoke (OP-8-03). */
  revoke: Handler<RevokePayload, RevokeData> = (req) => this.runChainTouching(() => this.app.revoke(req));

  // --- Queries: never infer canonical state; watermarked resolve boundary honors staleness ---

  /** GET /v1/identity/:prism_id — canonical read (QRY-7-01). */
  getIdentity: QueryHandler<GetIdentityQuery, GetIdentityData> = (req) => this.app.getIdentity(req);

  /** GET /v1/resolve/:identifier?venue=BASE — watermarked resolve (QRY-8-01, INV-SYS-007). */
  resolve: QueryHandler<ResolveQuery, ResolveData> = (req) => this.app.resolve(req);

  /** GET /v1/operations/:id — durably persisted operation read (SM-PRISM-003). */
  getOperation: QueryHandler<{ operationId: string }, PersistedOperation | null> = (req) =>
    this.app.getOperation(req);

  /** Retry only pre-submit failed_retryable operations with an actual adapter. */
  retryOperation(operationId: string, now: number): Promise<AppResponse<{ operationId: string; state: string }>> {
    return this.app.retryOperation(operationId, now) as Promise<AppResponse<{ operationId: string; state: string }>>;
  }
}

/** Factory helper: creates handlers from service — transport layer injects only this. */
export function createPrismApiHandlers(app: PrismApplicationService, options?: PrismApiHandlersOptions): PrismApiHandlers {
  return new PrismApiHandlers(app, options);
}

/** API contract table for documentation/testing traceability (no runtime effect). */
export const API_CONTRACTS = [
  {
    method: "POST",
    path: "/v1/prism/challenge/issue",
    handler: "issue",
    systemOp: "CMD-B-01",
    errors: ["ERR-001", "ERR-005", "ERR-010", "ERR-023"],
    idempotency: "none — new nonce each call",
    notes: "session auth != execution authority (CON-PRISM-006)",
  },
  {
    method: "POST",
    path: "/v1/prism/challenge/verify",
    handler: "verify",
    systemOp: "CMD-B-02",
    errors: ["ERR-003", "ERR-006", "ERR-012", "ERR-013", "ERR-014"],
    idempotency: "nonce single-use (INV-SYS-010)",
    notes: "ladder EOA->1271->6492 (INV-SYS-009)",
  },
  {
    method: "POST",
    path: "/v1/identity",
    handler: "createIdentity",
    systemOp: "OP-7-01",
    errors: ["ERR-021", "ERR-023"],
    idempotency: "idempotencyKey + requestFingerprint",
    notes: "operation_id before submit; submitted != completed",
  },
  {
    method: "POST",
    path: "/v1/identity/:prismId/bindings",
    handler: "bind",
    systemOp: "OP-8-01",
    errors: ["ERR-001", "ERR-002", "ERR-004", "ERR-005", "ERR-007", "ERR-008", "ERR-023"],
    idempotency: "digest single-use (INV-SYS-004)",
    notes: "controller-only; proof not re-verified onchain",
  },
  {
    method: "POST",
    path: "/v1/identity/:prismId/bindings/revoke",
    handler: "revoke",
    systemOp: "OP-8-03",
    errors: ["ERR-002", "ERR-004", "ERR-009", "ERR-011"],
    idempotency: "revoke of REVOKED is benign (ERR-011)",
    notes: "parent identity survives (INV-SYS-006)",
  },
  {
    method: "GET",
    path: "/v1/identity/:prismId",
    handler: "getIdentity",
    systemOp: "QRY-7-01",
    errors: ["ERR-010"],
    notes: "canonical Starknet read, not cache",
  },
  {
    method: "GET",
    path: "/v1/resolve/:prismId",
    handler: "resolve",
    systemOp: "QRY-8-01",
    errors: ["ERR-010"],
    notes: "canonical preference + stale-cache refusal (INV-SYS-007)",
  },
  {
    method: "GET",
    path: "/v1/operations/:operationId",
    handler: "getOperation",
    systemOp: "SM-PRISM-003",
    errors: ["ERR-023"],
    notes: "durable operation row; submitted != completed",
  },
] as const;
