import { describe, expect, it } from "vitest";
import {
  BASE_SEPOLIA_CHAIN_ID,
  approvePaymentRequest,
  createPaymentRequest,
  transitionPaymentRequest,
  type CreatePaymentRequestInput,
} from "../domain/payment-request";
import { PaymentClaimError, PAYMENT_CLAIM_ERROR_CODE } from "../domain/errors";

const HASH = `0x${"a".repeat(64)}` as `0x${string}`;

function input(overrides: Partial<CreatePaymentRequestInput> = {}): CreatePaymentRequestInput {
  return {
    requestId: "payreq_01H00000000000000000000000",
    requesterRef: "session:user-1",
    recipient: { kind: "claim_token", commitment: HASH },
    asset: "native",
    amount: 100n,
    chainId: BASE_SEPOLIA_CHAIN_ID,
    expiresAt: 200,
    now: 100,
    ...overrides,
  };
}

describe("Prism v0 request-payment domain", () => {
  it("creates a requested payment without an approval or spend transaction", () => {
    const payment = createPaymentRequest(input());

    expect(payment.protocolVersion).toBe("v0");
    expect(payment.state).toBe("requested");
    expect(payment.approval).toBeNull();
    expect(payment.transactionHash).toBeNull();
    expect(payment.amount).toBe(100n);
    expect(payment.chainId).toBe(BASE_SEPOLIA_CHAIN_ID);
  });

  it("moves a requested payment to viewed without authorizing a spend", () => {
    const payment = createPaymentRequest(input());

    const viewed = transitionPaymentRequest(payment, { to: "viewed", now: 101 });

    expect(viewed.state).toBe("viewed");
    expect(viewed.version).toBe(1);
    expect(viewed.approval).toBeNull();
    expect(viewed.transactionHash).toBeNull();
    expect(viewed.viewedAt).toBe(101);
  });

  it("requires a payer wallet approval before entering approved", () => {
    const payment = transitionPaymentRequest(createPaymentRequest(input()), { to: "viewed", now: 101 });

    const approved = approvePaymentRequest(payment, {
      now: 102,
      approval: {
        requestId: payment.requestId,
        walletAddress: `0x${"b".repeat(40)}`,
        chainId: BASE_SEPOLIA_CHAIN_ID,
        asset: payment.asset,
        amount: payment.amount,
        recipientCommitment: payment.recipient.commitment,
        expiresAt: payment.expiresAt,
        approvedAt: 102,
        approvalReference: "wallet-approval-1",
        termsCommitment: HASH,
      },
    });

    expect(approved.state).toBe("approved");
    expect(approved.approval?.walletAddress).toBe(`0x${"b".repeat(40)}`);
    expect(approved.transactionHash).toBeNull();
  });

  it("rejects an approval whose wallet terms differ from the request", () => {
    const payment = transitionPaymentRequest(createPaymentRequest(input()), { to: "viewed", now: 101 });

    try {
      approvePaymentRequest(payment, {
        now: 102,
        approval: {
          requestId: payment.requestId,
          walletAddress: `0x${"b".repeat(40)}`,
          chainId: BASE_SEPOLIA_CHAIN_ID,
          asset: payment.asset,
          amount: payment.amount + 1n,
          recipientCommitment: payment.recipient.commitment,
          expiresAt: payment.expiresAt,
          approvedAt: 102,
          approvalReference: "wallet-approval-1",
          termsCommitment: HASH,
        },
      });
      throw new Error("expected approval mismatch");
    } catch (error) {
      expect(error).toBeInstanceOf(PaymentClaimError);
      expect((error as PaymentClaimError).code).toBe(PAYMENT_CLAIM_ERROR_CODE.APPROVAL_TERMS_MISMATCH);
    }
  });

  it("enters submitted only with a wallet transaction hash after approval", () => {
    const payment = transitionPaymentRequest(createPaymentRequest(input()), { to: "viewed", now: 101 });
    const approved = approvePaymentRequest(payment, {
      now: 102,
      approval: {
        requestId: payment.requestId,
        walletAddress: `0x${"b".repeat(40)}`,
        chainId: BASE_SEPOLIA_CHAIN_ID,
        asset: payment.asset,
        amount: payment.amount,
        recipientCommitment: payment.recipient.commitment,
        expiresAt: payment.expiresAt,
        approvedAt: 102,
        approvalReference: "wallet-approval-1",
        termsCommitment: HASH,
      },
    });

    const submitted = transitionPaymentRequest(approved, {
      to: "submitted",
      now: 103,
      transactionHash: HASH,
    });

    expect(submitted.state).toBe("submitted");
    expect(submitted.transactionHash).toBe(HASH);
  });

  it("keeps a submitted payment processing until a matching receipt is observed", () => {
    const payment = transitionPaymentRequest(createPaymentRequest(input()), { to: "viewed", now: 101 });
    const approved = approvePaymentRequest(payment, {
      now: 102,
      approval: {
        requestId: payment.requestId,
        walletAddress: `0x${"b".repeat(40)}`,
        chainId: BASE_SEPOLIA_CHAIN_ID,
        asset: payment.asset,
        amount: payment.amount,
        recipientCommitment: payment.recipient.commitment,
        expiresAt: payment.expiresAt,
        approvedAt: 102,
        approvalReference: "wallet-approval-1",
        termsCommitment: HASH,
      },
    });
    const submitted = transitionPaymentRequest(approved, { to: "submitted", now: 103, transactionHash: HASH });

    const processing = transitionPaymentRequest(submitted, { to: "processing", now: 104 });

    expect(processing.state).toBe("processing");
    expect(() => transitionPaymentRequest(processing, { to: "confirmed", now: 105 })).toThrow(/receipt|observ/);
  });

  it("confirms only from a matching successful Base receipt", () => {
    const payment = transitionPaymentRequest(createPaymentRequest(input()), { to: "viewed", now: 101 });
    const approved = approvePaymentRequest(payment, {
      now: 102,
      approval: {
        requestId: payment.requestId,
        walletAddress: `0x${"b".repeat(40)}`,
        chainId: BASE_SEPOLIA_CHAIN_ID,
        asset: payment.asset,
        amount: payment.amount,
        recipientCommitment: payment.recipient.commitment,
        expiresAt: payment.expiresAt,
        approvedAt: 102,
        approvalReference: "wallet-approval-1",
        termsCommitment: HASH,
      },
    });
    const submitted = transitionPaymentRequest(approved, { to: "submitted", now: 103, transactionHash: HASH });
    const processing = transitionPaymentRequest(submitted, { to: "processing", now: 104 });

    const confirmed = transitionPaymentRequest(processing, {
      to: "confirmed",
      now: 105,
      receipt: {
        requestId: payment.requestId,
        transactionHash: HASH,
        chainId: BASE_SEPOLIA_CHAIN_ID,
        status: "succeeded",
        blockNumber: 123,
      },
    });

    expect(confirmed.state).toBe("confirmed");
    expect(confirmed.transactionHash).toBe(HASH);
  });

  it("marks an ambiguous submitted payment unknown without permitting rebroadcast", () => {
    const payment = transitionPaymentRequest(createPaymentRequest(input()), { to: "viewed", now: 101 });
    const approved = approvePaymentRequest(payment, {
      now: 102,
      approval: {
        requestId: payment.requestId,
        walletAddress: `0x${"b".repeat(40)}`,
        chainId: BASE_SEPOLIA_CHAIN_ID,
        asset: payment.asset,
        amount: payment.amount,
        recipientCommitment: payment.recipient.commitment,
        expiresAt: payment.expiresAt,
        approvedAt: 102,
        approvalReference: "wallet-approval-1",
        termsCommitment: HASH,
      },
    });
    const submitted = transitionPaymentRequest(approved, { to: "submitted", now: 103, transactionHash: HASH });

    const unknown = transitionPaymentRequest(submitted, {
      to: "unknown",
      now: 104,
      errorCode: "ERR-022",
      errorDetail: "provider_status_unknown",
    });

    expect(unknown.state).toBe("unknown");
    expect(unknown.transactionHash).toBe(HASH);
    expect(() => transitionPaymentRequest(unknown, { to: "submitted", now: 105, transactionHash: HASH })).toThrow(/rebroadcast|transition|unknown/);
  });

  it("recovers an unknown submitted payment only from the existing transaction", () => {
    const payment = transitionPaymentRequest(createPaymentRequest(input()), { to: "viewed", now: 101 });
    const approved = approvePaymentRequest(payment, {
      now: 102,
      approval: {
        requestId: payment.requestId,
        walletAddress: `0x${"b".repeat(40)}`,
        chainId: BASE_SEPOLIA_CHAIN_ID,
        asset: payment.asset,
        amount: payment.amount,
        recipientCommitment: payment.recipient.commitment,
        expiresAt: payment.expiresAt,
        approvedAt: 102,
        approvalReference: "wallet-approval-1",
        termsCommitment: HASH,
      },
    });
    const submitted = transitionPaymentRequest(approved, { to: "submitted", now: 103, transactionHash: HASH });
    const unknown = transitionPaymentRequest(submitted, { to: "unknown", now: 104, errorCode: "ERR-022" });

    const processing = transitionPaymentRequest(unknown, {
      to: "processing",
      now: 105,
      receipt: {
        requestId: payment.requestId,
        transactionHash: HASH,
        chainId: BASE_SEPOLIA_CHAIN_ID,
        status: "pending",
        blockNumber: null,
      },
    });

    expect(processing.state).toBe("processing");
    expect(processing.transactionHash).toBe(HASH);
  });

  it("preserves a reverted receipt as a terminal payment outcome", () => {
    const payment = transitionPaymentRequest(createPaymentRequest(input()), { to: "viewed", now: 101 });
    const approved = approvePaymentRequest(payment, {
      now: 102,
      approval: {
        requestId: payment.requestId,
        walletAddress: `0x${"b".repeat(40)}`,
        chainId: BASE_SEPOLIA_CHAIN_ID,
        asset: payment.asset,
        amount: payment.amount,
        recipientCommitment: payment.recipient.commitment,
        expiresAt: payment.expiresAt,
        approvedAt: 102,
        approvalReference: "wallet-approval-1",
        termsCommitment: HASH,
      },
    });
    const submitted = transitionPaymentRequest(approved, { to: "submitted", now: 103, transactionHash: HASH });
    const processing = transitionPaymentRequest(submitted, { to: "processing", now: 104 });

    const reverted = transitionPaymentRequest(processing, {
      to: "reverted",
      now: 105,
      errorCode: "BASE_TX_REVERTED",
      receipt: {
        requestId: payment.requestId,
        transactionHash: HASH,
        chainId: BASE_SEPOLIA_CHAIN_ID,
        status: "reverted",
        blockNumber: 123,
      },
    });

    expect(reverted.state).toBe("reverted");
    expect(reverted.transactionHash).toBe(HASH);
    expect(reverted.errorCode).toBe("BASE_TX_REVERTED");
  });

  it("records a payer rejection as a terminal request state", () => {
    const payment = transitionPaymentRequest(createPaymentRequest(input()), { to: "viewed", now: 101 });

    const rejected = transitionPaymentRequest(payment, {
      to: "rejected",
      now: 102,
      rejectionReason: "payer_declined",
    });

    expect(rejected.state).toBe("rejected");
    expect(rejected.rejectedAt).toBe(102);
    expect(rejected.rejectionReason).toBe("payer_declined");
    expect(rejected.approval).toBeNull();
    expect(rejected.transactionHash).toBeNull();
  });

  it("rejects payment requests outside the accepted Base Sepolia chain", () => {
    expect(() => createPaymentRequest(input({ chainId: 8453 as typeof BASE_SEPOLIA_CHAIN_ID }))).toThrow(/BASE_SEPOLIA|84532/);
  });

  it("rejects zero or negative payment amounts", () => {
    expect(() => createPaymentRequest(input({ amount: 0n }))).toThrow(/amount|ERR-053/);
  });

  it("expires an unsubmitted request at its exact expiry boundary", () => {
    const payment = createPaymentRequest(input());

    const expired = transitionPaymentRequest(payment, { to: "expired", now: 200 });

    expect(expired.state).toBe("expired");
    expect(expired.transactionHash).toBeNull();
    expect(expired.approval).toBeNull();
  });

  it("allows only the requester to cancel before submission", () => {
    const payment = createPaymentRequest(input());

    const cancelled = transitionPaymentRequest(payment, {
      to: "cancelled",
      now: 101,
      actorRef: payment.requesterRef,
    });

    expect(cancelled.state).toBe("cancelled");
    expect(cancelled.transactionHash).toBeNull();
  });

  it("requires an expiry strictly after creation", () => {
    expect(() => createPaymentRequest(input({ expiresAt: 100 }))).toThrow(/expir|ERR-054/);
  });

  it("rejects an external recipient payload that attempts to inject a Prism ID", () => {
    expect(() => createPaymentRequest(input({
      recipient: { kind: "email", commitment: HASH, prismId: "prism:P7F21" } as never,
    }))).toThrow(/Prism ID|infer|ERR-050/);
  });
});
