import { describe, expect, it } from "vitest";
import { Pool } from "pg";
import { createClaimableGift } from "../domain/claimable-gift";
import { PostgresClaimableGiftStore, PAYMENT_CLAIM_MIGRATION_SQL } from "../adapters/postgres-payment-claim-store";

const enabled = Boolean(process.env.PRISM_POSTGRES_TEST_URL);
const H = (c: string) => `0x${c.repeat(64)}` as `0x${string}`;
const A = (c: string) => `0x${c.repeat(40)}` as `0x${string}`;

describe.skipIf(!enabled)("PostgreSQL claim/recovery durability", () => {
  it("persists submission hash and fences across a reopened store", async () => {
    const pool = new Pool({ connectionString: process.env.PRISM_POSTGRES_TEST_URL });
    await pool.query(PAYMENT_CLAIM_MIGRATION_SQL);
    const id = `pg-recovery-${Date.now()}`;
    const gift = createClaimableGift({ claimId: id, sender: A("e"), asset: "native", amount: 1n, chainId: 84532, expiresAt: 100, nullifierCommitment: H("c"), now: 1 });
    try {
      const first = new PostgresClaimableGiftStore(pool);
      await first.create(gift);
      const fenced = await first.beginClaimSubmission(id, 0, "claim-fence");
      await first.update(id, fenced.version, current => ({ ...current, state: "claim_submitted", version: current.version + 1, claimSubmissionHash: H("b") }));
      const reopened = new PostgresClaimableGiftStore(pool);
      const readback = await reopened.getById(id);
      expect(readback?.claimSubmissionHash).toBe(H("b"));
      expect(readback?.claimSubmissionFence).toBe("claim-fence");
    } finally {
      await pool.query("DELETE FROM prism_claimable_gifts WHERE claim_id=$1", [id]);
      await pool.end();
    }
  });

  it("uses CAS as the atomic refund submission fence", async () => {
    const pool = new Pool({ connectionString: process.env.PRISM_POSTGRES_TEST_URL });
    await pool.query(PAYMENT_CLAIM_MIGRATION_SQL);
    const id = `pg-refund-${Date.now()}`;
    const gift = { ...createClaimableGift({ claimId: id, sender: A("e"), asset: "native", amount: 1n, chainId: 84532, expiresAt: 100, nullifierCommitment: H("c"), now: 1 }), state: "expired" as const, expiredAt: 101, version: 1 };
    try {
      const store = new PostgresClaimableGiftStore(pool);
      await store.create(gift);
      const results = await Promise.allSettled([store.beginRefundSubmission(id, 1, "fence-a"), store.beginRefundSubmission(id, 1, "fence-b")]);
      expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
      expect((await store.getById(id))?.state).toBe("refund_submitting");
    } finally {
      await pool.query("DELETE FROM prism_claimable_gifts WHERE claim_id=$1", [id]);
      await pool.end();
    }
  });
});
