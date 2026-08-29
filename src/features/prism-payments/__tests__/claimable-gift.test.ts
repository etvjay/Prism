import { describe, expect, it } from "vitest";
import {
  BASE_SEPOLIA_CHAIN_ID,
  claimClaimableGift,
  createClaimableGift,
  expireClaimableGift,
  fundClaimableGift,
  markGiftClaimable,
  refundClaimableGift,
  type CreateClaimableGiftInput,
} from "../domain/claimable-gift";

const TX_HASH = `0x${"a".repeat(64)}` as `0x${string}`;
const CLAIM_TX_HASH = `0x${"e".repeat(64)}` as `0x${string}`;
const REFUND_TX_HASH = `0x${"f".repeat(64)}` as `0x${string}`;
const TOKEN = `0x${"b".repeat(40)}` as `0x${string}`;
const SENDER = `0x${"c".repeat(40)}` as `0x${string}`;
const RECIPIENT = `0x${"d".repeat(40)}` as `0x${string}`;

function input(overrides: Partial<CreateClaimableGiftInput> = {}): CreateClaimableGiftInput {
  return {
    claimId: "gift_01H00000000000000000000000",
    sender: SENDER,
    asset: TOKEN,
    amount: 500n,
    chainId: BASE_SEPOLIA_CHAIN_ID,
    expiresAt: 200,
    nullifierCommitment: TX_HASH,
    now: 100,
    ...overrides,
  };
}

