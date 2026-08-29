import { describe, it, expect, vi } from "vitest";
import { M5VesuRunner, M5_BLOCKED_BY_ENVIRONMENT_EVIDENCE, M5_ERROR_CODE, buildHelperCalldata, buildActions } from "../runner";
import { MAX_U128, STRK_SEPOLIA, VTOKEN_STRK_SEPOLIA, HELPER_ADDRESS_SEPOLIA, PRIVACY_POOL_SEPOLIA } from "../constants";
import type { M5Provider } from "../ports";
import { WalletV6M5Adapter, type WalletAccountV6Like } from "../wallet-adapter";

// X2 doubles — never fabricate hash, never use mock proof as evidence

function makeMockProvider(overrides: Partial<M5Provider> = {}): M5Provider {
  const base: M5Provider = {
    supportedWalletApi: async () => ["0.10.3"],
    supportedSpecs: async () => [],
    requestChainId: async () => "SN_SEPOLIA",
    isRegistered: async () => true,
    getFeeAmount: async () => ({ fee: 4n, blockNumber: 100 }),
    strk20PrepareInvoke: async (actions: unknown, simulate: unknown) => {
      // Simulate returns empty proof, non-simulate would return real (but mock has no prover)
      if (simulate) {
        return {
          call: { contract_address: "0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91", entry_point: "invoke", calldata: [] },
          proof: { data: "", output: [], proof_facts: [] },
        };
      }
      // Real prepare should not be called on mock without prover — simulate blocked path
      return {
        call: { contract_address: "0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91", entry_point: "invoke", calldata: [] },
        proof: { data: "0xMOCK_SHOULD_NEVER_BE_EVIDENCE", output: ["0x1"], proof_facts: ["0x1"] },
      };
    },
    strk20InvokeTransaction: async () => {
      // Mock cannot generate real proof — we mark as mock and runner should return BLOCKED
      throw new Error("MOCK_NO_PROVER: wallet cannot generate SNIP-36 proof in test double");
    },
    getReceipt: async () => null,
    getAddress: async () => "0x047c0f8b01b9c7c75c669dc549bc305a0f2d796808117339a1c87730162b131c",
    _isMock: true,
    ...overrides,
  } as unknown as M5Provider;
  // Merge overrides after to allow custom strk20Invoke etc to override throw
  return Object.assign(base, overrides, { _isMock: (overrides as { _isMock?: boolean })._isMock ?? true });
}

function makeSuccessProvider(overrides: Partial<M5Provider> = {}): M5Provider {
  return makeMockProvider({
    _isMock: false,
    strk20InvokeTransaction: async () => ({ transaction_hash: "0x05abc123abc123abc123abc123abc123abc123abc123abc123abc123abc123ab" }),
    getReceipt: async () => ({
      executionStatus: "SUCCEEDED",
      finalityStatus: "ACCEPTED_ON_L2",
      blockNumber: 13945591,
      events: [
        { address: "0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91", keys: ["0x01"], data: [] },
        { address: VTOKEN_STRK_SEPOLIA, keys: ["0x02"], data: ["0x01"] },
      ],
    }),
    callBalance: async (token: string) => 0n,
    ...overrides,
  } as unknown as Partial<M5Provider>);
}

