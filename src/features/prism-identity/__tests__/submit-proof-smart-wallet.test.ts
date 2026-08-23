// TEST-8-2-2 / TEST-8-2-3 — deployed EIP-1271 and undeployed ERC-6492 classes,
// plus wrapper-owner mismatch and dependency-indeterminacy negatives.

import { describe, expect, it } from "vitest";
import type { PublicClient } from "viem";
import { PRISM_ERROR_CODE } from "../domain/errors";
import { parseErc6492Wrapper } from "../domain/signature-class";
import {
  presentedFromIssued,
  makeEoaSigner,
  wrapAsUndeployed6492,
  UndeterminedChecker,
  ThrowingChecker,
} from "../testing/fixtures";
import { viemChallengeCrypto } from "../adapters/viem-crypto";
import { ViemSmartWalletChecker } from "../adapters/viem-smart-wallet-checker";
import { PrismChallengeService } from "../application/challenge-service";
import {
  buildHarness,
  issueForAccount,
  makeOwnerWithAccount,
  CHALLENGE_CHAIN_ID,
  CHALLENGE_DOMAIN,
  PRISM_ID,
} from "./harness";

describe("SubmitProof — smart-wallet classes", () => {
  it("verifies a valid deployed EIP-1271 proof (TEST-8-2-2)", async () => {
    const harness = buildHarness();
    const { service, checker, store } = harness;
    const { signer, smartAccount } = makeOwnerWithAccount();

    // Deployed contract-wallet semantics (labeled test double): the account
    // accepts signatures recovering to its registered owner.
    checker.registerSmartAccount(smartAccount, signer.address.toLowerCase() as `0x${string}`);

    const view = await issueForAccount(service, smartAccount);
    const signature = await signer.signMessage({ message: view.messageToSign });

    const result = await service.submitProof({
      challengeId: view.challengeId,
      presented: presentedFromIssued(view),
      signature,
    });

    expect(result.status).toBe("verified");
    expect(result.signatureClass).toBe("EIP1271");
    const stored = await store.getById(view.challengeId);
    expect(stored?.verifiedSignatureClass).toBe("EIP1271");
  });

  it("verifies a valid ERC-6492 wrapped proof for an undeployed account (TEST-8-2-3)", async () => {
    const harness = buildHarness();
    const { service, checker, store } = harness;
    const { signer, smartAccount } = makeOwnerWithAccount();

    checker.registerSmartAccount(smartAccount, signer.address.toLowerCase() as `0x${string}`);

    const view = await issueForAccount(service, smartAccount);
    const innerSignature = await signer.signMessage({ message: view.messageToSign });
    const wrapped = wrapAsUndeployed6492({
      counterfactualAccount: smartAccount,
      innerSignature,
    });

    // Round-trip sanity of the standards-shaped wrapper.
    const parsed = parseErc6492Wrapper(wrapped);
    expect(parsed?.owner.toLowerCase()).toBe(smartAccount.toLowerCase());

    const result = await service.submitProof({
      challengeId: view.challengeId,
      presented: presentedFromIssued(view),
      signature: wrapped,
    });

    expect(result.status).toBe("verified");
    expect(result.signatureClass).toBe("ERC6492");
    const stored = await store.getById(view.challengeId);
    expect(stored?.verifiedSignatureClass).toBe("ERC6492");
  });

  it("rejects a 6492 wrapper whose owner differs from the bound account (ERR-003)", async () => {
    const { service } = buildHarness();
    const { signer, smartAccount } = makeOwnerWithAccount();

    const view = await issueForAccount(service, smartAccount);
    const innerSignature = await signer.signMessage({ message: view.messageToSign });
    const stranger = makeEoaSigner().address.toLowerCase() as `0x${string}`;
    const wrapped = wrapAsUndeployed6492({
      counterfactualAccount: stranger,
      innerSignature,
    });

    await expect(
      service.submitProof({
        challengeId: view.challengeId,
        presented: presentedFromIssued(view),
        signature: wrapped,
      }),
    ).rejects.toMatchObject({ code: PRISM_ERROR_CODE.INVALID_SIGNER });
  });

  it("maps checker indeterminacy to an explicit dependency error (ERR-021)", async () => {
    const harness = buildHarness();
    const service = new PrismChallengeService({
      clock: harness.clock,
      crypto: viemChallengeCrypto,
      checker: new UndeterminedChecker("sequencer timeout"),
      store: harness.store,
      policy: { defaultTtlSeconds: 600, defaultDomain: CHALLENGE_DOMAIN, defaultChainId: CHALLENGE_CHAIN_ID },
    });
    const { signer, smartAccount } = makeOwnerWithAccount();

    const view = await service.issueChallenge({
      prismId: PRISM_ID,
      venue: "BASE",
      executionAccount: smartAccount,
    });
    const signature = await signer.signMessage({ message: view.messageToSign });

    await expect(
      service.submitProof({
        challengeId: view.challengeId,
        presented: presentedFromIssued(view),
        signature,
      }),
    ).rejects.toMatchObject({
      code: PRISM_ERROR_CODE.RPC_UNAVAILABLE,
      detail: "signature_checker_unavailable:sequencer timeout",
    });
  });

  it("maps thrown transport failures to ERR-021, not silent invalid", async () => {
    const harness = buildHarness();
    const service = new PrismChallengeService({
      clock: harness.clock,
      crypto: viemChallengeCrypto,
      checker: new ThrowingChecker(new Error("connection reset")),
      store: harness.store,
      policy: { defaultTtlSeconds: 600, defaultDomain: CHALLENGE_DOMAIN, defaultChainId: CHALLENGE_CHAIN_ID },
    });
    const { signer, smartAccount } = makeOwnerWithAccount();

    const view = await service.issueChallenge({
      prismId: PRISM_ID,
      venue: "BASE",
      executionAccount: smartAccount,
    });
    const signature = await signer.signMessage({ message: view.messageToSign });

    await expect(
      service.submitProof({
        challengeId: view.challengeId,
        presented: presentedFromIssued(view),
        signature,
      }),
    ).rejects.toMatchObject({ code: PRISM_ERROR_CODE.RPC_UNAVAILABLE });
  });

  it("rejects when the bound account is an unregistered contract wallet", async () => {
    const { service } = buildHarness();
    const { signer, smartAccount } = makeOwnerWithAccount();

    const view = await issueForAccount(service, smartAccount);
    const signature = await signer.signMessage({ message: view.messageToSign });

    // No owner registered for smartAccount → deterministic onchain-style "no".
    await expect(
      service.submitProof({
        challengeId: view.challengeId,
        presented: presentedFromIssued(view),
        signature,
      }),
    ).rejects.toMatchObject({ code: PRISM_ERROR_CODE.INVALID_SIGNER });
  });
});

describe("ViemSmartWalletChecker adapter mapping (no network)", () => {
  function stubClient(behavior: () => Promise<boolean>): PublicClient {
    return { verifyMessage: behavior } as unknown as PublicClient;
  }

  const input = {
    account: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const,
    message: "m",
    signature: "0xabcd" as const,
  };

  it("maps boolean results to valid/invalid", async () => {
    const yes = new ViemSmartWalletChecker(stubClient(async () => true));
    const no = new ViemSmartWalletChecker(stubClient(async () => false));
    expect(await yes.check(input)).toEqual({ status: "valid" });
    expect(await no.check(input)).toEqual({ status: "invalid" });
  });

  it("maps deterministic reverts to invalid and outages to undetermined", async () => {
    const revertClient = new ViemSmartWalletChecker(
      stubClient(async () => {
        throw new Error("contract function execution reverted");
      }),
    );
    const outageClient = new ViemSmartWalletChecker(
      stubClient(async () => {
        throw new Error("HTTP request failed");
      }),
    );
    expect(await revertClient.check(input)).toEqual({ status: "invalid" });
    const outage = await outageClient.check(input);
    expect(outage.status).toBe("undetermined");
  });
});
