// TEST-8-2-4 — mutation matrix: altering any bound field of the presented
// challenge fails verification with ERR-012 (altered_message), each with a
// distinct, recorded detail (INV-SYS-011 / A8-3).

import { describe, expect, it } from "vitest";
import { PRISM_ERROR_CODE } from "../domain/errors";
import {
  presentedFromIssued,
  mutatePresented,
  makeEoaSigner,
} from "../testing/fixtures";
import { buildHarness, issueForAccount } from "./harness";

describe("mutation matrix (TEST-8-2-4)", () => {
  it("fails with ERR-012 for each mutated binding field", async () => {
    const { service } = buildHarness();
    const signer = makeEoaSigner();

    const view = await issueForAccount(service, signer.address.toLowerCase());
    const signature = await signer.signMessage({ message: view.messageToSign });
    const base = presentedFromIssued(view);

    // The venue enum has one member; the mutation substitutes an unsupported
    // value to prove even enum-invalid echoes are caught as tamper evidence.
    const mutations: Array<{ field: string; patch: Record<string, unknown>; expectedDetail: string }> = [
      { field: "prism_id", patch: { prismId: "prism:ZZZZ99" }, expectedDetail: "altered_fields:prism_id" },
      { field: "execution_account", patch: { executionAccount: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }, expectedDetail: "altered_fields:execution_account" },
      { field: "domain", patch: { domain: "evil.example" }, expectedDetail: "altered_fields:domain" },
      { field: "venue", patch: { venue: "SOLANA" }, expectedDetail: "altered_fields:venue" },
      { field: "nonce", patch: { nonce: ("0x" + "cd".repeat(32)) as `0x${string}` }, expectedDetail: "altered_fields:nonce" },
      { field: "expiry", patch: { expiresAt: view.expiresAt + 3600 }, expectedDetail: "altered_fields:expiry" },
    ];

    for (const mutation of mutations) {
      let captured: unknown;
      try {
        await service.submitProof({
          challengeId: view.challengeId,
          presented: mutatePresented(base, mutation.patch as Parameters<typeof mutatePresented>[1]),
          signature,
        });
      } catch (failure) {
        captured = failure;
      }
      expect(captured, `mutation of ${mutation.field} must throw`).toBeInstanceOf(Error);
      const err = captured as { code?: string; detail?: string };
      expect(err.code, `mutation of ${mutation.field}`).toBe(PRISM_ERROR_CODE.ALTERED_MESSAGE);
      expect(err.detail, `mutation of ${mutation.field}`).toBe(mutation.expectedDetail);
    }
  });

  it("does not consume the nonce when the echo is unfaithful", async () => {
    const { service, store } = buildHarness();
    const signer = makeEoaSigner();

    const view = await issueForAccount(service, signer.address.toLowerCase());
    const signature = await signer.signMessage({ message: view.messageToSign });
    const base = presentedFromIssued(view);

    await expect(
      service.submitProof({
        challengeId: view.challengeId,
        presented: mutatePresented(base, { prismId: "prism:TAMPER" }),
        signature,
      }),
    ).rejects.toMatchObject({ code: PRISM_ERROR_CODE.ALTERED_MESSAGE });

    const stored = await store.getById(view.challengeId);
    // Digest check precedes consumption: tampered submissions never burn the
    // single-use property — the challenge remains ISSUED/UNUSED.
    expect(stored?.state).toBe("ISSUED");
    expect(stored?.nonceState).toBe("UNUSED");
  });
});
