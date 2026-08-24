import { describe, it, expect } from "vitest";
import { buildShieldReceipt, buildPrivateTransferReceipt, assertNotSenderAttribution, assertReceiptPrivacyHonesty, STRK20_POOL_ADDRESS } from "../domain/receipt";

// X2 — TEST DOUBLE: pure receipt, relayer non-attribution
describe("M4 Receipt — X2 relayer sender non-attribution", () => {
  const poolAddr = STRK20_POOL_ADDRESS;
  const relayer = "0x0000000000000000000000000000000000000000000000000000000000000abc" as `0x${string}`;
  const depositor = "0x0000000000000000000000000000000000000000000000000000000000000def" as `0x${string}`;
  const txHash = "0x0000000000000000000000000000000000000000000000000000000000000001" as `0x${string}`;

  it("attributes via pool event first key, not sender", () => {
    const r = buildShieldReceipt(
      {
        transactionHash: txHash,
        executionStatus: "SUCCEEDED",
        finalityStatus: "ACCEPTED_ON_L2",
        senderAddress: relayer,
        events: [{ address: poolAddr, keys: [depositor], data: [], blockNumber: 100, transactionHash: txHash }],
      },
      { feePaid: 4n },
    );
    expect(r.attributedDepositor).toBe(depositor);
    expect(r.senderIgnored).toBe(relayer);
    expect(r.poolEventFound).toBe(true);
    // Must not equal sender attribution
    assertNotSenderAttribution(r.attributedDepositor, r.senderIgnored);
  });

  it("pool event missing → poolEventFound false", () => {
    const r = buildShieldReceipt(
      {
        transactionHash: txHash,
        executionStatus: "SUCCEEDED",
        finalityStatus: "ACCEPTED_ON_L2",
        senderAddress: relayer,
        events: [],
      },
      {},
    );
    expect(r.poolEventFound).toBe(false);
    expect(r.attributedDepositor).toBeNull();
  });

  it("private transfer receipt hides amount", () => {
    const r = buildPrivateTransferReceipt(
      {
        transactionHash: txHash,
        executionStatus: "SUCCEEDED",
        finalityStatus: "ACCEPTED_ON_L2",
        senderAddress: relayer,
        events: [{ address: poolAddr, keys: [depositor], data: [], blockNumber: 110, transactionHash: txHash }],
      },
      { feePaid: 4n },
    );
    expect(r.hiddenMetadata).toContain("amount");
    expect(r.hiddenMetadata).toContain("sender");
  });

  it("shield honesty: amount not hidden", () => {
    const r = buildShieldReceipt(
      {
        transactionHash: txHash,
        executionStatus: "SUCCEEDED",
        finalityStatus: "ACCEPTED_ON_L2",
        senderAddress: relayer,
        events: [{ address: poolAddr, keys: [depositor], data: [], blockNumber: 100, transactionHash: txHash }],
      },
      {},
    );
    expect(() => assertReceiptPrivacyHonesty(r)).not.toThrow();
    // Overclaim: shield claims amount hidden
    const bad = { ...r, hiddenMetadata: ["amount"] } as typeof r;
    expect(() => assertReceiptPrivacyHonesty(bad)).toThrow(/shield_amount_is_public/);
  });

  it("forbids sender attribution", () => {
    // If someone incorrectly sets attributed == sender, throw
    expect(() => assertNotSenderAttribution(relayer, relayer)).toThrow(/relayer_attribution_forbidden|sender_must_not/);
  });
});
