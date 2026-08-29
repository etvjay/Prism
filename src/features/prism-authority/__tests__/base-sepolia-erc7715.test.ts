import { describe, expect, it } from "vitest";
import { decodeFunctionData } from "viem";
import { createSecureSessionGrant, type SecureSessionGrant } from "../domain/sessions";
import {
  BASE_SEPOLIA_CHAIN_ID_HEX,
  BaseSepoliaErc7715Adapter,
  encodeErc7710RedeemDelegations,
  ERC7710_SINGLE_DEFAULT_MODE,
  type BaseSepoliaPermissionModule,
  type Erc7715PermissionResponse,
  type Erc7715PermissionRequest,
  SESSION_ONCHAIN_CONSTRAINTS,
} from "../adapters/base-sepolia-erc7715";
import { BaseSepoliaErc7715Adapter as PublicBaseSepoliaErc7715Adapter } from "../index";

const ACCOUNT = "0x1111111111111111111111111111111111111111" as const;
const SESSION_ACCOUNT = "0x5555555555555555555555555555555555555555" as const;
const TARGET = "0x2222222222222222222222222222222222222222" as const;
const TOKEN = "0x3333333333333333333333333333333333333333" as const;
const MANAGER = "0x6666666666666666666666666666666666666666" as const;
const CONTEXT = "0x1234" as const;
const USER_OP_HASH = `0x${"ab".repeat(32)}` as const;
const ERC7710_ABI = [{
  type: "function",
  name: "redeemDelegations",
  stateMutability: "nonpayable",
  inputs: [
    { name: "_permissionContexts", type: "bytes[]" },
    { name: "_modes", type: "bytes32[]" },
    { name: "_executionCallData", type: "bytes[]" },
  ],
}] as const;

function grant(): SecureSessionGrant {
  return createSecureSessionGrant({
    id: "grant-base-sepolia",
    prismId: "prism:owner",
    endpointId: "base-sepolia-smart-account",
    delegatePublicKey: "delegate-public-key",
    chainId: 84532,
    account: ACCOUNT,
    delegateAccount: SESSION_ACCOUNT,
    replay: { mode: "unique-key", namespace: "prism:owner:base" },
    scope: {
      contracts: [TARGET],
      selectors: ["0xa9059cbb"],
      spendLimits: [{ asset: TOKEN, maxPerCall: 10n, maxTotal: 100n }],
      maxCalls: 20,
    },
    validFrom: 1_700_000_000,
    validUntil: 1_700_003_600,
  });
}

function permissionResponse(): Erc7715PermissionResponse {
  return {
    chainId: BASE_SEPOLIA_CHAIN_ID_HEX,
    from: ACCOUNT,
    to: SESSION_ACCOUNT,
    expiry: 1_700_003_600,
    permission: {
      type: "erc20-token-allowance",
      isAdjustmentAllowed: false,
      data: { tokenAddress: TOKEN, allowanceAmount: 100n },
    },
    rules: [
      { type: "expiry", data: { timestamp: 1_700_003_600 } },
      { type: "target", data: { contracts: [TARGET] } },
      { type: "selector", data: { selectors: ["0xa9059cbb"] } },
    ],
    context: CONTEXT,
    dependencies: [],
    delegationManager: MANAGER,
  };
}

function moduleDouble(): BaseSepoliaPermissionModule {
  return {
    enforcedConstraints: [...SESSION_ONCHAIN_CONSTRAINTS],
    permissionTypes: ["erc20-token-allowance"],
    ruleTypes: ["expiry", "target", "selector"],
    buildPermissionRequests({ grant: input }: { grant: SecureSessionGrant; sessionAccount: string }): readonly Erc7715PermissionRequest[] {
      return [{
        chainId: BASE_SEPOLIA_CHAIN_ID_HEX,
        from: input.account as `0x${string}`,
        to: input.delegateAccount as `0x${string}`,
        expiry: input.validUntil,
        permission: {
          type: "erc20-token-allowance",
          isAdjustmentAllowed: false,
          data: { tokenAddress: TOKEN, allowanceAmount: 100n },
        },
        rules: [
          { type: "expiry", data: { timestamp: input.validUntil } },
          { type: "target", data: { contracts: [...input.scope.contracts] } },
          { type: "selector", data: { selectors: [...input.scope.selectors] } },
        ],
      }];
    },
    validatePermissionResponse({ response }: { response: Erc7715PermissionResponse; grant: SecureSessionGrant }): void {
      expect(response.permission.data).toEqual({ tokenAddress: TOKEN, allowanceAmount: 100n });
    },
    encodeRedeemDelegations: () => ({ to: MANAGER, data: "0xdead" as `0x${string}`, value: 0n }),
  };
}

