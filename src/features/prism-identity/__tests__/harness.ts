// Shared harness for the PRISM-8 offchain acceptance suite.
// Deterministic time + in-memory store + local ERC-1271 semantics double.

import { PrismChallengeService } from "../application/challenge-service";
import { fixedClock, type FixedClock } from "../adapters/clock";
import { InMemoryOwnershipProofStore } from "../adapters/memory-ownership-proof-store";
import { viemChallengeCrypto } from "../adapters/viem-crypto";
import {
  LocalErc1271SemanticsChecker,
  makeEoaSigner,
} from "../testing/fixtures";
import type { PrivateKeyAccount } from "viem/accounts";
import type { IssuedChallengeView } from "../application/challenge-service";

export const CHALLENGE_DOMAIN = "prism.example";
export const PRISM_ID = "prism:P7F21";
/** Base Sepolia — the fixture network the suite binds every challenge to. */
export const CHALLENGE_CHAIN_ID = 84_532;

export interface Harness {
  clock: FixedClock;
  store: InMemoryOwnershipProofStore;
  checker: LocalErc1271SemanticsChecker;
  service: PrismChallengeService;
}

export function buildHarness(startAtEpochSeconds = 1_789_000_000): Harness {
  const clock = fixedClock(startAtEpochSeconds);
  const store = new InMemoryOwnershipProofStore();
  const checker = new LocalErc1271SemanticsChecker();
  const service = new PrismChallengeService({
    clock,
    crypto: viemChallengeCrypto,
    checker,
    store,
    policy: { defaultTtlSeconds: 600, defaultDomain: CHALLENGE_DOMAIN, defaultChainId: CHALLENGE_CHAIN_ID },
  });
  return { clock, store, checker, service };
}

export function makeOwnerWithAccount(): { signer: PrivateKeyAccount; smartAccount: `0x${string}` } {
  const signer = makeEoaSigner();
  // Deterministic-looking but random smart-account address derived from a
  // second fresh key's address (no literals, nothing persisted).
  const smartAccount = makeEoaSigner().address.toLowerCase() as `0x${string}`;
  return { signer, smartAccount };
}

export async function issueForAccount(
  service: PrismChallengeService,
  executionAccount: string,
  overrides: Partial<{ ttlSeconds: number }> = {},
): Promise<IssuedChallengeView> {
  return service.issueChallenge({
    prismId: PRISM_ID,
    venue: "BASE",
    executionAccount,
    ...overrides,
  });
}
