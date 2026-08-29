import { describe, expect, it } from "vitest";
import { ClaimableGiftService } from "../application/claimable-gift-service";
import { InMemoryClaimNullifierStore, InMemoryClaimableGiftStore } from "../adapters/memory-payment-claim-store";
import { type GiftClaimAuthorization, type GiftFundingObservation } from "../domain/claimable-gift";
import type { ClaimProofVerifier, PublicBaseSepoliaEscrowPort } from "../domain/ports";

const H = (c: string) => `0x${c.repeat(64)}` as `0x${string}`;
const A = (c: string) => `0x${c.repeat(40)}` as `0x${string}`;
const claimId = "gift_01H00000000000000000000000";
const sender = A("e");
const recipient = A("f");
const nullifier = H("c");
const signature = `0x${"1".repeat(130)}` as `0x${string}`;

class RecoveryEscrow implements PublicBaseSepoliaEscrowPort {
  readonly chainId = 84532 as const;
  async createEscrow() { return { transactionHash: H("a") }; }
  async claimEscrow() { return { status: "submitted" as const, transactionHash: H("b"), blockNumber: null }; }
  async refundEscrow() { return { status: "submitted" as const, transactionHash: H("d"), blockNumber: null }; }
  async observeFunding(id: string): Promise<GiftFundingObservation> { return { claimId: id, transactionHash: H("a"), chainId: 84532, sender, asset: "native", amount: 1n, status: "succeeded", blockNumber: 1 }; }
}
class Verifier implements ClaimProofVerifier {
  async verify(input: { claimId: string; nullifierCommitment: `0x${string}`; proof: unknown; recipientAddress: `0x${string}` }): Promise<GiftClaimAuthorization> {
    return { claimId: input.claimId, nullifier: input.nullifierCommitment, recipientAddress: input.recipientAddress, signature };
  }
}
async function claimableService() {
  const store = new InMemoryClaimableGiftStore();
  const nullifiers = new InMemoryClaimNullifierStore();
  const service = new ClaimableGiftService({ store, nullifierStore: nullifiers, escrow: new RecoveryEscrow(), claimProofVerifier: new Verifier() });
  await service.create({ claimId, sender, asset: "native", amount: 1n, chainId: 84532, expiresAt: 100, nullifierCommitment: nullifier, now: 1 });
  const funded = await service.recordFunding(claimId, { now: 2 });
  await service.markClaimable(claimId, { now: 3 });
  return { service, store, nullifiers, funded };
}

describe("claim/refund recovery regressions", () => {
  it("accepts submitted and unknown, but completes only on verified success; reverted releases nullifier", async () => {
    const { service, nullifiers } = await claimableService();
    const submitted = await service.claim(claimId, { now: 4, proof: {}, recipientAddress: recipient });
    expect(submitted.state).toBe("claim_submitted");
    expect(submitted.claimSubmissionHash).toBe(H("b"));
    const unknown = await service.reconcileClaim(claimId, 5, { claimId, nullifier, recipientAddress: recipient, signature }, { claimId, status: "unknown", transactionHash: H("b"), blockNumber: null, chainId: 84532, escrowContractAddress: A("1"), operationId: claimId, action: "claim", providerVerification: { kind: "provider_verified", provider: "test", verifiedAt: 5 } });
    expect(unknown.state).toBe("claim_unknown");
    expect(unknown.state).not.toBe("claimed");
    const failed = await service.reconcileClaim(claimId, 6, { claimId, nullifier, recipientAddress: recipient, signature }, { claimId, status: "reverted", transactionHash: H("b"), blockNumber: null, chainId: 84532, escrowContractAddress: A("1"), operationId: claimId, action: "claim", providerVerification: { kind: "provider_verified", provider: "test", verifiedAt: 6 } });
    expect(failed.state).toBe("claimable");
    expect(await nullifiers.reserve(nullifier, claimId)).toBe("reserved");
    const completed = await service.reconcileClaim(claimId, 7, { claimId, nullifier, recipientAddress: recipient, signature }, { claimId, status: "succeeded", transactionHash: H("b"), blockNumber: 9, chainId: 84532, escrowContractAddress: A("1"), operationId: claimId, action: "claim", providerVerification: { kind: "provider_verified", provider: "test", verifiedAt: 7 } });
    expect(completed.state).toBe("claimed");
  });

  it("keeps refund submitted/unknown distinct and completes only with final receipt", async () => {
    const { service } = await claimableService();
    await service.expire(claimId, { now: 101 });
    const submitted = await service.refund(claimId, { now: 102, actor: sender });
    expect(submitted.state).toBe("refund_submitted");
    const unknown = await service.reconcileRefund(claimId, 103, sender, { claimId, status: "unknown", transactionHash: H("d"), blockNumber: null, chainId: 84532, escrowContractAddress: A("1"), operationId: claimId, action: "refund", providerVerification: { kind: "provider_verified", provider: "test", verifiedAt: 103 } });
    expect(unknown.state).toBe("refund_unknown");
    const completed = await service.reconcileRefund(claimId, 104, sender, { claimId, status: "succeeded", transactionHash: H("d"), blockNumber: 11, chainId: 84532, escrowContractAddress: A("1"), operationId: claimId, action: "refund", providerVerification: { kind: "provider_verified", provider: "test", verifiedAt: 104 } });
    expect(completed.state).toBe("refunded");
  });
});

// Regression for the SQL adapter: its update must bind both submission hashes,
// use the version fence, and map snake_case PostgreSQL rows back to the domain.
describe("Postgres claim store persistence contract", () => {
  it("writes submission hashes and reads them back after an update", async () => {
    const calls: Array<{ sql: string; values?: readonly unknown[] }> = [];
    const row = { claim_id: claimId, protocol_version: "v0", schema_version: 1, network: "BASE_SEPOLIA", chain_id: 84532, sender, refund_recipient: sender, asset: "native", amount: "1", expires_at: 100, nullifier_commitment: nullifier, state: "claimable", version: 0, created_at: 1, funded_at: 2, claimable_at: 3, claimed_at: null, expired_at: null, refunded_at: null, funding_transaction_hash: H("a"), funding_block_number: 1, claim_transaction_hash: null, refund_transaction_hash: null, refund_block_number: null, claim_submission_hash: H("b"), refund_submission_hash: null, recipient: null };
    const pool = { async query(sql: string, values?: readonly unknown[]) { calls.push({ sql, values }); if (sql.startsWith("SELECT")) return { rows: [row], rowCount: 1 }; return { rows: [], rowCount: 1 }; } };
    const { PostgresClaimableGiftStore } = await import("../adapters/postgres-payment-claim-store");
    const store = new PostgresClaimableGiftStore(pool as any);
    const result = await store.update(claimId, 0, gift => ({ ...gift, state: "claim_submitted", version: 1, claimSubmissionHash: H("b") }));
    const update = calls.find(call => call.sql.startsWith("UPDATE"));
    expect(update?.sql).toContain("claim_submission_hash=$15");
    expect(update?.sql).toContain("refund_submission_hash=$16");
    expect(update?.values?.[14]).toBe(H("b"));
    expect(result.claimSubmissionHash).toBe(H("b"));
  });
});