describe("M5VesuRunner — X2 provider-injected", () => {
  it("capability: wallet not capable → M5-001", async () => {
    const runner = new M5VesuRunner({ inAmount: 1_000_000_000_000_000_000n });
    const provider = makeMockProvider({
      supportedWalletApi: async () => ["0.9.0"],
      supportedSpecs: async () => ["0.9.0"],
      _isMock: false,
    });
    await expect(runner.run(provider)).rejects.toThrow(M5_ERROR_CODE.CAPABILITY_UNKNOWN);
  });

  it("fee/registration: not registered → M5-003 distinct from screening", async () => {
    const runner = new M5VesuRunner({ inAmount: 1_000_000_000_000_000_000n });
    const provider = makeMockProvider({
      isRegistered: async () => false,
      _isMock: false,
    });
    await expect(runner.run(provider)).rejects.toThrow(M5_ERROR_CODE.NOT_REGISTERED);
  });

  it("simulate: NOT_REGISTERED on prepare → M5_NOT_REGISTERED", async () => {
    const runner = new M5VesuRunner({ inAmount: 1_000_000_000_000_000_000n });
    const provider = makeMockProvider({
      strk20PrepareInvoke: async () => {
        throw new Error("NOT_REGISTERED: user not registered");
      },
      _isMock: false,
    } as unknown as Partial<M5Provider>);
    await expect(runner.run(provider)).rejects.toThrow(M5_ERROR_CODE.NOT_REGISTERED);
  });

  it("screening rejected → M5-004 distinct from unavailable", async () => {
    const runner = new M5VesuRunner({ inAmount: 1_000_000_000_000_000_000n });
    const provider = makeMockProvider({
      strk20PrepareInvoke: async () => {
        throw new Error("screening rejected");
      },
      _isMock: false,
    } as unknown as Partial<M5Provider>);
    await expect(runner.run(provider)).rejects.toThrow(M5_ERROR_CODE.SCREENING_REJECTED);
  });

  it("screening unavailable → M5-005", async () => {
    const runner = new M5VesuRunner({ inAmount: 1_000_000_000_000_000_000n });
    const provider = makeMockProvider({
      strk20PrepareInvoke: async () => {
        throw new Error("screening unavailable");
      },
      _isMock: false,
    } as unknown as Partial<M5Provider>);
    await expect(runner.run(provider)).rejects.toThrow(M5_ERROR_CODE.SCREENING_UNAVAILABLE);
  });

  it("simulation proof must remain empty and non-submittable", async () => {
    let submissions = 0;
    const runner = new M5VesuRunner({ inAmount: 1_000_000_000_000_000_000n });
    const provider = makeMockProvider({
      _isMock: false,
      strk20PrepareInvoke: async () => ({
        call: { contract_address: PRIVACY_POOL_SEPOLIA, entry_point: "invoke", calldata: [] },
        proof: { data: "0xnot-simulation", output: ["0x1"], proof_facts: ["0x2"] },
      }),
      strk20InvokeTransaction: async () => {
        submissions += 1;
        return { transaction_hash: "0x05abc123abc123abc123abc123abc123abc123abc123abc123abc123abc123ab" };
      },
    } as unknown as Partial<M5Provider>);

    await expect(runner.run(provider)).rejects.toThrow(M5_ERROR_CODE.SIMULATION_PROOF_INVALID);
    expect(submissions).toBe(0);
  });

  it("malformed simulation responses fail closed before submission", async () => {
    const runner = new M5VesuRunner({ inAmount: 1_000_000_000_000_000_000n });
    const provider = makeMockProvider({
      _isMock: false,
      strk20PrepareInvoke: async () => null as never,
    } as unknown as Partial<M5Provider>);

    await expect(runner.run(provider)).rejects.toThrow(M5_ERROR_CODE.SIMULATION_PROOF_INVALID);
  });

  it("network guard rejects lookalike chain identifiers", async () => {
    const runner = new M5VesuRunner({ inAmount: 1_000_000_000_000_000_000n });
    const provider = makeMockProvider({
      requestChainId: async () => "NOT_SEPOLIA",
      _isMock: false,
    });

    await expect(runner.run(provider)).rejects.toThrow(M5_ERROR_CODE.NETWORK_MISMATCH);
  });

  it("malformed capability responses block without invoking the wallet", async () => {
    const runner = new M5VesuRunner({ inAmount: 1_000_000_000_000_000_000n });
    const provider = makeMockProvider({
      supportedWalletApi: async () => undefined as never,
      _isMock: false,
    });

    const result = await runner.run(provider);
    expect((result as { verdict: string }).verdict).toBe(M5_BLOCKED_BY_ENVIRONMENT_EVIDENCE);
    expect((result as { reason: string }).reason).toBe("CAPABILITY_UNAVAILABLE");
  });

  it("helper calldata exactness: preserves [STRK, VTOKEN, u128, placeholder]", () => {
    const amount = 1_000_000_000_000_000_000n;
    const cd = buildHelperCalldata(amount);
    expect(cd[0].toLowerCase()).toBe(STRK_SEPOLIA.toLowerCase());
    expect(cd[1].toLowerCase()).toBe(VTOKEN_STRK_SEPOLIA.toLowerCase());
    expect(cd[2]).toBe(`0x${amount.toString(16)}`);
    expect(cd[3]).toBe("${openNoteIds[0]}");
  });

  it("u128 boundary: overflow → M5-017", () => {
    expect(() => buildHelperCalldata(MAX_U128 + 1n)).toThrow(M5_ERROR_CODE.AMOUNT_OVERFLOW);
    expect(() => buildHelperCalldata(0n)).toThrow(M5_ERROR_CODE.INVALID_AMOUNT);
    expect(() => buildHelperCalldata(-1n)).toThrow(M5_ERROR_CODE.INVALID_AMOUNT);
  });

  it("pool/token/vToken configuration rejects malformed and out-of-range addresses", () => {
    expect(() => buildHelperCalldata(1n, { strk: "not-an-address", vToken: VTOKEN_STRK_SEPOLIA })).toThrow(M5_ERROR_CODE.CONFIG_INVALID);
    expect(() => new M5VesuRunner({ inAmount: 1n, privacyPool: "0x0" })).toThrow(M5_ERROR_CODE.CONFIG_INVALID);
    // Starknet contract addresses are field elements below 2^251, not any
    // syntactically valid 64-hex value.
    expect(() => new M5VesuRunner({ inAmount: 1n, privacyPool: `0x${"f".repeat(64)}` })).toThrow(M5_ERROR_CODE.CONFIG_INVALID);
  });

  it("exact actions reject a malformed wallet recipient before provider submission", () => {
    expect(() => buildActions(1n, "0x0", {
      inAmount: 1n,
      helperAddress: HELPER_ADDRESS_SEPOLIA,
      strkToken: STRK_SEPOLIA,
      vToken: VTOKEN_STRK_SEPOLIA,
    } as never)).toThrow(M5_ERROR_CODE.CONFIG_INVALID);
  });

  it("u256/u128: note denomination is vToken shares", async () => {
    const amount = 1_000_000_000_000_000_000n;
    const actions = buildActions(amount, "0x01", { inAmount: amount, helperAddress: HELPER_ADDRESS_SEPOLIA, strkToken: STRK_SEPOLIA, vToken: VTOKEN_STRK_SEPOLIA } as never);
    const invoke = actions[1] as { calldata: string[] };
    expect(invoke.calldata[1].toLowerCase()).toBe(VTOKEN_STRK_SEPOLIA.toLowerCase());
  });

  it("maturity: <10 blocks not allowed for spend (domain state machine)", async () => {
    // This is tested via strk20-state transition; runner itself notes maturing
    const mod = (await import("../../domain/strk20-state")) as unknown as {
      createFlow: (i: { id: string; now: number }) => { id: string; state: string; version: number; confirmedBlock: number | null; maturityTargetBlock: number | null };
      transition: (f: unknown, i: unknown) => { flow: { id: string; state: string; version: number; confirmedBlock: number | null; maturityTargetBlock: number | null } };
    };
    let f: ReturnType<typeof mod.createFlow> = mod.createFlow({ id: "m5-mat", now: 1000 });
    f = mod.transition(f, { to: "registration_required", now: 1001 }).flow;
    f = mod.transition(f, { to: "approval_pending", now: 1002 }).flow;
    f = mod.transition(f, { to: "shielding", now: 1003, shieldTxHash: "0x0000000000000000000000000000000000000000000000000000000000000001" }).flow as unknown as typeof f;
    f = mod.transition(f, {
      to: "confirmed",
      now: 1004,
      confirmedBlock: 100,
      shieldTxHash: "0x0000000000000000000000000000000000000000000000000000000000000001",
      receipt: {
        transactionHash: "0x0000000000000000000000000000000000000000000000000000000000000001",
        executionStatus: "SUCCEEDED",
        finalityStatus: "ACCEPTED_ON_L2",
        blockNumber: 100,
        poolEventFound: true,
      },
    }).flow as unknown as typeof f;
    f = mod.transition(f, { to: "maturing", now: 1005 }).flow as unknown as typeof f;
    expect(() => mod.transition(f, { to: "privately_available", now: 1006, currentBlock: 105, balanceConsent: "granted" })).toThrow(/maturity_pending/);
  });

  it("zero output: helper would revert → pool rollback", async () => {
    const runner = new M5VesuRunner({ inAmount: 1n }); // 1 wei likely 0 shares
    const provider = makeMockProvider({
      _isMock: false,
      strk20PrepareInvoke: async () => ({ call: { contract_address: "0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91", entry_point: "invoke", calldata: [] }, proof: { data: "", output: [], proof_facts: [] } }),
      strk20InvokeTransaction: async () => ({ transaction_hash: "0x05abc123abc123abc123abc123abc123abc123abc123abc123abc123abc123ab" }),
      getReceipt: async () => ({
        executionStatus: "REVERTED",
        blockNumber: 100,
        events: [],
      }),
    } as unknown as Partial<M5Provider>);
    await expect(runner.run(provider)).rejects.toThrow(M5_ERROR_CODE.POOL_ROLLBACK);
  });

  it("helper revert: REVERTED receipt → POOL_ROLLBACK (atomic)", async () => {
    const runner = new M5VesuRunner({ inAmount: 1_000_000_000_000_000_000n });
    const provider = makeMockProvider({
      _isMock: false,
      strk20PrepareInvoke: async () => ({ call: { contract_address: "0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91", entry_point: "invoke", calldata: [] }, proof: { data: "", output: [], proof_facts: [] } }),
      strk20InvokeTransaction: async () => ({ transaction_hash: "0x05abc123abc123abc123abc123abc123abc123abc123abc123abc123abc123ab" }),
      getReceipt: async () => ({ executionStatus: "REVERTED", blockNumber: 100, events: [] }),
    } as unknown as Partial<M5Provider>);
    await expect(runner.run(provider)).rejects.toThrow();
  });

  it("unknown receipt: null after timeout → M5-011", async () => {
    const runner = new M5VesuRunner({ inAmount: 1_000_000_000_000_000_000n, receiptTimeoutMs: 50, receiptIntervalMs: 10 });
    const provider = makeMockProvider({
      _isMock: false,
      strk20PrepareInvoke: async () => ({ call: { contract_address: "0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91", entry_point: "invoke", calldata: [] }, proof: { data: "", output: [], proof_facts: [] } }),
      strk20InvokeTransaction: async () => ({ transaction_hash: "0x05abc123abc123abc123abc123abc123abc123abc123abc123abc123abc123ab" }),
      getReceipt: async () => null,
    } as unknown as Partial<M5Provider>);
    await expect(runner.run(provider)).rejects.toThrow(M5_ERROR_CODE.UNKNOWN_RECEIPT);
  });

  it("does not rebroadcast when a timed-out operation is recovered on the same runner", async () => {
    let submissions = 0;
    let receiptMode: "missing" | "success" = "missing";
    const txHash = "0x05abc123abc123abc123abc123abc123abc123abc123abc123abc123abc123ab";
    const runner = new M5VesuRunner({ inAmount: 1_000_000_000_000_000_000n, receiptTimeoutMs: 20, receiptIntervalMs: 1 });
    const provider = makeSuccessProvider({
      strk20InvokeTransaction: async () => {
        submissions += 1;
        return { transaction_hash: txHash };
      },
      getReceipt: async () => receiptMode === "missing"
        ? null
        : {
            transactionHash: txHash,
            executionStatus: "SUCCEEDED",
            finalityStatus: "ACCEPTED_ON_L2",
            blockNumber: 13945591,
            events: [{ address: PRIVACY_POOL_SEPOLIA, keys: ["0x1"], data: [] }],
          },
    } as unknown as Partial<M5Provider>);

    await expect(runner.run(provider)).rejects.toThrow(M5_ERROR_CODE.UNKNOWN_RECEIPT);
    receiptMode = "success";
    const recovered = await runner.run(provider);

    expect((recovered as { verdict: string }).verdict).toBe("M5_E2E_RUNNER_READY_X2");
    expect(submissions).toBe(1);
  });

  it("receipt polling recovers from RECEIVED before a terminal receipt", async () => {
    let reads = 0;
    const runner = new M5VesuRunner({ inAmount: 1_000_000_000_000_000_000n });
    const terminal = makeSuccessProvider();
    const provider = makeSuccessProvider({
      getReceipt: async () => {
        reads += 1;
        if (reads === 1) {
          return { executionStatus: "RECEIVED", blockNumber: null, events: [] };
        }
        return terminal.getReceipt("0x05abc123abc123abc123abc123abc123abc123abc123abc123abc123abc123ab");
      },
    } as unknown as Partial<M5Provider>);

    const result = await runner.run(provider);
    expect((result as { verdict: string }).verdict).toBe("M5_E2E_RUNNER_READY_X2");
    expect(reads).toBe(2);
  });

  it("successful status without accepted finality or block cannot become completion", async () => {
    const runner = new M5VesuRunner({ inAmount: 1_000_000_000_000_000_000n });
    const provider = makeSuccessProvider({
      getReceipt: async () => ({
        executionStatus: "SUCCEEDED",
        blockNumber: null,
        events: [{ address: PRIVACY_POOL_SEPOLIA, keys: ["0x1"], data: [] }],
      }),
    } as unknown as Partial<M5Provider>);
    await expect(runner.run(provider)).rejects.toThrow(M5_ERROR_CODE.UNKNOWN_RECEIPT);
  });

  it("does not promote maturity observed against a different confirmation block", async () => {
    const runner = new M5VesuRunner({ inAmount: 1_000_000_000_000_000_000n });
    const provider = makeSuccessProvider({
      observeMaturity: async () => ({
        confirmedBlock: 13945590,
        maturityTargetBlock: 13945600,
        currentBlock: 13945600,
        balanceConsent: "granted" as const,
      }),
    } as unknown as Partial<M5Provider>);

    const result = await runner.run(provider);
    expect((result as { verdict: string }).verdict).toBe("M5_E2E_RUNNER_READY_X2");
    expect((result as { predicates: { maturityObserved: boolean } }).predicates.maturityObserved).toBe(false);
    expect((result as { predicates: { maturityState: string } }).predicates.maturityState).toBe("maturing");
  });

  it("does not promote conservation when the explicit note/share amount is zero", async () => {
    const amount = 1_000_000_000_000_000_000n;
    const txHash = "0x05abc123abc123abc123abc123abc123abc123abc123abc123abc123abc123ab" as `0x${string}`;
    const runner = new M5VesuRunner({
      inAmount: amount,
      primarySourceId: "rpc-one",
      independentSourceId: "rpc-two",
      independentRpc: {
        sourceId: "rpc-two",
        getTransactionReceipt: async () => ({
          transactionHash: txHash,
          executionStatus: "SUCCEEDED",
          finalityStatus: "ACCEPTED_ON_L2",
          blockNumber: 13945591,
          events: [{ address: PRIVACY_POOL_SEPOLIA, keys: ["0x1"] }],
        }),
        getBalance: async () => 0n,
        getTransaction: async () => ({ calldata: ["0x1", HELPER_ADDRESS_SEPOLIA] }),
      },
      validator: { validate: async () => ({ ok: true, pool: true, mine: true }) },
    });
    const provider = makeSuccessProvider({
      strk20InvokeTransaction: async () => ({ transaction_hash: txHash }),
      callBalance: async () => 0n,
      observeVesuDeposit: async () => ({
        contractAddress: VTOKEN_STRK_SEPOLIA,
        receiver: HELPER_ADDRESS_SEPOLIA,
        assets: amount,
      }),
      observeOpenNote: async () => ({ noteId: "note-1", token: VTOKEN_STRK_SEPOLIA, amount: 1n }),
      observeMaturity: async () => ({
        confirmedBlock: 13945591,
        maturityTargetBlock: 13945601,
        currentBlock: 13945601,
        balanceConsent: "granted" as const,
      }),
      observeConservation: async () => ({
        inputDelivered: amount,
        vTokenShares: 0n,
        noteAmount: 0n,
        helperStrkBalance: 0n,
        helperVTokenBalance: 0n,
      }),
    } as unknown as Partial<M5Provider>);

    const result = await runner.run(provider);
    expect((result as { verdict: string }).verdict).toBe("M5_E2E_RUNNER_READY_X2");
    expect((result as { predicates: { conservationOk: boolean } }).predicates.conservationOk).toBe(false);
  });

  it("independent receipt block divergence fails closed", async () => {
    const runner = new M5VesuRunner({
      inAmount: 1_000_000_000_000_000_000n,
      independentRpc: {
        sourceId: "rpc-two",
        getTransactionReceipt: async () => ({
          executionStatus: "SUCCEEDED",
          finalityStatus: "ACCEPTED_ON_L2",
          blockNumber: 13945590,
          events: [{ address: PRIVACY_POOL_SEPOLIA, keys: ["0x1"] }],
        }),
        getBalance: async () => 0n,
      },
      primarySourceId: "rpc-one",
    });
    await expect(runner.run(makeSuccessProvider())).rejects.toThrow(M5_ERROR_CODE.INDEPENDENT_READ_MISMATCH);
  });

  it("validator mine=false → M5-010", async () => {
    const runner = new M5VesuRunner({
      inAmount: 1_000_000_000_000_000_000n,
      validator: {
        validate: async () => ({ ok: true, pool: true, mine: false, reason: "no prism contract involvement" }),
      },
      independentRpc: null,
    });
    const provider = makeSuccessProvider();
    await expect(runner.run(provider)).rejects.toThrow(M5_ERROR_CODE.VALIDATOR_MINE_FALSE);
  });

  it("validator ok=false or pool=false cannot promote the route", async () => {
    const runner = new M5VesuRunner({
      inAmount: 1_000_000_000_000_000_000n,
      validator: {
        validate: async () => ({ ok: false, pool: true, mine: true, reason: "validator_ok_false" }),
      },
    });
    await expect(runner.run(makeSuccessProvider())).rejects.toThrow(M5_ERROR_CODE.VALIDATOR_MINE_FALSE);
  });

  it("no wallet/prover → M5_BLOCKED_BY_ENVIRONMENT_EVIDENCE, no fabricated hash", async () => {
    const runner = new M5VesuRunner({ inAmount: 1_000_000_000_000_000_000n });
    const result = await runner.run(null as unknown as M5Provider);
    expect(result).toHaveProperty("verdict", M5_BLOCKED_BY_ENVIRONMENT_EVIDENCE);
    expect(result).not.toHaveProperty("txHash");
    // Must not contain a fabricated hash anywhere
    const asStr = JSON.stringify(result);
    expect(asStr).not.toMatch(/0x[0-9a-f]{64}/);
  });

  it("WalletV6 adapter does not fabricate registration or block observations", async () => {
    const wallet: WalletAccountV6Like = {
      address: "0x047c0f8b01b9c7c75c669dc549bc305a0f2d796808117339a1c87730162b131c",
      provider: { getChainId: async () => "SN_SEPOLIA" },
      strk20PrepareInvoke: async () => ({
        call: { contract_address: PRIVACY_POOL_SEPOLIA, entry_point: "invoke", calldata: [] },
        proof: { data: "", output: [], proof_facts: [] },
      }),
      strk20InvokeTransaction: async () => ({ transaction_hash: "0x1" }),
    };
    const adapter = new WalletV6M5Adapter({
      wallet,
      capabilityProvider: {
        supportedWalletApi: async () => ["0.10.3"],
        supportedSpecs: async () => [],
        requestChainId: async () => "SN_SEPOLIA",
      },
      walletFeatures: {},
      feeReader: { getFeeAmount: async () => ({ fee: 1n, blockNumber: 1 }) },
    });

    expect(await adapter.isRegistered()).toBeNull();
    expect((adapter as unknown as { getBlockNumber?: unknown }).getBlockNumber).toBeUndefined();
  });

  it("WalletV6 adapter preserves first-party finality and raw transaction calldata facts", async () => {
    const tx = "0x05abc123abc123abc123abc123abc123abc123abc123abc123abc123abc123ab" as `0x${string}`;
    const wallet: WalletAccountV6Like = {
      address: "0x047c0f8b01b9c7c75c669dc549bc305a0f2d796808117339a1c87730162b131c",
      provider: {
        getChainId: async () => "SN_SEPOLIA",
        getTransactionReceipt: async () => ({
          transaction_hash: tx,
          execution_status: "SUCCEEDED",
          finality_status: "ACCEPTED_ON_L2",
          block_number: 123,
          sender_address: "0x123",
          events: [{ from_address: PRIVACY_POOL_SEPOLIA, keys: ["0x1"], data: ["0x2"] }],
        }),
        getTransaction: async () => ({ calldata: ["0x1", HELPER_ADDRESS_SEPOLIA] }),
      },
      strk20PrepareInvoke: async () => ({
        call: { contract_address: PRIVACY_POOL_SEPOLIA, entry_point: "invoke", calldata: [] },
        proof: { data: "", output: [], proof_facts: [] },
      }),
      strk20InvokeTransaction: async () => ({ transaction_hash: tx }),
    };
    const adapter = new WalletV6M5Adapter({
      wallet,
      capabilityProvider: {
        supportedWalletApi: async () => ["0.10.3"],
        supportedSpecs: async () => [],
        requestChainId: async () => "SN_SEPOLIA",
      },
      walletFeatures: {},
      feeReader: { getFeeAmount: async () => ({ fee: 1n, blockNumber: 1 }) },
    });
    const receipt = await adapter.getReceipt(tx);
    expect(receipt?.finalityStatus).toBe("ACCEPTED_ON_L2");
    expect(receipt?.events[0]?.data).toEqual(["0x2"]);
    expect(await adapter.getTransaction(tx)).toEqual({ calldata: ["0x1", HELPER_ADDRESS_SEPOLIA] });
  });

  it("mock provider with no real prover → BLOCKED, not fake success", async () => {
    const runner = new M5VesuRunner({ inAmount: 1_000_000_000_000_000_000n });
    const mock = makeMockProvider(); // _isMock true, strk20Invoke throws MOCK_NO_PROVER
    const result = await runner.run(mock);
    // Simulate passes, but invoke fails with mock → BLOCKED
    expect((result as { verdict: string }).verdict).toBe(M5_BLOCKED_BY_ENVIRONMENT_EVIDENCE);
  });

  it("X2 success without independent read → M5_E2E_RUNNER_READY_X2", async () => {
    const runner = new M5VesuRunner({ inAmount: 1_000_000_000_000_000_000n });
    const provider = makeSuccessProvider();
    const result = await runner.run(provider);
    expect((result as { verdict: string }).verdict).toBe("M5_E2E_RUNNER_READY_X2");
    const ok = result as { verdict: string; predicates: { calldataExact: boolean; noteDenominationShares: boolean } };
    expect(ok.predicates.calldataExact).toBe(true);
    expect(ok.predicates.noteDenominationShares).toBe(true);
  });

  it("receipt events alone cannot promote helper calldata, Vesu deposit, note readback, or maturity", async () => {
    const runner = new M5VesuRunner({
      inAmount: 1_000_000_000_000_000_000n,
      independentRpc: {
        getTransactionReceipt: async () => ({
          executionStatus: "SUCCEEDED",
          blockNumber: 13945591,
          events: [
            { address: "0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91", keys: ["0x01"] },
            { address: VTOKEN_STRK_SEPOLIA, keys: ["0x02"] },
          ],
        }),
        getBalance: async () => 0n,
      },
      validator: {
        validate: async () => ({ ok: true, pool: true, mine: true }),
      },
    });
    const provider = makeSuccessProvider();
    const result = await runner.run(provider);
    expect((result as { verdict: string }).verdict).toBe("M5_E2E_RUNNER_READY_X2");
    const predicates = (result as unknown as { predicates: Record<string, boolean | null> }).predicates;
    expect(predicates.helperCalldataInReceipt).toBe(false);
    expect(predicates.vesuDepositObserved).toBe(false);
    expect(predicates.noteReadbackObserved).toBe(false);
    expect(predicates.maturityObserved).toBe(false);
    expect(predicates.conservationOk).toBe(false);
  });

  it("viewing key guard: provider with viewingKey → forbidden", async () => {
    const runner = new M5VesuRunner({ inAmount: 1_000_000_000_000_000_000n });
    const badProvider = makeMockProvider({
      _isMock: false,
      supportedWalletApi: async () => ["0.10.3"],
    } as unknown as Partial<M5Provider>);
    (badProvider as unknown as Record<string, unknown>).viewingKey = "0xsecret";
    await expect(runner.run(badProvider)).rejects.toThrow(M5_ERROR_CODE.VIEWING_KEY_FORBIDDEN);
  });

  it("conservation: stranded balance → M5-020", async () => {
    const runner = new M5VesuRunner({
      inAmount: 1_000_000_000_000_000_000n,
      independentRpc: {
        getTransactionReceipt: async () => ({
          executionStatus: "SUCCEEDED",
          blockNumber: 13945591,
          events: [
            { address: "0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91", keys: ["0x01"] },
            { address: VTOKEN_STRK_SEPOLIA, keys: ["0x02"] },
          ],
        }),
        getBalance: async (token: string) => (token.toLowerCase() === STRK_SEPOLIA.toLowerCase() ? 0n : 999n),
      },
    });
    const provider = makeSuccessProvider();
    await expect(runner.run(provider)).rejects.toThrow(M5_ERROR_CODE.STRANDED_BALANCE);
  });
});
