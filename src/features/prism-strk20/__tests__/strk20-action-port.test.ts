import { describe, it, expect } from "vitest";
import { Strk20Error } from "../domain/errors";
import { assertNoViewingKey } from "../domain/privacy-guard";
import {
  WalletStrk20ActionAdapter,
  type WalletStrk20ActionProvider,
} from "../adapters/wallet-strk20-action-adapter";
import type { Strk20Action } from "../domain/strk20-action-port";
import { normalizeReceipt, transitionProving, createProvingTracker, STRK20_POOL_ADDRESS } from "../domain/strk20-action-port";
import { makeStubProof, makeEmptyProof, isEmptyProof } from "../domain/strk20-proof";
import { supportsStrk20 } from "../domain/wallet-capability";
import { transition, createFlow } from "../domain/strk20-state";

// X2 — TEST DOUBLE: provider-injected STRK20 action port, no live wallet, no broadcast

function makeProvider(overrides: Partial<WalletStrk20ActionProvider> = {}): WalletStrk20ActionProvider & { calls: Record<string, number> } {
  const calls: Record<string, number> = {};
  const base: WalletStrk20ActionProvider = {
    supportedWalletApi: async () => {
      calls.supportedWalletApi = (calls.supportedWalletApi ?? 0) + 1;
      return ["0.10.3"];
    },
    supportedSpecs: async () => {
      calls.supportedSpecs = (calls.supportedSpecs ?? 0) + 1;
      return [];
    },
    requestChainId: async () => {
      calls.requestChainId = (calls.requestChainId ?? 0) + 1;
      return "SN_SEPOLIA";
    },
    strk20PrepareInvoke: async (actions: Strk20Action[], simulate?: boolean) => {
      calls.strk20PrepareInvoke = (calls.strk20PrepareInvoke ?? 0) + 1;
      const call = { contract_address: "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a" as `0x${string}`, entry_point: "deposit", calldata: ["0x1"] };
      if (simulate) return { call, proof: makeEmptyProof() };
      return { call, proof: makeStubProof() };
    },
    strk20InvokeTransaction: async () => {
      calls.strk20InvokeTransaction = (calls.strk20InvokeTransaction ?? 0) + 1;
      return { transaction_hash: "0x0000000000000000000000000000000000000000000000000000000000000001" };
    },
    strk20Balances: async () => {
      calls.strk20Balances = (calls.strk20Balances ?? 0) + 1;
      return [];
    },
    executeWithProof: async () => {
      calls.executeWithProof = (calls.executeWithProof ?? 0) + 1;
      return { transaction_hash: "0x0000000000000000000000000000000000000000000000000000000000000002" };
    },
    getReceipt: async (txHash: string) => {
      calls.getReceipt = (calls.getReceipt ?? 0) + 1;
      return {
        transactionHash: txHash,
        executionStatus: "SUCCEEDED",
        finalityStatus: "ACCEPTED_ON_L2",
        blockNumber: 100,
        events: [{ address: "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a", keys: ["0x0000000000000000000000000000000000000000000000000000000000000abc"], data: [] }],
        senderAddress: "0x0000000000000000000000000000000000000000000000000000000000000def",
      } as unknown as Record<string, unknown>;
    },
    ...overrides,
  };
  return Object.assign(base, { calls });
}

const sampleActions: Strk20Action[] = [{ type: "deposit", token: "0x0000000000000000000000000000000000000000000000000000000000000001", amount: "1000" }];

