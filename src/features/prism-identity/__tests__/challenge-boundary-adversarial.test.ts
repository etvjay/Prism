import { describe, expect, it } from "vitest";
import { PRISM_ERROR_CODE } from "../domain/errors";
import { makeEoaSigner } from "../testing/fixtures";
import { buildHarness, issueForAccount, PRISM_ID } from "./harness";

// X2 — TEST DOUBLE: challenge/proof verification boundary, no live Base RPC.

describe("challenge presentation fail-closed validation", () => {
  it("maps a structurally malformed execution account echo to altered_fields", async () => {
    const { service } = buildHarness();
    const signer = makeEoaSigner();
    const view = await issueForAccount(service, signer.address.toLowerCase());

    await expect(service.submitProof({
      challengeId: view.challengeId,
      presented: {
        chainId: view.chainId,
        domain: view.domain,
        venue: "BASE",
        executionAccount: undefined as never,
        prismId: PRISM_ID,
        nonce: view.nonce,
        expiresAt: view.expiresAt,
        schemaVersion: view.schemaVersion,
      },
      signature: "0x" as never,
    })).rejects.toMatchObject({
      code: PRISM_ERROR_CODE.ALTERED_MESSAGE,
      detail: "altered_fields:execution_account",
    });
  });
});
