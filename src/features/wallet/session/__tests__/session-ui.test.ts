import { describe, expect, it } from "vitest";
import {
  applyPrivacyObservation,
  applyStarknetObservation,
  createPrivacyWalletSession,
  createStarknetWalletSession,
  grantConsent,
  markProofReady,
  markReceipt,
  markSubmitted,
  markSubmissionStarted,
} from "../session-state";
import { StarknetWalletSessionAdapter } from "../starknet-wallet-adapter";
import {
  createSessionReducerState,
  sessionReducer,
} from "../reducer";
import {
  formatObservedAddress,
  selectCapabilities,
  selectReceipt,
  selectSessionState,
  SESSION_UI_STATES,
} from "../selectors";
import { SESSION_STATE_GLYPHS, SESSION_STATE_LABELS } from "../strings";

const NOW = 1_700_000_000_000;
const ACCOUNT = `0x0${"1".repeat(63)}`;
const TX_HASH = `0x${"b".repeat(64)}` as `0x${string}`;

function starknetSession(input: {
  chainId?: string;
  apiVersions?: readonly string[];
  specs?: readonly string[];
} = {}) {
  const initial = createStarknetWalletSession({
    now: NOW,
    expectedEnvironment: "SN_SEPOLIA",
    walletName: "Observed wallet",
  });
  return applyStarknetObservation(
    initial,
    {
      accountAddress: ACCOUNT,
      chainId: input.chainId ?? "SN_SEPOLIA",
      apiVersions: input.apiVersions ?? ["1.0.0"],
      specs: input.specs ?? ["0.10.3"],
      walletName: "Observed wallet",
    },
    NOW + 1,
  );
}

function privacySession() {
  const initial = createPrivacyWalletSession({
    now: NOW,
    expectedEnvironment: "SN_SEPOLIA",
    accountAddress: ACCOUNT,
  });
  return applyPrivacyObservation(
    initial,
    {
      capable: true,
      capabilityStatus: "supported",
      apiVersions: ["1.0.0"],
      specs: ["0.10.3"],
      chainId: "SN_SEPOLIA",
      environment: "SN_SEPOLIA",
      mismatch: false,
      expected: "SN_SEPOLIA",
    },
    NOW + 1,
  );
}

