// Transport-neutral API adapter/handler contracts for issue/verify/bind/resolve/revoke/operation read.
// No HTTP framework imports. Each handler preserves stable ERR codes, idempotency,
// expectedVersion CAS, and submitted != completed (INV-SYS-005). Thin mapping over
// PrismApplicationService — the only effectful boundary is the injected service.

import type { PrismApplicationService } from "./prism-application";
import { err, ok } from "./schemas";
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
  ListPublicBindingsData,
  ListPublicBindingsQuery,
  ListOwnerPrivateBindingsData,
  ListOwnerPrivateBindingsPayload,
  AppErrorResponse,
} from "./schemas";
import type { PersistedOperation } from "../features/prism-operations/domain/operation-store";
import type { AppSession } from "./auth";
import { assertValidAppSession } from "./auth";
import type { Clock } from "../features/prism-identity/domain/ports";
import { BindingDisclosureError, BINDING_ERROR_CODE, type BindingOwnerActor } from "../features/prism-identity/domain/binding-disclosure";
import type { BindingDisclosureService } from "../features/prism-identity/application/binding-disclosure-service";

/** Handler is a pure async function over typed request envelope -> typed response. */
export type Handler<TPayload, TData> = (req: AppCommandRequest<TPayload>) => Promise<AppResponse<TData>>;
export type QueryHandler<TQuery, TData> = (req: { payload: TQuery; headers?: { requestId?: string | null } }) => Promise<AppResponse<TData>>;

function bindingErrorShape(cause: BindingDisclosureError): AppErrorResponse["error"] {
  const status = (() => {
    switch (cause.code) {
      case BINDING_ERROR_CODE.OWNER_AUTHORIZATION_REQUIRED:
        return 401;
      case BINDING_ERROR_CODE.OWNER_NOT_AUTHORIZED:
        return 403;
      case BINDING_ERROR_CODE.BINDING_NOT_FOUND:
        return 404;
      case BINDING_ERROR_CODE.INVALID_BINDING:
      case BINDING_ERROR_CODE.SELECTIVE_UNSUPPORTED:
      case BINDING_ERROR_CODE.LIFECYCLE_UNSUPPORTED:
        return 422;
      case BINDING_ERROR_CODE.BINDING_REVOKED:
      case BINDING_ERROR_CODE.NOT_PUBLIC:
      case BINDING_ERROR_CODE.NOT_PRIVATE:
      case BINDING_ERROR_CODE.PUBLIC_EXPOSURE_CONFIRMATION_REQUIRED:
      case BINDING_ERROR_CODE.STALE_BINDING_VERSION:
      case BINDING_ERROR_CODE.DUPLICATE_BINDING_ID:
        return 409;
      case BINDING_ERROR_CODE.OWNER_AUTHORIZATION_UNAVAILABLE:
      case BINDING_ERROR_CODE.BLOCKED_BY_KEY_MANAGEMENT:
      case BINDING_ERROR_CODE.STORE_UNAVAILABLE:
        return 503;
      default:
        return 503;
    }
  })();
  const category = status === 401 || status === 403 ? "authorization" : status === 503 ? "dependency" : status === 404 ? "not_found" : "validation";
  const retryable = status === 503 ? "true_backoff" : "no";
  const userAction = status === 503 ? "wait_retry" : status === 401 ? "authenticate_owner" : status === 403 ? "use_owner_authority" : "correct_input";
  return {
    code: cause.code,
    name: cause.code.toLowerCase(),
    category,
    retryable,
    userAction,
    httpStatusHint: status,
    ...(cause.detail ? { detail: cause.detail } : {}),
  };
}

function unavailableBindingService(requestId: string | null): AppResponse<never> {
  return err({
    code: BINDING_ERROR_CODE.STORE_UNAVAILABLE,
    name: "store_unavailable",
    category: "dependency",
    retryable: "true_backoff",
    userAction: "wait_retry",
    httpStatusHint: 503,
    detail: "binding_disclosure_service_unconfigured",
  }, requestId);
}

function ownerActorFromSession(session: AppSession): BindingOwnerActor {
  return {
    // The session user is an actor claim only. The injected owner-authorization
    // port remains authoritative and this function never infers ownership.
    actorId: session.userId,
    authorizationContext: { sessionId: session.sessionId, userId: session.userId },
  };
}

function mapOwnerHandlerFailure(cause: unknown, requestId: string | null): AppResponse<never> {
  if (cause instanceof AppError) return err(cause.toExternalShape(), requestId);
  const code = (cause as { code?: unknown } | null)?.code;
  if (typeof code === "string" && Object.values(APP_ERROR_CODE).includes(code as never)) {
    const appError = new AppError(code as typeof APP_ERROR_CODE[keyof typeof APP_ERROR_CODE], (cause as { detail?: string })?.detail ?? (cause as Error)?.message);
    return err(appError.toExternalShape(), requestId);
  }
  return unavailableBindingService(requestId);
}

