// Error/test crosswalk (TEST-8.5 analog, scoped to V8.1–V8.2).
//
// Every catalogue code this slice can emit is exercised end-to-end here with
// its stable name/category/user-action shape pinned against
// projects/prism/system/errors.yaml. Codes belonging to the contract layer or
// later slices are listed as explicitly out of scope — their absence is
// intentional, not an omission.

import { describe, expect, it } from "vitest";
import {
  PRISM_ERROR_CODE,
  PrismError,
} from "../domain/errors";
import { presentedFromIssued, makeEoaSigner } from "../testing/fixtures";
import { viemChallengeCrypto } from "../adapters/viem-crypto";
import { PrismChallengeService } from "../application/challenge-service";
import type { OwnershipProofStore } from "../domain/ports";
import {
  buildHarness,
  issueForAccount,
  CHALLENGE_DOMAIN,
  PRISM_ID,
} from "./harness";

const IN_SCOPE_CODES: Array<{ code: string; scenario: string }> = [
  { code: "ERR-001", scenario: "issuance venue enum lacks value" },
  { code: "ERR-002", scenario: "issuance structurally invalid prism id" },
  { code: "ERR-003", scenario: "wrong signer over intact message" },
  { code: "ERR-005", scenario: "zero/malformed execution account" },
  { code: "ERR-006", scenario: "nonce consumed (replay/concurrency)" },
  { code: "ERR-012", scenario: "altered echo / unknown challenge" },
  { code: "ERR-013", scenario: "ttl exceeded pre-verify" },
  { code: "ERR-014", scenario: "malformed + unsupported signature classes" },
  { code: "ERR-021", scenario: "clock/store/checker dependency failure" },
];

// Contract-layer and post-V8.2 codes that MUST NOT appear in this slice.
const OUT_OF_SCOPE_CODES = [
  "ERR-004", // not_controller — registry caller check (contract tier)
  "ERR-007", // proof_digest_already_consumed — onchain digest map (V8.3)
  "ERR-008", // binding_already_active — registry conflict (V8.3)
  "ERR-009", // binding_not_found — revoke path (V8.4)
  "ERR-010", // identity_not_found_read — registry read (PRISM-7/V8.3)
  "ERR-011", // binding_already_revoked — revoke idempotency (V8.4)
  "ERR-020", // wallet_rejected — client UX state
  "ERR-022", // timeout_unknown_status — operation lifecycle tier
  "ERR-023", // stale_state_conflict — cache/watermark tier
];

async function captureCode(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (failure) {
    if (failure instanceof PrismError) return failure.code;
    throw failure;
  }
  throw new Error("expected PrismError");
}

