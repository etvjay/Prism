/**
 * Typed mocks that stop at the wallet adapter boundary.
 *
 * Every value below is a declared constant. No live chain call, balance
 * probe, viewing-key read, or provider network access happens here — the
 * mock implements `StarknetWalletSessionProvider` so the real
 * `StarknetWalletSessionAdapter` can run its pure observation path.
 */

import type { StarknetWalletSessionProvider } from "../wallet/session/starknet-wallet-adapter";

export type MockWalletScenario =
  | "supported-sepolia"
  | "unsupported"
  | "unknown"
  | "wrong-network";

export const MOCK_SCENARIOS: readonly MockWalletScenario[] = [
  "supported-sepolia",
  "unsupported",
  "unknown",
  "wrong-network",
] as const;

export const MOCK_WALLET_LABELS: Record<MockWalletScenario, string> = {
  "supported-sepolia": "Demo wallet (capable)",
  "unsupported": "Demo wallet (legacy)",
  unknown: "Demo wallet (no versions)",
  "wrong-network": "Demo wallet (other network)",
};

/** Declared constants only — never an observed live address. */
export const MOCK_ACCOUNT_ADDRESS = `0x0${"7".repeat(63)}`;
export const MOCK_APPROVAL_HASH = `0x${"a".repeat(64)}` as `0x${string}`;
export const MOCK_SHIELD_HASH = `0x${"b".repeat(64)}` as `0x${string}`;
export const MOCK_EXPECTED_ENVIRONMENT = "SN_SEPOLIA";
export const MOCK_CONFIRMED_BLOCK = 12355;
export const MOCK_MATURITY_TARGET_BLOCK = MOCK_CONFIRMED_BLOCK + 10;
export const MOCK_FEE_WEI = "0x2386f26fc10000";
export const MOCK_FEE_LABEL = "0.01 STRK (quoted)";
export const MOCK_POOL_LABEL = "0x0403…812a";

const SUPPORTED_VERSIONS = ["0.10.3"] as const;
const LEGACY_VERSIONS = ["0.9.1"] as const;

function versionsFor(scenario: MockWalletScenario): {
  apiVersions: readonly string[];
  specs: readonly string[];
} {
  switch (scenario) {
    case "supported-sepolia":
      return { apiVersions: [...SUPPORTED_VERSIONS], specs: [...SUPPORTED_VERSIONS] };
    case "unsupported":
      return { apiVersions: [...LEGACY_VERSIONS], specs: [...LEGACY_VERSIONS] };
    case "unknown":
      return { apiVersions: [], specs: [] };
    case "wrong-network":
      return { apiVersions: [...SUPPORTED_VERSIONS], specs: [...SUPPORTED_VERSIONS] };
  }
}

function chainIdFor(scenario: MockWalletScenario): string {
  return scenario === "wrong-network" ? "SN_MAIN" : "SN_SEPOLIA";
}

/**
 * Typed mock behind the `StarknetWalletSessionProvider` port. The session
 * adapter treats it exactly like a real provider surface; capability
 * detection still reads declared version constants only.
 */
export function createMockStarknetProvider(
  scenario: MockWalletScenario,
): StarknetWalletSessionProvider {
  const { apiVersions, specs } = versionsFor(scenario);
  const chainId = chainIdFor(scenario);
  return {
    name: MOCK_WALLET_LABELS[scenario],
    connect: () => Promise.resolve({ address: MOCK_ACCOUNT_ADDRESS }),
    getSession: () => Promise.resolve({ address: MOCK_ACCOUNT_ADDRESS }),
    disconnect: () => Promise.resolve(),
    supportedWalletApi: () => Promise.resolve(apiVersions),
    supportedSpecs: () => Promise.resolve(specs),
    requestChainId: () => Promise.resolve(chainId),
  };
}

export type MockReceiptTone = "confirmed" | "pending" | "reverted";

export interface MockReceiptFixture {
  readonly tone: MockReceiptTone;
  readonly transactionHash: `0x${string}`;
  readonly executionStatus: "SUCCEEDED" | "REVERTED" | "RECEIVED";
  readonly finalityStatus: "ACCEPTED_ON_L2" | "ACCEPTED_ON_L1" | "RECEIVED" | "PENDING";
  readonly blockNumber: number | null;
  readonly poolEventFound: boolean;
}

export function mockReceiptFixture(tone: MockReceiptTone): MockReceiptFixture {
  switch (tone) {
    case "confirmed":
      return {
        tone,
        transactionHash: MOCK_SHIELD_HASH,
        executionStatus: "SUCCEEDED",
        finalityStatus: "ACCEPTED_ON_L2",
        blockNumber: MOCK_CONFIRMED_BLOCK,
        poolEventFound: true,
      };
    case "pending":
      return {
        tone,
        transactionHash: MOCK_SHIELD_HASH,
        executionStatus: "RECEIVED",
        finalityStatus: "PENDING",
        blockNumber: null,
        poolEventFound: false,
      };
    case "reverted":
      return {
        tone,
        transactionHash: MOCK_SHIELD_HASH,
        executionStatus: "REVERTED",
        finalityStatus: "ACCEPTED_ON_L2",
        blockNumber: MOCK_CONFIRMED_BLOCK,
        poolEventFound: false,
      };
  }
}

export type ActivityTone = "confirmed" | "pending" | "reverted";

export interface ActivityEntry {
  readonly slot: "approval" | "shield";
  readonly transactionHash: `0x${string}`;
  readonly tone: ActivityTone;
  readonly blockNumber: number | null;
  readonly poolEventFound: boolean;
}

/** Two-hash activity tail: approval hash first, shield hash second. */
export function mockTwoHashActivity(tone: ActivityTone): readonly ActivityEntry[] {
  const shield = mockReceiptFixture(tone);
  return [
    {
      slot: "approval",
      transactionHash: MOCK_APPROVAL_HASH,
      tone,
      blockNumber: shield.blockNumber,
      poolEventFound: false,
    },
    {
      slot: "shield",
      transactionHash: shield.transactionHash,
      tone,
      blockNumber: shield.blockNumber,
      poolEventFound: shield.poolEventFound,
    },
  ];
}