describe("public Base Sepolia claimable gift domain", () => {
  it("creates an unfunded gift with fixed sender, amount, expiry, and nullifier commitment", () => {
    const gift = createClaimableGift(input());

    expect(gift.protocolVersion).toBe("v0");
    expect(gift.network).toBe("BASE_SEPOLIA");
    expect(gift.state).toBe("created");
    expect(gift.claimId).toBe(input().claimId);
    expect(gift.asset).toBe(TOKEN);
    expect(gift.amount).toBe(500n);
    expect(gift.expiresAt).toBe(200);
    expect(gift.sender).toBe(SENDER);
    expect(gift.nullifierCommitment).toBe(TX_HASH);
    expect(gift.recipient).toBeNull();
  });

  it("rejects a gift configured for a chain other than Base Sepolia", () => {
    expect(() => createClaimableGift(input({ chainId: 8453 as typeof BASE_SEPOLIA_CHAIN_ID }))).toThrow(/Base Sepolia|84532/);
  });

  it("rejects non-positive gift amounts", () => {
    expect(() => createClaimableGift(input({ amount: 0n }))).toThrow(/amount|ERR-053/);
  });

  it("rejects a zero sender address", () => {
    expect(() => createClaimableGift(input({ sender: "0x0000000000000000000000000000000000000000" as `0x${string}` }))).toThrow(/sender|address|ERR-005/);
  });

  it("rejects a malformed token asset", () => {
    expect(() => createClaimableGift(input({ asset: "not-an-asset" as `0x${string}` }))).toThrow(/asset|ERR-052/);
  });

  it("requires a 32-byte nullifier commitment", () => {
    expect(() => createClaimableGift(input({ nullifierCommitment: "not-a-nullifier" as `0x${string}` }))).toThrow(/nullifier|ERR-050/);
  });

  it("requires a gift expiry strictly after creation", () => {
    expect(() => createClaimableGift(input({ expiresAt: 100 }))).toThrow(/expir|ERR-054/);
  });

  it("records funding only from a matching successful Base Sepolia observation", () => {
    const gift = createClaimableGift(input());

    const funded = fundClaimableGift(gift, {
      now: 110,
      observation: {
        claimId: gift.claimId,
        transactionHash: TX_HASH,
        chainId: BASE_SEPOLIA_CHAIN_ID,
        sender: SENDER,
        asset: TOKEN,
        amount: 500n,
        status: "succeeded",
        blockNumber: 456,
      },
    });

    expect(funded.state).toBe("funded");
    expect(funded.fundingTransactionHash).toBe(TX_HASH);
    expect(funded.fundedAt).toBe(110);
    expect(funded.recipient).toBeNull();
  });

  it("marks a funded gift claimable without binding a recipient", () => {
    const funded = fundClaimableGift(createClaimableGift(input()), {
      now: 110,
      observation: {
        claimId: input().claimId,
        transactionHash: TX_HASH,
        chainId: BASE_SEPOLIA_CHAIN_ID,
        sender: SENDER,
        asset: TOKEN,
        amount: 500n,
        status: "succeeded",
        blockNumber: 456,
      },
    });

    const claimable = markGiftClaimable(funded, { now: 111 });

    expect(claimable.state).toBe("claimable");
    expect(claimable.claimableAt).toBe(111);
    expect(claimable.recipient).toBeNull();
  });

  it("consumes a matching one-time nullifier and binds the claiming recipient", () => {
    const claimable = markGiftClaimable(
      fundClaimableGift(createClaimableGift(input()), {
        now: 110,
        observation: {
          claimId: input().claimId,
          transactionHash: TX_HASH,
          chainId: BASE_SEPOLIA_CHAIN_ID,
          sender: SENDER,
          asset: TOKEN,
          amount: 500n,
          status: "succeeded",
          blockNumber: 456,
        },
      }),
      { now: 111 },
    );

    const claimed = claimClaimableGift(claimable, {
      now: 120,
      authorization: {
        claimId: claimable.claimId,
        nullifier: TX_HASH,
        recipientAddress: RECIPIENT,
      },
      transactionHash: CLAIM_TX_HASH,
      blockNumber: 789,
    });

    expect(claimed.state).toBe("claimed");
    expect(claimed.recipient).toEqual({ address: RECIPIENT, boundAt: 120, nullifier: TX_HASH });
    expect(claimed.claimTransactionHash).toBe(CLAIM_TX_HASH);
    expect(claimed.claimedAt).toBe(120);
  });

  it("rejects a claim authorization with a malformed recipient address", () => {
    const claimable = markGiftClaimable(
      fundClaimableGift(createClaimableGift(input()), {
        now: 110,
        observation: {
          claimId: input().claimId,
          transactionHash: TX_HASH,
          chainId: BASE_SEPOLIA_CHAIN_ID,
          sender: SENDER,
          asset: TOKEN,
          amount: 500n,
          status: "succeeded",
          blockNumber: 456,
        },
      }),
      { now: 111 },
    );

    expect(() => claimClaimableGift(claimable, {
      now: 120,
      authorization: { claimId: claimable.claimId, nullifier: TX_HASH, recipientAddress: "not-an-address" as `0x${string}` },
      transactionHash: CLAIM_TX_HASH,
      blockNumber: 789,
    })).toThrow(/address|ERR-005/);
  });

  it("refuses a claim at the expiry boundary", () => {
    const claimable = markGiftClaimable(
      fundClaimableGift(createClaimableGift(input()), {
        now: 110,
        observation: {
          claimId: input().claimId,
          transactionHash: TX_HASH,
          chainId: BASE_SEPOLIA_CHAIN_ID,
          sender: SENDER,
          asset: TOKEN,
          amount: 500n,
          status: "succeeded",
          blockNumber: 456,
        },
      }),
      { now: 111 },
    );

    expect(() => claimClaimableGift(claimable, {
      now: claimable.expiresAt,
      authorization: { claimId: claimable.claimId, nullifier: TX_HASH, recipientAddress: RECIPIENT },
      transactionHash: CLAIM_TX_HASH,
      blockNumber: 789,
    })).toThrow(/expired|ERR-064/);
  });

  it("marks a funded claimable gift expired at expiry without claiming it", () => {
    const claimable = markGiftClaimable(
      fundClaimableGift(createClaimableGift(input()), {
        now: 110,
        observation: {
          claimId: input().claimId,
          transactionHash: TX_HASH,
          chainId: BASE_SEPOLIA_CHAIN_ID,
          sender: SENDER,
          asset: TOKEN,
          amount: 500n,
          status: "succeeded",
          blockNumber: 456,
        },
      }),
      { now: 111 },
    );

    const expired = expireClaimableGift(claimable, { now: claimable.expiresAt });

    expect(expired.state).toBe("expired");
    expect(expired.expiredAt).toBe(claimable.expiresAt);
    expect(expired.recipient).toBeNull();
    expect(expired.claimTransactionHash).toBeNull();
  });

  it("refunds only to the original sender after expiry", () => {
    const expired = expireClaimableGift(
      markGiftClaimable(
        fundClaimableGift(createClaimableGift(input()), {
          now: 110,
          observation: {
            claimId: input().claimId,
            transactionHash: TX_HASH,
            chainId: BASE_SEPOLIA_CHAIN_ID,
            sender: SENDER,
            asset: TOKEN,
            amount: 500n,
            status: "succeeded",
            blockNumber: 456,
          },
        }),
        { now: 111 },
      ),
      { now: 200 },
    );

    const refunded = refundClaimableGift(expired, {
      now: 201,
      actor: SENDER,
      transactionHash: REFUND_TX_HASH,
      blockNumber: 790,
    });

    expect(refunded.state).toBe("refunded");
    expect(refunded.refundedAt).toBe(201);
    expect(refunded.refundTransactionHash).toBe(REFUND_TX_HASH);
    expect(refunded.refundRecipient).toBe(SENDER);
  });
});
