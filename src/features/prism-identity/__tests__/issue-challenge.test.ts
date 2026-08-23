// CMD-B-01 IssueChallenge acceptance: field binding, ERR-001/ERR-002/ERR-005
// validation paths, TTL ceiling, uniqueness, and explicit dependency failures.

import { describe, expect, it } from "vitest";
import { PRISM_ERROR_CODE, PrismError, PRISM_ERROR_DETAIL } from "../domain/errors";
import { viemChallengeCrypto } from "../adapters/viem-crypto";
import {
  CHALLENGE_DOMAIN,
  PRISM_ID,
  buildHarness,
  makeOwnerWithAccount,
} from "./harness";
import type { Clock } from "../domain/ports";

describe("IssueChallenge (CMD-B-01)", () => {
  it("issues a fully bound challenge with unique id and nonce", async () => {
    const { service } = buildHarness();
    const { signer } = makeOwnerWithAccount();

    const first = await service.issueChallenge({
      prismId: PRISM_ID,
      venue: "BASE",
      executionAccount: signer.address.toLowerCase(),
    });
    const second = await service.issueChallenge({
      prismId: PRISM_ID,
      venue: "BASE",
      executionAccount: signer.address.toLowerCase(),
    });

    for (const view of [first, second]) {
      expect(view.domain).toBe(CHALLENGE_DOMAIN);
      expect(view.venue).toBe("BASE");
      expect(view.executionAccount).toBe(signer.address.toLowerCase());
      expect(view.prismId).toBe(PRISM_ID);
      expect(view.expiresAt - view.issuedAt).toBe(600);
    }
    // Fresh nonce per call — intentionally not idempotent (operations.yaml).
    expect(second.challengeId).not.toBe(first.challengeId);
    expect(second.nonce).not.toBe(first.nonce);
  });

  it("rejects unsupported venues with ERR-001", async () => {
    const { service } = buildHarness();
    const { signer } = makeOwnerWithAccount();

    await expect(
      service.issueChallenge({
        prismId: PRISM_ID,
        venue: "SOLANA",
        executionAccount: signer.address.toLowerCase(),
      }),
    ).rejects.toMatchObject({ code: PRISM_ERROR_CODE.INVALID_VENUE, name: "invalid_venue" });
  });

  it("rejects zero and malformed Base accounts with ERR-005", async () => {
    const { service } = buildHarness();

    await expect(
      service.issueChallenge({
        prismId: PRISM_ID,
        venue: "BASE",
        executionAccount: "0x0000000000000000000000000000000000000000",
      }),
    ).rejects.toMatchObject({ code: PRISM_ERROR_CODE.INVALID_EXECUTION_ACCOUNT, detail: "zero_address" });

    await expect(
      service.issueChallenge({ prismId: PRISM_ID, venue: "BASE", executionAccount: "0x1234" }),
    ).rejects.toMatchObject({ code: PRISM_ERROR_CODE.INVALID_EXECUTION_ACCOUNT, detail: "malformed_base_address" });
  });

  it("rejects structurally invalid Prism IDs under the identity_not_found family", async () => {
    const { service } = buildHarness();
    const { signer } = makeOwnerWithAccount();

    await expect(
      service.issueChallenge({
        prismId: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
        venue: "BASE",
        executionAccount: signer.address.toLowerCase(),
      }),
    ).rejects.toMatchObject({
      code: PRISM_ERROR_CODE.IDENTITY_NOT_FOUND,
      detail: PRISM_ERROR_DETAIL.MALFORMED_PRISM_ID,
    });
  });

  it("fails explicitly when the clock port fails", async () => {
    const harness = buildHarness();
    const brokenClock: Clock = {
      now: () => {
        throw new Error("time_source_gone");
      },
    };
    const { PrismChallengeService: ServiceCtor } = await import("../application/challenge-service");
    const service = new ServiceCtor({
      clock: brokenClock,
      crypto: viemChallengeCrypto,
      checker: harness.checker,
      store: harness.store,
      policy: { defaultTtlSeconds: 600, defaultDomain: CHALLENGE_DOMAIN },
    });
    const { signer } = makeOwnerWithAccount();

    await expect(service.issueChallenge({
      prismId: PRISM_ID,
      venue: "BASE",
      executionAccount: signer.address.toLowerCase(),
    })).rejects.toMatchObject({
      code: PRISM_ERROR_CODE.RPC_UNAVAILABLE,
      detail: `${PRISM_ERROR_DETAIL.CLOCK_UNAVAILABLE}:time_source_gone`,
    });
  });

  it("fails explicitly when the nonce/challenge store fails", async () => {
    const harness = buildHarness();
    const breakingStore = {
      async putIssued() {
        throw new Error("connection refused");
      },
      async getById() {
        return undefined;
      },
      async consumeNonce() {
        return "unknown" as const;
      },
      async transitionState() {
        return false;
      },
    };
    const { PrismChallengeService: ServiceCtor } = await import("../application/challenge-service");
    const service = new ServiceCtor({
      clock: harness.clock,
      crypto: viemChallengeCrypto,
      checker: harness.checker,
      store: breakingStore,
      policy: { defaultTtlSeconds: 600, defaultDomain: CHALLENGE_DOMAIN },
    });
    const { signer } = makeOwnerWithAccount();

    await expect(service.issueChallenge({
      prismId: PRISM_ID,
      venue: "BASE",
      executionAccount: signer.address.toLowerCase(),
    })).rejects.toMatchObject({
      code: PRISM_ERROR_CODE.RPC_UNAVAILABLE,
      detail: `${PRISM_ERROR_DETAIL.CHALLENGE_STORE_UNAVAILABLE}:connection refused`,
    });
  });

  it("surfaces a deterministic-RNG duplicate as an explicit dependency error", async () => {
    const harness = buildHarness();
    const { signer } = makeOwnerWithAccount();
    let calls = 0;
    const fixedRandomCrypto = {
      ...viemChallengeCrypto,
      randomNonceHex: () => {
        calls += 1;
        return calls <= 2
          ? ("0x" + "42".repeat(32) as `0x${string}`)
          : viemChallengeCrypto.randomNonceHex(32);
      },
    };
    const { PrismChallengeService: ServiceCtor } = await import("../application/challenge-service");
    const service = new ServiceCtor({
      clock: harness.clock,
      crypto: fixedRandomCrypto,
      checker: harness.checker,
      store: harness.store,
      policy: { defaultTtlSeconds: 600, defaultDomain: CHALLENGE_DOMAIN },
    });

    await service.issueChallenge({
      prismId: PRISM_ID,
      venue: "BASE",
      executionAccount: signer.address.toLowerCase(),
    });
    await expect(service.issueChallenge({
      prismId: PRISM_ID,
      venue: "BASE",
      executionAccount: signer.address.toLowerCase(),
    })).rejects.toMatchObject({
      code: PRISM_ERROR_CODE.RPC_UNAVAILABLE,
      detail: `${PRISM_ERROR_DETAIL.CHALLENGE_STORE_UNAVAILABLE}:duplicate_challenge_id`,
    });
  });

  it("exposes stable external error shapes without stack traces", () => {
    const error = new PrismError(PRISM_ERROR_CODE.NONCE_ALREADY_USED);
    const shape = error.toExternalShape();
    expect(shape).toEqual({
      code: "ERR-006",
      name: "nonce_already_used",
      category: "replay",
      retryable: "false_new_challenge",
      userAction: "restart_binding_flow",
      httpStatusHint: 409,
    });
  });
});
