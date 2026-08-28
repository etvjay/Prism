import { describe, expect, it } from "vitest";
import { derivePublicGiftEvents, toPublicGiftProjection } from "../domain/public-projection";
import { createClaimableGift } from "../domain/claimable-gift";

const HASH = `0x${"a".repeat(64)}` as `0x${string}`;
const TOKEN = `0x${"b".repeat(40)}` as `0x${string}`;
const SENDER = `0x${"c".repeat(40)}` as `0x${string}`;

describe("public claimable-gift projection", () => {
  it("serializes deliberate lifecycle metadata without proof, memo, or viewing-key material", () => {
    const gift = createClaimableGift({
      claimId: "gift_01H00000000000000000000000",
      sender: SENDER,
      asset: TOKEN,
      amount: 500n,
      chainId: 84532,
      expiresAt: 200,
      nullifierCommitment: HASH,
      now: 100,
    });

    const projection = toPublicGiftProjection(gift);

    expect(projection).toMatchObject({
      claimId: gift.claimId,
      network: "BASE_SEPOLIA",
      chainId: 84532,
      state: "created",
      asset: TOKEN,
      amount: "500",
      expiresAt: 200,
      sender: SENDER,
      recipientBound: false,
    });
    expect(projection).not.toHaveProperty("proof");
    expect(projection).not.toHaveProperty("viewingKey");
    expect(projection).not.toHaveProperty("nullifierCommitment");
    expect(JSON.stringify(projection)).not.toMatch(/memo|private|proof|viewing/i);
  });

  it("emits an explicit created lifecycle event for a new gift", () => {
    const gift = createClaimableGift({
      claimId: "gift_01H00000000000000000000000",
      sender: SENDER,
      asset: TOKEN,
      amount: 500n,
      chainId: 84532,
      expiresAt: 200,
      nullifierCommitment: HASH,
      now: 100,
    });

    const events = derivePublicGiftEvents(gift);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "created",
      eventName: "GiftCreated",
      claimId: gift.claimId,
      network: "BASE_SEPOLIA",
      chainId: 84532,
      asset: TOKEN,
      amount: "500",
      expiresAt: 200,
    });
    expect(events[0]).not.toHaveProperty("proof");
    expect(events[0]).not.toHaveProperty("recipientAddress");
    expect(events[0]).not.toHaveProperty("nullifierCommitment");
  });
});