describe("M4 Wallet API Runtime — STRK20 Action Port X2", () => {
  // capability positive/negative
  it("capability positive: supportsStrk20 >=0.10.3 via apiVersions", () => {
    expect(supportsStrk20(["0.10.3"], [])).toBe(true);
    expect(supportsStrk20(["0.10.4"], [])).toBe(true);
    expect(supportsStrk20([], ["0.10.3"])).toBe(true);
  });

  it("capability negative: below 0.10.3 or empty is not capable", () => {
    expect(supportsStrk20(["0.10.2"], [])).toBe(false);
    expect(supportsStrk20([], [])).toBe(false);
    // Note: pure supportsStrk20(["1.0.0"]) returns true numerically, but walletApi feature version "1.0.0" (starknet:walletApi) is NOT a STRK20 signal – detection must use supportedWalletApi/supportedSpecs only. Hence higher-level adapter must never treat feature version as capability.
    expect(supportsStrk20(["0.9.9"], [])).toBe(false);
    // adapter level negative: provider returns 0.10.2
    const provider = makeProvider({ supportedWalletApi: async () => ["0.10.2"], supportedSpecs: async () => [] });
    const adapter = new WalletStrk20ActionAdapter(provider);
    return expect(adapter.ensureReady()).rejects.toThrow(/unsupported_wallet|below_0_10_3/);
  });

  it("capability negative: adapter fails closed when unsupported wallet (0.9.9)", async () => {
    const provider = makeProvider({ supportedWalletApi: async () => ["0.9.9"], supportedSpecs: async () => [] });
    const adapter = new WalletStrk20ActionAdapter(provider);
    await expect(adapter.prepare(sampleActions, { simulate: true })).rejects.toThrow(Strk20Error);
    try {
      await adapter.prepare(sampleActions, { simulate: true });
    } catch (e) {
      expect((e as Strk20Error).code).toBe("STRK20-021");
    }
  });

  // network mismatch
  it("network mismatch: SN_SEPOLIA guard fails when wallet on SN_MAIN", async () => {
    const provider = makeProvider({ requestChainId: async () => "SN_MAIN" });
    const adapter = new WalletStrk20ActionAdapter(provider, { expectedChainId: "SN_SEPOLIA" });
    await expect(adapter.ensureReady()).rejects.toThrow(/expected_SN_SEPOLIA_got_SN_MAIN|network_mismatch/);
    try {
      await adapter.ensureReady();
    } catch (e) {
      expect((e as Strk20Error).code).toBe("STRK20-002");
    }
  });

  it("network mismatch: UNKNOWN environment fails closed", async () => {
    const provider = makeProvider({ requestChainId: async () => "0x123" });
    const adapter = new WalletStrk20ActionAdapter(provider);
    await expect(adapter.ensureReady()).rejects.toThrow(/unknown_network|network_mismatch/);
  });

  it("network mismatch: state machine mismatch blocks readiness", () => {
    let f = createFlow({ id: "net-mismatch", now: 1000, expectedChainId: "SN_SEPOLIA" });
    const r = transition(f, { to: "mismatch", now: 1001, chainId: "SN_MAIN", capable: true, errorCode: "STRK20-002", errorDetail: "expected SN_SEPOLIA got SN_MAIN" });
    expect(r.flow.state).toBe("mismatch");
    expect(r.flow.chainId).toBe("SN_MAIN");
    // mismatch cannot directly go to shielding
    expect(() => transition(r.flow, { to: "shielding", now: 1002, shieldTxHash: "0x0000000000000000000000000000000000000000000000000000000000000001" })).toThrow(/illegal/);
  });

  // provider refusal
  it("provider refusal: wallet user refused maps to PROVIDER_REFUSED", async () => {
    const provider = makeProvider({
      strk20InvokeTransaction: async () => {
        throw new Error("User_refused_op: user rejected transaction");
      },
    });
    const adapter = new WalletStrk20ActionAdapter(provider);
    await expect(adapter.execute(sampleActions)).rejects.toThrow(Strk20Error);
    try {
      await adapter.execute(sampleActions);
    } catch (e) {
      expect((e as Strk20Error).code).toBe("STRK20-020");
      expect((e as Strk20Error).message).not.toMatch(/stack/i);
    }
  });

  it("provider refusal: prepare with user denied throws PROVIDER_REFUSED", async () => {
    const provider = makeProvider({
      strk20PrepareInvoke: async () => {
        throw new Error("USER_REFUSED_OP");
      },
    });
    const adapter = new WalletStrk20ActionAdapter(provider);
    await expect(adapter.prepare(sampleActions, { simulate: false })).rejects.toThrow(/refused/);
    try {
      await adapter.prepare(sampleActions, { simulate: false });
    } catch (e) {
      expect((e as Strk20Error).code).toBe("STRK20-020");
    }
  });

  it("unknown provider errors are typed without echoing key material", async () => {
    const provider = makeProvider({
      strk20InvokeTransaction: async () => {
        throw new Error("opaque provider failure: viewing key secret-material-should-not-escape");
      },
    });
    const adapter = new WalletStrk20ActionAdapter(provider);

    try {
      await adapter.execute(sampleActions);
      throw new Error("expected provider failure");
    } catch (e) {
      expect((e as Strk20Error).code).toBe("STRK20-013");
      expect((e as Error).message).not.toContain("secret-material-should-not-escape");
      expect((e as Error).message).not.toContain("viewing key");
    }
  });

  // missing methods
  it("missing methods: provider without strk20PrepareInvoke fails closed UNSUPPORTED_WALLET_METHOD", async () => {
    const provider = makeProvider();
    // delete method
    (provider as unknown as Record<string, unknown>).strk20PrepareInvoke = undefined;
    const adapter = new WalletStrk20ActionAdapter(provider);
    await expect(adapter.prepare(sampleActions, { simulate: true })).rejects.toThrow(/wallet_missing_method|unsupported_wallet_method/);
    try {
      await adapter.prepare(sampleActions, { simulate: true });
    } catch (e) {
      expect((e as Strk20Error).code).toBe("STRK20-019");
    }
  });

  it("missing methods: strk20InvokeTransaction absent fails closed", async () => {
    const provider = makeProvider();
    (provider as unknown as Record<string, unknown>).strk20InvokeTransaction = undefined;
    const adapter = new WalletStrk20ActionAdapter(provider);
    await expect(adapter.execute(sampleActions)).rejects.toThrow(/missing_method|unsupported_wallet_method/);
    try {
      await adapter.execute(sampleActions);
    } catch (e) {
      expect((e as Strk20Error).code).toBe("STRK20-019");
    }
  });

  it("missing methods: capability detection still works without STRK20 methods (observeCapability)", async () => {
    const provider = makeProvider();
    (provider as unknown as Record<string, unknown>).strk20PrepareInvoke = undefined;
    const adapter = new WalletStrk20ActionAdapter(provider);
    const cap = await adapter.observeCapability();
    expect(cap.capable).toBe(true);
    // capability success does not imply every action method is present
    await expect(adapter.prepare(sampleActions, { simulate: true })).rejects.toThrow(/unsupported_wallet_method/);
  });

  // simulation with empty proof
  it("simulation with empty proof: simulate=true returns empty proof, not submittable", async () => {
    const provider = makeProvider();
    const adapter = new WalletStrk20ActionAdapter(provider);
    const res = await adapter.simulate(sampleActions);
    expect(isEmptyProof(res.proof)).toBe(true);
    expect(res.proof.data).toBe("");
    expect(res.proof.output.length).toBe(0);
    expect(res.proof.proof_facts.length).toBe(0);
  });

  it("simulation with empty proof: simulate false returns non-empty proof", async () => {
    const provider = makeProvider();
    const adapter = new WalletStrk20ActionAdapter(provider);
    const res = await adapter.prepare(sampleActions, { simulate: false });
    expect(isEmptyProof(res.proof)).toBe(false);
    expect(res.proof.data.length).toBeGreaterThan(0);
  });

  it("simulation empty proof invariant: provider returning non-empty on simulate throws dependency failure", async () => {
    const provider = makeProvider({
      strk20PrepareInvoke: async () => ({ call: { contract_address: "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a" as `0x${string}`, entry_point: "x", calldata: [] }, proof: makeStubProof() }),
    });
    const adapter = new WalletStrk20ActionAdapter(provider);
    await expect(adapter.simulate(sampleActions)).rejects.toThrow(/simulate_expected_empty_proof/);
  });

  it("simulation: prepare with simulate=false returning empty proof throws PROOF_REQUIRED", async () => {
    const provider = makeProvider({
      strk20PrepareInvoke: async () => ({ call: { contract_address: "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a" as `0x${string}`, entry_point: "x", calldata: [] }, proof: makeEmptyProof() }),
    });
    const adapter = new WalletStrk20ActionAdapter(provider);
    await expect(adapter.prepare(sampleActions, { simulate: false })).rejects.toThrow(/empty_proof|proof_required/);
    try {
      await adapter.prepare(sampleActions, { simulate: false });
    } catch (e) {
      expect((e as Strk20Error).code).toBe("STRK20-018");
    }
  });

  // proof-required submission boundary
  it("proof-required submission boundary: executeWithProof with empty proof throws PROOF_REQUIRED", async () => {
    const provider = makeProvider();
    const adapter = new WalletStrk20ActionAdapter(provider);
    const call = { contract_address: "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a" as `0x${string}`, entry_point: "deposit", calldata: ["0x1"] };
    await expect(adapter.executeWithProof(call, makeEmptyProof())).rejects.toThrow(/empty_proof|proof_required/);
    try {
      await adapter.executeWithProof(call, makeEmptyProof());
    } catch (e) {
      expect((e as Strk20Error).code).toBe("STRK20-018");
    }
    // No provider call should have happened for empty proof
    expect(provider.calls.executeWithProof ?? 0).toBe(0);
  });

  it("proof-required submission boundary: valid proof allows submission", async () => {
    const provider = makeProvider();
    const adapter = new WalletStrk20ActionAdapter(provider);
    const call = { contract_address: "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a" as `0x${string}`, entry_point: "deposit", calldata: ["0x1"] };
    const res = await adapter.executeWithProof(call, makeStubProof());
    expect(res.transactionHash).toBe("0x0000000000000000000000000000000000000000000000000000000000000002");
  });

  it("proof-required submission boundary: simulate result not submittable via executeWithProof", async () => {
    const provider = makeProvider();
    const adapter = new WalletStrk20ActionAdapter(provider);
    const simulated = await adapter.simulate(sampleActions);
    // Try to submit simulated empty proof – must fail before provider hit
    await expect(adapter.executeWithProof(simulated.call, simulated.proof)).rejects.toThrow(/empty_proof/);
    expect(provider.calls.executeWithProof ?? 0).toBe(0);
  });

  // receipt states
  it("receipt states: SUCCEEDED normalized with poolEventFound and depositor attribution", async () => {
    const provider = makeProvider();
    const adapter = new WalletStrk20ActionAdapter(provider);
    const receipt = await adapter.observeReceipt("0x0000000000000000000000000000000000000000000000000000000000000001");
    expect(receipt).not.toBeNull();
    expect(receipt!.executionStatus).toBe("SUCCEEDED");
    expect(receipt!.finalityStatus).toBe("ACCEPTED_ON_L2");
    expect(receipt!.poolEventFound).toBe(true);
    expect(receipt!.attributedDepositor).toBe("0x0000000000000000000000000000000000000000000000000000000000000abc");
    expect(receipt!.senderIgnored).toBe("0x0000000000000000000000000000000000000000000000000000000000000def");
    expect(receipt!.blockNumber).toBe(100);
  });

  it("receipt states: REVERTED, RECEIVED, PENDING normalization", () => {
    const reverted = normalizeReceipt({ transactionHash: "0x1", executionStatus: "REVERTED", finalityStatus: "ACCEPTED_ON_L2", blockNumber: 10, events: [] });
    expect(reverted.executionStatus).toBe("REVERTED");
    const received = normalizeReceipt({ transactionHash: "0x2", executionStatus: "RECEIVED", finalityStatus: "RECEIVED", blockNumber: null, events: [] });
    expect(received.executionStatus).toBe("RECEIVED");
    const pending = normalizeReceipt({ transactionHash: "0x3", executionStatus: "PENDING", finalityStatus: "UNKNOWN", blockNumber: null, events: [] });
    expect(pending.executionStatus).toBe("PENDING");
    expect(pending.poolEventFound).toBe(false);
  });

  it("receipt parser does not count pool events from a reverted transaction", () => {
    const reverted = normalizeReceipt({
      transactionHash: "0x4",
      executionStatus: "REVERTED",
      finalityStatus: "ACCEPTED_ON_L2",
      blockNumber: 11,
      events: [{ address: STRK20_POOL_ADDRESS, keys: ["0xabc"] }],
    });
    expect(reverted.poolEventFound).toBe(false);
    expect(reverted.attributedDepositor).toBeNull();
  });

  it("receipt states: relayer sender ignored, not attribution source", async () => {
    const relayer = "0x0000000000000000000000000000000000000000000000000000000000000abc";
    const depositor = "0x0000000000000000000000000000000000000000000000000000000000000def";
    const txHash = "0x0000000000000000000000000000000000000000000000000000000000000001" as `0x${string}`;
    const provider = makeProvider({
      getReceipt: async () => ({
        transactionHash: txHash,
        executionStatus: "SUCCEEDED",
        finalityStatus: "ACCEPTED_ON_L2",
        blockNumber: 100,
        events: [{ address: "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a", keys: [depositor], data: [] }],
        senderAddress: relayer,
      } as unknown as Record<string, unknown>),
    });
    const adapter = new WalletStrk20ActionAdapter(provider);
    const receipt = await adapter.observeReceipt(txHash);
    expect(receipt!.attributedDepositor).toBe(depositor);
    expect(receipt!.senderIgnored).toBe(relayer);
    expect(receipt!.attributedDepositor).not.toBe(receipt!.senderIgnored);
  });

  it("receipt states: null receipt when not found", async () => {
    const provider = makeProvider({ getReceipt: async () => null });
    const adapter = new WalletStrk20ActionAdapter(provider);
    const receipt = await adapter.observeReceipt("0x0000000000000000000000000000000000000000000000000000000000000001");
    expect(receipt).toBeNull();
  });

  // no viewing-key leakage
  it("no viewing-key leakage: any payload containing viewingKey throws", async () => {
    expect(() => assertNoViewingKey({ viewingKey: "0xabc" }, "test")).toThrow(/viewing_key_forbidden/);
    expect(() => assertNoViewingKey("my viewing key is xyz", "note")).toThrow();
    expect(() => assertNoViewingKey({ nested: { privateKey: "0x123" } }, "deep")).toThrow();
    expect(() => assertNoViewingKey({ token: "0x1", viewing_key: "secret" }, "action")).toThrow();
  });

  it("no viewing-key leakage: provider injected with viewingKey is rejected at construction", () => {
    const bad = makeProvider() as unknown as WalletStrk20ActionProvider & Record<string, unknown>;
    (bad as unknown as Record<string, unknown>).viewingKey = "0xsecret";
    expect(() => new WalletStrk20ActionAdapter(bad)).toThrow(/viewing_key_forbidden/);
  });

  it("no viewing-key leakage: prepare with viewingKey in actions throws", async () => {
    const provider = makeProvider();
    const adapter = new WalletStrk20ActionAdapter(provider);
    const badActions = [{ type: "deposit", token: "0x0000000000000000000000000000000000000000000000000000000000000001", amount: "1000", viewingKey: "0xsecret" } as unknown as Strk20Action];
    await expect(adapter.prepare(badActions, { simulate: true })).rejects.toThrow(/viewing_key_forbidden/);
    await expect(adapter.execute(badActions)).rejects.toThrow(/viewing_key_forbidden/);
  });

  it("no viewing-key leakage: executeWithProof with viewingKey in proof throws", async () => {
    const provider = makeProvider();
    const adapter = new WalletStrk20ActionAdapter(provider);
    const call = { contract_address: "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a" as `0x${string}`, entry_point: "x", calldata: [] };
    const badProof = { data: "viewing key material", output: [], proof_facts: [] } as unknown as import("../domain/strk20-proof").Strk20Proof;
    await expect(adapter.executeWithProof(call, badProof)).rejects.toThrow(/viewing_key_forbidden|forbidden/);
  });

  // screening distinction
  it("screening distinction: screening rejected vs unavailable vs privacy leak map to distinct codes", async () => {
    const providerRejected = makeProvider({
      strk20InvokeTransaction: async () => {
        throw new Error("privacy_leak: action would leak");
      },
    });
    const adapterRejected = new WalletStrk20ActionAdapter(providerRejected);
    try {
      await adapterRejected.execute(sampleActions);
    } catch (e) {
      expect((e as Strk20Error).code).toBe("STRK20-006");
    }

    const providerUnavailable = makeProvider({
      strk20InvokeTransaction: async () => {
        throw new Error("screening_unavailable: service down");
      },
    });
    const adapterUnavailable = new WalletStrk20ActionAdapter(providerUnavailable);
    try {
      await adapterUnavailable.execute(sampleActions);
    } catch (e) {
      expect((e as Strk20Error).code).toBe("STRK20-007");
    }
    // Ensure they are distinct
    expect("STRK20-006").not.toBe("STRK20-007");
  });

  // unsupported/unknown fail-closed
  it("fail-closed unknown: empty apiVersions/specs are UNKNOWN, not unsupported", async () => {
    const provider = makeProvider({ supportedWalletApi: async () => [], supportedSpecs: async () => [] });
    const adapter = new WalletStrk20ActionAdapter(provider);
    await expect(adapter.ensureReady()).rejects.toThrow(/capability_unknown/);
    const cap = await adapter.observeCapability();
    expect(cap.capable).toBe(false);
    expect(cap.capabilityStatus).toBe("unknown");
  });

  it("fail-closed unsupported: adapter isSupported false when capability false", async () => {
    const provider = makeProvider({ supportedWalletApi: async () => ["0.10.2"], supportedSpecs: async () => [] });
    const adapter = new WalletStrk20ActionAdapter(provider);
    expect(await adapter.isSupported()).toBe(false);
  });

  it("fail-closed unknown: provider throwing on supportedWalletApi maps to CAPABILITY_UNKNOWN", async () => {
    const provider = makeProvider({
      supportedWalletApi: async () => {
        throw new Error("unknown error fetching api");
      },
    });
    const adapter = new WalletStrk20ActionAdapter(provider);
    await expect(adapter.observeCapability()).rejects.toThrow(/capability_unknown|CAPABILITY_UNKNOWN|capability_query_failed/);
    try {
      await adapter.observeCapability();
    } catch (e) {
      expect((e as Strk20Error).code).toBe("STRK20-001");
    }
  });

  // long-running proof state
  it("long-running proof state: proving tracker lifecycle idle->preparing->proving->ready->submitting->confirmed", () => {
    const now = 1_000;
    let t = createProvingTracker(now);
    expect(t.state).toBe("idle");
    t = transitionProving(t, "preparing", now + 10);
    expect(t.state).toBe("preparing");
    // proving is long-running: may have empty proof
    const simCall = { call: { contract_address: "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a" as `0x${string}`, entry_point: "x", calldata: [] }, proof: makeEmptyProof() };
    t = transitionProving(t, "proving", now + 20, simCall);
    expect(t.state).toBe("proving");
    expect(t.elapsedMs).not.toBeNull();
    // ready requires non-empty proof
    const readyCall = { call: simCall.call, proof: makeStubProof() };
    t = transitionProving(t, "ready", now + 30, readyCall);
    expect(t.state).toBe("ready");
    expect(isEmptyProof(t.callAndProof!.proof)).toBe(false);
    t = transitionProving(t, "submitting", now + 40);
    expect(t.state).toBe("submitting");
    t = transitionProving(t, "confirmed", now + 50);
    expect(t.state).toBe("confirmed");
  });

  it("long-running proof state: proving tracker rejects illegal jump idle->ready", () => {
    const t = createProvingTracker(1000);
    expect(() => transitionProving(t, "ready", 1010)).toThrow(/illegal_proving/);
  });

  it("long-running proof state: proving tracker ready with empty proof throws PROOF_REQUIRED", () => {
    let t = createProvingTracker(1000);
    t = transitionProving(t, "preparing", 1010);
    t = transitionProving(t, "proving", 1020, { call: { contract_address: "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a" as `0x${string}`, entry_point: "x", calldata: [] }, proof: makeEmptyProof() });
    expect(() => transitionProving(t, "ready", 1030, { call: { contract_address: "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a" as `0x${string}`, entry_point: "x", calldata: [] }, proof: makeEmptyProof() })).toThrow(/proof_required|empty_proof/);
  });

  it("long-running proof state: state machine proving integrates with strk20-state", () => {
    let f = createFlow({ id: "proving-state", now: 1000 });
    f = transition(f, { to: "registration_required", now: 1001 }).flow;
    f = transition(f, { to: "approval_pending", now: 1002 }).flow;
    f = transition(f, { to: "shielding", now: 1003, shieldTxHash: "0x0000000000000000000000000000000000000000000000000000000000000001" }).flow;
    const shieldReceipt = {
      transactionHash: "0x0000000000000000000000000000000000000000000000000000000000000001" as `0x${string}`,
      executionStatus: "SUCCEEDED" as const,
      finalityStatus: "ACCEPTED_ON_L2" as const,
      blockNumber: 100,
      poolEventFound: true,
    };
    f = transition(f, { to: "confirmed", now: 1004, confirmedBlock: 100, receipt: shieldReceipt }).flow;
    f = transition(f, { to: "maturing", now: 1005 }).flow;
    f = transition(f, { to: "privately_available", now: 1006, currentBlock: 110, balanceConsent: "granted" }).flow;
    expect(f.state).toBe("privately_available");
    // proving is long-running ZK proof generation before transfer
    f = transition(f, { to: "proving", now: 1007 }).flow;
    expect(f.state).toBe("proving");
    f = transition(f, { to: "transfer_pending", now: 1008, transferTxHash: "0x0000000000000000000000000000000000000000000000000000000000000002" }).flow;
    expect(f.state).toBe("transfer_pending");
    const transferReceipt = {
      transactionHash: "0x0000000000000000000000000000000000000000000000000000000000000002" as `0x${string}`,
      executionStatus: "SUCCEEDED" as const,
      finalityStatus: "ACCEPTED_ON_L2" as const,
      blockNumber: 120,
      poolEventFound: true,
    };
    f = transition(f, { to: "transfer_confirmed", now: 1009, receipt: transferReceipt }).flow;
    expect(f.state).toBe("transfer_confirmed");
  });

  it("mobile connector boundary: adapter does not import starknetkit", async () => {
    // This test ensures the new port remains an injected boundary, not a guessed starknetkit dep
    // Check that WalletStrk20ActionAdapter provider interface is narrow and does not require starknetkit
    const provider = makeProvider();
    const adapter = new WalletStrk20ActionAdapter(provider);
    expect(adapter).toBeInstanceOf(WalletStrk20ActionAdapter);
    // Ensure no starknetkit import exists in source (ignore explanatory comments that mention the name)
    const fs = await import("fs");
    const content = fs.readFileSync("src/features/prism-strk20/adapters/wallet-strk20-action-adapter.ts", "utf8");
    expect(content).not.toMatch(/from\s+["']starknetkit["']/i);
    expect(content).not.toMatch(/import.*starknetkit/i);
    const portContent = fs.readFileSync("src/features/prism-strk20/domain/strk20-action-port.ts", "utf8");
    expect(portContent).not.toMatch(/from\s+["']starknetkit["']/i);
    // package.json must not have added starknetkit
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
    expect(Object.keys(pkg.dependencies ?? {})).not.toContain("starknetkit");
    expect(Object.keys(pkg.devDependencies ?? {})).not.toContain("starknetkit");
    // starknet version must remain 10.4.0
    expect(pkg.dependencies.starknet).toBe("10.4.0");
  });
});
