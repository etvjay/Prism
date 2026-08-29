// Application service for request-payment. The service records wallet approval
// separately from submission and never treats an identifier as a Prism ID.

import { PaymentClaimError, PAYMENT_CLAIM_ERROR_CODE } from "../domain/errors";
import {
  approvePaymentRequest as approveDomain,
  createPaymentRequest,
  transitionPaymentRequest,
  type ApprovePaymentRequestInput,
  type CreatePaymentRequestInput,
  type PaymentApproval,
  type PaymentRequest,
} from "../domain/payment-request";
import type { PayerWalletPort, PaymentRequestStore } from "../domain/ports";

export interface CreateRequestPaymentInput extends CreatePaymentRequestInput {
  readonly idempotencyKey: string;
  readonly requestFingerprint?: string;
}

export interface RequestPaymentServiceDeps {
  readonly store: PaymentRequestStore;
  readonly payerWallet?: PayerWalletPort | null;
}

function fingerprint(input: CreateRequestPaymentInput): string {
  return JSON.stringify({
    requestId: input.requestId,
    requesterRef: input.requesterRef,
    recipient: input.recipient,
    asset: input.asset,
    amount: input.amount.toString(10),
    chainId: input.chainId,
    expiresAt: input.expiresAt,
  });
}

export class RequestPaymentService {
  constructor(private readonly deps: RequestPaymentServiceDeps) {}

  private assertRequester(payment: PaymentRequest, callerRef: string): void {
    if (callerRef !== payment.requesterRef) {
      throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.UNAUTHORIZED, "requester_authority_required");
    }
  }

  async create(input: CreateRequestPaymentInput): Promise<PaymentRequest> {
    if (!input.idempotencyKey || input.idempotencyKey.trim().length === 0) {
      throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.INVALID_REQUEST, "idempotency_key_required");
    }
    const payment = createPaymentRequest(input);
    return this.deps.store.create({
      payment,
      idempotencyKey: input.idempotencyKey,
      requestFingerprint: input.requestFingerprint ?? fingerprint(input),
    });
  }

  async view(requestId: string, now: number, callerRef: string): Promise<PaymentRequest> {
    const payment = await this.require(requestId);
    this.assertRequester(payment, callerRef);
    return this.deps.store.update(requestId, payment.version, (current) =>
      transitionPaymentRequest(current, { to: "viewed", now }),
    );
  }

  async approve(requestId: string, input: ApprovePaymentRequestInput, callerRef: string): Promise<PaymentRequest> {
    const payment = await this.require(requestId);
    this.assertRequester(payment, callerRef);
    return this.deps.store.update(requestId, payment.version, (current) => approveDomain(current, input));
  }

  /**
   * Submission crosses the payer wallet boundary only after an approval fact
   * has been recorded. Wallet rejection/unknown status handling is added by
   * the receipt adapter; this method never fabricates a transaction hash.
   */
  async submit(requestId: string, callerRef: string): Promise<PaymentRequest> {
    const payment = await this.require(requestId);
    this.assertRequester(payment, callerRef);
    if (payment.state !== "approved" || payment.approval === null) {
      throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.WALLET_APPROVAL_REQUIRED, "explicit_payer_wallet_approval_required");
    }
    if (!this.deps.payerWallet) {
      throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.ESCROW_UNAVAILABLE, "payer_wallet_unavailable");
    }
    let attempted: PaymentRequest;
    try {
      attempted = await this.deps.store.update(requestId, payment.version, (current) => transitionPaymentRequest(current, {
        to: "unknown",
        now: current.updatedAt + 1,
        submissionAttempted: true,
        errorCode: PAYMENT_CLAIM_ERROR_CODE.SUBMISSION_STATUS_UNKNOWN,
        errorDetail: "wallet_submission_in_progress",
      }));
    } catch {
      throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.VERSION_CONFLICT, "submission_fence_failed");
    }
    let result: { readonly transactionHash: `0x${string}` };
    try {
      result = await this.deps.payerWallet.submitPayment({ payment: attempted });
    } catch (cause) {
      const kind = (cause as { kind?: unknown } | null)?.kind;
      const detail = (cause as { message?: unknown } | null)?.message;
      if (kind === "rejected") {
        await this.deps.store.update(requestId, attempted.version, (current) => transitionPaymentRequest(current, {
          to: "rejected",
          now: current.updatedAt + 1,
          rejectionReason: typeof detail === "string" ? detail : "payer_declined",
        }));
        throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.WALLET_REJECTED, "payer_wallet_rejected");
      }
      if (kind === "unknown") {
        throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.SUBMISSION_STATUS_UNKNOWN, "poll_existing_transaction");
      }
      throw cause;
    }
    if (!result?.transactionHash) {
      throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.TRANSACTION_HASH_REQUIRED, "wallet_submission_missing_transaction_hash");
    }
    return this.deps.store.update(requestId, attempted.version, (current) =>
      transitionPaymentRequest(current, {
        to: "submitted",
        now: Math.max(current.updatedAt, attempted.updatedAt + 1),
        transactionHash: result.transactionHash,
      }),
    );
  }

  async get(requestId: string): Promise<PaymentRequest | undefined> {
    return this.deps.store.getById(requestId);
  }

  private async require(requestId: string): Promise<PaymentRequest> {
    const payment = await this.deps.store.getById(requestId);
    if (!payment) throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.PAYMENT_NOT_FOUND, `unknown_payment:${requestId}`);
    return payment;
  }
}

export type { PaymentApproval };
