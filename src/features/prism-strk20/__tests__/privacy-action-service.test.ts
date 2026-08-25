import { describe, expect, it } from "vitest";
import {
  PrivacyActionService,
  type PrivacyActionServiceDeps,
  type PrivacyActionRequest,
} from "../application/privacy-action-service";
import {
  WalletStrk20ActionAdapter,
  type WalletStrk20ActionProvider,
} from "../adapters/wallet-strk20-action-adapter";
import {
  InjectedWalletStrk20Adapter,
  type InjectedWalletProvider,
} from "../adapters/injected-wallet";
import { makeEmptyProof, makeStubProof } from "../domain/strk20-proof";
import { STRK20_POOL_ADDRESS, type Strk20Action } from "../domain/strk20-action-port";
import { Strk20Error } from "../domain/errors";

const TX = "0x0000000000000000000000000000000000000000000000000000000000000001" as const;
const TOKEN = "0x0000000000000000000000000000000000000000000000000000000000000003" as const;
const RECIPIENT = "0x0000000000000000000000000000000000000000000000000000000000000004" as const;
const ACTIONS: Strk20Action[] = [{ type: "transfer", token: TOKEN, amount: "1", recipient: RECIPIENT }];

function makeProviders(
  overrides: Partial<WalletStrk20ActionProvider> & Partial<Omit<InjectedWalletProvider, "isRegistered">> & {
    isRegistered?: () => Promise<boolean | null>;
  } = {},
) {
  const calls: Record<string, number> = {};
  let receiptMode: "pending" | "success" | "reverted" = "success";
  const count = (name: string) => {
    calls[name] = (calls[name] ?? 0) + 1;
  };
  const receipt = (txHash: string): Record<string, unknown> => {
    count("getReceipt");
    if (receiptMode === "pending") {
      return {
        transactionHash: txHash,
        executionStatus: "PENDING",
        finalityStatus: "PENDING",
        blockNumber: null,
        events: [],
      };
    }
    return {
      transactionHash: txHash,
      executionStatus: receiptMode === "reverted" ? "REVERTED" : "SUCCEEDED",
      finalityStatus: receiptMode === "reverted" ? "ACCEPTED_ON_L2" : "ACCEPTED_ON_L2",
      blockNumber: receiptMode === "reverted" ? 101 : 100,
      events: receiptMode === "success" ? [{ address: STRK20_POOL_ADDRESS, keys: ["0xabc"], data: [] }] : [],
    };
  };

  const base = {
    supportedWalletApi: async () => {
      count("supportedWalletApi");
      return ["0.10.3"];
    },
    supportedSpecs: async () => {
      count("supportedSpecs");
      return [];
    },
    requestChainId: async () => {
      count("requestChainId");
      return "SN_SEPOLIA";
    },
    isRegistered: async () => {
      count("isRegistered");
      return true;
    },
    getFeeAmount: async () => {
      count("getFeeAmount");
      return { fee: 4n, blockNumber: 10 };
    },
    balances: async () => {
      count("balances");
      return { balances: [{ token: TOKEN, amount: 10n }], consent: "granted" as const };
    },
    approve: async () => {
      count("approve");
      return TX;
    },
    shield: async () => {
      count("shield");
      return { txHash: TX, executionStatus: "SUCCEEDED" as const, screening: "approved" as const, blockNumber: 100, receiptEvents: [] };
    },
    transfer: async () => {
      count("transfer");
      return { txHash: TX, executionStatus: "SUCCEEDED" as const, blockNumber: 100 };
    },
    strk20PrepareInvoke: async (_actions: Strk20Action[], simulate?: boolean) => {
      count(simulate ? "simulate" : "prepare");
      return {
        call: { contract_address: STRK20_POOL_ADDRESS, entry_point: "invoke", calldata: ["0x1"] },
        proof: simulate ? makeEmptyProof() : makeStubProof(),
      };
    },
    strk20InvokeTransaction: async () => {
      count("strk20InvokeTransaction");
      return { transaction_hash: TX };
    },
    executeWithProof: async () => {
      count("executeWithProof");
      return { transaction_hash: TX };
    },
    getReceipt: async (txHash: string) => receipt(txHash),
    ...overrides,
  } as unknown as WalletStrk20ActionProvider & InjectedWalletProvider;

  return {
    calls,
    action: new WalletStrk20ActionAdapter(base as WalletStrk20ActionProvider),
    wallet: new InjectedWalletStrk20Adapter(base as InjectedWalletProvider),
    setReceiptMode(mode: "pending" | "success" | "reverted") {
      receiptMode = mode;
    },
    provider: base,
  };
}

