import { createHash } from "node:crypto";
import type { AppSession } from "./auth";

/** The only identity permitted to key an authenticated rate-limit bucket. */
export interface TrustedRateLimitIdentity {
  readonly kind: "principal" | "network";
  readonly value: string;
}

export interface RateLimitRequest {
  readonly session?: Pick<AppSession, "userId"> | null;
  readonly remoteAddress?: string | null;
  readonly headers?: Headers | Record<string, string | undefined>;
}

function header(request: RateLimitRequest, name: string): string | null {
  const headers = request.headers;
  if (!headers) return null;
  if (headers instanceof Headers) return headers.get(name);
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key ? headers[key] ?? null : null;
}

function validAddress(value: string): boolean {
  // Keep the boundary deliberately conservative: malformed forwarded values are
  // rejected instead of becoming attacker-controlled bucket names.
  return /^(?:[0-9a-fA-F:]+|\d{1,3}(?:\.\d{1,3}){3})$/.test(value);
}

/** Derive a bucket key from verified auth, or the transport peer as a fallback. */
export function trustedRateLimitIdentity(request: RateLimitRequest, trustProxy = false): TrustedRateLimitIdentity {
  const principal = request.session?.userId?.trim();
  if (principal) return { kind: "principal", value: principal };

  let address = request.remoteAddress?.trim() ?? "";
  if (trustProxy) {
    const forwarded = header(request, "x-forwarded-for")?.split(",").map((v) => v.trim()).filter(Boolean) ?? [];
    // This hook is for deployments where the network layer has already verified
    // the peer is an approved proxy. Do not enable it for arbitrary clients.
    if (forwarded.length > 0) address = forwarded[0];
  }
  if (!validAddress(address)) return { kind: "network", value: "unknown" };
  return { kind: "network", value: address };
}

export interface LimiterStore { get(key: string): number | undefined; set(key: string, value: number): void; }
export interface RateLimitDecision { readonly allowed: boolean; readonly remaining: number; readonly resetAt: number; readonly key: string; }

export interface LimiterTelemetry {
  onDecision?(decision: RateLimitDecision): void;
}

export class FixedWindowLimiter {
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly store: LimiterStore = new Map<string, number>(),
    private readonly telemetry: LimiterTelemetry = {},
    private readonly now: () => number = () => Date.now(),
  ) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error("invalid_rate_limit");
    if (!Number.isInteger(windowMs) || windowMs < 1) throw new Error("invalid_rate_window");
  }

  consume(identity: TrustedRateLimitIdentity): RateLimitDecision {
    const now = this.now();
    const resetAt = Math.floor(now / this.windowMs) * this.windowMs + this.windowMs;
    const bucket = Math.floor(now / this.windowMs);
    const key = `${identity.kind}:${createHash("sha256").update(identity.value).digest("hex").slice(0, 32)}:${bucket}`;
    const used = this.store.get(key) ?? 0;
    const allowed = used < this.limit;
    if (allowed) this.store.set(key, used + 1);
    const decision = { allowed, remaining: Math.max(0, this.limit - used - (allowed ? 1 : 0)), resetAt, key };
    this.telemetry.onDecision?.(decision);
    return decision;
  }
}

export interface AuditEvent {
  readonly eventId: string;
  readonly eventType: string;
  readonly occurredAt: string;
  readonly actor: string;
  readonly requestId?: string;
  readonly outcome: "accepted" | "rejected" | "failed";
  readonly metadata?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface AuditRetentionPolicy { readonly retentionDays: number; readonly immutable: true; readonly redactionVersion: string; }

export function assertAuditRetentionPolicy(policy: AuditRetentionPolicy): AuditRetentionPolicy {
  if (!Number.isInteger(policy.retentionDays) || policy.retentionDays < 1 || policy.retentionDays > 3650) throw new Error("invalid_audit_retention_days");
  if (policy.immutable !== true || !/^[A-Za-z0-9._-]{1,32}$/.test(policy.redactionVersion)) throw new Error("invalid_audit_retention_contract");
  return policy;
}

export function assertStructuredAuditEvent(event: AuditEvent): AuditEvent {
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(event.eventId) || !/^[A-Za-z0-9._:-]{1,96}$/.test(event.eventType)) throw new Error("invalid_audit_identity");
  if (!event.actor || !event.occurredAt || !["accepted", "rejected", "failed"].includes(event.outcome)) throw new Error("invalid_audit_event");
  return event;
}

export interface ProductionObservabilityConfig {
  readonly metricsEnabled: boolean;
  readonly tracingEnabled: boolean;
  readonly alertingEnabled: boolean;
  readonly serviceName: string;
}

export function productionObservabilityConfig(env: Record<string, string | undefined> = process.env): ProductionObservabilityConfig {
  const flag = (name: string) => env[name] === "1" || env[name]?.toLowerCase() === "true";
  const serviceName = env.PRISM_SERVICE_NAME?.trim() || "prism-api";
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(serviceName)) throw new Error("invalid_service_name");
  return { metricsEnabled: flag("PRISM_METRICS_ENABLED"), tracingEnabled: flag("PRISM_TRACING_ENABLED"), alertingEnabled: flag("PRISM_ALERTING_ENABLED"), serviceName };
}
