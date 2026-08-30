// Typed TypeScript SDK — domain-first vocabulary, no raw felt/calldata.
// All methods go through Prism REST API; no chain bypass exists.
// Idempotency / correlation / expected-version are explicit helpers, not hidden.

import type {
  PrismId,
  Venue,
  Hex,
  SdkResponse,
  IdentityData,
  ResolveData,
  OperationData,
  ReceiptData,
  IntentData,
  PauseData,
  PauseVerificationInput,
  PauseApprovalInput,
  PauseReleaseInput,
  AppSession,
  IntentPurpose,
  PublicBindingData,
  OwnerPrivateBindingData,
  PortfolioData,
  PortfolioPrivacyConsent,
} from "./types";

export interface PrismClientConfig {
  readonly baseUrl: string;
  readonly fetch?: typeof fetch;
  readonly defaultSession?: AppSession;
  readonly defaultHeaders?: Record<string, string>;
}

function buildHeaders(session: AppSession | undefined, opts: { idempotencyKey?: string | null; correlationId?: string | null; requestId?: string | null; expectedVersion?: number | null; extra?: Record<string, string> }): Headers {
  const h = new Headers({ "content-type": "application/json" });
  if (opts.requestId) h.set("x-request-id", opts.requestId);
  if (opts.correlationId) h.set("x-correlation-id", opts.correlationId);
  if (opts.idempotencyKey) h.set("idempotency-key", opts.idempotencyKey);
  if (opts.expectedVersion !== undefined && opts.expectedVersion !== null) h.set("if-match", `"${opts.expectedVersion}"`);
  if (session) {
    h.set("x-session-id", session.sessionId);
    h.set("x-session-user", session.userId);
    h.set("x-session-issued-at", String(session.issuedAt));
    if (session.expiresAt !== undefined && session.expiresAt !== null) h.set("x-session-expires-at", String(session.expiresAt));
  }
  if (opts.extra) for (const [k, v] of Object.entries(opts.extra)) h.set(k, v);
  return h;
}

async function parseSdkResponse<T>(res: Response): Promise<SdkResponse<T>> {
  const json = (await res.json().catch(() => ({ ok: false, error: { code: "ERR-023", name: "stale_state_conflict", category: "unknown", retryable: "no", userAction: "none", httpStatusHint: res.status } }))) as SdkResponse<T> & { headers?: unknown };
  // Do not expose raw stacks — SDK preserves stable catalogue shape only.
  const requestId = res.headers.get("x-request-id") ?? (json as { requestId?: string | null }).requestId ?? null;
  const watermarkHeader = res.headers.get("x-prism-watermark");
  const watermark = watermarkHeader ? Number(watermarkHeader) : (json as { watermark?: number | null }).watermark ?? null;
  const retryAfterRaw = res.headers.get("retry-after");
  const retryAfterSeconds = retryAfterRaw && Number.isFinite(Number(retryAfterRaw)) ? Number(retryAfterRaw) : null;
  const operation = (json as { operation?: { operationId: string; state: string; version: number } }).operation ?? null;
  if (!json.ok) {
    return { ok: false, error: (json as { error: SdkResponse<T>["error"] }).error, requestId, watermark: watermark as number | null, retryAfterSeconds };
  }
  return { ok: true, data: (json as { data: T }).data, requestId, operation: operation as never, watermark: watermark as number | null, retryAfterSeconds };
}