describe("wallet session UI projection", () => {
  it("exposes the closed fifteen-state surface with text and glyphs", () => {
    expect(SESSION_UI_STATES).toHaveLength(15);
    expect(Object.keys(SESSION_STATE_LABELS)).toEqual(expect.arrayContaining([...SESSION_UI_STATES]));
    expect(Object.keys(SESSION_STATE_GLYPHS)).toEqual(expect.arrayContaining([...SESSION_UI_STATES]));
  });

  it("keeps discovery and connection as explicit user-driven phases", () => {
    const initial = createSessionReducerState(starknetSession());
    const discovering = sessionReducer(initial, { type: "discovery-started" });
    expect(selectSessionState(discovering)).toBe("discovering");

    const connecting = sessionReducer(
      discovering,
      { type: "connection-started", walletId: "Observed wallet" },
    );
    expect(selectSessionState(connecting)).toBe("connecting");

    const disconnected = sessionReducer(
      createSessionReducerState(
        createStarknetWalletSession({ now: NOW, expectedEnvironment: "SN_SEPOLIA" }),
      ),
      {
        type: "discovery-finished",
        wallets: [],
      },
    );
    expect(selectSessionState(disconnected)).toBe("disconnected");
    expect(disconnected.notice).toBe("No Starknet wallet was found.");
  });

  it("re-reads the observed account on a wallet change before reclassifying capabilities", async () => {
    let currentAccount = ACCOUNT;
    const nextAccount = `0x0${"2".repeat(63)}`;
    const adapter = new StarknetWalletSessionAdapter({
      name: "Observed wallet",
      connect: async () => ({ address: currentAccount }),
      getSession: async () => ({ address: currentAccount }),
      supportedWalletApi: async () => ["1.0.0"],
      supportedSpecs: async () => ["0.10.3"],
      requestChainId: async () => "SN_SEPOLIA",
    });
    const connected = await adapter.connect(NOW);
    currentAccount = nextAccount;
    const refreshed = await adapter.refresh(connected, NOW + 1);

    expect(refreshed.accountAddress).toBe(nextAccount);
    expect(refreshed.status).toBe("ready");
  });

  it.each([
    ["capability-unknown", { apiVersions: [], specs: [] }],
    ["unsupported", { apiVersions: ["0.10.2"], specs: [] }],
    ["wrong-network", { chainId: "SN_MAIN" }],
    ["ready", {}],
  ] as const)("maps observed contract facts to %s", (expected, input) => {
    const session = starknetSession(input);
    const state = createSessionReducerState(session);
    expect(selectSessionState(state)).toBe(expected);
  });

  it("does not expose unobserved identity, capabilities, or receipt fields", () => {
    const disconnected = createSessionReducerState(
      createStarknetWalletSession({ now: NOW, expectedEnvironment: "SN_SEPOLIA" }),
    );

    expect(disconnected.session.accountAddress).toBeNull();
    expect(selectCapabilities(disconnected.session)).toEqual([]);
    expect(selectReceipt(disconnected.operation)).toBeNull();
    expect(formatObservedAddress(disconnected.session.accountAddress)).toBeNull();
  });

  it("projects only observed proof and receipt transitions", () => {
    const ready = privacySession();
    const preparing = {
      ...ready,
      strk20State: "proving" as const,
      proofReady: false,
    };
    expect(selectSessionState({
      ...createSessionReducerState(starknetSession()),
      operation: preparing,
    })).toBe("proof-preparing");

    const consented = grantConsent(ready, NOW + 2);
    const proofReady = markProofReady(consented, NOW + 3);
    expect(selectSessionState({
      ...createSessionReducerState(starknetSession()),
      operation: proofReady,
    })).toBe("awaiting-approval");

    const submitting = markSubmissionStarted(proofReady, NOW + 4);
    const submitted = markSubmitted(submitting, TX_HASH, NOW + 5);
    expect(selectSessionState({
      ...createSessionReducerState(starknetSession()),
      operation: submitted,
    })).toBe("processing");
    expect(selectReceipt(submitted)).toMatchObject({
      status: "pending",
      transactionHash: TX_HASH,
    });

    const confirmed = awaitReceipt(submitted, "SUCCEEDED");
    expect(selectSessionState({
      ...createSessionReducerState(starknetSession()),
      operation: confirmed,
    })).toBe("receipt-confirmed");
    expect(selectReceipt(confirmed)).toMatchObject({
      status: "confirmed",
      blockNumber: 42,
    });

    const reverted = awaitReceipt(submitted, "REVERTED");
    expect(selectSessionState({
      ...createSessionReducerState(starknetSession()),
      operation: reverted,
    })).toBe("reverted");
    expect(selectReceipt(reverted)).toMatchObject({ status: "reverted" });
  });
});

function awaitReceipt(
  session: ReturnType<typeof markSubmitted>,
  executionStatus: "SUCCEEDED" | "REVERTED",
) {
  return markReceipt(
    session,
    {
      transactionHash: TX_HASH,
      executionStatus,
      finalityStatus: executionStatus === "SUCCEEDED" ? "ACCEPTED_ON_L2" : "UNKNOWN",
      blockNumber: executionStatus === "SUCCEEDED" ? 42 : null,
      poolEventFound: executionStatus === "SUCCEEDED",
      attributedDepositor: null,
      senderIgnored: null,
      events: executionStatus === "SUCCEEDED"
        ? [{ address: "0x1", keys: [], data: [] }]
        : [],
      rawExecutionStatus: executionStatus,
    },
    NOW + 6,
  );
}
