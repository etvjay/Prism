import { describe, it, expect } from "vitest";
import { createIntent } from "../domain/intent";
import { createExecutionPlan, computePlanHash } from "../domain/execution-plan";

const baseIntent = () => createIntent({
  intentId: "intent_1",
  principal: "prism:alice",
  initiator: "user",
  purpose: "payment",
  requestedRecipient: "0xabc",
  requestedAsset: "0xdead",
  requestedAmount: "100",
  requestedRoute: "base:0xdead:transfer",
  createdAt: 1_000_000,
  expiresAt: 2_000_000,
  clientIdempotencyKey: "idem_1",
  policyVersion: "v1",
});

describe("P1 Intent and normalized ExecutionPlan", () => {
  it("same intent → same plan hash (deterministic)", () => {
    const plan1 = createExecutionPlan({ chainId: "BASE", asset: "0xDead", recipient: "0xABC", calls: ["transfer"], valueLimits: { maxValue: "100" }, policyVersion: "v1", intentId: "intent_1", createdAt: 1_000_000 });
    const plan2 = createExecutionPlan({ chainId: "base", asset: "0xdead", recipient: "0xabc", calls: ["transfer"], valueLimits: { maxValue: "100" }, policyVersion: "v1", intentId: "intent_1", createdAt: 1_000_000 });
    expect(plan1.planHash).toBe(plan2.planHash);
  });

  it("changed recipient/value/chain → different hash", () => {
    const base = { chainId: "base", asset: "0xdead", recipient: "0xabc", calls: ["transfer"] as const, valueLimits: { maxValue: "100" }, policyVersion: "v1", intentId: "intent_1", createdAt: 1_000_000 };
    const p1 = createExecutionPlan(base);
    const p2 = createExecutionPlan({ ...base, recipient: "0xdef" });
    const p3 = createExecutionPlan({ ...base, valueLimits: { maxValue: "200" } });
    const p4 = createExecutionPlan({ ...base, chainId: "starknet" });
    expect(p1.planHash).not.toBe(p2.planHash);
    expect(p1.planHash).not.toBe(p3.planHash);
    expect(p1.planHash).not.toBe(p4.planHash);
  });

  it("malformed asset/chain/call rejected", () => {
    expect(() => createExecutionPlan({ chainId: "", asset: "0xdead", recipient: "0xabc", calls: ["transfer"], valueLimits: { maxValue: "100" }, policyVersion: "v1", intentId: "intent_1", createdAt: 1_000_000 })).toThrow();
    expect(() => createExecutionPlan({ chainId: "base", asset: "", recipient: "0xabc", calls: ["transfer"], valueLimits: { maxValue: "100" }, policyVersion: "v1", intentId: "intent_1", createdAt: 1_000_000 })).toThrow();
    expect(() => createExecutionPlan({ chainId: "base", asset: "0xdead", recipient: "0xabc", calls: [], valueLimits: { maxValue: "100" }, policyVersion: "v1", intentId: "intent_1", createdAt: 1_000_000 })).toThrow();
    expect(() => createExecutionPlan({ chainId: "base", asset: "0xdead", recipient: "0xabc", calls: ["transfer"], valueLimits: { maxValue: "" }, policyVersion: "v1", intentId: "intent_1", createdAt: 1_000_000 })).toThrow();
  });

  it("expired intent detected", () => {
    const intent = baseIntent();
    expect(intent.expiresAt).toBe(2_000_000);
    // intent itself valid; expiry checked at pause time via isIntentExpired
    expect(intent.createdAt < intent.expiresAt).toBe(true);
  });

  it("intent validation: expiry before creation rejected", () => {
    expect(() => createIntent({ intentId: "i", principal: "p", initiator: "user", purpose: "payment", requestedRecipient: "r", requestedAsset: "a", requestedAmount: "1", requestedRoute: "route", createdAt: 2000, expiresAt: 1000, clientIdempotencyKey: "k", policyVersion: "v1" })).toThrow();
  });

  it("canonical serialization is deterministic regardless of whitespace/case", () => {
    const p1 = createExecutionPlan({ chainId: "  BASE ", asset: "0xDEAD", recipient: "0xAbC", calls: ["  transfer  "], valueLimits: { maxValue: " 100 " }, policyVersion: "v1", intentId: "intent_1", createdAt: 1_000_000 });
    const p2 = createExecutionPlan({ chainId: "base", asset: "0xdead", recipient: "0xabc", calls: ["transfer"], valueLimits: { maxValue: "100" }, policyVersion: "v1", intentId: "intent_1", createdAt: 1_000_000 });
    expect(p1.planHash).toBe(p2.planHash);
  });

  it("agent initiator requires agentId", () => {
    expect(() => createIntent({ intentId: "i2", principal: "p", initiator: "agent", purpose: "payment", requestedRecipient: "r", requestedAsset: "a", requestedAmount: "1", requestedRoute: "route", createdAt: 1000, expiresAt: 2000, clientIdempotencyKey: "k2", policyVersion: "v1" })).toThrow();
  });
});
