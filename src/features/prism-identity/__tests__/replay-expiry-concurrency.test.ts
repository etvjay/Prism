// TEST-8-1-2 / TEST-8-1-3 — single-use nonce under repetition and concurrency,
// expiry boundary behavior, and ERR-006/ERR-013 distinctness.

import { describe, expect, it } from "vitest";
import { PRISM_ERROR_CODE } from "../domain/errors";
import type { PrismError } from "../domain/errors";
import { presentedFromIssued, makeEoaSigner } from "../testing/fixtures";
import {
  buildHarness,
  issueForAccount,
} from "./harness";

describe("single-use nonce (TEST-8-1-2, INV-SYS-010)", () => {
  it("fails a second submission with ERR-006 even when the signature is valid", async () => {
    const { service } = buildHarness();
    const signer = makeEoaSigner();

    const view = await issueForAccount(service, signer.address.toLowerCase());
    const signature = await signer.signMessage({ message: view.messageToSign });
    const presented = presentedFromIssued(view);

    await expect(
      service.submitProof({ challengeId: view.challengeId, presented, signature }),
    ).resolves.toMatchObject({ status: "verified" });

    await expect(
      service.submitProof({ challengeId: view.challengeId, presented, signature }),
    ).rejects.toMatchObject({ code: PRISM_ERROR_CODE.NONCE_ALREADY_USED });

    // A freshly signed (still valid) signature over the same challenge is
    // equally replay: consumption precedes verification.
    await expect(
      service.submitProof({
        challengeId: view.challengeId,
        presented,
        signature: await signer.signMessage({ message: view.messageToSign }),
      }),
    ).rejects.toMatchObject({ code: PRISM_ERROR_CODE.NONCE_ALREADY_USED });
  });

  it("yields exactly one VERIFIED under concurrent verification", async () => {
    const { service } = buildHarness();
    const signer = makeEoaSigner();

    const view = await issueForAccount(service, signer.address.toLowerCase());
    const signature = await signer.signMessage({ message: view.messageToSign });
    const presented = presentedFromIssued(view);

    const attempts = 8;
    const outcomes = await Promise.allSettled(
      Array.from({ length: attempts }, () =>
        service.submitProof({ challengeId: view.challengeId, presented, signature }),
      ),
    );

    const verified = outcomes.filter(
      (outcome) => outcome.status === "fulfilled",
    ) as PromiseFulfilledResult<{ status: string }>[];
    const rejected = outcomes.filter(
      (outcome) => outcome.status === "rejected",
    ) as PromiseRejectedResult[];

    expect(verified).toHaveLength(1);
    expect(verified[0].value.status).toBe("verified");
    expect(rejected).toHaveLength(attempts - 1);
    for (const rejection of rejected) {
      expect(rejection.reason).toBeInstanceOf(Error);
      expect((rejection.reason as PrismError).code).toBe(PRISM_ERROR_CODE.NONCE_ALREADY_USED);
    }
  });

  it("keeps exactly-one-winner when a forged attempt races the real owner", async () => {
    const { service } = buildHarness();
    const owner = makeEoaSigner();
    const attacker = makeEoaSigner();

    const view = await issueForAccount(service, owner.address.toLowerCase());
    const [ownerSignature, attackerSignature] = await Promise.all([
      owner.signMessage({ message: view.messageToSign }),
      attacker.signMessage({ message: view.messageToSign }),
    ]);
    const presented = presentedFromIssued(view);

    const outcomes = await Promise.allSettled([
      service.submitProof({ challengeId: view.challengeId, presented, signature: ownerSignature }),
      service.submitProof({ challengeId: view.challengeId, presented, signature: attackerSignature }),
    ]);

    const fulfilled = outcomes.filter((outcome) => outcome.status === "fulfilled");
    expect(fulfilled).toHaveLength(1);
  });

  it("rejects a signature minted over another chain's message with ERR-003", async () => {
    // Schema v2 chain binding (audit F-1): the same account signing on a
    // different network produces different personal_sign bytes. The server
    // re-renders the message from its stored authoritative copy (Base
    // Sepolia), so a signature over the Base-mainnet rendering cannot verify.
    const { service, store } = buildHarness();
    const signer = makeEoaSigner();

    const view = await issueForAccount(service, signer.address.toLowerCase());
    const crossChainMessage = view.messageToSign.replace(
      `Chain ID: ${view.chainId}`,
      "Chain ID: 8453",
    );
    expect(crossChainMessage).not.toBe(view.messageToSign);
    const signature = await signer.signMessage({ message: crossChainMessage });

    await expect(
      service.submitProof({
        challengeId: view.challengeId,
        presented: presentedFromIssued(view),
        signature,
      }),
    ).rejects.toMatchObject({ code: PRISM_ERROR_CODE.INVALID_SIGNER });

    // The failed attempt consumes the nonce (consume-on-attempt) — the proof
    // was bound to the wrong chain and is dead, not retryable elsewhere.
    const stored = await store.getById(view.challengeId);
    expect(stored?.state).toBe("REJECTED");
  });
});

describe("expiry (TEST-8-1-3)", () => {
  it("accepts just before the TTL boundary", async () => {
    const harness = buildHarness();
    const { service } = harness;
    const signer = makeEoaSigner();

    const view = await issueForAccount(service, signer.address.toLowerCase());
    const signature = await signer.signMessage({ message: view.messageToSign });
    harness.clock.setTo(view.expiresAt - 1);

    await expect(
      service.submitProof({
        challengeId: view.challengeId,
        presented: presentedFromIssued(view),
        signature,
      }),
    ).resolves.toMatchObject({ status: "verified", signatureClass: "EOA" });
  });

  it("rejects exactly at the TTL boundary with ERR-013 and marks EXPIRED", async () => {
    const harness = buildHarness();
    const { service, store } = harness;
    const signer = makeEoaSigner();

    const view = await issueForAccount(service, signer.address.toLowerCase());
    const signature = await signer.signMessage({ message: view.messageToSign });
    harness.clock.setTo(view.expiresAt);

    await expect(
      service.submitProof({
        challengeId: view.challengeId,
        presented: presentedFromIssued(view),
        signature,
      }),
    ).rejects.toMatchObject({
      code: PRISM_ERROR_CODE.PROOF_EXPIRED,
      name: "proof_expired",
      httpStatusHint: 410,
    });

    const stored = await store.getById(view.challengeId);
    expect(stored?.state).toBe("EXPIRED");
    // Expiry does not burn the nonce as CONSUMED — it is its own terminal state.
    expect(stored?.nonceState).toBe("UNUSED");
  });

  it("reports EXPIRED state on later submissions instead of replay semantics", async () => {
    const harness = buildHarness();
    const { service } = harness;
    const signer = makeEoaSigner();

    const view = await issueForAccount(service, signer.address.toLowerCase());
    harness.clock.advance(601);

    await expect(
      service.submitProof({
        challengeId: view.challengeId,
        presented: presentedFromIssued(view),
        signature: await signer.signMessage({ message: view.messageToSign }),
      }),
    ).rejects.toMatchObject({ code: PRISM_ERROR_CODE.PROOF_EXPIRED });
  });
});