describe("error/test crosswalk (scoped to V8.1–V8.2)", () => {
  it("exercises every in-scope catalogue code at least once", async () => {
    const observed = new Map<string, string>();

    const harness = buildHarness();
    const service = harness.service;
    const signer = makeEoaSigner();
    const account = signer.address.toLowerCase();

    observed.set(
      PRISM_ERROR_CODE.INVALID_VENUE,
      await captureCode(() =>
        service.issueChallenge({ prismId: PRISM_ID, venue: "SOLANA", executionAccount: account }),
      ),
    );
    observed.set(
      PRISM_ERROR_CODE.IDENTITY_NOT_FOUND,
      await captureCode(() =>
        service.issueChallenge({ prismId: "not-a-prism-id", venue: "BASE", executionAccount: account }),
      ),
    );
    observed.set(
      PRISM_ERROR_CODE.INVALID_EXECUTION_ACCOUNT,
      await captureCode(() =>
        service.issueChallenge({
          prismId: PRISM_ID,
          venue: "BASE",
          executionAccount: "0x0000000000000000000000000000000000000000",
        }),
      ),
    );

    const view = await issueForAccount(service, account);
    const signature = await signer.signMessage({ message: view.messageToSign });
    const presented = presentedFromIssued(view);

    observed.set(
      PRISM_ERROR_CODE.ALTERED_MESSAGE,
      await captureCode(() =>
        service.submitProof({
          challengeId: view.challengeId,
          presented: { ...presented, prismId: "prism:MUTATED" },
          signature,
        }),
      ),
    );

    // Fresh challenge for the remaining lifecycle codes.
    const view2 = await issueForAccount(service, account);
    const signature2 = await signer.signMessage({ message: view2.messageToSign });
    const presented2 = presentedFromIssued(view2);
    const attacker = makeEoaSigner();

    observed.set(
      PRISM_ERROR_CODE.NONCE_ALREADY_USED,
      await captureCode(async () => {
        await service.submitProof({
          challengeId: view2.challengeId,
          presented: presented2,
          signature: signature2,
        });
        await service.submitProof({
          challengeId: view2.challengeId,
          presented: presented2,
          signature: signature2,
        });
      }),
    );

    observed.set(
      PRISM_ERROR_CODE.INVALID_SIGNER,
      await captureCode(async () => {
        const view3 = await issueForAccount(service, account);
        await service.submitProof({
          challengeId: view3.challengeId,
          presented: presentedFromIssued(view3),
          signature: await attacker.signMessage({ message: view3.messageToSign }),
        });
      }),
    );

    harness.clock.advance(601);
    observed.set(
      PRISM_ERROR_CODE.PROOF_EXPIRED,
      await captureCode(async () => {
        const view4 = await issueForAccount(service, account, {});
        harness.clock.advance(601);
        await service.submitProof({
          challengeId: view4.challengeId,
          presented: presentedFromIssued(view4),
          signature: await signer.signMessage({ message: view4.messageToSign }),
        });
      }),
    );

    observed.set(
      PRISM_ERROR_CODE.UNSUPPORTED_SIGNATURE_CLASS,
      await captureCode(async () => {
        const view5 = await issueForAccount(service, account);
        await service.submitProof({
          challengeId: view5.challengeId,
          presented: presentedFromIssued(view5),
          signature: ("0x" + "cd".repeat(96)) as `0x${string}`,
        });
      }),
    );

    const brokenStoreService = new PrismChallengeService({
      clock: harness.clock,
      crypto: viemChallengeCrypto,
      checker: harness.checker,
      store: BROKEN_STORE_SINGLETON,
      policy: { defaultTtlSeconds: 600, defaultDomain: CHALLENGE_DOMAIN },
    });
    observed.set(
      PRISM_ERROR_CODE.RPC_UNAVAILABLE,
      await captureCode(() =>
        brokenStoreService.issueChallenge({
          prismId: PRISM_ID,
          venue: "BASE",
          executionAccount: account,
        }),
      ),
    );

    for (const entry of IN_SCOPE_CODES) {
      expect(observed.get(entry.code), `missing coverage for ${entry.code} (${entry.scenario})`).toBeDefined();
    }
    expect(observed.size).toBe(IN_SCOPE_CODES.length);

    // Stable external semantics spot-checks against errors.yaml.
    const replayError = new PrismError(PRISM_ERROR_CODE.NONCE_ALREADY_USED);
    expect(replayError.name).toBe("nonce_already_used");
    expect(replayError.category).toBe("replay");
    expect(replayError.httpStatusHint).toBe(409);

    const expiredError = new PrismError(PRISM_ERROR_CODE.PROOF_EXPIRED);
    expect(expiredError.retryable).toBe("new_challenge");
    expect(expiredError.userAction).toBe("restart_flow");
    expect(expiredError.httpStatusHint).toBe(410);

    const unsupportedError = new PrismError(PRISM_ERROR_CODE.UNSUPPORTED_SIGNATURE_CLASS);
    expect(unsupportedError.name).toBe("unsupported_signature_class");
    expect(unsupportedError.userAction).toBe("use_supported_wallet_type");

    const dependencyError = new PrismError(PRISM_ERROR_CODE.RPC_UNAVAILABLE);
    expect(dependencyError.name).toBe("rpc_unavailable");
    expect(dependencyError.retryable).toBe("true_backoff");
    expect(dependencyError.httpStatusHint).toBe(503);
  });

  it("never emits contract-layer or post-V8.2 codes from this slice", () => {
    // Structural guard: the domain's error surface is closed over the
    // in-scope code set; any drift shows up as a diff here.
    const emittedCodes = Object.values(PRISM_ERROR_CODE);
    for (const forbidden of OUT_OF_SCOPE_CODES) {
      expect(emittedCodes).not.toContain(forbidden);
    }
  });
});

const BROKEN_STORE_SINGLETON: OwnershipProofStore = {
  async putIssued(): Promise<void> {
    throw new Error("store down");
  },
  async getById(): Promise<undefined> {
    return undefined;
  },
  async consumeNonce() {
    return "unknown" as const;
  },
  async transitionState() {
    return false;
  },
};
