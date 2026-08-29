import { describe, expect, it } from "vitest";
import { Strk20Error } from "../domain/errors";
import {
  WalletStrk20ActionAdapter,
  type WalletStrk20ActionProvider,
} from "../adapters/wallet-strk20-action-adapter";
import {
  normalizeReceipt,
  STRK20_POOL_ADDRESS,
  transitionProving,
  createProvingTracker,
} from "../domain/strk20-action-port";
import { makeEmptyProof, makeStubProof } from "../domain/strk20-proof";
import type { Strk20Action } from "../domain/strk20-action-port";
import { createFlow, transition } from "../domain/strk20-state";

// X2 — TEST DOUBLE: adversarial local Wallet API boundary tests only.
// No live wallet, prover, RPC, private key, or broadcast is used here.

const TX = "0x0000000000000000000000000000000000000000000000000000000000000001" as const;
const OTHER_TX = "0x0000000000000000000000000000000000000000000000000000000000000002" as const;
const TOKEN = "0x0000000000000000000000000000000000000000000000000000000000000003" as const;
const ACTIONS: Strk20Action[] = [{ type: "deposit", token: TOKEN, amount: "1" }];

function provider(overrides: Partial<WalletStrk20ActionProvider> = {}): WalletStrk20ActionProvider {
  return {
    supportedWalletApi: async () => ["0.10.3"],
    supportedSpecs: async () => [],
    requestChainId: async () => "SN_SEPOLIA",
    strk20PrepareInvoke: async (_actions, simulate) => ({
      call: {
        contract_address: STRK20_POOL_ADDRESS,
        entry_point: "invoke",
        calldata: ["0x1"],
      },
      proof: simulate ? makeEmptyProof() : makeStubProof(),
    }),
    strk20InvokeTransaction: async () => ({ transaction_hash: TX }),
    executeWithProof: async () => ({ transaction_hash: TX }),
    getReceipt: async (txHash) => ({
      transaction_hash: txHash,
      execution_status: "SUCCEEDED",
      finality_status: "ACCEPTED_ON_L2",
      block_number: 100,
      events: [{
        from_address: STRK20_POOL_ADDRESS,
        keys: ["0xabc"],
        data: [],
      }],
    }),
    ...overrides,
  };
}

function finalReceipt(transactionHash: typeof TX | typeof OTHER_TX, blockNumber = 100) {
  return {
    transactionHash,
    executionStatus: "SUCCEEDED" as const,
    finalityStatus: "ACCEPTED_ON_L2" as const,
    blockNumber,
    poolEventFound: true,
  };
}

describe("M4 wallet/proof fail-closed boundaries", () => {
  it("keeps screening rejection distinct from user refusal", async () => {
    const adapter = new WalletStrk20ActionAdapter(provider({
      strk20InvokeTransaction: async () => {
        throw new Error("screening_rejected: pool denied this deposit");
      },
    }));

    await expect(adapter.execute(ACTIONS)).rejects.toMatchObject({
      code: "STRK20-006",
    });
  });

  it("classifies an empty capability answer as UNKNOWN, not unsupported", async () => {
    const adapter = new WalletStrk20ActionAdapter(provider({
      supportedWalletApi: async () => [],
      supportedSpecs: async () => [],
    }));

    await expect(adapter.ensureReady()).rejects.toMatchObject({
      code: "STRK20-001",
    });
  });

  it("rejects malformed capability payloads with a typed UNKNOWN result", async () => {
    const adapter = new WalletStrk20ActionAdapter(provider({
      supportedWalletApi: async () => [null as unknown as string],
    }));

    await expect(adapter.observeCapability()).rejects.toMatchObject({
      code: "STRK20-001",
    });
  });

  it("rejects malformed or out-of-range action addresses before provider invocation", async () => {
    let invoked = false;
    const adapter = new WalletStrk20ActionAdapter(provider({
      strk20InvokeTransaction: async () => {
        invoked = true;
        return { transaction_hash: TX };
      },
    }));
    const malformed = [{ type: "deposit", token: "not-an-address", amount: "1" }] as never;
    const outOfRange = [{ type: "deposit", token: `0x${(1n << 251n).toString(16)}`, amount: "1" }] as never;

    await expect(adapter.execute(malformed)).rejects.toMatchObject({ code: "STRK20-016" });
    await expect(adapter.execute(outOfRange)).rejects.toMatchObject({ code: "STRK20-016" });
    expect(invoked).toBe(false);
  });

  it("preserves UNKNOWN receipt status instead of treating it as pending", () => {
    const receipt = normalizeReceipt({
      transaction_hash: TX,
      execution_status: "PROVIDER_ADDED_A_NEW_STATUS",
      finality_status: "PROVIDER_ADDED_A_NEW_FINALITY",
      block_number: null,
      events: [],
    });

    expect(receipt.executionStatus).toBe("UNKNOWN");
    expect(receipt.finalityStatus).toBe("UNKNOWN");
    expect(receipt.poolEventFound).toBe(false);
  });

  it("rejects a receipt whose returned hash does not match the requested hash", async () => {
    const adapter = new WalletStrk20ActionAdapter(provider({
      getReceipt: async () => ({
        transaction_hash: OTHER_TX,
        execution_status: "SUCCEEDED",
        finality_status: "ACCEPTED_ON_L2",
        block_number: 100,
        events: [],
      }),
    }));

    await expect(adapter.observeReceipt(TX)).rejects.toMatchObject({
      code: "STRK20-013",
    });
  });

  it("accepts authoritative Starknet snake_case call and receipt/event fields", async () => {
    const authoritativeCall = {
      contract_address: STRK20_POOL_ADDRESS,
      entry_point: "invoke",
      calldata: ["0x1"],
    };
    const adapter = new WalletStrk20ActionAdapter(provider({
      strk20PrepareInvoke: async () => ({
        call: authoritativeCall,
        proof: makeStubProof(),
      } as never),
    }));

    const prepared = await adapter.prepare(ACTIONS, { simulate: false });
    expect(prepared.call).toEqual(authoritativeCall);
    const receipt = await adapter.observeReceipt(TX);
    expect(receipt?.poolEventFound).toBe(true);
    expect(receipt?.attributedDepositor).toBe(`0x${"0".repeat(61)}abc`);
  });

  it("does not submit an empty simulated proof or a proof with malformed shape", async () => {
    let calls = 0;
    const adapter = new WalletStrk20ActionAdapter(provider({
      executeWithProof: async () => {
        calls += 1;
        return { transaction_hash: TX };
      },
    }));
    const call = {
      contract_address: STRK20_POOL_ADDRESS,
      entry_point: "invoke",
      calldata: ["0x1"],
    };

    await expect(adapter.executeWithProof(call as never, makeEmptyProof())).rejects.toMatchObject({
      code: "STRK20-018",
    });
    await expect(adapter.executeWithProof(call as never, { data: 1 } as never)).rejects.toMatchObject({
      code: "STRK20-018",
    });
    expect(calls).toBe(0);
  });

  it("does not advance the proving tracker to ready without a real proof", () => {
    let tracker = createProvingTracker(1_000);
    tracker = transitionProving(tracker, "preparing", 1_001);
    tracker = transitionProving(tracker, "proving", 1_002, {
      call: {
        contract_address: STRK20_POOL_ADDRESS,
        entry_point: "invoke",
        calldata: [],
      },
      proof: makeEmptyProof(),
    });

    expect(() => transitionProving(tracker, "ready", 1_003)).toThrow(/proof_required|empty_proof/);
  });
});

