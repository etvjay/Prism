import { describe, expect, it } from "vitest";
import { PaymentClaimError, PAYMENT_CLAIM_ERROR_CODE } from "../domain/errors";
import { RequestPaymentService } from "../application/request-payment-service";
import { InMemoryPaymentRequestStore } from "../adapters/memory-payment-claim-store";

const HASH = `0x${"a".repeat(64)}` as `0x${string}`;

class RecordingPayerWallet {
  submissions = 0;
  async submitPayment(): Promise<{ transactionHash: `0x${string}` }> {
    this.submissions += 1;
    return { transactionHash: HASH };
  }
}

class RejectingPayerWallet {
  async submitPayment(): Promise<{ transactionHash: `0x${string}` }> {
    throw Object.assign(new Error("payer_declined"), { kind: "rejected" as const });
  }
}

class UnknownPayerWallet {
  calls = 0;
  async submitPayment(): Promise<{ transactionHash: `0x${string}` }> {
    this.calls += 1;
    throw Object.assign(new Error("provider_status_unknown"), { kind: "unknown" as const });
  }
}

describe("request-payment application boundary", () => {
  it("never invokes payer spending before an explicit wallet approval", async () => {
    const wallet = new RecordingPayerWallet();
    const service = new RequestPaymentService({
      store: new InMemoryPaymentRequestStore(),
      payerWallet: wallet,
    });

    const created = await service.create({
      requestId: "payreq_01H00000000000000000000000",
      requesterRef: "session:user-1",
      recipient: { kind: "claim_token", commitment: HASH },
      asset: "native",
      amount: 100n,
      chainId: 84532,
      expiresAt: 200,
      now: 100,
      idempotencyKey: "payment-create-1",
    });

    let failure: unknown;
    try {
      await service.submit(created.requestId);
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(PaymentClaimError);
    expect((failure as PaymentClaimError).code).toBe(PAYMENT_CLAIM_ERROR_CODE.WALLET_APPROVAL_REQUIRED);
    expect(wallet.submissions).toBe(0);
  });

  it("records a payer wallet rejection instead of leaving an approved request", async () => {
    const service = new RequestPaymentService({
      store: new InMemoryPaymentRequestStore(),
      payerWallet: new RejectingPayerWallet(),
    });
    const created = await service.create({
      requestId: "payreq_01H00000000000000000000000",
      requesterRef: "session:user-1",
      recipient: { kind: "claim_token", commitment: HASH },
      asset: "native",
      amount: 100n,
      chainId: 84532,
      expiresAt: 200,
      now: 100,
      idempotencyKey: "payment-create-1",
    });
    const viewed = await service.view(created.requestId, 101);
    await service.approve(created.requestId, {
      now: 102,
      approval: {
        requestId: created.requestId,
        walletAddress: `0x${"b".repeat(40)}`,
        chainId: 84532,
        asset: created.asset,
        amount: created.amount,
        recipientCommitment: created.recipient.commitment,
        expiresAt: created.expiresAt,
        approvedAt: 102,
        approvalReference: "wallet-approval-1",
        termsCommitment: HASH,
      },
    });

    await expect(service.submit(viewed.requestId)).rejects.toMatchObject({ code: PAYMENT_CLAIM_ERROR_CODE.WALLET_REJECTED });
    expect((await service.get(created.requestId))?.state).toBe("rejected");
  });

  it("fences an ambiguous wallet submission as unknown and forbids rebroadcast", async () => {
    const wallet = new UnknownPayerWallet();
    const service = new RequestPaymentService({
      store: new InMemoryPaymentRequestStore(),
      payerWallet: wallet,
    });
    const created = await service.create({
      requestId: "payreq_01H00000000000000000000000",
      requesterRef: "session:user-1",
      recipient: { kind: "claim_token", commitment: HASH },
      asset: "native",
      amount: 100n,
      chainId: 84532,
      expiresAt: 200,
      now: 100,
      idempotencyKey: "payment-create-1",
    });
    await service.view(created.requestId, 101);
    await service.approve(created.requestId, {
      now: 102,
      approval: {
        requestId: created.requestId,
        walletAddress: `0x${"b".repeat(40)}`,
        chainId: 84532,
        asset: created.asset,
        amount: created.amount,
        recipientCommitment: created.recipient.commitment,
        expiresAt: created.expiresAt,
        approvedAt: 102,
        approvalReference: "wallet-approval-1",
        termsCommitment: HASH,
      },
    });

    await expect(service.submit(created.requestId)).rejects.toMatchObject({ code: PAYMENT_CLAIM_ERROR_CODE.SUBMISSION_STATUS_UNKNOWN });
    expect((await service.get(created.requestId))?.state).toBe("unknown");
    await expect(service.submit(created.requestId)).rejects.toMatchObject({ code: PAYMENT_CLAIM_ERROR_CODE.WALLET_APPROVAL_REQUIRED });
    expect(wallet.calls).toBe(1);
  });
});
