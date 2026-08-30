import { describe, expect, it, vi } from "vitest";
import { FixedWindowLimiter, assertAuditRetentionPolicy, assertStructuredAuditEvent, productionObservabilityConfig, trustedRateLimitIdentity } from "../production-ops";

describe("production operations boundaries", () => {
  it("uses verified principal and ignores caller-controlled identity headers", () => {
    expect(trustedRateLimitIdentity({ session: { userId: "user-7" }, remoteAddress: "10.0.0.1", headers: { "x-user-id": "attacker" } })).toEqual({ kind: "principal", value: "user-7" });
  });

  it("does not trust forwarded identity unless the deployment enables a trusted proxy", () => {
    const request = { remoteAddress: "10.0.0.1", headers: { "x-forwarded-for": "203.0.113.8" } };
    expect(trustedRateLimitIdentity(request)).toEqual({ kind: "network", value: "10.0.0.1" });
    expect(trustedRateLimitIdentity(request, true)).toEqual({ kind: "network", value: "203.0.113.8" });
    expect(trustedRateLimitIdentity({ ...request, headers: { "x-forwarded-for": "not-an-address" } }, true)).toEqual({ kind: "network", value: "unknown" });
  });

  it("shares deterministic limiter decisions and telemetry", () => {
    let clock = 1_000;
    const onDecision = vi.fn();
    const limiter = new FixedWindowLimiter(2, 1_000, new Map(), { onDecision }, () => clock);
    const identity = { kind: "network" as const, value: "10.0.0.1" };
    expect(limiter.consume(identity).remaining).toBe(1);
    expect(limiter.consume(identity).allowed).toBe(true);
    expect(limiter.consume(identity).allowed).toBe(false);
    expect(onDecision).toHaveBeenCalledTimes(3);
    clock = 2_000;
    expect(limiter.consume(identity).allowed).toBe(true);
  });

  it("enforces an explicit immutable audit retention contract", () => {
    expect(assertAuditRetentionPolicy({ retentionDays: 90, immutable: true, redactionVersion: "v1" })).toEqual({ retentionDays: 90, immutable: true, redactionVersion: "v1" });
    expect(() => assertAuditRetentionPolicy({ retentionDays: 0, immutable: true, redactionVersion: "v1" })).toThrow("invalid_audit_retention_days");
    expect(() => assertStructuredAuditEvent({ eventId: "bad", eventType: "auth", occurredAt: "now", actor: "u", outcome: "accepted" })).toThrow("invalid_audit_identity");
    expect(assertStructuredAuditEvent({ eventId: "evt-00000001", eventType: "auth.login", occurredAt: "2026-01-01T00:00:00Z", actor: "u", outcome: "accepted" }).outcome).toBe("accepted");
  });

  it("provides fail-closed naming and explicit observability hooks", () => {
    expect(productionObservabilityConfig({ PRISM_METRICS_ENABLED: "1", PRISM_TRACING_ENABLED: "true", PRISM_ALERTING_ENABLED: "0", PRISM_SERVICE_NAME: "api.v1" })).toEqual({ metricsEnabled: true, tracingEnabled: true, alertingEnabled: false, serviceName: "api.v1" });
    expect(() => productionObservabilityConfig({ PRISM_SERVICE_NAME: "bad name" })).toThrow("invalid_service_name");
  });
});
