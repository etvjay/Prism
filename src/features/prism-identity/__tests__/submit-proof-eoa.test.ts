// TEST-8-2-1 / TEST-8-2-5 — EOA ladder class and wrong-signer negatives.

import { describe, expect, it } from "vitest";
import { PRISM_ERROR_CODE } from "../domain/errors";
import { presentedFromIssued, mutatePresented, makeEoaSigner } from "../testing/fixtures";
import {
  buildHarness,
  issueForAccount,
  makeOwnerWithAccount,
  PRISM_ID,
} from "./harness";

describe("SubmitProof — EOA class (TEST-8-2-1)", () => {
  it("verifies a valid EOA proof and records the signature class", async () => {
    const { service, store } = buildHarness();
    const { signer } = makeOwnerWithAccount();

    const view = await issueForAccount(service, signer.address.toLowerCase());
    const signature = await signer.signMessage({ message: view.messageToSign });

    const result = await service.submitProof({
      challengeId: view.challengeId,
      presented: presentedFromIssued(view),
      signature,
    });

    expect(result.status).toBe("verified");
    expect(result.signatureClass).toBe("EOA");
    expect(result.digest).toBe(view.digest);

    const stored = await store.getById(view.challengeId);
    expect(stored?.state).toBe("VERIFIED");
    expect(stored?.nonceState).toBe("CONSUMED");
    expect(stored?.verifiedSignatureClass).toBe("EOA");
  });

  it("rejects a wrong signer over an intact message with ERR-003 (TEST-8-2-5)", async () => {
    const { service, checker, store } = buildHarness();
    const owner = makeEoaSigner();
    const attacker = makeEoaSigner();

    const view = await issueForAccount(service, owner.address.toLowerCase());
    const signature = await attacker.signMessage({ message: view.messageToSign });

    // The attacker's EOA recovery mismatches; the account is not a registered
    // smart wallet either, so the 1271 branch rejects deterministically.
    checker.registerSmartAccount(
      owner.address.toLowerCase() as `0x${string}`,
      owner.address.toLowerCase() as `0x${string}`,
    );

    await expect(
      service.submitProof({
        challengeId: view.challengeId,
        presented: presentedFromIssued(view),
        signature,
      }),
    ).rejects.toMatchObject({
      code: PRISM_ERROR_CODE.INVALID_SIGNER,
      name: "invalid_signer",
    });

    const stored = await store.getById(view.challengeId);
    expect(stored?.state).toBe("REJECTED");
    expect(stored?.rejection?.code).toBe(PRISM_ERROR_CODE.INVALID_SIGNER);
  });

  it("keeps VERIFIED strictly non-canonical: no binding/resolve surface exists", async () => {
    const { service } = buildHarness();
    const { signer } = makeOwnerWithAccount();

    const view = await issueForAccount(service, signer.address.toLowerCase());
    const signature = await signer.signMessage({ message: view.messageToSign });
    const result = await service.submitProof({
      challengeId: view.challengeId,
      presented: presentedFromIssued(view),
      signature,
    });

    expect(result.status).toBe("verified");
    // Structural assertion of scope: the service's public surface is exactly
    // the three V8.1–V8.2 operations — no canonical bind/resolve/revoke
    // capability exists in any form (INV-SYS-003 / TEST-8-3-4 boundary).
    const capabilityKeys = Object.getOwnPropertyNames(Object.getPrototypeOf(service));
    const forbidden = ["bind", "canonical", "resolve", "revoke", "accept", "register"];
    expect(capabilityKeys.sort()).toEqual(
      expect.arrayContaining(["getChallenge", "issueChallenge", "submitProof"]),
    );
    for (const key of capabilityKeys) {
      for (const verb of forbidden) {
        expect(key.toLowerCase()).not.toContain(verb);
      }
    }
    expect(PRISM_ID).not.toMatch(/^0x[0-9a-fA-F]{40}$/); // INV-SYS-001 guard
  });

  it("treats an unknown challenge id as altered/unverifiable material (ERR-012)", async () => {
    const { service } = buildHarness();
    const { signer } = makeOwnerWithAccount();

    const view = await issueForAccount(service, signer.address.toLowerCase());
    const signature = await signer.signMessage({ message: view.messageToSign });

    await expect(
      service.submitProof({
        challengeId: ("0x" + "9".repeat(64)) as `0x${string}`,
        presented: mutatePresented(presentedFromIssued(view), {}),
        signature,
      }),
    ).rejects.toMatchObject({ code: PRISM_ERROR_CODE.ALTERED_MESSAGE, detail: "unknown_challenge" });
  });
});
