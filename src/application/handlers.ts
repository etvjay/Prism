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
  AliasLookupData,
  AliasLookupQuery,
  ResolutionContinuityData,
  ResolutionContinuityQuery,
  Strk20ActionData,
  Strk20ActionPayload,
  GetStrk20ActionQuery,
  PrivacyReceiptData,
  GetPrivacyReceiptQuery,
  PortfolioData,
  PortfolioQuery,
} from "./schemas";
import type { PersistedOperation } from "../features/prism-operations/domain/operation-store";
import type { PrivacyReceiptApplicationPort, Strk20ActionApplicationPort } from "./ports";
import type { AppSession } from "./auth";
import { assertValidAppSession } from "./auth";
import type { Clock } from "../features/prism-identity/domain/ports";
import { BindingDisclosureError, BINDING_ERROR_CODE, type BindingOwnerActor } from "../features/prism-identity/domain/binding-disclosure";
import type { BindingDisclosureService } from "../features/prism-identity/application/binding-disclosure-service";
import { PrivacyActionService, type PrivacyActionRequest } from "../features/prism-strk20/application/privacy-action-service";
import { Strk20Error, STRK20_ERROR_CODE } from "../features/prism-strk20/domain/errors";
import { PrivacyReceiptService } from "./privacy-receipt-service";
import { parseStrk20ActionPayload, serializePrivacyActionView } from "./strk20-transport";
import { PortfolioAggregationError, PORTFOLIO_ERROR_CODE } from "../features/prism-portfolio/domain/errors";
import type { PortfolioAggregationPort } from "../features/prism-portfolio/domain/ports";

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

function portfolioErrorShape(cause: PortfolioAggregationError): AppErrorResponse["error"] {
  const validation = cause.code === PORTFOLIO_ERROR_CODE.INVALID_PRISM_ID;
  const status = validation ? 422 : 503;
  return {
    code: cause.code,
    name: cause.code.toLowerCase(),
    category: validation ? "validation" : "dependency",
    retryable: validation ? "no" : "true_backoff",
    userAction: validation ? "correct_input" : "wait_retry",
    httpStatusHint: status,
    ...(cause.detail ? { detail: cause.detail } : {}),
  };
}

function portfolioUnavailable(requestId: string | null): AppResponse<never> {
  return err({
    code: "PORTFOLIO_UNAVAILABLE",
    name: "portfolio_unavailable",
    category: "dependency",
    retryable: "true_backoff",
    userAction: "wait_retry",
    httpStatusHint: 503,
    detail: "portfolio_service_unconfigured",
  }, requestId);
}

function strk20Unavailable(requestId: string | null): AppResponse<never> {
  return err({
    code: STRK20_ERROR_CODE.UNSUPPORTED_WALLET_METHOD,
    name: "privacy_provider_unavailable",
    category: "dependency",
    retryable: "true_backoff",
    userAction: "connect_supported_wallet",
    httpStatusHint: 503,
    detail: "external_wallet_provider_required_x2",
  }, requestId);
}

function strk20NotFound(actionId: string, requestId: string | null): AppResponse<never> {
  return err({
    code: STRK20_ERROR_CODE.STALE_STATE,
    name: "action_not_found",
    category: "not_found",
    retryable: "no",
    userAction: "check_identifier",
    httpStatusHint: 404,
    detail: `action_not_found:${actionId}`,
  }, requestId);
}

function mapStrk20Failure(cause: unknown, requestId: string | null): AppResponse<never> {
  if (cause instanceof Strk20Error) {
    const shape = cause.toExternalShape();
    const rawDetail = typeof shape.detail === "string" ? shape.detail : null;
    const detail = rawDetail === null
      ? undefined
      : /private|viewing|seed|mnemonic|proof|calldata|raw|provider|secret|password|note/i.test(rawDetail)
        ? "provider_failure"
        : rawDetail.slice(0, 160);
    return err({
      ...shape,
      ...(detail === undefined ? {} : { detail }),
    }, requestId);
  }
  const code = (cause as { code?: unknown } | null)?.code;
  // M5 errors remain an explicit X2/provider blocker, but their detail is not
  // safe to echo because a provider may include hashes, calldata, or secrets.
  if (typeof code === "string" && /^M5-\d{3}$/.test(code)) {
    return err({
      code,
      name: "m5_blocked",
      category: "dependency",
      retryable: "true_backoff",
      userAction: "provide_external_wallet_and_receipt",
      httpStatusHint: 503,
      detail: "external_provider_blocked_x2",
    }, requestId);
  }
  return err({
    code: STRK20_ERROR_CODE.DEPENDENCY_FAILURE,
    name: "dependency_failure",
    category: "dependency",
    retryable: "true_backoff",
    userAction: "wait_retry",
    httpStatusHint: 503,
    detail: "provider_failure",
  }, requestId);
}

