// Decisive-sequence harness test — offline, TEST DOUBLE, X2 ceiling.
// No live RPC, no secrets, no strk20.json writes.

import { describe, it, expect } from "vitest";
import { runDecisiveFixture } from "../decisive-sequence-harness";
import { HARNESS_LABEL } from "../decisive-sequence-harness";

describe("decisive-sequence harness — offline fixture (TEST DOUBLE)", () => {
  it("create → read → Base proof → controller bind → resolve → revoke → NO_ACTIVE → P persists (X2, not promotable)", async () => {
    const result = await runDecisiveFixture({
      controllerAddress: "0x1111111111111111111111111111111111111111",
      baseExecutionAccount: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    expect(result.label).toContain("TEST DOUBLE");
    expect(result.environment).toBe("SN_SEPOLIA");
    expect(result.chainId).toBe(84532);
    expect(result.finalResolve).toBeNull();
    expect(result.prismIdPersists).toBe(true);
    expect(result.maturity).toBe("X2");
    expect(result.promotable).toBe(false);
    expect(result.blockers.join(" ")).toMatch(/TEST DOUBLE|independent_verification/);
    // Invariant checks mirrored from procedure
    const steps = result.steps.map(s=>s.step);
    expect(steps.join(" ")).toContain("bind B to P");
    expect(steps.join(" ")).toContain("NO_ACTIVE_DESTINATION");
  });

  it("harness defaults to testnet SN_SEPOLIA + 84532 and is labeled TEST DOUBLE", async () => {
    const r = await runDecisiveFixture({ controllerAddress: "0x1111111111111111111111111111111111111111", baseExecutionAccount: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" });
    expect(r.environment).toBe("SN_SEPOLIA");
    expect(r.label).toBe(HARNESS_LABEL);
  });
});
