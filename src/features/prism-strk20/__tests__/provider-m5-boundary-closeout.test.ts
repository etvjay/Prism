import { describe, expect, it, vi } from "vitest";
import { InjectedWalletStrk20Adapter, type InjectedWalletProvider } from "../adapters/injected-wallet";
import { WalletStrk20ActionAdapter } from "../adapters/wallet-strk20-action-adapter";
import { M5VesuRunner } from "../m5/runner";
import { M5_ERROR_CODE } from "../m5/errors";
import { PRIVACY_POOL_SEPOLIA, STRK_SEPOLIA, VTOKEN_STRK_SEPOLIA, HELPER_ADDRESS_SEPOLIA } from "../m5/constants";
import { createM5Operation, markM5Submitted, recoverM5Operation, type M5ReceiptObservation } from "../m5/operation";
import { assertValidExecutionEndpoint } from "../../prism-identity/domain/binding-disclosure";
import { PrivacyActionService } from "../application/privacy-action-service";
import type { Strk20WalletPort } from "../domain/ports";
import { normalizeShadowAccountObservation } from "../domain/shadow-account";
import { validateM5Conservation, validateM5OpenNoteObservation } from "../m5/validation";
import { projectPrivacyReceipt } from "../../../application/privacy-receipt-service";
import type { PrivacyActionView } from "../application/privacy-action-service";
import { applyPrivacyObservation, createPrivacyWalletSession } from "../../wallet/session/session-state";
import { createValidatorFromEnv } from "../m5/validator";

vi.mock("node:child_process", () => ({ spawnSync: vi.fn() }));

const TX = "0x05abc123abc123abc123abc123abc123abc123abc123abc123abc123abc123ab" as const;
const ACCOUNT = "0x047c0f8b01b9c7c75c669dc549bc305a0f2d796808117339a1c87730162b131c" as const;
const TOKEN = "0x0000000000000000000000000000000000000000000000000000000000000003" as const;
const RECIPIENT = "0x0000000000000000000000000000000000000000000000000000000000000004" as const;

function injectedProvider(overrides: Partial<InjectedWalletProvider> = {}): InjectedWalletProvider {
  return {
    supportedWalletApi: async () => ["0.10.3"],
    supportedSpecs: async () => [],
    requestChainId: async () => "SN_SEPOLIA",
    isRegistered: async () => true,
    getFeeAmount: async () => ({ fee: 1n, blockNumber: 1 }),
    approve: async () => TX,
    shield: async () => ({
      txHash: TX,
      executionStatus: "SUCCEEDED",
      screening: "approved",
      blockNumber: 1,
      receiptEvents: [],
    }),
    balances: async () => ({ balances: [], consent: "granted" }),
    transfer: async () => ({ txHash: TX, executionStatus: "SUCCEEDED", blockNumber: 1, receiptEvents: [] }),
    getReceipt: async () => null,
    ...overrides,
  };
}

function m5Provider(overrides: Record<string, unknown> = {}) {
  return {
    supportedWalletApi: async () => ["0.10.3"],
    supportedSpecs: async () => [],
    requestChainId: async () => "SN_SEPOLIA",
    isRegistered: async () => true,
    getFeeAmount: async () => ({ fee: 1n, blockNumber: 1 }),
    strk20PrepareInvoke: async (_actions: unknown[], simulate: boolean) => ({
      call: { contract_address: PRIVACY_POOL_SEPOLIA, entry_point: "invoke", calldata: [] },
      proof: simulate ? { data: "", output: [], proof_facts: [] } : { data: "0x1", output: ["0x1"], proof_facts: ["0x1"] },
    }),
    strk20InvokeTransaction: async () => ({ transaction_hash: TX }),
    getReceipt: async () => ({
      transactionHash: TX,
      executionStatus: "SUCCEEDED",
      finalityStatus: "ACCEPTED_ON_L2",
      blockNumber: 10,
      events: [{ address: PRIVACY_POOL_SEPOLIA, keys: ["0x1"], data: [] }],
    }),
    getAddress: async () => ACCOUNT,
    _isMock: false,
    ...overrides,
  };
}