function decimalOrNull(value: string | null | undefined, field: string): bigint | null | undefined {
  if (value === undefined || value === null) return value;
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Strk20Error(STRK20_ERROR_CODE.INVALID_AMOUNT, `${field}_must_be_decimal_string`);
  try {
    return BigInt(value);
  } catch {
    throw new Strk20Error(STRK20_ERROR_CODE.INVALID_AMOUNT, `${field}_must_be_decimal_string`);
  }
}

function privacyActionRequest(payload: Strk20ActionPayload): PrivacyActionRequest {
  // Re-run the safe parser at the application seam for non-HTTP callers; it
  // rejects an accidentally widened payload before the provider port sees it.
  const safe = parseStrk20ActionPayload(payload);
  return {
    id: safe.actionId,
    prismId: safe.prismId ?? null,
    walletSessionRef: safe.walletSessionRef ?? null,
    kind: safe.kind,
    execution: safe.execution ?? (safe.kind === "application" ? "wallet_action" : "wallet_managed"),
    expectedChainId: safe.expectedChainId ?? null,
    quotedFee: decimalOrNull(safe.quotedFee, "quoted_fee"),
    requireConsent: safe.requireConsent,
    token: safe.token as `0x${string}` | undefined,
    amount: decimalOrNull(safe.amount, "amount") ?? undefined,
    recipient: safe.recipient as `0x${string}` | undefined,
    spender: safe.spender as `0x${string}` | undefined,
    consentTokens: safe.consentTokens as readonly `0x${string}`[] | undefined,
  };
}

function actionFingerprint(payload: Strk20ActionPayload, session: AppSession): string {
  // The parser returns fields in a fixed order and excludes the HTTP envelope;
  // include the authenticated subject so an idempotency key cannot cross users.
  return JSON.stringify({
    sessionId: session.sessionId,
    userId: session.userId,
    payload: { ...payload, operation: "create", idempotencyKey: undefined },
  });
}

function idempotencyConflict(requestId: string | null): AppResponse<never> {
  return err({
    code: STRK20_ERROR_CODE.STALE_STATE,
    name: "idempotency_key_conflict",
    category: "replay",
    retryable: "no",
    userAction: "use_new_idempotency_key",
    httpStatusHint: 409,
    detail: "idempotency_key_conflict",
  }, requestId);
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
  /** Optional injected Wallet API lifecycle; absent remains an explicit X2 blocker. */
  readonly privacyActionService?: PrivacyActionService | null;
  /** Optional derived privacy receipt projector; absent remains fail-closed. */
  readonly privacyReceiptService?: PrivacyReceiptService | null;
  /** Explicit connected-portfolio projector; missing means fail closed. */
  readonly portfolioService?: PortfolioAggregationPort | null;
}

export class PrismApiHandlers implements Strk20ActionApplicationPort, PrivacyReceiptApplicationPort {
  private readonly assertChainTouchingConfigured?: () => void;
  private readonly bindingDisclosureService?: BindingDisclosureService;
  private readonly bindingDisclosureClock?: Clock;
  private readonly privacyActionService?: PrivacyActionService | null;
  private readonly privacyReceiptService?: PrivacyReceiptService | null;
  private readonly portfolioService?: PortfolioAggregationPort | null;
  /** Process-local idempotency fences for the X2 privacy adapter. */
  private readonly strk20Idempotency = new Map<string, { fingerprint: string; actionId: string }>();
  private readonly strk20ActionFingerprints = new Map<string, string>();