describe("M4 flow receipt completion boundary", () => {
  it("does not turn submitted transfer into transfer_confirmed without a final receipt", () => {
    let flow = createFlow({ id: "receipt-boundary", now: 1_000 });
    flow = transition(flow, { to: "registration_required", now: 1_001 }).flow;
    flow = transition(flow, { to: "approval_pending", now: 1_002 }).flow;
    flow = transition(flow, {
      to: "shielding",
      now: 1_003,
      shieldTxHash: TX,
    }).flow;

    expect(() => transition(flow, {
      to: "confirmed",
      now: 1_004,
      confirmedBlock: 100,
    })).toThrow(/receipt|dependency_failure/);
  });

  it("requires a matching successful receipt before terminal transfer confirmation", () => {
    let flow = createFlow({ id: "transfer-receipt-boundary", now: 1_000 });
    flow = transition(flow, { to: "registration_required", now: 1_001 }).flow;
    flow = transition(flow, { to: "approval_pending", now: 1_002 }).flow;
    flow = transition(flow, {
      to: "shielding",
      now: 1_003,
      shieldTxHash: TX,
    } as never).flow;
    flow = transition(flow, { to: "confirmed", now: 1_004, confirmedBlock: 100, receipt: finalReceipt(TX) } as never).flow;
    flow = transition(flow, { to: "maturing", now: 1_005 }).flow;
    flow = transition(flow, { to: "privately_available", now: 1_006, currentBlock: 110, balanceConsent: "granted" }).flow;
    flow = transition(flow, {
      to: "transfer_pending",
      now: 1_007,
      transferTxHash: OTHER_TX,
    }).flow;

    expect(() => transition(flow, { to: "transfer_confirmed", now: 1_008 } as never)).toThrow(/receipt|dependency_failure/);
    expect(() => transition(flow, {
      to: "transfer_confirmed",
      now: 1_008,
      receipt: finalReceipt(TX),
    } as never)).toThrow(/receipt|dependency_failure/);

    const complete = transition(flow, {
      to: "transfer_confirmed",
      now: 1_008,
      receipt: finalReceipt(OTHER_TX),
    } as never);
    expect(complete.flow.state).toBe("transfer_confirmed");
  });

  it("rejects a completion attempt that replaces the submitted transaction hash", () => {
    let flow = createFlow({ id: "tx-hash-fence", now: 1_000 });
    flow = transition(flow, { to: "registration_required", now: 1_001 }).flow;
    flow = transition(flow, { to: "approval_pending", now: 1_002 }).flow;
    flow = transition(flow, { to: "shielding", now: 1_003, shieldTxHash: TX }).flow;

    expect(() => transition(flow, {
      to: "confirmed",
      now: 1_004,
      shieldTxHash: OTHER_TX,
      receipt: finalReceipt(OTHER_TX),
    } as never)).toThrow(/shield_tx_hash_mismatch/);
  });
});

void Strk20Error;
