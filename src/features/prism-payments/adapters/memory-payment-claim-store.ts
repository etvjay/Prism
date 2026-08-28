// X2 in-memory adapters for focused local tests. They model idempotency,
// compare-and-set, and one-time nullifier semantics; they are not durable or
// live-chain implementations.

import { PAYMENT_CLAIM_ERROR_CODE, PaymentClaimError } from "../domain/errors";
import type { PaymentRequest } from "../domain/payment-request";
import type { ClaimableGift } from "../domain/claimable-gift";
import type { ClaimableGiftStore, ClaimNullifierStore, PaymentRequestStore } from "../domain/ports";

function clonePayment(payment: PaymentRequest): PaymentRequest {
  return {
    ...payment,
    recipient: { ...payment.recipient },
    approval: payment.approval ? { ...payment.approval } : null,
  };
}

export class InMemoryPaymentRequestStore implements PaymentRequestStore {
  private readonly byId = new Map<string, PaymentRequest>();
  private readonly byKey = new Map<string, { requestId: string; fingerprint: string }>();

  async create(input: { payment: PaymentRequest; idempotencyKey: string; requestFingerprint: string }): Promise<PaymentRequest> {
    const existing = this.byKey.get(input.idempotencyKey);
    if (existing) {
      const existingPayment = this.byId.get(existing.requestId);
      if (!existingPayment) throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.PAYMENT_NOT_FOUND, "idempotency_index_corrupt");
      if (existing.fingerprint !== input.requestFingerprint) {
        throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.REPLAY_DETECTED, "idempotency_key_conflict");
      }
      return clonePayment(existingPayment);
    }
    if (this.byId.has(input.payment.requestId)) {
      throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.REPLAY_DETECTED, "duplicate_payment_request_id");
    }
    this.byId.set(input.payment.requestId, clonePayment(input.payment));
    this.byKey.set(input.idempotencyKey, { requestId: input.payment.requestId, fingerprint: input.requestFingerprint });
    return clonePayment(input.payment);
  }

  async getById(requestId: string): Promise<PaymentRequest | undefined> {
    const payment = this.byId.get(requestId);
    return payment ? clonePayment(payment) : undefined;
  }

  async getByIdempotencyKey(idempotencyKey: string): Promise<PaymentRequest | undefined> {
    const entry = this.byKey.get(idempotencyKey);
    return entry ? this.getById(entry.requestId) : undefined;
  }

  async update(requestId: string, expectedVersion: number, updater: (current: PaymentRequest) => PaymentRequest): Promise<PaymentRequest> {
    const current = this.byId.get(requestId);
    if (!current) throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.PAYMENT_NOT_FOUND, `unknown_payment:${requestId}`);
    if (current.version !== expectedVersion) {
      throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.VERSION_CONFLICT, `expected_${expectedVersion}_got_${current.version}`);
    }
    const next = updater(clonePayment(current));
    this.byId.set(requestId, clonePayment(next));
    return clonePayment(next);
  }
}

function cloneGift(gift: ClaimableGift): ClaimableGift {
  return { ...gift, recipient: gift.recipient ? { ...gift.recipient } : null };
}

export class InMemoryClaimableGiftStore implements ClaimableGiftStore {
  private readonly byId = new Map<string, ClaimableGift>();

  async create(gift: ClaimableGift): Promise<ClaimableGift> {
    if (this.byId.has(gift.claimId)) throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.REPLAY_DETECTED, "duplicate_claim_id");
    this.byId.set(gift.claimId, cloneGift(gift));
    return cloneGift(gift);
  }

  async getById(claimId: string): Promise<ClaimableGift | undefined> {
    const gift = this.byId.get(claimId);
    return gift ? cloneGift(gift) : undefined;
  }

  async update(claimId: string, expectedVersion: number, updater: (current: ClaimableGift) => ClaimableGift): Promise<ClaimableGift> {
    const current = this.byId.get(claimId);
    if (!current) throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.CLAIM_NOT_FOUND, `unknown_claim:${claimId}`);
    if (current.version !== expectedVersion) throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.VERSION_CONFLICT, `expected_${expectedVersion}_got_${current.version}`);
    const next = updater(cloneGift(current));
    this.byId.set(claimId, cloneGift(next));
    return cloneGift(next);
  }
}

export class InMemoryClaimNullifierStore implements ClaimNullifierStore {
  private readonly claimsByNullifier = new Map<string, string>();

  async reserve(nullifier: `0x${string}`, claimId: string): Promise<"reserved" | "already_reserved"> {
    const key = nullifier.toLowerCase();
    if (this.claimsByNullifier.has(key)) return "already_reserved";
    this.claimsByNullifier.set(key, claimId);
    return "reserved";
  }
}
