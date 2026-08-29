import { describe, expect, it } from "vitest";
import {
  assertSessionVenue,
  assertCanSubmitSession,
  canSubmitSession,
  grantConsent,
  resetForAccountChange,
} from "../session-state";
import type { PrivacyWalletSessionPort } from "../types";
import { StarknetWalletSessionAdapter } from "../starknet-wallet-adapter";
import { BaseProofSessionAdapter } from "../base-proof-adapter";
import { PrivacyWalletSessionAdapter } from "../privacy-wallet-adapter";
import { STRK20_POOL_ADDRESS } from "../../../prism-strk20/domain/strk20-action-port";
import { makeReadyCallAndProof, type Strk20CallAndProof } from "../../../prism-strk20/domain/strk20-proof";

const NOW = 1_700_000_000_000;
const STARKNET_ACCOUNT = `0x0${"1".repeat(63)}`;
const NEXT_STARKNET_ACCOUNT = `0x0${"2".repeat(63)}`;
const BASE_ACCOUNT = `0x${"a".repeat(40)}`;
const TX_HASH = `0x${"b".repeat(64)}` as `0x${string}`;
const SIGNATURE = `0x${"c".repeat(130)}`;

function starknetProvider(overrides: Record<string, unknown> = {}) {
  return {
    name: "Injected Starknet wallet",
    connect: async () => ({ address: STARKNET_ACCOUNT }),
    disconnect: async () => undefined,
    supportedWalletApi: async () => ["1.0.0"],
    supportedSpecs: async () => ["0.10.3"],
    requestChainId: async () => "SN_SEPOLIA",
    ...overrides,
  };
}

function baseProvider(overrides: Record<string, unknown> = {}) {
  return {
    request: async ({ method }: { method: string; params?: readonly unknown[] }) => {
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [BASE_ACCOUNT];
      if (method === "eth_chainId") return "0x14a34";
      if (method === "personal_sign") return SIGNATURE;
      throw new Error("unsupported_method");
    },
    disconnect: async () => undefined,
    ...overrides,
  };
}

function privacyPort(overrides: Partial<PrivacyWalletSessionPort> = {}): PrivacyWalletSessionPort {
  const callAndProof = makeReadyCallAndProof({
    contract_address: STRK20_POOL_ADDRESS,
    entry_point: "invoke",
    calldata: ["0x1"],
  });
  return {
    observeCapability: async () => ({
      capable: true,
      capabilityStatus: "supported",
      apiVersions: ["0.10.3"],
      specs: [],
      chainId: "SN_SEPOLIA",
      environment: "SN_SEPOLIA",
      mismatch: false,
      expected: "SN_SEPOLIA",
    }),
    prepare: async () => callAndProof,
    executeWithProof: async () => ({ transactionHash: TX_HASH }),
    observeReceipt: async () => ({
      transactionHash: TX_HASH,
      executionStatus: "SUCCEEDED",
      finalityStatus: "ACCEPTED_ON_L2",
      blockNumber: 42,
      poolEventFound: true,
      attributedDepositor: null,
      senderIgnored: null,
      events: [{ address: STRK20_POOL_ADDRESS, keys: ["0x1"], data: [] }],
      rawExecutionStatus: "SUCCEEDED",
    }),
    ...overrides,
  };
}