function randomId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}-${Date.now()}`;
}

export class PrismClient {
  private readonly baseUrl: string;
  private readonly doFetch: typeof fetch;
  private readonly defaultSession?: AppSession;
  private readonly defaultHeaders: Record<string, string>;

  constructor(config: PrismClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.doFetch = config.fetch ?? fetch;
    this.defaultSession = config.defaultSession;
    this.defaultHeaders = config.defaultHeaders ?? {};
  }

  private url(path: string): string {
    return `${this.baseUrl}${path}`;
  }

  // -------------------------------------------------------------------------
  // Utilities
  // -------------------------------------------------------------------------

  /** Version negotiation: server advertises version via header; client can pin. */
  async negotiateVersion(): Promise<{ serverVersion: string | null; supported: boolean }> {
    const res = await this.doFetch(this.url("/v1/identity/nonexistent-version-probe"), { method: "GET", headers: buildHeaders(this.defaultSession, {}) });
    const v = res.headers.get("x-prism-api-version") ?? res.headers.get("x-api-version") ?? null;
    return { serverVersion: v, supported: v === "1.0.0" || v === "v1" };
  }

  /** Operation polling helper — polls until terminal or requires_attention */
  async pollOperation(operationId: string, opts?: { intervalMs?: number; timeoutMs?: number }): Promise<SdkResponse<OperationData>> {
    const interval = opts?.intervalMs ?? 1000;
    const timeout = opts?.timeoutMs ?? 30_000;
    const start = Date.now();
    while (true) {
      const cur = await this.operations.get(operationId);
      if (!cur.ok) return cur;
      const state = cur.data!.state;
      if (["completed", "failed_terminal", "reverted", "expired", "cancelled", "requires_attention", "failed_retryable"].includes(state)) return cur;
      if (Date.now() - start > timeout) return cur;
      await new Promise((r) => setTimeout(r, interval));
    }
  }

  // -------------------------------------------------------------------------
  // Identities
  // -------------------------------------------------------------------------

  identities = {
    create: async (input: { controllerAddress: string; kind?: string; idempotencyKey?: string; correlationId?: string | null; requestId?: string | null; session?: AppSession }): Promise<SdkResponse<{ operationId: string; state: string }>> => {
      const session = input.session ?? this.defaultSession;
      if (!session) return { ok: false, error: { code: "ERR-023", name: "stale_state_conflict", category: "stale_state", retryable: "re_read", userAction: "refresh", httpStatusHint: 401, detail: "missing_app_session" } };
      const idempotencyKey = input.idempotencyKey ?? randomId("idem");
      const headers = buildHeaders(session, { idempotencyKey, correlationId: input.correlationId ?? null, requestId: input.requestId ?? null, extra: this.defaultHeaders });
      const res = await this.doFetch(this.url("/v1/identity"), { method: "POST", headers, body: JSON.stringify({ controllerAddress: input.controllerAddress, kind: input.kind, session, correlationId: input.correlationId ?? null }) });
      return parseSdkResponse(res);
    },

    get: async (prismId: PrismId, opts?: { requestId?: string | null }): Promise<SdkResponse<IdentityData>> => {
      const headers = buildHeaders(undefined, { requestId: opts?.requestId ?? null, extra: this.defaultHeaders });
      const res = await this.doFetch(this.url(`/v1/identity/${encodeURIComponent(prismId)}`), { method: "GET", headers });
      return parseSdkResponse(res);
    },

    resolve: async (prismId: PrismId, venue: Venue = "BASE", opts?: { requestId?: string | null }): Promise<SdkResponse<ResolveData>> => {
      const headers = buildHeaders(undefined, { requestId: opts?.requestId ?? null, extra: this.defaultHeaders });
      const res = await this.doFetch(this.url(`/v1/resolve/${encodeURIComponent(prismId)}?venue=${encodeURIComponent(venue)}`), { method: "GET", headers });
      return parseSdkResponse(res);
    },
  };

  portfolio = {
    /** Read source/freshness-bearing connected portfolio projection. */
    get: async (prismId: PrismId, opts?: {
      requestId?: string | null;
      privacyWalletConsent?: PortfolioPrivacyConsent;
      /** Opaque reference; never a viewing key, proof, or credential. */
      walletSessionRef?: string | null;
    }): Promise<SdkResponse<PortfolioData>> => {
      const extra: Record<string, string> = { ...this.defaultHeaders };
      if (opts?.privacyWalletConsent) extra["x-privacy-wallet-consent"] = opts.privacyWalletConsent;
      if (opts?.privacyWalletConsent === "granted" && opts.walletSessionRef) {
        extra["x-privacy-wallet-session-ref"] = opts.walletSessionRef;
      }
      const headers = buildHeaders(undefined, {
        requestId: opts?.requestId ?? null,
        extra,
      });
      const res = await this.doFetch(this.url(`/v1/portfolio/${encodeURIComponent(prismId)}`), {
        method: "GET",
        headers,
      });
      return parseSdkResponse(res);
    },
  };

  bindings = {
    listPublic: async (prismId: PrismId, opts?: { requestId?: string | null }): Promise<SdkResponse<readonly PublicBindingData[]>> => {
      const headers = buildHeaders(undefined, { requestId: opts?.requestId ?? null, extra: this.defaultHeaders });
      const res = await this.doFetch(this.url(`/v1/identity/${encodeURIComponent(prismId)}/bindings?audience=public`), {
        method: "GET",
        headers,
      });
      return parseSdkResponse(res);
    },

    listPrivate: async (prismId: PrismId, opts?: { requestId?: string | null; session?: AppSession }): Promise<SdkResponse<readonly OwnerPrivateBindingData[]>> => {
      const session = opts?.session ?? this.defaultSession;
      if (!session) return { ok: false, error: { code: "OWNER_AUTHORIZATION_REQUIRED", name: "owner_authorization_required", category: "authorization", retryable: "no", userAction: "authenticate_owner", httpStatusHint: 401, detail: "missing_app_session" } };
      const headers = buildHeaders(session, { requestId: opts?.requestId ?? null, extra: this.defaultHeaders });
      const res = await this.doFetch(this.url(`/v1/identity/${encodeURIComponent(prismId)}/bindings/private`), {
        method: "GET",
        headers,
      });
      return parseSdkResponse(res);
    },

    create: async (input: {
      prismId: PrismId;
      venue?: Venue;
      executionAccount: string;
      proofDigest: Hex;
      challengeId: Hex;
      chainId: number;
      expiresAt: number;
      controllerAddress: string;
      idempotencyKey?: string;
      correlationId?: string | null;
      requestId?: string | null;
      expectedVersion?: number | null;
      session?: AppSession;
    }): Promise<SdkResponse<{ operationId: string; state: string }>> => {
      const session = input.session ?? this.defaultSession;
      if (!session) return { ok: false, error: { code: "ERR-023", name: "stale_state_conflict", category: "stale_state", retryable: "re_read", userAction: "refresh", httpStatusHint: 401, detail: "missing_app_session" } };
      const idempotencyKey = input.idempotencyKey ?? randomId("idem");
      const headers = buildHeaders(session, { idempotencyKey, correlationId: input.correlationId ?? null, requestId: input.requestId ?? null, expectedVersion: input.expectedVersion ?? null, extra: this.defaultHeaders });
      const res = await this.doFetch(this.url(`/v1/identity/${encodeURIComponent(input.prismId)}/bindings`), {
        method: "POST",
        headers,
        body: JSON.stringify({
          venue: input.venue ?? "BASE",
          executionAccount: input.executionAccount,
          proofDigest: input.proofDigest,
          challengeId: input.challengeId,
          chainId: input.chainId,
          expiresAt: input.expiresAt,
          controllerAddress: input.controllerAddress,
          session,
          correlationId: input.correlationId ?? null,
        }),
      });
      return parseSdkResponse(res);
    },

    revoke: async (input: {
      prismId: PrismId;
      venue?: Venue;
      executionAccount: string;
      controllerAddress: string;
      idempotencyKey?: string;
      correlationId?: string | null;
      requestId?: string | null;
      session?: AppSession;
    }): Promise<SdkResponse<{ operationId: string; state: string }>> => {
      const session = input.session ?? this.defaultSession;
      if (!session) return { ok: false, error: { code: "ERR-023", name: "stale_state_conflict", category: "stale_state", retryable: "re_read", userAction: "refresh", httpStatusHint: 401, detail: "missing_app_session" } };
      const idempotencyKey = input.idempotencyKey ?? randomId("idem");
      const headers = buildHeaders(session, { idempotencyKey, correlationId: input.correlationId ?? null, requestId: input.requestId ?? null, extra: this.defaultHeaders });
      const bindingId = encodeURIComponent(input.executionAccount);
      const res = await this.doFetch(this.url(`/v1/identity/${encodeURIComponent(input.prismId)}/bindings/${bindingId}/revoke`), {
        method: "POST",
        headers,
        body: JSON.stringify({ venue: input.venue ?? "BASE", executionAccount: input.executionAccount, controllerAddress: input.controllerAddress, session }),
      });
      return parseSdkResponse(res);
    },
  };

  operations = {
    get: async (operationId: string, opts?: { requestId?: string | null }): Promise<SdkResponse<OperationData>> => {
      const headers = buildHeaders(undefined, { requestId: opts?.requestId ?? null, extra: this.defaultHeaders });
      const res = await this.doFetch(this.url(`/v1/operations/${encodeURIComponent(operationId)}`), { method: "GET", headers });
      return parseSdkResponse(res);
    },
  };

  receipts = {
    get: async (receiptId: string, opts?: { requestId?: string | null }): Promise<SdkResponse<ReceiptData>> => {
      const headers = buildHeaders(undefined, { requestId: opts?.requestId ?? null, extra: this.defaultHeaders });
      const res = await this.doFetch(this.url(`/v1/receipts/${encodeURIComponent(receiptId)}`), { method: "GET", headers });
      return parseSdkResponse(res);
    },
  };

  intents = {
    create: async (input: {
      prismId: PrismId;
      purpose?: IntentPurpose;
      venue?: string | null;
      executionAccount?: string | null;
      amount?: string | null;
      asset?: string | null;
      recipientPrismId?: string | null;
      recipientAddress?: string | null;
      idempotencyKey?: string;
      correlationId?: string | null;
      requestId?: string | null;
      session?: AppSession;
    }): Promise<SdkResponse<IntentData>> => {
      const session = input.session ?? this.defaultSession;
      if (!session) return { ok: false, error: { code: "ERR-023", name: "stale_state_conflict", category: "stale_state", retryable: "re_read", userAction: "refresh", httpStatusHint: 401, detail: "missing_app_session" } };
      const idempotencyKey = input.idempotencyKey ?? randomId("idem");
      const headers = buildHeaders(session, { idempotencyKey, correlationId: input.correlationId ?? null, requestId: input.requestId ?? null, extra: this.defaultHeaders });
      const res = await this.doFetch(this.url("/v1/intents"), {
        method: "POST",
        headers,
        body: JSON.stringify({ prismId: input.prismId, purpose: input.purpose ?? "payment", venue: input.venue ?? null, executionAccount: input.executionAccount ?? null, amount: input.amount ?? null, asset: input.asset ?? null, recipientPrismId: input.recipientPrismId ?? null, recipientAddress: input.recipientAddress ?? null, session, idempotencyKey, correlationId: input.correlationId ?? null }),
      });
      return parseSdkResponse(res);
    },

    pause: async (intentId: string, opts?: { correlationId?: string | null; requestId?: string | null; session?: AppSession }): Promise<SdkResponse<PauseData>> => {
      const session = opts?.session ?? this.defaultSession;
      if (!session) return { ok: false, error: { code: "ERR-023", name: "stale_state_conflict", category: "stale_state", retryable: "re_read", userAction: "refresh", httpStatusHint: 401, detail: "missing_app_session" } };
      const headers = buildHeaders(session, { correlationId: opts?.correlationId ?? null, requestId: opts?.requestId ?? null, extra: this.defaultHeaders });
      const res = await this.doFetch(this.url(`/v1/intents/${encodeURIComponent(intentId)}/pause`), { method: "POST", headers, body: JSON.stringify({ session }) });
      return parseSdkResponse(res);
    },
  };

  pauses = {
    get: async (pauseId: string, opts?: { requestId?: string | null }): Promise<SdkResponse<PauseData>> => {
      const headers = buildHeaders(undefined, { requestId: opts?.requestId ?? null, extra: this.defaultHeaders });
      const res = await this.doFetch(this.url(`/v1/pauses/${encodeURIComponent(pauseId)}`), { method: "GET", headers });
      return parseSdkResponse(res);
    },
    verify: async (pauseId: string, opts: PauseVerificationInput & { requestId?: string | null; session?: AppSession }): Promise<SdkResponse<PauseData>> => {
      const session = opts?.session ?? this.defaultSession;
      if (!session) return { ok: false, error: { code: "ERR-023", name: "stale_state_conflict", category: "stale_state", retryable: "re_read", userAction: "refresh", httpStatusHint: 401, detail: "missing_app_session" } };
      const headers = buildHeaders(session, { requestId: opts?.requestId ?? null, extra: this.defaultHeaders });
      const res = await this.doFetch(this.url(`/v1/pauses/${encodeURIComponent(pauseId)}/verify`), { method: "POST", headers, body: JSON.stringify({ session, planHash: opts.planHash, ...(opts.policyVersion ? { policyVersion: opts.policyVersion } : {}) }) });
      return parseSdkResponse(res);
    },
    release: async (pauseId: string, opts: PauseReleaseInput & { requestId?: string | null; session?: AppSession }): Promise<SdkResponse<PauseData>> => {
      const session = opts?.session ?? this.defaultSession;
      if (!session) return { ok: false, error: { code: "ERR-023", name: "stale_state_conflict", category: "stale_state", retryable: "re_read", userAction: "refresh", httpStatusHint: 401, detail: "missing_app_session" } };
      const headers = buildHeaders(session, { requestId: opts?.requestId ?? null, expectedVersion: opts?.expectedVersion ?? null, extra: this.defaultHeaders });
      const res = await this.doFetch(this.url(`/v1/pauses/${encodeURIComponent(pauseId)}/release`), { method: "POST", headers, body: JSON.stringify({ session, planHash: opts.planHash, approvalScopeHash: opts.approvalScopeHash, settlementOperationId: opts.settlementOperationId, expectedVersion: opts.expectedVersion ?? null }) });
      return parseSdkResponse(res);
    },
    cancel: async (pauseId: string, opts?: { expectedVersion?: number | null; requestId?: string | null; session?: AppSession }): Promise<SdkResponse<PauseData>> => {
      const session = opts?.session ?? this.defaultSession;
      if (!session) return { ok: false, error: { code: "ERR-023", name: "stale_state_conflict", category: "stale_state", retryable: "re_read", userAction: "refresh", httpStatusHint: 401, detail: "missing_app_session" } };
      const headers = buildHeaders(session, { requestId: opts?.requestId ?? null, expectedVersion: opts?.expectedVersion ?? null, extra: this.defaultHeaders });
      const res = await this.doFetch(this.url(`/v1/pauses/${encodeURIComponent(pauseId)}/cancel`), { method: "POST", headers, body: JSON.stringify({ session, expectedVersion: opts?.expectedVersion ?? null }) });
      return parseSdkResponse(res);
    },
    escalate: async (pauseId: string, opts?: { requestId?: string | null; session?: AppSession }): Promise<SdkResponse<PauseData>> => {
      const session = opts?.session ?? this.defaultSession;
      if (!session) return { ok: false, error: { code: "ERR-023", name: "stale_state_conflict", category: "stale_state", retryable: "re_read", userAction: "refresh", httpStatusHint: 401, detail: "missing_app_session" } };
      const headers = buildHeaders(session, { requestId: opts?.requestId ?? null, extra: this.defaultHeaders });
      const res = await this.doFetch(this.url(`/v1/pauses/${encodeURIComponent(pauseId)}/escalate`), { method: "POST", headers, body: JSON.stringify({ session }) });
      return parseSdkResponse(res);
    },
    approve: async (pauseId: string, opts: PauseApprovalInput & { requestId?: string | null; session?: AppSession }): Promise<SdkResponse<PauseData>> => {
      const session = opts?.session ?? this.defaultSession;
      if (!session) return { ok: false, error: { code: "ERR-023", name: "stale_state_conflict", category: "stale_state", retryable: "re_read", userAction: "refresh", httpStatusHint: 401, detail: "missing_app_session" } };
      const headers = buildHeaders(session, { requestId: opts?.requestId ?? null, extra: this.defaultHeaders });
      const res = await this.doFetch(this.url(`/v1/pauses/${encodeURIComponent(pauseId)}/approve`), { method: "POST", headers, body: JSON.stringify({ session, planHash: opts.planHash, approvalScopeHash: opts.approvalScopeHash, approver: opts.approver ?? null }) });
      return parseSdkResponse(res);
    },
  };
}

export function createPrismClient(config: PrismClientConfig): PrismClient {
  return new PrismClient(config);
}