/**
 * Wiring for all API handlers. Transport layer (HTTP/gRPC/queue) maps its own
 * wire format into these typed envelopes and maps AppResponse.error.httpStatusHint
 * to status codes — never fabricates chain truth.
 */
export interface PrismApiHandlersOptions {
  /** Factory-level runtime guard for identity/binding/revoke submissions. */
  readonly assertChainTouchingConfigured?: () => void;
  /** Optional durable disclosure service. Missing means the route fails closed. */
  readonly bindingDisclosureService?: BindingDisclosureService;
  /** Runtime clock used to validate owner-session freshness at this boundary. */
  readonly bindingDisclosureClock?: Clock;
}

export class PrismApiHandlers {
  private readonly assertChainTouchingConfigured?: () => void;
  private readonly bindingDisclosureService?: BindingDisclosureService;
  private readonly bindingDisclosureClock?: Clock;

  constructor(private readonly app: PrismApplicationService, options?: PrismApiHandlersOptions) {
    this.assertChainTouchingConfigured = options?.assertChainTouchingConfigured;
    this.bindingDisclosureService = options?.bindingDisclosureService;
    this.bindingDisclosureClock = options?.bindingDisclosureClock;
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

  async listPublicBindings(req: { payload: ListPublicBindingsQuery; headers?: { requestId?: string | null } }): Promise<AppResponse<ListPublicBindingsData>> {
    const requestId = req.headers?.requestId ?? null;
    const service = this.bindingDisclosureService;
    if (!service) return unavailableBindingService(requestId) as AppResponse<ListPublicBindingsData>;
    try {
      const data = await service.listPublicBindings(req.payload.prismId);
      return ok<ListPublicBindingsData>(data, undefined, requestId);
    } catch (cause) {
      if (cause instanceof BindingDisclosureError) return err(bindingErrorShape(cause), requestId) as AppResponse<ListPublicBindingsData>;
      return unavailableBindingService(requestId) as AppResponse<ListPublicBindingsData>;
    }
  }

  listOwnerPrivateBindings: Handler<ListOwnerPrivateBindingsPayload, ListOwnerPrivateBindingsData> = async (req) => {
    const requestId = req.headers.requestId ?? null;
    const service = this.bindingDisclosureService;
    if (!service) return unavailableBindingService(requestId) as AppResponse<ListOwnerPrivateBindingsData>;
    try {
      const now = this.bindingDisclosureClock?.now() ?? Math.floor(Date.now() / 1000);
      assertValidAppSession(req.session, now);
      const actor = ownerActorFromSession(req.session);
      const data = await service.listOwnerPrivateBindings(req.payload.prismId, actor);
      return ok<ListOwnerPrivateBindingsData>(data, undefined, requestId);
    } catch (cause) {
      if (cause instanceof BindingDisclosureError) return err(bindingErrorShape(cause), requestId) as AppResponse<ListOwnerPrivateBindingsData>;
      return mapOwnerHandlerFailure(cause, requestId) as AppResponse<ListOwnerPrivateBindingsData>;
    }
  };

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
    errors: ["ERR-001", "ERR-002", "ERR-004", "ERR-005", "ERR-007", "ERR-008", "ERR-012", "ERR-013", "ERR-021", "ERR-023"],
    idempotency: "verified challenge claim + digest single-use (INV-SYS-004)",
    notes: "controller-only; server-issued VERIFIED challenge fields must match exactly; submitted != completed",
  },
  {
    method: "GET",
    path: "/v1/identity/:prismId/bindings",
    handler: "listPublicBindings",
    systemOp: "QRY-8-02",
    errors: ["SELECTIVE_UNSUPPORTED", "LIFECYCLE_UNSUPPORTED", "STORE_UNAVAILABLE"],
    notes: "public audience only; ACTIVE PUBLIC rows; PRIVATE and SELECTIVE are never projected",
  },
  {
    method: "GET",
    path: "/v1/identity/:prismId/bindings/private",
    handler: "listOwnerPrivateBindings",
    systemOp: "QRY-8-03",
    errors: ["OWNER_AUTHORIZATION_REQUIRED", "OWNER_NOT_AUTHORIZED", "OWNER_AUTHORIZATION_UNAVAILABLE", "BLOCKED_BY_KEY_MANAGEMENT", "STORE_UNAVAILABLE"],
    notes: "owner-authorized private audience; no public fallback and no private read without proven protection",
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