function successReceipt(overrides: Partial<M5ReceiptObservation> = {}): M5ReceiptObservation {
  return {
    transactionHash: TX,
    executionStatus: "SUCCEEDED",
    finalityStatus: "ACCEPTED_ON_L2",
    blockNumber: 10,
    poolEventFound: true,
    events: [{ address: PRIVACY_POOL_SEPOLIA, keys: [], data: [] }],
    ...overrides,
  };
}

describe("STRK20 provider boundary closeout", () => {
  it("maps user rejection from wallet-managed approval to the stable provider-refused error", async () => {
    const adapter = new InjectedWalletStrk20Adapter(injectedProvider({
      approve: async () => {
        throw new Error("User rejected the approval prompt");
      },
    }));

    await expect(adapter.requestApproval({ token: TOKEN, amount: 1n, spender: STRK_SEPOLIA })).rejects.toMatchObject({
      code: "STRK20-020",
    });
  });

  it("maps wallet-managed provider receipt failures without leaking provider detail", async () => {
    const adapter = new InjectedWalletStrk20Adapter(injectedProvider({
      getReceipt: async () => {
        throw new Error("provider timeout with privateKey=must-not-escape");
      },
    }));

    await expect(adapter.observeReceipt(TX)).rejects.toMatchObject({ code: "STRK20-013" });
    await expect(adapter.observeReceipt(TX)).rejects.not.toThrow("privateKey");
  });

  it("keeps provider capability failures generic at the M5 blocker boundary", async () => {
    const provider = m5Provider({
      supportedWalletApi: async () => {
        throw new Error("provider response privateKey=must-not-escape");
      },
    });
    const result = await new M5VesuRunner({ inAmount: 1n }).run(provider as never);

    expect((result as { verdict: string }).verdict).toBe("M5_BLOCKED_BY_ENVIRONMENT_EVIDENCE");
    expect((result as { detail: string }).detail).not.toContain("privateKey");
  });

  it("rejects secret-bearing simulation observations at the M5 provider boundary", async () => {
    const provider = m5Provider({
      strk20PrepareInvoke: async () => ({
        call: { contract_address: PRIVACY_POOL_SEPOLIA, entry_point: "invoke", calldata: [] },
        proof: { data: "", output: [], proof_facts: [] },
        viewingKey: "must-not-cross",
      }),
    });

    await expect(new M5VesuRunner({ inAmount: 1n }).run(provider as never)).rejects.toMatchObject({
      code: M5_ERROR_CODE.VIEWING_KEY_FORBIDDEN,
    });
  });

  it("redacts raw provider proof/calldata detail from M5 errors", async () => {
    const provider = m5Provider({
      strk20PrepareInvoke: async () => {
        throw new Error("provider response calldata=0xdeadbeef proof_facts=private material");
      },
    });

    try {
      await new M5VesuRunner({ inAmount: 1n }).run(provider as never);
      throw new Error("expected helper failure");
    } catch (error) {
      expect((error as Error).message).not.toContain("deadbeef");
      expect((error as Error).message).not.toContain("proof_facts");
    }
  });

  it("redacts wallet-owned note and private-balance detail from M5 errors", async () => {
    const provider = m5Provider({
      strk20PrepareInvoke: async () => {
        throw new Error("wallet private note=redacted private balance=999");
      },
    });

    try {
      await new M5VesuRunner({ inAmount: 1n }).run(provider as never);
      throw new Error("expected helper failure");
    } catch (error) {
      expect((error as Error).message).not.toContain("private note");
      expect((error as Error).message).not.toContain("999");
    }
  });

  it("records optional shadow-account provider observation without making it an action route", async () => {
    const provider = m5Provider({
      observeShadowAccountCapability: async () => ({
        status: "supported",
        source: "provider_observation",
        disposableExecutionAccounts: true,
        supportedProtocols: ["Vesu", "Endur"],
        privacyClaim: "not_claimed",
      }),
    });
    const runner = new M5VesuRunner({ inAmount: 1n });
    const result = await runner.run(provider as never);

    expect((result as { predicates: { shadowAccountObserved: boolean } }).predicates.shadowAccountObserved).toBe(true);
    expect((result as { verdict: string }).verdict).toBe("M5_E2E_RUNNER_READY_X2");
    expect(JSON.stringify(result)).not.toMatch(/unlinkable|untraceable|viewingKey|privateKey/);
  });

  it("normalizes shadow-account research to bounded metadata and discards account material", () => {
    expect(normalizeShadowAccountObservation({
      status: "supported",
      source: "provider_observation",
      disposableExecutionAccounts: true,
      supportedProtocols: ["Vesu", "Vesu", "Endur"],
      privacyClaim: "not_claimed",
      accountAddress: ACCOUNT,
    })).toMatchObject({
      status: "unknown",
      source: "provider_observation",
      privacyClaim: "not_claimed",
    });
    expect(normalizeShadowAccountObservation({
      status: "supported",
      source: "provider_observation",
      disposableExecutionAccounts: true,
      supportedProtocols: ["Vesu", "Vesu", "Endur"],
      privacyClaim: "not_claimed",
    })).toEqual({
      status: "supported",
      source: "provider_observation",
      disposableExecutionAccounts: true,
      supportedProtocols: ["Vesu", "Endur"],
      privacyClaim: "not_claimed",
    });
  });

  it("forwards only the bounded shadow observation through the normal action adapter", async () => {
    const adapter = new WalletStrk20ActionAdapter(m5Provider({
      observeShadowAccountCapability: async () => ({
        status: "supported",
        source: "provider_observation",
        disposableExecutionAccounts: true,
        supportedProtocols: ["Vesu"],
        privacyClaim: "not_claimed",
      }),
    }) as never);
    const capability = await adapter.observeCapability();

    expect(capability.shadowAccount).toEqual({
      status: "supported",
      source: "provider_observation",
      disposableExecutionAccounts: true,
      supportedProtocols: ["Vesu"],
      privacyClaim: "not_claimed",
    });
  });

  it("rejects an attempted shadow-account binding instead of treating the observation as an endpoint", () => {
    expect(() => assertValidExecutionEndpoint({
      id: "shadow-observation",
      chain: "STARKNET",
      chainId: "SN_SEPOLIA",
      kind: "STRK20_SHADOW_ACCOUNT",
    } as never)).toThrow(/unsupported_endpoint_kind/);
  });

  it("does not terminally reject a reverted receipt with no block evidence", () => {
    const submitted = markM5Submitted(createM5Operation("m5-receipt", 1), TX, 2);
    const result = recoverM5Operation(submitted, successReceipt({
      executionStatus: "REVERTED",
      finalityStatus: "UNKNOWN",
      blockNumber: null,
      poolEventFound: false,
      events: [],
    }), { now: 3, timeoutAt: 100 });

    expect(result.operation.state).toBe("submitted");
    expect(result.advanced).toBe(false);
  });

  it("polls past a transient pre-confirmation revert instead of declaring pool rollback", async () => {
    let reads = 0;
    const provider = m5Provider({
      getReceipt: async () => {
        reads += 1;
        if (reads === 1) return { transactionHash: TX, executionStatus: "REVERTED", finalityStatus: "UNKNOWN", blockNumber: null, events: [] };
        return { transactionHash: TX, executionStatus: "SUCCEEDED", finalityStatus: "ACCEPTED_ON_L2", blockNumber: 10, events: [{ address: PRIVACY_POOL_SEPOLIA, keys: ["0x1"], data: [] }] };
      },
    });
    const result = await new M5VesuRunner({ inAmount: 1n, receiptIntervalMs: 0 }).run(provider as never);

    expect(reads).toBe(2);
    expect((result as { verdict: string }).verdict).toBe("M5_E2E_RUNNER_READY_X2");
  });

  it("retries a transient receipt-provider failure before entering unknown timeout", async () => {
    let reads = 0;
    const provider = m5Provider({
      getReceipt: async () => {
        reads += 1;
        if (reads === 1) throw new Error("temporary rpc unavailable");
        return { transactionHash: TX, executionStatus: "SUCCEEDED", finalityStatus: "ACCEPTED_ON_L2", blockNumber: 10, events: [{ address: PRIVACY_POOL_SEPOLIA, keys: ["0x1"], data: [] }] };
      },
    });
    const result = await new M5VesuRunner({ inAmount: 1n, receiptIntervalMs: 0 }).run(provider as never);

    expect(reads).toBe(2);
    expect((result as { verdict: string }).verdict).toBe("M5_E2E_RUNNER_READY_X2");
  });

  it("requires independent transaction and public-balance reads, not only a second receipt", async () => {
    const provider = m5Provider({
      getTransaction: async () => ({ transactionHash: TX, calldata: ["0x1", HELPER_ADDRESS_SEPOLIA] }),
      callBalance: async () => 0n,
    });
    const independentRpc = {
      sourceId: "rpc-two",
      getTransactionReceipt: async () => ({ transactionHash: TX, executionStatus: "SUCCEEDED", finalityStatus: "ACCEPTED_ON_L2", blockNumber: 10, events: [{ address: PRIVACY_POOL_SEPOLIA, keys: ["0x1"], data: [] }] }),
      getBalance: async () => 0n,
    };
    const result = await new M5VesuRunner({ inAmount: 1n, primarySourceId: "rpc-one", independentRpc }).run(provider as never);

    expect((result as { predicates: { independentReadbackOk: boolean } }).predicates.independentReadbackOk).toBe(false);
    expect((result as { verdict: string }).verdict).toBe("M5_E2E_RUNNER_READY_X2");
  });

  it("rejects independent source identities that only differ by whitespace", () => {
    expect(() => new M5VesuRunner({
      inAmount: 1n,
      primarySourceId: "rpc-one",
      independentSourceId: " rpc-one ",
      independentRpc: {
        sourceId: "rpc-two",
        getTransactionReceipt: async () => null,
        getBalance: async () => 0n,
      },
    })).toThrow(M5_ERROR_CODE.CONFIG_INVALID);
  });

  it("fails closed on a malformed upstream validator response", async () => {
    const runner = new M5VesuRunner({
      inAmount: 1n,
      validator: {
        validate: async () => ({ ok: "true", pool: true, mine: true } as never),
      },
    });

    await expect(runner.run(m5Provider() as never)).rejects.toMatchObject({
      code: M5_ERROR_CODE.VALIDATOR_MINE_FALSE,
    });
  });

  it("does not treat non-JSON validator output as an upstream pass", async () => {
    const childProcess = await import("node:child_process");
    vi.mocked(childProcess.spawnSync).mockReturnValue({ status: 0, stdout: "validator said ok", stderr: "" } as never);
    const previousPath = process.env.STRK20_VALIDATOR_PATH;
    const previousUrl = process.env.STRK20_VALIDATOR_URL;
    process.env.STRK20_VALIDATOR_PATH = "/tmp/upstream-validator.mjs";
    delete process.env.STRK20_VALIDATOR_URL;
    try {
      const validator = createValidatorFromEnv();
      const result = await validator!.validate(TX);
      expect(result.ok).toBe(false);
      expect(result.pool).toBe(false);
      expect(result.mine).toBe(false);
    } finally {
      if (previousPath === undefined) delete process.env.STRK20_VALIDATOR_PATH;
      else process.env.STRK20_VALIDATOR_PATH = previousPath;
      if (previousUrl === undefined) delete process.env.STRK20_VALIDATOR_URL;
      else process.env.STRK20_VALIDATOR_URL = previousUrl;
    }
  });

  it("redacts validator stderr before it can cross the M5 boundary", async () => {
    const childProcess = await import("node:child_process");
    vi.mocked(childProcess.spawnSync).mockReturnValue({ status: 1, stdout: "", stderr: "privateKey=must-not-escape" } as never);
    const previousPath = process.env.STRK20_VALIDATOR_PATH;
    const previousUrl = process.env.STRK20_VALIDATOR_URL;
    process.env.STRK20_VALIDATOR_PATH = "/tmp/upstream-validator.mjs";
    delete process.env.STRK20_VALIDATOR_URL;
    try {
      const validator = createValidatorFromEnv();
      const result = await validator!.validate(TX);
      expect(result.reason).not.toContain("privateKey");
    } finally {
      if (previousPath === undefined) delete process.env.STRK20_VALIDATOR_PATH;
      else process.env.STRK20_VALIDATOR_PATH = previousPath;
      if (previousUrl === undefined) delete process.env.STRK20_VALIDATOR_URL;
      else process.env.STRK20_VALIDATOR_URL = previousUrl;
    }
  });

  it("maps explicit Wallet API user rejection separately from wallet unavailability", async () => {
    const provider = m5Provider({
      strk20InvokeTransaction: async () => {
        throw new Error("user rejected transaction");
      },
    });
    await expect(new M5VesuRunner({ inAmount: 1n }).run(provider as never)).rejects.toMatchObject({
      code: M5_ERROR_CODE.USER_REJECTED,
    });
  });

  it("fails before proving when the live M5 fee no longer matches the quote", async () => {
    const runner = new M5VesuRunner({ inAmount: 1n, quotedFee: 2n } as never);

    await expect(runner.run(m5Provider({ getFeeAmount: async () => ({ fee: 3n, blockNumber: 1 }) }) as never)).rejects.toMatchObject({
      code: M5_ERROR_CODE.FEE_CHANGED,
    });
  });

  it("fails closed when the fee provider returns a non-bigint observation", async () => {
    const runner = new M5VesuRunner({ inAmount: 1n });

    await expect(runner.run(m5Provider({ getFeeAmount: async () => ({ fee: 1, blockNumber: 1 }) }) as never)).rejects.toMatchObject({
      code: M5_ERROR_CODE.FEE_UNAVAILABLE,
    });
  });

  it("fails closed when registration readback is neither true, false, nor unknown", async () => {
    const runner = new M5VesuRunner({ inAmount: 1n });

    await expect(runner.run(m5Provider({ isRegistered: async () => "registered" }) as never)).rejects.toMatchObject({
      code: M5_ERROR_CODE.NOT_REGISTERED,
    });
  });
});