  constructor(private readonly app: PrismApplicationService, options?: PrismApiHandlersOptions) {
    this.assertChainTouchingConfigured = options?.assertChainTouchingConfigured;
    this.bindingDisclosureService = options?.bindingDisclosureService;
    this.bindingDisclosureClock = options?.bindingDisclosureClock;
    this.privacyActionService = options?.privacyActionService;
    this.privacyReceiptService = options?.privacyReceiptService
      ?? (this.privacyActionService ? new PrivacyReceiptService(this.privacyActionService) : null);
    this.portfolioService = options?.portfolioService;
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

  /** GET /v1/aliases/:provider/:value — provider evidence + explicit association. */
  lookupAlias: QueryHandler<AliasLookupQuery, AliasLookupData> = (req) => this.app.lookupAlias(req);
  resolveAlias: QueryHandler<AliasLookupQuery, AliasLookupData> = (req) => this.app.resolveAlias(req);

  /** GET /v1/resolution/:identifier/continuity — scoped continuity assessment. */
  assessContinuity: QueryHandler<ResolutionContinuityQuery, ResolutionContinuityData> = (req) => this.app.assessContinuity(req);
  resolveContinuity: QueryHandler<ResolutionContinuityQuery, ResolutionContinuityData> = (req) => this.app.resolveContinuity(req);
  assessResolutionContinuity: QueryHandler<ResolutionContinuityQuery, ResolutionContinuityData> = (req) => this.app.assessResolutionContinuity(req);

  /** GET /v1/operations/:id — durably persisted operation read (SM-PRISM-003). */
  getOperation: QueryHandler<{ operationId: string }, PersistedOperation | null> = (req) =>
    this.app.getOperation(req);

  /** GET /v1/portfolio/:prismId — derived, explicit-source portfolio read. */
  async getPortfolio(req: { payload: PortfolioQuery; headers?: { requestId?: string | null } }): Promise<AppResponse<PortfolioData>> {
    const requestId = req.headers?.requestId ?? null;
    const service = this.portfolioService;
    if (!service) return portfolioUnavailable(requestId) as AppResponse<PortfolioData>;
    const read = service.aggregate ?? service.getPortfolio;
    if (!read) return portfolioUnavailable(requestId) as AppResponse<PortfolioData>;
    try {
      const data = await read.call(service, {
        prismId: req.payload.prismId,
        privacyWalletConsent: req.payload.privacyWalletConsent,
      });
      return ok<PortfolioData>(data, undefined, requestId);
    } catch (cause) {
      if (cause instanceof PortfolioAggregationError) return err(portfolioErrorShape(cause), requestId) as AppResponse<PortfolioData>;
      return portfolioUnavailable(requestId) as AppResponse<PortfolioData>;
    }
  }

  // --- Wallet-mediated STRK20 lifecycle / policy-filtered privacy receipt ---

  /**
   * POST /v1/strk20/actions. The operation selector lets a transport caller
   * advance one safe lifecycle step without ever sending raw calldata/proof.
   * `create` is side-effect free; provider submission only occurs for explicit
   * `submit` after the service's capability/fee/consent/proof gates pass.
   */
  async createStrk20Action(req: AppCommandRequest<Strk20ActionPayload>): Promise<AppResponse<Strk20ActionData>> {
    const requestId = req.headers.requestId ?? null;
    const service = this.privacyActionService;
    if (!service) return strk20Unavailable(requestId) as AppResponse<Strk20ActionData>;
    try {
      const payload = parseStrk20ActionPayload(req.payload);
      const internal = privacyActionRequest(payload);
      const operation = payload.operation ?? "create";
      const existing = service.getAction(payload.actionId);
      if (operation === "create") {
        const key = req.headers.idempotencyKey ?? payload.idempotencyKey ?? `action:${payload.actionId}`;
        const fingerprint = actionFingerprint(payload, req.session);
        const prior = this.strk20Idempotency.get(key);
        if (prior && (prior.fingerprint !== fingerprint || prior.actionId !== payload.actionId)) {
          return idempotencyConflict(requestId) as AppResponse<Strk20ActionData>;
        }
        const actionPrior = this.strk20ActionFingerprints.get(payload.actionId);
        if (actionPrior && actionPrior !== fingerprint) {
          return idempotencyConflict(requestId) as AppResponse<Strk20ActionData>;
        }
        // Action ids and idempotency keys are both replay fences. A repeated
        // create returns the existing local record and never calls a provider.
        const view = existing ?? service.create(internal);
        this.strk20Idempotency.set(key, { fingerprint, actionId: payload.actionId });
        this.strk20ActionFingerprints.set(payload.actionId, fingerprint);
        return ok<Strk20ActionData>(serializePrivacyActionView(view), undefined, requestId);
      }
      let view;
      if (operation === "prepare") {
        view = existing ? await service.prepare(payload.actionId) : await service.prepare(internal);
      } else if (operation === "submit") {
        if (!existing) return strk20NotFound(payload.actionId, requestId) as AppResponse<Strk20ActionData>;
        view = await service.submit(payload.actionId);
      } else {
        if (!existing) return strk20NotFound(payload.actionId, requestId) as AppResponse<Strk20ActionData>;
        view = await service.observeReceipt(payload.actionId);
      }
      return ok<Strk20ActionData>(serializePrivacyActionView(view), undefined, requestId);
    } catch (cause) {
      return mapStrk20Failure(cause, requestId) as AppResponse<Strk20ActionData>;
    }
  }

  getStrk20Action: QueryHandler<GetStrk20ActionQuery, Strk20ActionData> = async (req) => {
    const requestId = req.headers?.requestId ?? null;
    const service = this.privacyActionService;
    if (!service) return strk20Unavailable(requestId) as AppResponse<Strk20ActionData>;
    try {
      const view = service.getAction(req.payload.actionId);
      if (!view) return strk20NotFound(req.payload.actionId, requestId) as AppResponse<Strk20ActionData>;
      return ok<Strk20ActionData>(serializePrivacyActionView(view), undefined, requestId);
    } catch (cause) {
      return mapStrk20Failure(cause, requestId) as AppResponse<Strk20ActionData>;
    }
  };

  getPrivacyReceipt: QueryHandler<GetPrivacyReceiptQuery, PrivacyReceiptData> = async (req) => {
    const requestId = req.headers?.requestId ?? null;
    const service = this.privacyReceiptService;
    if (!service) return strk20Unavailable(requestId) as AppResponse<PrivacyReceiptData>;
    try {
      return await service.getReceipt(req.payload.receiptId, requestId);
    } catch (cause) {
      return mapStrk20Failure(cause, requestId) as AppResponse<PrivacyReceiptData>;
    }
  };

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
    path: "/v1/identity/:prismId/bindings/:bindingId/revoke",
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
    path: "/v1/aliases/:provider/:value",
    handler: "lookupAlias",
    systemOp: "QRY-ALIAS-01",
    errors: ["UNAVAILABLE", "BLOCKED_BY_INTERFACE_EVIDENCE", "INVALID_RESPONSE"],
    notes: "provider subject remains external; only explicit association evidence may expose a Prism ID",
  },
  {
    method: "GET",
    path: "/v1/resolution/:identifier/continuity",
    handler: "assessContinuity",
    systemOp: "QRY-RESOLUTION-CONTINUITY-01",
    errors: ["UNKNOWN", "SNAPSHOT_UNAVAILABLE", "NO_ACTIVE_DESTINATION"],
    notes: "canonical registry resolution plus scoped snapshot diff; risks never settle directly",
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

/** Additive STRK20/privacy contracts kept separate from the legacy M2 table. */
export const STRK20_API_CONTRACTS = [
  {
    method: "POST",
    path: "/v1/strk20/actions",
    handler: "createStrk20Action",
    systemOp: "STRK20-ACTION-LIFECYCLE",
    errors: ["STRK20-001", "STRK20-002", "STRK20-003", "STRK20-004", "STRK20-005", "STRK20-006", "STRK20-007", "STRK20-008", "STRK20-009", "STRK20-013", "STRK20-018", "STRK20-019", "STRK20-020", "STRK20-021"],
    idempotency: "actionId create fence; provider submission is poll-only after submissionAttempted",
    notes: "wallet-mediated only; raw proof/calldata/keys/notes/provider responses rejected; optional shadow-account readiness is metadata-only and never a route; submitted != completed",
  },
  {
    method: "GET",
    path: "/v1/strk20/actions/:actionId",
    handler: "getStrk20Action",
    systemOp: "STRK20-ACTION-LIFECYCLE",
    errors: ["STRK20-011", "STRK20-013", "STRK20-019"],
    notes: "JSON-safe lifecycle projection; fee BigInts are decimal strings and proof/call is status-only",
  },
  {
    method: "GET",
    path: "/v1/privacy/receipts/:receiptId",
    handler: "getPrivacyReceipt",
    systemOp: "STRK20-PRIVACY-RECEIPT-PROJECTION",
    errors: ["ERR-002", "STRK20-013", "STRK20-019"],
    notes: "derived policy-filtered projection; OBSERVED requires matching successful final receipt and pinned pool event",
  },
] as const;

/** Additive portfolio contract; public branches are source-bound and private
 * STRK20 data requires an explicit wallet-consent capability. */
export const PORTFOLIO_API_CONTRACTS = [
  {
    method: "GET",
    path: "/v1/portfolio/:prismId",
    handler: "getPortfolio",
    systemOp: "PORTFOLIO-DERIVED-READ",
    errors: ["PORTFOLIO_UNAVAILABLE", "PORTFOLIO_INVALID_PRISM_ID"],
    notes: "Base/Starknet require explicit binding resolution; STRK20 balances are queried only after privacy-wallet consent; totals require fresh injected valuation.",
  },
] as const;