function makeService(
  providers: ReturnType<typeof makeProviders>,
  overrides: Partial<PrivacyActionServiceDeps> = {},
) {
  return new PrivacyActionService({
    actionPort: providers.action,
    walletPort: providers.wallet,
    now: () => 1_000,
    ...overrides,
  });
}

function request(overrides: Partial<PrivacyActionRequest> = {}): PrivacyActionRequest {
  return {
    id: "privacy-action-1",
    kind: "private_transfer",
    actions: ACTIONS,
    quotedFee: 4n,
    requireConsent: true,
    ...overrides,
  };
}

describe("PrivacyActionService — local Wallet API integration boundary", () => {
  it("wires capability, registration, fee, consent, real proof, submit, receipt, and terminal state", async () => {
    const providers = makeProviders();
    const service = makeService(providers);

    const created = service.create(request());
    expect(created.state).toBe("capability_unknown");
    expect(created.terminal).toBe(false);

    const prepared = await service.prepare(created.id);
    expect(prepared.capability?.capable).toBe(true);
    expect(prepared.registration.status).toBe("registered");
    expect(prepared.fee?.fee).toBe(4n);
    expect(prepared.consent.status).toBe("granted");
    expect(prepared.proof.status).toBe("ready");
    expect(prepared.state).toBe("proof_ready");
    expect(prepared.terminal).toBe(false);
    expect(providers.calls.balances).toBe(1);
    expect(providers.calls.executeWithProof ?? 0).toBe(0);

    const submitted = await service.submit(created.id);
    expect(submitted.transactionHash).toBe(TX);
    expect(submitted.state).toBe("transfer_pending");
    expect(submitted.receipt).toBeNull();
    expect(submitted.terminal).toBe(false);
    expect(providers.calls.executeWithProof).toBe(1);

    const completed = await service.observeReceipt(created.id);
    expect(completed.state).toBe("transfer_confirmed");
    expect(completed.receipt?.executionStatus).toBe("SUCCEEDED");
    expect(completed.receipt?.poolEventFound).toBe(true);
    expect(completed.terminal).toBe(true);
  });

  it("uses the InjectedWalletStrk20Adapter wallet-managed fallback without exposing proof material", async () => {
    const providers = makeProviders();
    const service = new PrivacyActionService({ walletPort: providers.wallet, now: () => 1_000 });
    const id = "wallet-managed-transfer";

    const prepared = await service.prepare(request({
      id,
      execution: "wallet_managed",
      token: TOKEN,
      amount: 1n,
      recipient: RECIPIENT,
      consentTokens: [TOKEN],
    }));
    expect(prepared.proof.status).toBe("wallet_managed");
    expect(prepared.proof.call).toBeNull();

    const submitted = await service.submit(id);
    expect(submitted.state).toBe("transfer_pending");
    expect(providers.calls.transfer).toBe(1);
    expect(providers.calls.executeWithProof ?? 0).toBe(0);

    const completed = await service.observeReceipt(id);
    expect(completed.state).toBe("transfer_confirmed");
    expect(completed.terminal).toBe(true);
  });

  it("supports WalletAccountV6 wallet-side proving through strk20InvokeTransaction", async () => {
    const providers = makeProviders();
    const service = makeService(providers);
    const id = "wallet-action-proof";

    const prepared = await service.prepare(request({
      id,
      kind: "application",
      execution: "wallet_action",
      requireConsent: false,
    }));
    expect(prepared.proof.status).toBe("wallet_managed");

    const submitted = await service.submit(id);
    expect(submitted.state).toBe("transfer_pending");
    expect(providers.calls.strk20InvokeTransaction).toBe(1);
    expect(providers.calls.executeWithProof ?? 0).toBe(0);

    const completed = await service.observeReceipt(id);
    expect(completed.state).toBe("transfer_confirmed");
    expect(completed.terminal).toBe(true);
  });

  it("does not use balances for capability-only preparation when consent is not requested", async () => {
    const providers = makeProviders();
    const service = makeService(providers);

    const prepared = await service.prepare(request({ id: "capability-only", requireConsent: false }));
    expect(prepared.capability?.capable).toBe(true);
    expect(prepared.consent.status).toBe("not_requested");
    expect(providers.calls.balances ?? 0).toBe(0);
  });

  it("keeps an empty capability answer UNKNOWN and stops before registration, fee, proof, or submit", async () => {
    const providers = makeProviders({
      supportedWalletApi: async () => [],
      supportedSpecs: async () => [],
    });
    const service = makeService(providers);

    await expect(service.prepare(request({ id: "unknown-capability" }))).rejects.toMatchObject({ code: "STRK20-001" });
    expect(providers.calls.isRegistered ?? 0).toBe(0);
    expect(providers.calls.getFeeAmount ?? 0).toBe(0);
    expect(providers.calls.prepare ?? 0).toBe(0);
    expect(providers.calls.executeWithProof ?? 0).toBe(0);
  });

  it("requires observed registration and never treats unknown registration as registered", async () => {
    const providers = makeProviders({ isRegistered: async () => false });
    const service = makeService(providers);

    await expect(service.prepare(request({ id: "registration-required" }))).rejects.toMatchObject({ code: "STRK20-003" });
    expect(service.get("registration-required")?.registration.status).toBe("required");
    expect(providers.calls.getFeeAmount ?? 0).toBe(0);
    expect(providers.calls.prepare ?? 0).toBe(0);

    const unknownProviders = makeProviders({ isRegistered: async () => null });
    const unknownService = makeService(unknownProviders);
    const prepared = await unknownService.prepare(request({ id: "registration-unknown" }));
    expect(prepared.registration.status).toBe("unknown");
    expect(prepared.proof.status).toBe("ready");
  });

  it("re-quotes the fee at submit and rejects a changed fee before wallet submission", async () => {
    let fee = 4n;
    const providers = makeProviders({ getFeeAmount: async () => ({ fee, blockNumber: 10 }) });
    const service = makeService(providers);
    const id = request({ id: "fee-fence" }).id;

    await service.prepare(id === "fee-fence" ? request({ id }) : request());
    fee = 5n;

    await expect(service.submit(id)).rejects.toMatchObject({ code: "STRK20-008" });
    expect(providers.calls.executeWithProof ?? 0).toBe(0);
  });

  it("requires explicit consent for private balance state and does not prepare proof after denial", async () => {
    const providers = makeProviders({ balances: async () => ({ balances: [], consent: "denied" as const }) });
    const service = makeService(providers);

    await expect(service.prepare(request({ id: "consent-denied" }))).rejects.toMatchObject({ code: "STRK20-005" });
    expect(service.get("consent-denied")?.consent.status).toBe("denied");
    expect(providers.calls.prepare ?? 0).toBe(0);
    expect(providers.calls.executeWithProof ?? 0).toBe(0);
  });

  it("keeps simulated proof non-submittable and never calls the wallet submit method", async () => {
    const providers = makeProviders();
    const service = makeService(providers);
    const id = "simulation-only";

    const simulated = await service.simulate(request({ id }));
    expect(simulated.proof.status).toBe("simulated_empty");
    expect(simulated.state).toBe("proving");
    await expect(service.submit(id)).rejects.toMatchObject({ code: "STRK20-018" });
    expect(providers.calls.executeWithProof ?? 0).toBe(0);
  });

  it("rejects an empty non-simulated proof before any submit", async () => {
    const providers = makeProviders({
      strk20PrepareInvoke: async () => ({
        call: { contract_address: STRK20_POOL_ADDRESS, entry_point: "invoke", calldata: ["0x1"] },
        proof: makeEmptyProof(),
      }),
    });
    const service = makeService(providers);

    await expect(service.prepare(request({ id: "empty-real-proof" }))).rejects.toMatchObject({ code: "STRK20-018" });
    expect(providers.calls.executeWithProof ?? 0).toBe(0);
  });

  it("does not promote pending or event-less receipts to terminal state", async () => {
    const providers = makeProviders();
    const service = makeService(providers);
    const id = "receipt-pending";
    await service.prepare(request({ id }));
    await service.submit(id);

    providers.setReceiptMode("pending");
    const pending = await service.observeReceipt(id);
    expect(pending.state).toBe("transfer_pending");
    expect(pending.receipt?.executionStatus).toBe("PENDING");
    expect(pending.terminal).toBe(false);

    providers.setReceiptMode("success");
    const complete = await service.observeReceipt(id);
    expect(complete.state).toBe("transfer_confirmed");
    expect(complete.terminal).toBe(true);
  });

  it("does not confirm an event-less successful receipt even when the receipt flag claims pool evidence", async () => {
    const providers = makeProviders();
    providers.action.observeReceipt = async () => ({
      transactionHash: TX,
      executionStatus: "SUCCEEDED",
      finalityStatus: "ACCEPTED_ON_L2",
      blockNumber: 100,
      poolEventFound: true,
      attributedDepositor: null,
      senderIgnored: null,
      events: [],
      rawExecutionStatus: "SUCCEEDED",
    });
    const service = makeService(providers);
    const id = "receipt-eventless-success";
    await service.prepare(request({ id }));
    await service.submit(id);

    const observed = await service.observeReceipt(id);
    expect(observed.state).toBe("transfer_pending");
    expect(observed.receipt?.poolEventFound).toBe(false);
    expect(observed.terminal).toBe(false);
  });

  it("does not allow prepare to reopen an action after a submission attempt", async () => {
    let submissions = 0;
    const providers = makeProviders({
      executeWithProof: async () => {
        submissions += 1;
        throw new Error("provider_timeout_after_submit");
      },
    });
    const service = makeService(providers);
    const id = "submission-attempt-fence";
    await service.prepare(request({ id }));

    await expect(service.submit(id)).rejects.toThrow();
    await expect(service.prepare(id)).rejects.toMatchObject({ code: "STRK20-012" });
    expect(submissions).toBe(1);
  });

  it("makes a reverted receipt terminally rejected and never retries submission", async () => {
    const providers = makeProviders();
    const service = makeService(providers);
    const id = "receipt-reverted";
    await service.prepare(request({ id }));
    await service.submit(id);
    providers.setReceiptMode("reverted");

    const rejected = await service.observeReceipt(id);
    expect(rejected.state).toBe("rejected");
    expect(rejected.terminal).toBe(true);
    const submitCalls = providers.calls.executeWithProof;
    await expect(service.submit(id)).rejects.toMatchObject({ code: "STRK20-012" });
    expect(providers.calls.executeWithProof).toBe(submitCalls);
  });

  it("refuses viewing-key-shaped application input before any provider call", () => {
    const providers = makeProviders();
    const service = makeService(providers);
    const bad = {
      ...request({ id: "viewing-key-input" }),
      viewingKey: "deliberately-forbidden-test-material",
    } as unknown as PrivacyActionRequest;

    expect(() => service.create(bad)).toThrow(Strk20Error);
    expect(() => service.create(bad)).toThrow(/viewing_key_forbidden/);
    expect(providers.calls.supportedWalletApi ?? 0).toBe(0);
  });
});