describe("M5 privacy boundary lifecycle", () => {
  it("does not let a contradictory capability flag produce a ready privacy session", () => {
    const initial = createPrivacyWalletSession({ now: 1_000, expectedEnvironment: "SN_SEPOLIA", accountAddress: ACCOUNT });
    const session = applyPrivacyObservation(initial, {
      capable: false,
      capabilityStatus: "supported",
      apiVersions: ["0.10.3"],
      specs: [],
      chainId: "SN_SEPOLIA",
      environment: "SN_SEPOLIA",
      mismatch: false,
      expected: "SN_SEPOLIA",
    }, 1_001);

    expect(session.status).toBe("capability-unknown");
    expect(session.capability.status).toBe("unknown");
  });

  it("carries optional shadow readiness in the privacy session without gating ordinary readiness", () => {
    const initial = createPrivacyWalletSession({ now: 1_000, expectedEnvironment: "SN_SEPOLIA", accountAddress: ACCOUNT });
    const session = applyPrivacyObservation(initial, {
      capable: true,
      capabilityStatus: "supported",
      apiVersions: ["0.10.3"],
      specs: [],
      chainId: "SN_SEPOLIA",
      environment: "SN_SEPOLIA",
      mismatch: false,
      expected: "SN_SEPOLIA",
      shadowAccount: {
        status: "supported",
        source: "provider_observation",
        disposableExecutionAccounts: true,
        supportedProtocols: ["Vesu"],
        privacyClaim: "not_claimed",
      },
    }, 1_001);

    expect(session.status).toBe("ready");
    expect(session.capability.shadowAccount?.status).toBe("supported");
  });

  it("does not trust a provider's capable=true flag when declared versions are unsupported", async () => {
    let prepareCalls = 0;
    const actionPort = {
      observeCapability: async () => ({
        capable: true,
        capabilityStatus: "unsupported",
        apiVersions: ["0.9.0"],
        specs: [],
        chainId: "SN_SEPOLIA",
        environment: "SN_SEPOLIA",
        mismatch: false,
        expected: "SN_SEPOLIA",
      }),
      prepare: async () => {
        prepareCalls += 1;
        throw new Error("prepare must not run for an unsupported provider");
      },
    };
    const walletPort = {
      observeCapability: async () => ({ apiVersions: ["0.10.3"], specs: [], chainId: "SN_SEPOLIA" }),
      observeChainId: async () => "SN_SEPOLIA",
      isRegistered: async () => true,
      observeFee: async () => ({ fee: 1n, blockNumber: 1 }),
      requestPrivateBalances: async () => ({ balances: [], consent: "granted" as const }),
      requestApproval: async () => TX,
      requestShield: async () => ({ txHash: TX, executionStatus: "SUCCEEDED" as const, screening: "approved" as const, blockNumber: 1, receiptEvents: [] }),
      requestPrivateTransfer: async () => ({ txHash: TX, executionStatus: "RECEIVED" as const, blockNumber: null, receiptEvents: [] }),
      observeReceipt: async () => null,
    };
    const service = new PrivacyActionService({ actionPort: actionPort as never, walletPort, now: () => 1_000 });

    await expect(service.prepare({
      id: "capability-spoof",
      kind: "private_transfer",
      execution: "prepared_proof",
      actions: [{ type: "transfer", token: TOKEN, amount: "1", recipient: RECIPIENT }],
      requireConsent: false,
    })).rejects.toMatchObject({ code: "STRK20-021" });
    expect(prepareCalls).toBe(0);
  });

  it("fails closed when the action and wallet provider adapters disagree on capability", async () => {
    let prepareCalls = 0;
    const actionPort = {
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
      prepare: async () => {
        prepareCalls += 1;
        return {
          call: { contract_address: PRIVACY_POOL_SEPOLIA, entry_point: "invoke", calldata: ["0x1"] },
          proof: { data: "0x1", output: ["0x1"], proof_facts: ["0x1"] },
        };
      },
    };
    const walletPort = {
      observeCapability: async () => ({ apiVersions: ["0.9.0"], specs: [], chainId: "SN_SEPOLIA" }),
      observeChainId: async () => "SN_SEPOLIA",
      isRegistered: async () => true,
      observeFee: async () => ({ fee: 1n, blockNumber: 1 }),
      requestPrivateBalances: async () => ({ balances: [], consent: "granted" as const }),
      requestApproval: async () => TX,
      requestShield: async () => ({ txHash: TX, executionStatus: "SUCCEEDED" as const, screening: "approved" as const, blockNumber: 1, receiptEvents: [] }),
      requestPrivateTransfer: async () => ({ txHash: TX, executionStatus: "RECEIVED" as const, blockNumber: null, receiptEvents: [] }),
      observeReceipt: async () => null,
    };
    const service = new PrivacyActionService({ actionPort: actionPort as never, walletPort, now: () => 1_000 });

    await expect(service.prepare({
      id: "capability-disagreement",
      kind: "private_transfer",
      execution: "prepared_proof",
      actions: [{ type: "transfer", token: TOKEN, amount: "1", recipient: RECIPIENT }],
      requireConsent: false,
    })).rejects.toMatchObject({ code: "STRK20-021" });
    expect(prepareCalls).toBe(0);
  });

  function applicationReceiptView(overrides: Partial<PrivacyActionView> = {}): PrivacyActionView {
    return {
      id: "app-receipt",
      kind: "application",
      execution: "wallet_action",
      state: "transfer_confirmed",
      phase: "terminal",
      version: 4,
      updatedAt: 1_000,
      capability: null,
      registration: { status: "registered" },
      fee: null,
      consent: { status: "not_requested" },
      proof: { status: "wallet_managed", call: null },
      submissionAttempted: true,
      approvalTransactionHash: null,
      transactionHash: TX,
      receipt: { transactionHash: TX, executionStatus: "SUCCEEDED", finalityStatus: "ACCEPTED_ON_L2", blockNumber: 10, poolEventFound: true },
      terminal: true,
      errorCode: null,
      errorDetail: null,
      ...overrides,
    };
  }

  it("labels public downstream amount/timing for application actions instead of overclaiming protection", () => {
    const receipt = projectPrivacyReceipt(applicationReceiptView());

    expect(receipt.publicProperties).toEqual(expect.arrayContaining(["amount", "timing"]));
    expect(receipt.protectedProperties).not.toContain("amount");
    expect(receipt.protectedProperties).not.toContain("timing");
  });

  it("fails closed when the action receipt hash does not match the submitted hash", () => {
    const receipt = projectPrivacyReceipt(applicationReceiptView({
      receipt: { transactionHash: "0x2", executionStatus: "SUCCEEDED", finalityStatus: "ACCEPTED_ON_L2", blockNumber: 10, poolEventFound: true },
    }));

    expect(receipt.observationStatus).toBe("UNAVAILABLE");
    expect(receipt.transactionHash).toBe(TX);
    expect(receipt.limitations).toContain("receipt_action_mismatch");
  });

  it("does not project a malformed submitted hash into a privacy receipt", () => {
    const receipt = projectPrivacyReceipt(applicationReceiptView({
      transactionHash: "providerResponse privateKey must-not-escape" as unknown as `0x${string}`,
      receipt: null,
    }));

    expect(receipt.observationStatus).toBe("UNAVAILABLE");
    expect(receipt.transactionHash).toBeUndefined();
  });

  it("does not turn missing or invalid open-note facts into a mature note", () => {
    expect(validateM5OpenNoteObservation(null, { token: VTOKEN_STRK_SEPOLIA })).toBe(false);
    expect(validateM5OpenNoteObservation({ noteId: "note-1", token: VTOKEN_STRK_SEPOLIA, amount: 0n }, { token: VTOKEN_STRK_SEPOLIA })).toBe(false);
  });

  it("rejects contradictory conservation facts rather than promoting them", () => {
    expect(() => validateM5Conservation({
      inputDelivered: 2n,
      vTokenShares: 3n,
      noteAmount: 4n,
      helperStrkBalance: 0n,
      helperVTokenBalance: 0n,
    }, { expectedInput: 1n })).toThrow(M5_ERROR_CODE.CONSERVATION_FAILED);
  });

  it("keeps the wallet balance payload internal and exposes only consent in the action view", async () => {
    let walletBalanceCalls = 0;
    const wallet: Strk20WalletPort = {
      observeCapability: async () => ({ apiVersions: ["0.10.3"], specs: [], chainId: "SN_SEPOLIA" }),
      observeChainId: async () => "SN_SEPOLIA",
      isRegistered: async () => true,
      observeFee: async () => ({ fee: 1n, blockNumber: 1 }),
      requestApproval: async () => TX,
      requestShield: async () => ({ txHash: TX, executionStatus: "SUCCEEDED", screening: "approved", blockNumber: 1, receiptEvents: [] }),
      requestPrivateBalances: async () => {
        walletBalanceCalls += 1;
        return { balances: [{ token: TOKEN, amount: 999n }], consent: "granted" };
      },
      requestPrivateTransfer: async () => ({ txHash: TX, executionStatus: "RECEIVED", blockNumber: null, receiptEvents: [] }),
      observeReceipt: async () => null,
    };
    const service = new PrivacyActionService({ walletPort: wallet, now: () => 1_000 });
    const view = await service.prepare({
      id: "wallet-balance-boundary",
      kind: "private_transfer",
      execution: "wallet_managed",
      token: TOKEN,
      amount: 1n,
      recipient: RECIPIENT,
      requireConsent: true,
      consentTokens: [TOKEN],
    });

    expect(walletBalanceCalls).toBe(1);
    expect(view.consent.status).toBe("granted");
    const viewText = JSON.stringify(view, (_key, value) => typeof value === "bigint" ? value.toString() : value);
    expect(viewText).not.toContain("999");
    expect(viewText).not.toContain("balances");
  });
});
