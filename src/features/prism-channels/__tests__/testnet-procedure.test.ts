import { describe, it, expect } from "vitest";
import { PrismChannelService } from "../application/channel-service";
import { InMemoryChannelStore, InMemoryMessageStore, InMemoryKeyCommitmentPort, InMemoryPublicChainPublisher, FixedClock, SequentialIdGenerator } from "../adapters/memory-channel-store";
import { ALICE, BOB, makeCommitment, makeCiphertext, opaqueRef } from "../testing/fixtures";
import { buildC1Fixture, C1_TESTNET_PROCEDURE } from "../testing/testnet-procedure";

function makeService(now = 3_000_000) {
  const channelStore = new InMemoryChannelStore();
  const messageStore = new InMemoryMessageStore();
  const keyPort = new InMemoryKeyCommitmentPort();
  const publisher = new InMemoryPublicChainPublisher();
  const clock = new FixedClock(now);
  const ids = new SequentialIdGenerator();
  const svc = new PrismChannelService({ channelStore, messageStore, keyCommitmentPort: keyPort, publicPublisher: publisher, clock, idGenerator: ids });
  return { svc, channelStore, messageStore, keyPort, publisher, clock, ids };
}

describe("C1 testnet procedure / evidence fixture — independent read requirements (S4, AUDIT T8/T11, X2/X3)", () => {
  it("executes full S4 vertical slice with independent read fixture (X2)", async () => {
    const { svc, channelStore, messageStore, keyPort, publisher, clock } = makeService();
    keyPort.register(ALICE, makeCommitment(ALICE, "testnet-a"));
    keyPort.register(BOB, makeCommitment(BOB, "testnet-b"));

    // Step 1: create PROPOSED
    const ch1 = await svc.createChannel({ initiator: ALICE, peer: BOB, channelId: "ch_tn_01" });
    expect(ch1.status).toBe("PROPOSED");
    // Step 2: independent read sees PROPOSED
    const indep1 = await svc.independentRead("ch_tn_01", "reader_b");
    expect(indep1.channel?.status).toBe("PROPOSED");
    expect(indep1.channel?.channelId).toBe("ch_tn_01");

    // Step 3: accept -> ACTIVE
    clock.advance(10);
    const ch2 = await svc.acceptChannel({ channelId: "ch_tn_01", caller: BOB });
    expect(ch2.status).toBe("ACTIVE");
    // Separate commitments distinct
    expect(ch2.keyCommitments[ALICE]).not.toEqual(ch2.keyCommitments[BOB]);

    // Step 4: independent read sees ACTIVE
    const indep2 = await svc.independentRead("ch_tn_01", "reader_a");
    expect(indep2.channel?.status).toBe("ACTIVE");

    // Step 5: ALICE sends payment_memo ciphertext
    clock.advance(10);
    const m1 = await svc.sendMessage({ channelId: "ch_tn_01", sender: ALICE, ciphertext: makeCiphertext("payment-memo-secret"), contentType: "payment_memo", messageId: "msg_tn_01", paymentRef: opaqueRef("pay-tn-1") });
    expect(m1.contentType).toBe("payment_memo");
    expect(m1.ciphertext).toMatch(/^0x[0-9a-fA-F]{64,}$/);

    // Step 6: BOB reads via authorized participant
    const bMsgs = await svc.listMessages("ch_tn_01", BOB);
    expect(bMsgs.length).toBe(1);
    expect(bMsgs[0].messageId).toBe("msg_tn_01");

    // Step 7: independent read of messages
    const indepMsgs = await svc.independentRead("ch_tn_01", "independent_reader");
    expect(indepMsgs.messages.length).toBe(1);

    // Step 8: BOB sends receipt
    clock.advance(10);
    const m2 = await svc.sendMessage({ channelId: "ch_tn_01", sender: BOB, ciphertext: makeCiphertext("receipt-secret"), contentType: "receipt", messageId: "msg_tn_02", receiptRef: opaqueRef("rcpt-tn-1") });
    expect(m2.contentType).toBe("receipt");

    // Step 9: archive
    clock.advance(10);
    const archived = await svc.archiveChannel("ch_tn_01", ALICE);
    expect(archived.status).toBe("ARCHIVED");

    // Step 10: independent read sees ARCHIVED
    const indep3 = await svc.independentRead("ch_tn_01", "reader_a");
    expect(indep3.channel?.status).toBe("ARCHIVED");

    // Build evidence fixture
    const channels = await channelStore.listByParticipant(ALICE);
    const messages = await messageStore.listByChannel("ch_tn_01");
    const pub = await publisher.getPublished();
    const fixture = buildC1Fixture({ channels, messages, publicCommitments: [...pub] });

    // Fixture requirements
    expect(fixture.procedure.length).toBe(C1_TESTNET_PROCEDURE.length);
    expect(fixture.independentReadRequirement).toContain("separate");
    expect(fixture.noPlaintextRequirement).toContain("ERR-041");
    expect(fixture.keySeparationRequirement).toContain("INV-PRISM-012");
    expect(fixture.maturity).toBe("X2");
    expect(fixture.limitations.length).toBeGreaterThan(0);
    // No plaintext on public surface
    const leaks = await publisher.scanForPlaintext();
    expect(leaks.length).toBe(0);
  });

  it("revoke path documented as alternative terminal (step 11)", async () => {
    const { svc, keyPort } = makeService();
    keyPort.register(ALICE, makeCommitment(ALICE, "rev-a"));
    keyPort.register(BOB, makeCommitment(BOB, "rev-b"));
    await svc.createChannel({ initiator: ALICE, peer: BOB, channelId: "ch_tn_rev" });
    await svc.acceptChannel({ channelId: "ch_tn_rev", caller: BOB });
    await svc.revokeChannel("ch_tn_rev", BOB);
    const indep = await svc.independentRead("ch_tn_rev", "reader");
    expect(indep.channel?.status).toBe("REVOKED");
  });
});
