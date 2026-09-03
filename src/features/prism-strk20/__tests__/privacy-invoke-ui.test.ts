import { describe, expect, it } from "vitest";
import { privacyInvokeStatus } from "../PrivacyInvokeTestPanel";

describe("privacy invoke test UI status", () => {
  it("keeps blocked runner output explicit and receipt-free", () => {
    expect(privacyInvokeStatus({
      verdict: "M5_BLOCKED_BY_ENVIRONMENT_EVIDENCE",
      reason: "NO_WALLET",
      detail: "No WalletAccountV6 provider injected.",
      commit: "",
    })).toEqual({
      tone: "blocked",
      title: "Blocked: no WalletAccountV6 provider",
      detail: "No WalletAccountV6 provider injected.",
    });
  });

  it("does not call a runner result successful without an observed receipt", () => {
    expect(privacyInvokeStatus({
      verdict: "M5_E2E_RUNNER_READY_X2",
      txHash: "0xabc",
      predicates: { receiptObserved: false },
    })).toEqual({
      tone: "ready",
      title: "Runner ready, live closure not observed",
      detail: "The runner returned without an independently observed terminal receipt.",
    });
  });
});
