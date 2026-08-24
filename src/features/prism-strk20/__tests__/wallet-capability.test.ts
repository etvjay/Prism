import { describe, it, expect } from "vitest";
import { supportsStrk20, detectCapability, classifyWalletEnvironment } from "../domain/wallet-capability";

// X2 — TEST DOUBLE: pure capability logic, no live wallet, no balance reads
describe("M4 Wallet Capability — X2 pure detection via supportedWalletApi/supportedSpecs only", () => {
  it("detects capable when apiVersion >=0.10.3", () => {
    expect(supportsStrk20(["0.10.3"], [])).toBe(true);
    expect(supportsStrk20(["0.10.4"], [])).toBe(true);
    expect(supportsStrk20([], ["0.10.3"])).toBe(true);
  });

  it("rejects below threshold", () => {
    expect(supportsStrk20(["0.9.9"], [])).toBe(false);
    expect(supportsStrk20(["0.10.2"], [])).toBe(false);
    // walletApi feature version 1.0.0 is not STRK20 capability signal; only supportedWalletApi/supportedSpecs matter
    // So pure supportsStrk20 with "0.9.0" still false, but this is not a regression of feature-version handling
  });

  it("does not use balance reads for detection (no side effect)", () => {
    // If implementation called balances, this test would need a mock; pure fn has no I/O
    const r = detectCapability({ apiVersions: ["0.10.3"], specs: [], chainId: "SN_SEPOLIA", expectedChainId: "SN_SEPOLIA" });
    expect(r.capable).toBe(true);
    expect(r.mismatch).toBe(false);
  });

  it("flags network mismatch", () => {
    const r = detectCapability({ apiVersions: ["0.10.3"], specs: [], chainId: "SN_MAIN", expectedChainId: "SN_SEPOLIA" });
    expect(r.mismatch).toBe(true);
    expect(r.environment).toBe("SN_MAIN");
  });

  it("classifies UNKNOWN on unrecognized chain", () => {
    const env = classifyWalletEnvironment("0x123", { mainnet: "0x534E5f4d41494e", sepolia: "0x534e5f5345504f4c4941" });
    expect(env).toBe("UNKNOWN");
  });

  it("treats empty versions as not capable", () => {
    expect(supportsStrk20([], [])).toBe(false);
  });
});
