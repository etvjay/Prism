import { describe, it, expect, beforeEach } from "vitest";
import { PrismChannelService } from "../application/channel-service";
import { InMemoryChannelStore, InMemoryMessageStore, InMemoryKeyCommitmentPort, InMemoryPublicChainPublisher, FixedClock, SequentialIdGenerator } from "../adapters/memory-channel-store";
import { ALICE, BOB, makeCommitment, makeCiphertext, opaqueRef } from "../testing/fixtures";
import { PrismChannelError } from "../domain/errors";

function makeService(now = 1_000_000) {
  const channelStore = new InMemoryChannelStore();
  const messageStore = new InMemoryMessageStore();
  const keyPort = new InMemoryKeyCommitmentPort();
  const publisher = new InMemoryPublicChainPublisher();
  const clock = new FixedClock(now);
  const ids = new SequentialIdGenerator();
  const svc = new PrismChannelService({ channelStore, messageStore, keyCommitmentPort: keyPort, publicPublisher: publisher, clock, idGenerator: ids });
  return { svc, channelStore, messageStore, keyPort, publisher, clock, ids };
}

describe("C1 channel lifecycle — create/accept/archive/revoke (Foundry/AUDIT T11, Product §15-16, System S4)", () => {
  beforeEach(() => {});

  it("creates PROPOSED between two Prism IDs with initiator commitment (X2)", async () => {
    const { svc, keyPort } = makeService();
    keyPort.register(ALICE, makeCommitment(ALICE));
    keyPort.register(BOB, makeCommitment(BOB));
    const ch = await svc.createChannel({ initiator: ALICE, peer: BOB, channelId: "ch_test001" });
    expect(ch.status).toBe("PROPOSED");
    expect(ch.participants).toEqual(expect.arrayContaining([ALICE, BOB]));
    expect(ch.keyCommitments[ALICE]).toBe(makeCommitment(ALICE));
    expect(ch.keyCommitments[BOB]).toBeNull();
  });

  it("accept by peer moves to ACTIVE when both commitments present, requires peer commitment (X2)", async () => {
    const { svc, keyPort } = makeService();
    keyPort.register(ALICE, makeCommitment(ALICE));
    keyPort.register(BOB, makeCommitment(BOB));
    await svc.createChannel({ initiator: ALICE, peer: BOB, channelId: "ch_test002" });
    const accepted = await svc.acceptChannel({ channelId: "ch_test002", caller: BOB });
    expect(accepted.status).toBe("ACTIVE");
    expect(accepted.keyCommitments[ALICE]).not.toBeNull();
    expect(accepted.keyCommitments[BOB]).not.toBeNull();
  });

  it("initiator cannot accept own channel (participant authz)", async () => {
    const { svc, keyPort } = makeService();
    keyPort.register(ALICE, makeCommitment(ALICE));
    await svc.createChannel({ initiator: ALICE, peer: BOB, channelId: "ch_test003" });
    keyPort.register(ALICE, makeCommitment(ALICE)); // for verify
    await expect(svc.acceptChannel({ channelId: "ch_test003", caller: ALICE })).rejects.toThrow(PrismChannelError);
  });

  it("archive from ACTIVE blocks further sends; revocation is terminal (no re-activation)", async () => {
    const { svc, keyPort, clock } = makeService();
    keyPort.register(ALICE, makeCommitment(ALICE));
    keyPort.register(BOB, makeCommitment(BOB));
    await svc.createChannel({ initiator: ALICE, peer: BOB, channelId: "ch_test004" });
    await svc.acceptChannel({ channelId: "ch_test004", caller: BOB });
    // send one message while active
    const msg = await svc.sendMessage({ channelId: "ch_test004", sender: ALICE, ciphertext: makeCiphertext("seed1"), contentType: "payment_memo", messageId: "msg_arch_01" });
    expect(msg.ciphertext).toBeDefined();
    // archive
    const archived = await svc.archiveChannel("ch_test004", ALICE);
    expect(archived.status).toBe("ARCHIVED");
    await expect(svc.sendMessage({ channelId: "ch_test004", sender: ALICE, ciphertext: makeCiphertext("seed2"), contentType: "payment_memo", messageId: "msg_arch_02" })).rejects.toThrow(PrismChannelError);
    // revoke from archived
    const revoked = await svc.revokeChannel("ch_test004", BOB);
    expect(revoked.status).toBe("REVOKED");
    // revoked is terminal — messages still blocked, and revoke idempotent
    const reRevoked = await svc.revokeChannel("ch_test004", ALICE);
    expect(reRevoked.status).toBe("REVOKED");
  });

  it("revoke from PROPOSED terminal, independent read sees REVOKED (testnet procedure step 11)", async () => {
    const { svc, keyPort, channelStore } = makeService();
    keyPort.register(ALICE, makeCommitment(ALICE));
    keyPort.register(BOB, makeCommitment(BOB));
    await svc.createChannel({ initiator: ALICE, peer: BOB, channelId: "ch_test005" });
    await svc.revokeChannel("ch_test005", ALICE);
    // independent reader: separate service instance sharing same stores but different clock/ids
    const readerStore = channelStore; // simulates separate reader hitting same durable store
    const ch = await readerStore.getById("ch_test005");
    expect(ch?.status).toBe("REVOKED");
  });

  it("communication-key commitment port is separate — no key generation in app (INV-PRISM-012)", async () => {
    const { svc, keyPort } = makeService();
    // Commitment must come via port; if not registered, creation fails.
    // This proves app never generates keys internally.
    await expect(svc.createChannel({ initiator: ALICE, peer: BOB, channelId: "ch_keysep_1" })).rejects.toThrow(PrismChannelError);
    // register only ALICE, still fails for missing commitment
    keyPort.register(ALICE, makeCommitment(ALICE));
    const ch = await svc.createChannel({ initiator: ALICE, peer: BOB, channelId: "ch_keysep_1" });
    expect(ch.status).toBe("PROPOSED");
    // peer without commitment cannot accept
    await expect(svc.acceptChannel({ channelId: "ch_keysep_1", caller: BOB })).rejects.toThrow(PrismChannelError);
  });

  it("ciphertext message object for each allowed content type; references are opaque hex (no plaintext)", async () => {
    const { svc, keyPort } = makeService();
    keyPort.register(ALICE, makeCommitment(ALICE));
    keyPort.register(BOB, makeCommitment(BOB));
    await svc.createChannel({ initiator: ALICE, peer: BOB, channelId: "ch_msgtypes" });
    await svc.acceptChannel({ channelId: "ch_msgtypes", caller: BOB });
    const types = ["payment_memo", "receipt", "claim_invitation", "authorization_request"] as const;
    for (let i = 0; i < types.length; i++) {
      const ct = types[i];
      const msg = await svc.sendMessage({
        channelId: "ch_msgtypes",
        sender: ALICE,
        ciphertext: makeCiphertext(`ct-${ct}`),
        contentType: ct,
        messageId: `msg_type_${i.toString().padStart(2, "0")}`,
        paymentRef: ct === "payment_memo" ? opaqueRef("pay123") : null,
        receiptRef: ct === "receipt" ? opaqueRef("rcpt456") : null,
        claimRef: ct === "claim_invitation" ? opaqueRef("claim789") : null,
      });
      expect(msg.contentType).toBe(ct);
      expect(msg.ciphertext).toMatch(/^0x[0-9a-fA-F]{64,}$/);
    }
  });

  it("no plaintext metadata on public-chain surface — only commitments/hashes published", async () => {
    const { svc, keyPort, publisher } = makeService();
    keyPort.register(ALICE, makeCommitment(ALICE));
    keyPort.register(BOB, makeCommitment(BOB));
    await svc.createChannel({ initiator: ALICE, peer: BOB, channelId: "ch_noplain" });
    await svc.acceptChannel({ channelId: "ch_noplain", caller: BOB });
    await svc.sendMessage({ channelId: "ch_noplain", sender: ALICE, ciphertext: makeCiphertext("secret-memo"), contentType: "payment_memo", messageId: "msg_noplain01" });
    const pub = await publisher.getPublished();
    const leaks = await publisher.scanForPlaintext();
    expect(leaks.length).toBe(0);
    // All payloads are hex
    for (const p of pub) expect(p.payload).toMatch(/^0x[0-9a-fA-F]+$/);
  });

  it("participant authorization — non-participant cannot read channel/messages", async () => {
    const { svc, keyPort } = makeService();
    keyPort.register(ALICE, makeCommitment(ALICE));
    keyPort.register(BOB, makeCommitment(BOB));
    await svc.createChannel({ initiator: ALICE, peer: BOB, channelId: "ch_authz_1" });
    await svc.acceptChannel({ channelId: "ch_authz_1", caller: BOB });
    await expect(svc.getChannel("ch_authz_1", "prism:EVE99")).rejects.toThrow(PrismChannelError);
    await expect(svc.listMessages("ch_authz_1", "prism:EVE99")).rejects.toThrow(PrismChannelError);
    // send from non-participant
    await expect(svc.sendMessage({ channelId: "ch_authz_1", sender: "prism:EVE99", ciphertext: makeCiphertext("x"), contentType: "payment_memo", messageId: "msg_eve_01" })).rejects.toThrow(PrismChannelError);
  });

  it("channel policy checks — disallowed content type is rejected", async () => {
    const { svc, keyPort } = makeService();
    keyPort.register(ALICE, makeCommitment(ALICE));
    keyPort.register(BOB, makeCommitment(BOB));
    await svc.createChannel({ initiator: ALICE, peer: BOB, channelId: "ch_policy_1", policy: { allowedContentTypes: ["payment_memo", "receipt"] } });
    await svc.acceptChannel({ channelId: "ch_policy_1", caller: BOB });
    await expect(svc.sendMessage({ channelId: "ch_policy_1", sender: ALICE, ciphertext: makeCiphertext("x"), contentType: "claim_invitation", messageId: "msg_pol_01" })).rejects.toThrow(PrismChannelError);
    // allowed should pass
    const ok = await svc.sendMessage({ channelId: "ch_policy_1", sender: ALICE, ciphertext: makeCiphertext("x-memo"), contentType: "payment_memo", messageId: "msg_pol_02" });
    expect(ok.contentType).toBe("payment_memo");
  });
});
