// Malformed vs unsupported signature classes fail distinctly (both ERR-014
// with distinct detail discriminators), and store failures on the submit path
// surface explicitly as ERR-021.

import { describe, expect, it } from "vitest";
import { PRISM_ERROR_CODE } from "../domain/errors";
import type { Hex } from "../domain/hex";
import { presentedFromIssued, makeEoaSigner } from "../testing/fixtures";
import { viemChallengeCrypto } from "../adapters/viem-crypto";
import { PrismChallengeService } from "../application/challenge-service";
import {
  buildHarness,
  issueForAccount,
  CHALLENGE_DOMAIN,
  PRISM_ID,
} from "./harness";

const BROKEN_STORE = {
  async putIssued(): Promise<void> {
    throw new Error("disk full");
  },
  async getById(): Promise<undefined> {
    throw new Error("disk full");
  },
  async consumeNonce() {
    return "unknown" as const;
  },
  async transitionState() {
    return false;
  },
};

describe("malformed and unsupported signatures", () => {
  it.each([
    { label: "empty bytes", signature: "0x" as Hex },
    { label: "odd-length hex", signature: "0xabc" as Hex },
    { label: "non-hex characters", signature: "0xzzzz" as Hex },
    {
      label: "65-byte ECDSA layout with invalid recovery byte",
      signature: ("0x" + "a1".repeat(64) + "2b") as Hex,
    },
  ])("rejects $label as malformed_signature", async ({ signature }) => {
    const { service } = buildHarness();
    const signer = makeEoaSigner();
    const view = await issueForAccount(service, signer.address.toLowerCase());

    await expect(
      service.submitProof({
        challengeId: view.challengeId,
        presented: presentedFromIssued(view),
        signature,
      }),
    ).rejects.toMatchObject({
      code: PRISM_ERROR_CODE.UNSUPPORTED_SIGNATURE_CLASS,
      detail: "malformed_signature",
    });
  });

  it("rejects a magic-suffixed blob that fails wrapper decoding as unsupported", async () => {
    const { service } = buildHarness();
    const signer = makeEoaSigner();
    const view = await issueForAccount(service, signer.address.toLowerCase());

    // Ends in the ERC-6492 magic value but the body is not decodable ABI.
    const brokenWrapper = (
      "0x" +
      "00".repeat(96) +
      "6492649264926492649264926492649264926492649264926492649264926492"
    ) as Hex;

    await expect(
      service.submitProof({
        challengeId: view.challengeId,
        presented: presentedFromIssued(view),
        signature: brokenWrapper,
      }),
    ).rejects.toMatchObject({
      code: PRISM_ERROR_CODE.UNSUPPORTED_SIGNATURE_CLASS,
      detail: "malformed_signature",
    });
  });

  it("rejects well-formed but unclassifiable blobs as unsupported_signature_class", async () => {
    const { service } = buildHarness();
    const signer = makeEoaSigner();
    const view = await issueForAccount(service, signer.address.toLowerCase());

    // 96 uniform bytes: no EOA layout, no ERC-6492 magic.
    const exoticBlob = ("0x" + "be".repeat(96)) as Hex;

    await expect(
      service.submitProof({
        challengeId: view.challengeId,
        presented: presentedFromIssued(view),
        signature: exoticBlob,
      }),
    ).rejects.toMatchObject({
      code: PRISM_ERROR_CODE.UNSUPPORTED_SIGNATURE_CLASS,
      detail: "unsupported_signature_class",
    });
  });

  it("marks the challenge REJECTED when verification rejects the signature class", async () => {
    const { service, store } = buildHarness();
    const signer = makeEoaSigner();
    const view = await issueForAccount(service, signer.address.toLowerCase());
    const presented = presentedFromIssued(view);

    await expect(
      service.submitProof({
        challengeId: view.challengeId,
        presented,
        signature: ("0x" + "be".repeat(96)) as Hex,
      }),
    ).rejects.toBeTruthy();

    const after = await store.getById(view.challengeId);
    // Consume happens on the attempt (CMD-B-02 irreversibility): the nonce is
    // burned and REJECTED is terminal — restart requires a fresh challenge.
    expect(after?.nonceState).toBe("CONSUMED");
    expect(after?.state).toBe("REJECTED");

    await expect(
      service.submitProof({
        challengeId: view.challengeId,
        presented,
        signature: await signer.signMessage({ message: view.messageToSign }),
      }),
    ).rejects.toMatchObject({ code: PRISM_ERROR_CODE.NONCE_ALREADY_USED });
  });

  it("maps store read failures on submit to an explicit dependency error", async () => {
    const harness = buildHarness();

    const healthy = new PrismChallengeService({
      clock: harness.clock,
      crypto: viemChallengeCrypto,
      checker: harness.checker,
      store: harness.store,
      policy: { defaultTtlSeconds: 600, defaultDomain: CHALLENGE_DOMAIN },
    });
    const failingReadService = new PrismChallengeService({
      clock: harness.clock,
      crypto: viemChallengeCrypto,
      checker: harness.checker,
      store: BROKEN_STORE,
      policy: { defaultTtlSeconds: 600, defaultDomain: CHALLENGE_DOMAIN },
    });

    const signer = makeEoaSigner();
    const view = await healthy.issueChallenge({
      prismId: PRISM_ID,
      venue: "BASE",
      executionAccount: signer.address.toLowerCase(),
    });

    await expect(
      failingReadService.submitProof({
        challengeId: view.challengeId,
        presented: presentedFromIssued(view),
        signature: "0xabcd" as Hex,
      }),
    ).rejects.toMatchObject({
      code: PRISM_ERROR_CODE.RPC_UNAVAILABLE,
      detail: "challenge_store_unavailable:disk full",
    });
  });
});