function redemptionAdapter(): BaseSepoliaErc7715Adapter {
  return new BaseSepoliaErc7715Adapter({
    module: moduleDouble(),
    account: { address: SESSION_ACCOUNT, encodeCalls: async () => "0x1234" },
    bundler: { sendUserOperation: async () => USER_OP_HASH },
  });
}

describe("Base Sepolia ERC-7715/7710 adapter", () => {
  it("rejects a wallet permission response whose type or rule vocabulary is outside the configured module", async () => {
    const adapter = new BaseSepoliaErc7715Adapter({
      wallet: {
        request: async ({ method }) => {
          if (method === "wallet_getSupportedExecutionPermissions") {
            return { "erc20-token-allowance": { chainIds: [BASE_SEPOLIA_CHAIN_ID_HEX], ruleTypes: ["expiry", "target", "selector"] } };
          }
          return [{
            ...permissionResponse(),
            permission: { ...permissionResponse().permission, type: "unconfigured-permission" },
            rules: [...permissionResponse().rules, { type: "unconfigured-rule", data: {} }],
          }];
        },
      },
      module: moduleDouble(),
    });

    const result = await adapter.requestPermission(grant());
    expect(result).toMatchObject({ status: "invalid", reason: "permission_module_rejected_response" });
  });

  it("encodes the ERC-7710 redeemDelegations interface without assuming a manager address", () => {
    const encoded = encodeErc7710RedeemDelegations({
      permissionContexts: [CONTEXT],
      modes: [ERC7710_SINGLE_DEFAULT_MODE],
      executionCallDatas: ["0x1234"],
    });
    const decoded = decodeFunctionData({ abi: ERC7710_ABI, data: encoded });

    expect(decoded.functionName).toBe("redeemDelegations");
    expect(decoded.args).toEqual([[CONTEXT], [ERC7710_SINGLE_DEFAULT_MODE], ["0x1234"]]);
  });

  it("is exported through the provider-neutral Prism authority boundary", () => {
    expect(PublicBaseSepoliaErc7715Adapter).toBe(BaseSepoliaErc7715Adapter);
  });

  it("rejects a redemption for a target outside the grant before account encoding", async () => {
    const result = await redemptionAdapter().redeem({
      grant: { ...grant(), status: "ACTIVE" },
      permission: permissionResponse(),
      execution: {
        target: ACCOUNT,
        value: 0n,
        callData: "0xa9059cbb",
        asset: TOKEN,
        amount: 1n,
        replayKey: "wrong-target",
      },
      now: 1_700_000_001,
    });

    expect(result).toEqual({
      status: "policy_denied",
      code: "BASE_SEPOLIA_POLICY_DENIED",
      operation: "redeem",
      reason: "target_not_allowed",
    });
  });

  it("rejects selector, asset, per-call, aggregate, and call-count violations", async () => {
    const cases = [
      { execution: { target: TARGET, value: 0n, callData: "0x095ea7b3", asset: TOKEN, amount: 1n, replayKey: "wrong-selector" }, reason: "selector_not_allowed" },
      { execution: { target: TARGET, value: 0n, callData: "0xa9059cbb", asset: ACCOUNT, amount: 1n, replayKey: "wrong-asset" }, reason: "asset_not_allowed" },
      { execution: { target: TARGET, value: 0n, callData: "0xa9059cbb", asset: TOKEN, amount: 11n, replayKey: "per-call" }, reason: "per_call_spend_limit_exceeded" },
      { execution: { target: TARGET, value: 1n, callData: "0xa9059cbb", asset: TOKEN, amount: 1n, replayKey: "native-value-with-token" }, reason: "asset_not_allowed" },
    ] as const;
    for (const testCase of cases) {
      const result = await redemptionAdapter().redeem({
        grant: { ...grant(), status: "ACTIVE" },
        permission: permissionResponse(),
        execution: testCase.execution,
        now: 1_700_000_001,
      });
      expect(result).toMatchObject({ status: "policy_denied", reason: testCase.reason });
    }

    const aggregateGrant = { ...grant(), status: "ACTIVE" as const, scope: { ...grant().scope, spendLimits: [{ asset: TOKEN, maxPerCall: 10n, maxTotal: 10n }] } };
    const aggregateResult = await redemptionAdapter().redeem({
      grant: aggregateGrant,
      permission: permissionResponse(),
      execution: { target: TARGET, value: 0n, callData: "0xa9059cbb", asset: TOKEN, amount: 11n, replayKey: "aggregate" },
      now: 1_700_000_001,
    });
    expect(aggregateResult).toMatchObject({ status: "policy_denied", reason: "per_call_spend_limit_exceeded" });

    const callLimitGrant = { ...grant(), status: "ACTIVE" as const, scope: { ...grant().scope, maxCalls: 1 } };
    const first = await redemptionAdapter().redeem({
      grant: callLimitGrant,
      permission: permissionResponse(),
      execution: { target: TARGET, value: 0n, callData: "0xa9059cbb", asset: TOKEN, amount: 1n, replayKey: "call-1" },
      now: 1_700_000_001,
    });
    expect(first.status).toBe("submitted");
    if (first.status !== "submitted") throw new Error("expected first submission");
    const second = await redemptionAdapter().redeem({
      grant: first.grant,
      permission: permissionResponse(),
      execution: { target: TARGET, value: 0n, callData: "0xa9059cbb", asset: TOKEN, amount: 1n, replayKey: "call-2" },
      now: 1_700_000_002,
    });
    expect(second).toMatchObject({ status: "policy_denied", reason: "grant_not_active" });
  });

  it("rejects wrong chain, wrong delegator, expired, revoked, and replayed grants", async () => {
    const wrongChain = await redemptionAdapter().redeem({
      grant: { ...grant(), status: "ACTIVE", chainId: 1 },
      permission: permissionResponse(),
      execution: { target: TARGET, value: 0n, callData: "0xa9059cbb", asset: TOKEN, amount: 1n, replayKey: "wrong-chain" },
      now: 1_700_000_001,
    });
    expect(wrongChain).toMatchObject({ status: "policy_denied", reason: "chain_not_allowed" });

    const wrongAccount = await redemptionAdapter().redeem({
      grant: { ...grant(), status: "ACTIVE", account: ACCOUNT.replace("11", "44") },
      permission: permissionResponse(),
      execution: { target: TARGET, value: 0n, callData: "0xa9059cbb", asset: TOKEN, amount: 1n, replayKey: "wrong-account" },
      now: 1_700_000_001,
    });
    expect(wrongAccount).toMatchObject({ status: "invalid", reason: "permission_response_not_bound" });

    const expired = await redemptionAdapter().redeem({
      grant: { ...grant(), status: "ACTIVE" },
      permission: permissionResponse(),
      execution: { target: TARGET, value: 0n, callData: "0xa9059cbb", asset: TOKEN, amount: 1n, replayKey: "expired" },
      now: 1_700_003_600,
    });
    expect(expired).toMatchObject({ status: "policy_denied", reason: "expired" });

    const revoked = await redemptionAdapter().redeem({
      grant: { ...grant(), status: "REVOKED" },
      permission: permissionResponse(),
      execution: { target: TARGET, value: 0n, callData: "0xa9059cbb", asset: TOKEN, amount: 1n, replayKey: "revoked" },
      now: 1_700_000_001,
    });
    expect(revoked).toMatchObject({ status: "policy_denied", reason: "grant_not_active" });

    const adapter = redemptionAdapter();
    const input = {
      grant: { ...grant(), status: "ACTIVE" as const },
      permission: permissionResponse(),
      execution: { target: TARGET, value: 0n, callData: "0xa9059cbb" as `0x${string}`, asset: TOKEN, amount: 1n, replayKey: "replayed" },
      now: 1_700_000_001,
    };
    const submitted = await adapter.redeem(input);
    expect(submitted.status).toBe("submitted");
    const replayed = await adapter.redeem(input);
    expect(replayed).toMatchObject({ status: "policy_denied", reason: "replay_detected" });
  });

  it("rejects a wallet response that widens or adjusts the requested authority", async () => {
    const adapter = new BaseSepoliaErc7715Adapter({
      wallet: {
        request: async ({ method }) => {
          if (method === "wallet_getSupportedExecutionPermissions") {
            return { "erc20-token-allowance": { chainIds: [BASE_SEPOLIA_CHAIN_ID_HEX], ruleTypes: ["expiry", "target", "selector"] } };
          }
          return [{ ...permissionResponse(), permission: { ...permissionResponse().permission, isAdjustmentAllowed: true } }];
        },
      },
      module: moduleDouble(),
    });

    const result = await adapter.requestPermission(grant());

    expect(result).toMatchObject({ status: "invalid", reason: "permission_response_not_bound" });
  });

  it("fails closed for malformed capability data and a capability restricted to another chain", async () => {
    const malformed = new BaseSepoliaErc7715Adapter({
      wallet: { request: async () => ({ "erc20-token-allowance": { chainIds: "0x14a34", ruleTypes: [] } }) },
      module: moduleDouble(),
    });
    await expect(malformed.detectSupport()).resolves.toEqual({
      status: "provider_unavailable",
      code: "BASE_SEPOLIA_PROVIDER_UNAVAILABLE",
      operation: "detect",
      reason: "malformed_capability_response",
    });

    const wrongChain = new BaseSepoliaErc7715Adapter({
      wallet: { request: async () => ({ "erc20-token-allowance": { chainIds: ["0x1"], ruleTypes: ["expiry", "target", "selector"] } }) },
      module: moduleDouble(),
    });
    await expect(wrongChain.detectSupport()).resolves.toEqual({
      status: "unsupported",
      code: "BASE_SEPOLIA_UNSUPPORTED_WALLET",
      operation: "detect",
      reason: "wrong_chain_not_supported",
    });
  });

  it("feature-detects supported permissions and requests a bounded permission", async () => {
    const calls: Array<{ method: string; params?: readonly unknown[] }> = [];
    const provider = {
      request: async ({ method, params }: { method: string; params?: readonly unknown[] }) => {
        calls.push({ method, params });
        if (method === "wallet_getSupportedExecutionPermissions") {
          return { "erc20-token-allowance": { chainIds: [BASE_SEPOLIA_CHAIN_ID_HEX], ruleTypes: ["expiry", "target", "selector"] } };
        }
        if (method === "wallet_requestExecutionPermissions") return [permissionResponse()];
        throw new Error(`unexpected:${method}`);
      },
    };
    const adapter = new BaseSepoliaErc7715Adapter({ wallet: provider, module: moduleDouble() });

    const result = await adapter.requestPermission(grant());

    expect(result.status).toBe("granted");
    if (result.status !== "granted") throw new Error("expected granted permission");
    expect(result.permission.context).toBe(CONTEXT);
    expect(calls).toEqual([
      { method: "wallet_getSupportedExecutionPermissions", params: [] },
      { method: "wallet_requestExecutionPermissions", params: [expect.any(Array)] },
    ]);
    const request = calls[1].params?.[0];
    expect(request).toEqual([expect.objectContaining({
      chainId: BASE_SEPOLIA_CHAIN_ID_HEX,
      from: ACCOUNT,
      to: SESSION_ACCOUNT,
      expiry: 1_700_003_600,
    })]);
  });

  it("lists only structurally valid granted permissions through the feature-detected method", async () => {
    const calls: Array<{ method: string; params?: readonly unknown[] }> = [];
    const adapter = new BaseSepoliaErc7715Adapter({
      wallet: {
        request: async ({ method, params }) => {
          calls.push({ method, params });
          if (method === "wallet_getSupportedExecutionPermissions") {
            return { "erc20-token-allowance": { chainIds: [BASE_SEPOLIA_CHAIN_ID_HEX], ruleTypes: ["expiry", "target", "selector"] } };
          }
          if (method === "wallet_getGrantedExecutionPermissions") return [permissionResponse()];
          throw new Error(`unexpected:${method}`);
        },
      },
      module: moduleDouble(),
      account: { address: SESSION_ACCOUNT, encodeCalls: async () => "0x1234" },
    });

    const result = await adapter.listPermissions();

    expect(result).toEqual({ status: "listed", permissions: [permissionResponse()] });
    expect(calls.map(({ method }) => method)).toEqual([
      "wallet_getSupportedExecutionPermissions",
      "wallet_getGrantedExecutionPermissions",
    ]);
  });

  it("revokes with the opaque permission context and does not accept a non-empty provider result", async () => {
    const calls: Array<{ method: string; params?: readonly unknown[] }> = [];
    const adapter = new BaseSepoliaErc7715Adapter({
      wallet: {
        request: async ({ method, params }) => {
          calls.push({ method, params });
          if (method === "wallet_getSupportedExecutionPermissions") {
            return { "erc20-token-allowance": { chainIds: [BASE_SEPOLIA_CHAIN_ID_HEX], ruleTypes: ["expiry", "target", "selector"] } };
          }
          if (method === "wallet_revokeExecutionPermission") return undefined;
          throw new Error(`unexpected:${method}`);
        },
      },
      module: moduleDouble(),
    });

    const result = await adapter.revokePermission(CONTEXT);

    expect(result).toEqual({ status: "revoked", context: CONTEXT });
    expect(calls[1]).toEqual({
      method: "wallet_revokeExecutionPermission",
      params: [{ permissionContext: CONTEXT }],
    });
  });

  it("redeems through the injected ERC-4337 account and bundler without bypassing ERC-7710 module encoding", async () => {
    let encodedCalls: readonly unknown[] | null = null;
    let bundlerInput: unknown = null;
    const adapter = new BaseSepoliaErc7715Adapter({
      module: moduleDouble(),
      account: {
        address: SESSION_ACCOUNT,
        encodeCalls: async ({ calls }) => {
          encodedCalls = calls;
          return "0x1234";
        },
      },
      bundler: {
        sendUserOperation: async (input) => {
          bundlerInput = input;
          return USER_OP_HASH;
        },
      },
    });

    const result = await adapter.redeem({
      grant: {
        ...grant(),
        status: "ACTIVE",
      },
      permission: permissionResponse(),
      execution: {
        target: TARGET,
        value: 0n,
        callData: "0xa9059cbb",
        asset: TOKEN,
        amount: 10n,
        replayKey: "redeem-1",
      },
      now: 1_700_000_001,
    });

    expect(result.status).toBe("submitted");
    if (result.status !== "submitted") throw new Error("expected submitted user operation");
    expect(result.userOperationHash).toBe(USER_OP_HASH);
    expect(result.grant.usage?.calls).toBe(1);
    expect(encodedCalls).toEqual([{ to: MANAGER, data: "0xdead", value: 0n }]);
    expect(bundlerInput).toEqual({ sender: SESSION_ACCOUNT, callData: "0x1234", chainId: 84532 });
  });

  it("rejects an ERC-7710 manager call that carries native value", async () => {
    const moduleWithValue = {
      ...moduleDouble(),
      encodeRedeemDelegations: () => ({ to: MANAGER, data: "0xdead" as `0x${string}`, value: 1n }),
    };
    const adapter = new BaseSepoliaErc7715Adapter({
      module: moduleWithValue,
      account: { address: SESSION_ACCOUNT, encodeCalls: async () => "0x1234" },
      bundler: { sendUserOperation: async () => USER_OP_HASH },
    });

    const result = await adapter.redeem({
      grant: { ...grant(), status: "ACTIVE" },
      permission: permissionResponse(),
      execution: { target: TARGET, value: 0n, callData: "0xa9059cbb", asset: TOKEN, amount: 1n, replayKey: "manager-value" },
      now: 1_700_000_001,
    });

    expect(result).toMatchObject({ status: "invalid", reason: "malformed_redeem_call" });
  });

  it("blocks a module that does not declare onchain coverage for every canonical grant constraint", async () => {
    const incompleteModule = { ...moduleDouble(), enforcedConstraints: ["target-contract"] as const };
    const adapter = new BaseSepoliaErc7715Adapter({
      wallet: { request: async () => ({}) },
      module: incompleteModule,
    });

    await expect(adapter.requestPermission(grant())).resolves.toEqual({
      status: "blocked",
      code: "BASE_SEPOLIA_MODULE_UNAVAILABLE",
      operation: "request",
      reason: "module_configuration_invalid",
    });
  });

  it("returns explicit blockers when the live permission module, smart account, or bundler is not injected", async () => {
    const noModule = new BaseSepoliaErc7715Adapter({
      wallet: { request: async () => ({}) },
    });
    await expect(noModule.requestPermission(grant())).resolves.toEqual({
      status: "blocked",
      code: "BASE_SEPOLIA_MODULE_UNAVAILABLE",
      operation: "request",
      reason: "permission_module_missing",
    });

    const noAccount = new BaseSepoliaErc7715Adapter({ module: moduleDouble() });
    await expect(noAccount.redeem({
      grant: { ...grant(), status: "ACTIVE" },
      permission: permissionResponse(),
      execution: { target: TARGET, value: 0n, callData: "0xa9059cbb", asset: TOKEN, amount: 1n, replayKey: "no-account" },
      now: 1_700_000_001,
    })).resolves.toEqual({
      status: "blocked",
      code: "BASE_SEPOLIA_ACCOUNT_UNAVAILABLE",
      operation: "redeem",
      reason: "smart_account_missing",
    });

    const noBundler = new BaseSepoliaErc7715Adapter({
      module: moduleDouble(),
      account: { address: SESSION_ACCOUNT, encodeCalls: async () => "0x1234" },
    });
    await expect(noBundler.redeem({
      grant: { ...grant(), status: "ACTIVE" },
      permission: permissionResponse(),
      execution: { target: TARGET, value: 0n, callData: "0xa9059cbb", asset: TOKEN, amount: 1n, replayKey: "no-bundler" },
      now: 1_700_000_001,
    })).resolves.toEqual({
      status: "blocked",
      code: "BASE_SEPOLIA_BUNDLER_UNAVAILABLE",
      operation: "redeem",
      reason: "bundler_missing",
    });
  });

  it("returns unsupported instead of inferring support when the wallet lacks the ERC-7715 method", async () => {
    const adapter = new BaseSepoliaErc7715Adapter({
      wallet: {
        request: async () => {
          throw Object.assign(new Error("method not found"), { code: -32601 });
        },
      },
      module: moduleDouble(),
    });

    const result = await adapter.requestPermission(grant());

    expect(result).toEqual({
      status: "unsupported",
      code: "BASE_SEPOLIA_UNSUPPORTED_WALLET",
      operation: "detect",
      reason: "method_not_supported",
    });
  });

  it("returns provider unavailable when no wallet request boundary exists", async () => {
    const adapter = new BaseSepoliaErc7715Adapter({ module: moduleDouble() });

    const result = await adapter.requestPermission(grant());

    expect(result).toEqual({
      status: "provider_unavailable",
      code: "BASE_SEPOLIA_PROVIDER_UNAVAILABLE",
      operation: "detect",
      reason: "wallet_interface_missing",
    });
  });

});