describe("wallet-session authority contracts", () => {
  it("keeps Starknet, Base, and privacy sessions separate and maps readiness facts", async () => {
    const starknet = await new StarknetWalletSessionAdapter(starknetProvider()).connect(NOW);
    const base = await new BaseProofSessionAdapter(baseProvider(), { expectedChainId: "0x14a34" }).connect(NOW);
    const privacy = await new PrivacyWalletSessionAdapter(privacyPort(), { accountAddress: STARKNET_ACCOUNT }).connect(NOW);

    expect(starknet.venue).toBe("starknet");
    expect(starknet.status).toBe("ready");
    expect(starknet.network.status).toBe("expected");
    expect(starknet.capability.status).toBe("supported");
    expect(starknet.privacyCapability.status).toBe("supported");

    expect(base.venue).toBe("base");
    expect(base.status).toBe("ready");
    expect(base.network.status).toBe("expected");
    expect(base.capability.status).toBe("supported");
    expect(base.consent.status).toBe("not-required");

    expect(privacy.venue).toBe("privacy");
    expect(privacy.status).toBe("ready");
    expect(privacy.network.status).toBe("expected");
    expect(privacy.capability.status).toBe("supported");
    expect(privacy.submission.status).toBe("idle");
    expect(privacy.receipt.status).toBe("not-requested");
  });

  it("fails closed for wrong network and unknown capability", async () => {
    const wrongNetwork = await new StarknetWalletSessionAdapter(
      starknetProvider({ requestChainId: async () => "SN_MAIN" }),
      { expectedEnvironment: "SN_SEPOLIA" },
    ).connect(NOW);
    expect(wrongNetwork.status).toBe("wrong-network");
    expect(wrongNetwork.network.status).toBe("mismatch");
    expect(canSubmitSession(wrongNetwork)).toBe(false);

    const unknownCapability = await new StarknetWalletSessionAdapter(
      starknetProvider({ supportedWalletApi: async () => [], supportedSpecs: async () => [] }),
    ).connect(NOW);
    expect(unknownCapability.status).toBe("capability-unknown");
    expect(unknownCapability.capability.status).toBe("unknown");
    expect(canSubmitSession(unknownCapability)).toBe(false);
  });

  it("does not let unknown status remain submit- or sign-ready", async () => {
    const adapter = new BaseProofSessionAdapter(baseProvider(), { expectedChainId: "0x14a34" });
    const connected = await adapter.connect(NOW);
    const unknown = { ...connected, status: "unknown" as const };

    expect(canSubmitSession(unknown)).toBe(false);
    expect(() => assertCanSubmitSession(unknown)).toThrow(/unknown_session/);
    expect(() => grantConsent(unknown, NOW + 1)).toThrow(/unknown_session/);
    await expect(adapter.signMessage(unknown, "public challenge", NOW + 1)).rejects.toMatchObject({
      code: "STALE_STATE",
    });
  });

  it("clears every Base authority fact before returning an unknown refresh failure", async () => {
    const connected = await new BaseProofSessionAdapter(baseProvider(), { expectedChainId: "0x14a34" }).connect(NOW);
    const stale = {
      ...connected,
      consent: { status: "granted" as const, reason: null },
      proof: { status: "signed" as const, scheme: "personal_sign" as const, digest: null },
      submission: { status: "submitted" as const, transactionHash: TX_HASH, submittedAt: NOW },
      receipt: {
        status: "confirmed" as const,
        transactionHash: TX_HASH,
        blockNumber: 42,
        finality: "ACCEPTED_ON_L2" as const,
        observedAt: NOW,
      },
    };
    const failing = new BaseProofSessionAdapter({
      request: async () => {
        throw new Error("provider outage");
      },
    }, { expectedChainId: "0x14a34" });

    const failed = await failing.refresh(stale, NOW + 1);

    expect(failed.status).toBe("unknown");
    expect(failed.error).toMatchObject({ code: "PROVIDER_FAILURE" });
    expect(failed.accountAddress).toBeNull();
    expect(failed.chainId).toBeNull();
    expect(failed.network.status).toBe("unknown");
    expect(failed.capability.status).toBe("unknown");
    expect(failed.consent.status).toBe("unknown");
    expect(failed.proof.status).toBe("idle");
    expect(failed.submission.status).toBe("idle");
    expect(failed.receipt.status).toBe("not-requested");
    expect(canSubmitSession(failed)).toBe(false);
  });

  it("clears pre-injected privacy authority on connect failure", async () => {
    const adapter = new PrivacyWalletSessionAdapter(
      privacyPort({
        observeCapability: async () => {
          throw new Error("capability provider outage");
        },
      }),
      { accountAddress: STARKNET_ACCOUNT },
    );

    const failed = await adapter.connect(NOW);

    expect(failed.status).toBe("unknown");
    expect(failed.error).toMatchObject({ code: "PROVIDER_FAILURE" });
    expect(failed.accountAddress).toBeNull();
    expect(failed.chainId).toBeNull();
    expect(failed.network.status).toBe("unknown");
    expect(failed.capability.status).toBe("unknown");
    expect(failed.consent.status).toBe("unknown");
    expect(failed.submission.status).toBe("idle");
    expect(failed.receipt.status).toBe("not-requested");
    expect(failed.proofReady).toBe(false);
  });

  it("clears submitted and receipt authority on privacy refresh failure", async () => {
    const connectedAdapter = new PrivacyWalletSessionAdapter(privacyPort(), { accountAddress: STARKNET_ACCOUNT });
    const connected = await connectedAdapter.connect(NOW);
    const prepared = await connectedAdapter.prepare(grantConsent(connected, NOW + 1), [], NOW + 2);
    const submitted = await connectedAdapter.submit(prepared.session, prepared.callAndProof, NOW + 3);
    const confirmed = await connectedAdapter.observeReceipt(submitted, NOW + 4);
    const failingAdapter = new PrivacyWalletSessionAdapter(
      privacyPort({
        observeCapability: async () => {
          throw new Error("capability provider outage");
        },
      }),
      { accountAddress: STARKNET_ACCOUNT },
    );

    const failed = await failingAdapter.refresh(confirmed, NOW + 5);

    expect(failed.status).toBe("unknown");
    expect(failed.error).toMatchObject({ code: "PROVIDER_FAILURE" });
    expect(failed.accountAddress).toBeNull();
    expect(failed.chainId).toBeNull();
    expect(failed.network.status).toBe("unknown");
    expect(failed.capability.status).toBe("unknown");
    expect(failed.consent.status).toBe("unknown");
    expect(failed.submission.status).toBe("idle");
    expect(failed.receipt.status).toBe("not-requested");
    expect(failed.proofReady).toBe(false);
    expect(failed.strk20State).toBeNull();
  });

  it("resets authority-sensitive state when the wallet account changes", async () => {
    const adapter = new StarknetWalletSessionAdapter(starknetProvider());
    const connected = await adapter.connect(NOW);
    const consented = grantConsent(connected, NOW + 1);
    const reset = resetForAccountChange(consented, NEXT_STARKNET_ACCOUNT, NOW + 2);

    expect(reset.status).toBe("disconnected");
    expect(reset.accountAddress).toBeNull();
    expect(reset.capability.status).toBe("unknown");
    expect(reset.consent.status).toBe("unknown");
    expect(reset.submission.status).toBe("idle");
    expect(reset.receipt.status).toBe("not-requested");
    expect(reset.error).toBeNull();
  });

  it("clears local authority state after provider disconnect", async () => {
    const adapter = new StarknetWalletSessionAdapter(starknetProvider());
    const connected = await adapter.connect(NOW);
    const disconnected = await adapter.disconnect(connected, NOW + 1);

    expect(disconnected.status).toBe("disconnected");
    expect(disconnected.accountAddress).toBeNull();
    expect(disconnected.capability.status).toBe("unknown");
    expect(disconnected.privacyCapability.status).toBe("unknown");
    expect(disconnected.receipt.status).toBe("not-requested");
  });

  it("does not let a session from one venue cross the Base/Starknet boundary", async () => {
    const starknet = await new StarknetWalletSessionAdapter(starknetProvider()).connect(NOW);
    expect(() => assertSessionVenue(starknet, "base")).toThrow(/venue_mismatch/);
  });

  it("does not retain a Base signature in session state", async () => {
    const adapter = new BaseProofSessionAdapter(baseProvider(), { expectedChainId: "0x14a34" });
    const connected = await adapter.connect(NOW);
    const result = await adapter.signMessage(connected, "0xchallenge", NOW + 1);

    expect(result.signature).toBe(SIGNATURE);
    expect(result.session.proof.status).toBe("signed");
    expect(result.session.consent.status).toBe("granted");
    expect(JSON.stringify(result.session)).not.toContain(SIGNATURE);
  });

  it("requires explicit privacy consent and keeps submitted separate from receipt confirmation", async () => {
    let executeCalls = 0;
    const port = privacyPort({
      executeWithProof: async (_call, _proof) => {
        executeCalls += 1;
        return { transactionHash: TX_HASH };
      },
    });
    const adapter = new PrivacyWalletSessionAdapter(port, { accountAddress: STARKNET_ACCOUNT });
    const connected = await adapter.connect(NOW);
    const prepared = await adapter.prepare(grantConsent(connected, NOW + 1), [], NOW + 2);
    const submitted = await adapter.submit(prepared.session, prepared.callAndProof, NOW + 3);

    expect(executeCalls).toBe(1);
    expect(submitted.submission.status).toBe("submitted");
    expect(submitted.receipt.status).toBe("pending");
    expect(submitted.status).toBe("processing");

    const confirmed = await adapter.observeReceipt(submitted, NOW + 4);
    expect(confirmed.receipt.status).toBe("confirmed");
    expect(confirmed.status).toBe("receipt-confirmed");
  });

  it("keeps unknown receipts unknown and rejects simulated empty proofs", async () => {
    let executeCalls = 0;
    const adapter = new PrivacyWalletSessionAdapter(
      privacyPort({
        executeWithProof: async () => {
          executeCalls += 1;
          return { transactionHash: TX_HASH };
        },
        observeReceipt: async () => ({
          transactionHash: TX_HASH,
          executionStatus: "UNKNOWN",
          finalityStatus: "UNKNOWN",
          blockNumber: null,
          poolEventFound: false,
          attributedDepositor: null,
          senderIgnored: null,
          events: [],
          rawExecutionStatus: "UNKNOWN",
        }),
      }),
      { accountAddress: STARKNET_ACCOUNT },
    );
    const connected = await adapter.connect(NOW);
    const consented = grantConsent(connected, NOW + 1);
    const emptyProof: Strk20CallAndProof = {
      call: { contract_address: STRK20_POOL_ADDRESS, entry_point: "invoke", calldata: [] },
      proof: { data: "", output: [], proof_facts: [] },
    };

    await expect(adapter.submit(consented, emptyProof, NOW + 2)).rejects.toMatchObject({
      code: "PROOF_REQUIRED",
    });
    expect(executeCalls).toBe(0);

    const prepared = await adapter.prepare(consented, [], NOW + 2);
    const submitted = await adapter.submit(prepared.session, prepared.callAndProof, NOW + 3);
    const unknown = await adapter.observeReceipt(submitted, NOW + 4);
    expect(unknown.receipt.status).toBe("unknown");
    expect(unknown.status).toBe("unknown");
  });

  it("does not confirm an event-less receipt even when the provider claims pool evidence", async () => {
    const adapter = new PrivacyWalletSessionAdapter(
      privacyPort({
        observeReceipt: async () => ({
          transactionHash: TX_HASH,
          executionStatus: "SUCCEEDED",
          finalityStatus: "ACCEPTED_ON_L2",
          blockNumber: 42,
          poolEventFound: true,
          attributedDepositor: null,
          senderIgnored: null,
          events: [],
          rawExecutionStatus: "SUCCEEDED",
        }),
      }),
      { accountAddress: STARKNET_ACCOUNT },
    );
    const connected = await adapter.connect(NOW);
    const prepared = await adapter.prepare(grantConsent(connected, NOW + 1), [], NOW + 2);
    const submitted = await adapter.submit(prepared.session, prepared.callAndProof, NOW + 3);

    const observed = await adapter.observeReceipt(submitted, NOW + 4);
    expect(observed.receipt.status).toBe("unknown");
    expect(observed.status).toBe("unknown");
    expect(observed.receipt.status).not.toBe("confirmed");
  });

  it("fences a submission attempt when the provider fails after the submit boundary", async () => {
    let executeCalls = 0;
    const adapter = new PrivacyWalletSessionAdapter(
      privacyPort({
        executeWithProof: async () => {
          executeCalls += 1;
          throw new Error("provider_timeout_after_submit");
        },
      }),
      { accountAddress: STARKNET_ACCOUNT },
    );
    const connected = await adapter.connect(NOW);
    const prepared = await adapter.prepare(grantConsent(connected, NOW + 1), [], NOW + 2);

    await expect(adapter.submit(prepared.session, prepared.callAndProof, NOW + 3)).rejects.toThrow();
    await expect(adapter.submit(prepared.session, prepared.callAndProof, NOW + 4)).rejects.toMatchObject({
      code: "SUBMISSION_REQUIRED",
    });
    expect(executeCalls).toBe(1);
  });

  it("rejects secret-bearing adapter configuration without logging or retaining it", () => {
    expect(() => new StarknetWalletSessionAdapter({
      ...starknetProvider(),
      rpcUrl: "https://rpc.example.invalid/secret",
      privateKey: "not-a-real-key",
    } as never)).toThrow(/secret/i);
  });
});
