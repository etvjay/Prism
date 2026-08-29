import { encodeFunctionData } from "viem";
import {
  authorizeSessionAction,
  assertSecureSessionGrant,
  type SecureSessionGrant,
} from "../domain/sessions";
import { normalizeEvmAddress, type EvmAddress } from "../../prism-identity/domain/identifiers";
import { isHexString, type Hex } from "../../prism-identity/domain/hex";

/** Base Sepolia (EIP-155) is the only network wired by this adapter. */
export const BASE_SEPOLIA_CHAIN_ID = 84_532 as const;
export const BASE_SEPOLIA_CHAIN_ID_HEX = "0x14a34" as const;

export const ERC7715_METHOD = {
  GET_SUPPORTED: "wallet_getSupportedExecutionPermissions",
  REQUEST: "wallet_requestExecutionPermissions",
  GET_GRANTED: "wallet_getGrantedExecutionPermissions",
  REVOKE: "wallet_revokeExecutionPermission",
} as const;

export const ERC7710_REDEEM_FUNCTION = "redeemDelegations" as const;
export const ERC7710_SINGLE_DEFAULT_MODE = `0x${"0".repeat(64)}` as Hex32;

export const BASE_SEPOLIA_SESSION_ERROR_CODE = {
  PROVIDER_UNAVAILABLE: "BASE_SEPOLIA_PROVIDER_UNAVAILABLE",
  UNSUPPORTED_WALLET: "BASE_SEPOLIA_UNSUPPORTED_WALLET",
  MODULE_UNAVAILABLE: "BASE_SEPOLIA_MODULE_UNAVAILABLE",
  ACCOUNT_UNAVAILABLE: "BASE_SEPOLIA_ACCOUNT_UNAVAILABLE",
  BUNDLER_UNAVAILABLE: "BASE_SEPOLIA_BUNDLER_UNAVAILABLE",
  INVALID_RESPONSE: "BASE_SEPOLIA_INVALID_PROVIDER_RESPONSE",
  POLICY_DENIED: "BASE_SEPOLIA_POLICY_DENIED",
  USER_REJECTED: "BASE_SEPOLIA_USER_REJECTED",
} as const;

export type Erc7715Method = (typeof ERC7715_METHOD)[keyof typeof ERC7715_METHOD];
export type Hex32 = `0x${string}`;

/** Narrow EIP-1193 boundary. The adapter never accepts arbitrary RPC methods. */
export interface Erc7715WalletProvider {
  request(input: { method: Erc7715Method; params?: readonly unknown[] }): Promise<unknown>;
}

export interface Erc7715PermissionData {
  readonly type: string;
  readonly isAdjustmentAllowed: boolean;
  readonly data: Readonly<Record<string, unknown>>;
}

export interface Erc7715Rule {
  readonly type: string;
  readonly data: Readonly<Record<string, unknown>>;
}

export interface Erc7715PermissionRequest {
  readonly chainId: typeof BASE_SEPOLIA_CHAIN_ID_HEX;
  readonly from: EvmAddress;
  readonly to: EvmAddress;
  readonly expiry: number;
  readonly permission: Erc7715PermissionData;
  readonly rules: readonly Erc7715Rule[];
}

export interface Erc7715Dependency {
  readonly factory: EvmAddress;
  readonly factoryData: Hex;
}

export interface Erc7715PermissionResponse extends Erc7715PermissionRequest {
  readonly context: Hex;
  readonly dependencies: readonly Erc7715Dependency[];
  readonly delegationManager: EvmAddress;
}

/**
 * Account encoding is deliberately injected. This avoids assuming a specific
 * ERC-4337 smart-account implementation or inventing a deployed module.
 */
export interface Erc4337Call {
  readonly to: EvmAddress;
  readonly data: Hex;
  readonly value?: bigint;
}

export interface Erc4337SmartAccount {
  readonly address: EvmAddress;
  encodeCalls(input: { calls: readonly Erc4337Call[] }): Promise<Hex>;
}

/**
 * Bundler submission is the only side effect exposed by this boundary. The
 * adapter returns a user-operation hash, never a fabricated receipt.
 */
export interface Erc4337Bundler {
  sendUserOperation(input: {
    sender: EvmAddress;
    callData: Hex;
    chainId: typeof BASE_SEPOLIA_CHAIN_ID;
  }): Promise<Hex>;
}

export interface Erc7710Execution {
  readonly target: EvmAddress;
  readonly value: bigint;
  readonly callData: Hex;
  /** Asset and amount are explicit because arbitrary calldata is not decoded here. */
  readonly asset?: string;
  readonly amount?: bigint;
  readonly replayKey: string;
}

export interface Erc7710RedeemCallInput {
  readonly permissionContext: Hex;
  readonly delegationManager: EvmAddress;
  readonly mode: Hex32;
  readonly execution: Erc7710Execution;
}

export interface Erc7710RedeemEncodingInput {
  readonly permissionContexts: readonly Hex[];
  readonly modes: readonly Hex32[];
  readonly executionCallDatas: readonly Hex[];
}

const ERC7710_REDEEM_ABI = [{
  type: "function",
  name: ERC7710_REDEEM_FUNCTION,
  stateMutability: "nonpayable",
  inputs: [
    { name: "_permissionContexts", type: "bytes[]" },
    { name: "_modes", type: "bytes32[]" },
    { name: "_executionCallData", type: "bytes[]" },
  ],
}] as const;

export const SESSION_ONCHAIN_CONSTRAINTS = [
  "target-contract",
  "function-selector",
  "asset",
  "per-call-spend",
  "aggregate-spend",
  "call-count",
  "expiry",
  "revocation",
  "replay",
  "chain-id",
  "account-binding",
] as const;
export type SessionOnchainConstraint = (typeof SESSION_ONCHAIN_CONSTRAINTS)[number];

/**
 * Module boundary for the wallet permission vocabulary and ERC-7710 calldata.
 * The module owns the mapping from Prism's target/selector/spend bounds to the
 * wallet's concrete permission/rule and caveat encoding. No rule type is
 * silently invented by the adapter.
 */
export interface BaseSepoliaPermissionModule {
  /** Explicit attestation that onchain caveats enforce the full Prism grant. */
  readonly enforcedConstraints: readonly SessionOnchainConstraint[];
  readonly permissionTypes: readonly string[];
  readonly ruleTypes: readonly string[];
  buildPermissionRequests(input: {
    readonly grant: SecureSessionGrant;
    readonly sessionAccount: string;
  }): readonly Erc7715PermissionRequest[] | Promise<readonly Erc7715PermissionRequest[]>;
  validatePermissionResponse(input: {
    readonly response: Erc7715PermissionResponse;
    readonly grant: SecureSessionGrant;
  }): void | Promise<void>;
  encodeRedeemDelegations(input: Erc7710RedeemCallInput): Erc4337Call | Promise<Erc4337Call>;
}

export type BaseSepoliaAdapterOperation = "detect" | "request" | "list" | "revoke" | "redeem";

export type BaseSepoliaAdapterFailure =
  | {
      readonly status: "provider_unavailable";
      readonly code: typeof BASE_SEPOLIA_SESSION_ERROR_CODE.PROVIDER_UNAVAILABLE;
      readonly operation: BaseSepoliaAdapterOperation;
      readonly reason: "wallet_interface_missing" | "provider_request_failed" | "malformed_capability_response";
    }
  | {
      readonly status: "unsupported";
      readonly code: typeof BASE_SEPOLIA_SESSION_ERROR_CODE.UNSUPPORTED_WALLET;
      readonly operation: BaseSepoliaAdapterOperation;
      readonly reason: "method_not_supported" | "permission_type_not_supported" | "rule_type_not_supported" | "wrong_chain_not_supported";
    }
  | {
      readonly status: "blocked";
      readonly code:
        | typeof BASE_SEPOLIA_SESSION_ERROR_CODE.MODULE_UNAVAILABLE
        | typeof BASE_SEPOLIA_SESSION_ERROR_CODE.ACCOUNT_UNAVAILABLE
        | typeof BASE_SEPOLIA_SESSION_ERROR_CODE.BUNDLER_UNAVAILABLE;
      readonly operation: BaseSepoliaAdapterOperation;
      readonly reason: "permission_module_missing" | "smart_account_missing" | "bundler_missing" | "module_configuration_invalid";
    }
  | {
      readonly status: "invalid";
      readonly code: typeof BASE_SEPOLIA_SESSION_ERROR_CODE.INVALID_RESPONSE;
      readonly operation: BaseSepoliaAdapterOperation;
      readonly reason:
        | "malformed_permission_request"
        | "malformed_permission_response"
        | "permission_response_count_mismatch"
        | "permission_response_not_bound"
        | "permission_response_expired"
        | "permission_module_rejected_response"
        | "malformed_redeem_call"
        | "malformed_user_operation_hash";
    }
  | {
      readonly status: "policy_denied";
      readonly code: typeof BASE_SEPOLIA_SESSION_ERROR_CODE.POLICY_DENIED;
      readonly operation: "redeem";
      readonly reason:
        | "grant_invalid"
        | "grant_not_active"
        | "chain_not_allowed"
        | "account_not_allowed"
        | "delegate_account_not_allowed"
        | "target_not_allowed"
        | "selector_not_allowed"
        | "asset_not_allowed"
        | "per_call_spend_limit_exceeded"
        | "aggregate_spend_limit_exceeded"
        | "call_limit_exceeded"
        | "expired"
        | "replay_detected";
    }
  | {
      readonly status: "rejected";
      readonly code: typeof BASE_SEPOLIA_SESSION_ERROR_CODE.USER_REJECTED;
      readonly operation: BaseSepoliaAdapterOperation;
      readonly reason: "user_rejected";
    };

export interface BaseSepoliaSupportedPermissions {
  readonly status: "supported";
  readonly permissions: Readonly<Record<string, { readonly chainIds: readonly string[]; readonly ruleTypes: readonly string[] }>>;
}

export type BaseSepoliaSupportResult = BaseSepoliaSupportedPermissions | BaseSepoliaAdapterFailure;

export type BaseSepoliaPermissionResult =
  | {
      readonly status: "granted";
      readonly grant: SecureSessionGrant;
      readonly permission: Erc7715PermissionResponse;
      readonly permissions: readonly Erc7715PermissionResponse[];
    }
  | BaseSepoliaAdapterFailure;

export type BaseSepoliaListResult =
  | { readonly status: "listed"; readonly permissions: readonly Erc7715PermissionResponse[] }
  | BaseSepoliaAdapterFailure;

export type BaseSepoliaRevokeResult =
  | { readonly status: "revoked"; readonly context: Hex }
  | BaseSepoliaAdapterFailure;

export interface BaseSepoliaRedeemInput {
  readonly grant: SecureSessionGrant;
  readonly permission: Erc7715PermissionResponse;
  readonly execution: Erc7710Execution;
  readonly now: number;
  readonly mode?: Hex32;
}

export type BaseSepoliaRedeemResult =
  | {
      readonly status: "submitted";
      readonly grant: SecureSessionGrant;
      readonly permission: Erc7715PermissionResponse;
      readonly userOperationHash: Hex;
    }
  | BaseSepoliaAdapterFailure;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeAddress(value: unknown): EvmAddress | null {
  if (typeof value !== "string") return null;
  const address = normalizeEvmAddress(value);
  if (!address || address === "0x0000000000000000000000000000000000000000") return null;
  return address;
}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function parseChainId(value: unknown): string | null {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value <= 0) return null;
    return `0x${value.toString(16)}`;
  }
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!/^0x[0-9a-f]+$/i.test(raw)) return null;
  try {
    const parsed = BigInt(raw);
    if (parsed <= 0n) return null;
    return `0x${parsed.toString(16)}`;
  } catch {
    return null;
  }
}

function isByteHex(value: unknown, allowEmpty = true): value is Hex {
  if (!isHexString(value)) return false;
  if (!allowEmpty && value.length <= 2) return false;
  return true;
}

export function encodeErc7710RedeemDelegations(input: Erc7710RedeemEncodingInput): Hex {
  if (!input || !Array.isArray(input.permissionContexts) || !Array.isArray(input.modes) || !Array.isArray(input.executionCallDatas) || input.permissionContexts.length === 0 || input.permissionContexts.length !== input.modes.length || input.permissionContexts.length !== input.executionCallDatas.length) {
    throw new Error("invalid_erc7710_redeem_arrays");
  }
  if (input.permissionContexts.some((context) => !isByteHex(context, false)) || input.modes.some((mode) => !isByteHex(mode, false) || mode.length !== 66) || input.executionCallDatas.some((callData) => !isByteHex(callData))) {
    throw new Error("invalid_erc7710_redeem_encoding");
  }
  return encodeFunctionData({
    abi: ERC7710_REDEEM_ABI,
    functionName: ERC7710_REDEEM_FUNCTION,
    args: [input.permissionContexts, input.modes, input.executionCallDatas],
  });
}

function asInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function emptyRpcResult(value: unknown): boolean {
  return value === undefined || value === null || (Array.isArray(value) && value.length === 0);
}

function providerErrorCode(value: unknown): unknown {
  return isRecord(value) ? value.code : undefined;
}

function providerErrorMessage(value: unknown): string {
  return isRecord(value) && typeof value.message === "string" ? value.message : "";
}

function isUserRejection(value: unknown): boolean {
  const code = providerErrorCode(value);
  if (code === 4001 || code === "4001") return true;
  return /rejected|denied|cancelled|canceled/i.test(providerErrorMessage(value));
}

function isMethodUnsupported(value: unknown): boolean {
  const code = providerErrorCode(value);
  if (code === -32601 || code === "-32601") return true;
  return /method.*(not found|unsupported)|unsupported.*method/i.test(providerErrorMessage(value));
}

function moduleConfigurationValid(module: BaseSepoliaPermissionModule | null): module is BaseSepoliaPermissionModule {
  return !!module
    && Array.isArray(module.enforcedConstraints)
    && SESSION_ONCHAIN_CONSTRAINTS.every((constraint) => module.enforcedConstraints.includes(constraint))
    && Array.isArray(module.permissionTypes)
    && module.permissionTypes.length > 0
    && module.permissionTypes.every((type) => typeof type === "string" && type.trim().length > 0)
    && Array.isArray(module.ruleTypes)
    && module.ruleTypes.length > 0
    && module.ruleTypes.every((type) => typeof type === "string" && type.trim().length > 0)
    && typeof module.buildPermissionRequests === "function"
    && typeof module.validatePermissionResponse === "function"
    && typeof module.encodeRedeemDelegations === "function";
}

function failure(
  status: BaseSepoliaAdapterFailure["status"],
  operation: BaseSepoliaAdapterOperation,
  code: BaseSepoliaAdapterFailure["code"],
  reason: BaseSepoliaAdapterFailure["reason"],
): BaseSepoliaAdapterFailure {
  return { status, operation, code, reason } as BaseSepoliaAdapterFailure;
}

function parseCapabilityMap(value: unknown): BaseSepoliaSupportedPermissions | BaseSepoliaAdapterFailure {
  if (!isRecord(value)) {
    return failure("provider_unavailable", "detect", BASE_SEPOLIA_SESSION_ERROR_CODE.PROVIDER_UNAVAILABLE, "malformed_capability_response");
  }
  const permissions: Record<string, { chainIds: readonly string[]; ruleTypes: readonly string[] }> = {};
  for (const [permissionType, raw] of Object.entries(value)) {
    if (!isRecord(raw) || !Array.isArray(raw.chainIds) || !Array.isArray(raw.ruleTypes)) {
      return failure("provider_unavailable", "detect", BASE_SEPOLIA_SESSION_ERROR_CODE.PROVIDER_UNAVAILABLE, "malformed_capability_response");
    }
    const chainIds: string[] = [];
    for (const chainId of raw.chainIds) {
      const normalized = parseChainId(chainId);
      if (!normalized) {
        return failure("provider_unavailable", "detect", BASE_SEPOLIA_SESSION_ERROR_CODE.PROVIDER_UNAVAILABLE, "malformed_capability_response");
      }
      chainIds.push(normalized);
    }
    if (raw.ruleTypes.some((type) => typeof type !== "string")) {
      return failure("provider_unavailable", "detect", BASE_SEPOLIA_SESSION_ERROR_CODE.PROVIDER_UNAVAILABLE, "malformed_capability_response");
    }
    permissions[permissionType] = { chainIds, ruleTypes: raw.ruleTypes as string[] };
  }
  return { status: "supported", permissions };
}

function parsePermissionResponse(value: unknown): Erc7715PermissionResponse | null {
  if (!isRecord(value)) return null;
  const chainId = parseChainId(value.chainId);
  const from = normalizeAddress(value.from);
  const to = normalizeAddress(value.to);
  const expiry = asInteger(value.expiry);
  const permission = value.permission;
  const context = value.context;
  const delegationManager = normalizeAddress(value.delegationManager);
  if (!chainId || !from || !to || expiry === null || !isRecord(permission) || typeof permission.type !== "string" || permission.type.trim().length === 0 || typeof permission.isAdjustmentAllowed !== "boolean" || !isRecord(permission.data) || !isByteHex(context, false) || !delegationManager || !Array.isArray(value.dependencies)) {
    return null;
  }
  const dependencies: Erc7715Dependency[] = [];
  for (const dependency of value.dependencies) {
    if (!isRecord(dependency)) return null;
    const factory = dependency.factory;
    const factoryData = dependency.factoryData;
    if (factory === undefined && factoryData === undefined) continue;
    const normalizedFactory = normalizeAddress(factory);
    if (!normalizedFactory || !isByteHex(factoryData)) return null;
    dependencies.push({ factory: normalizedFactory, factoryData: factoryData as Hex });
  }
  const rules = value.rules === undefined ? [] : value.rules;
  if (!Array.isArray(rules)) return null;
  const parsedRules: Erc7715Rule[] = [];
  for (const rule of rules) {
    if (!isRecord(rule) || typeof rule.type !== "string" || rule.type.trim().length === 0 || !isRecord(rule.data)) return null;
    parsedRules.push({ type: rule.type, data: rule.data });
  }
  return {
    chainId: chainId as typeof BASE_SEPOLIA_CHAIN_ID_HEX,
    from,
    to,
    expiry,
    permission: {
      type: permission.type,
      isAdjustmentAllowed: permission.isAdjustmentAllowed,
      data: permission.data,
    },
    rules: parsedRules,
    context: context as Hex,
    dependencies,
    delegationManager,
  };
}

function permissionMatchesGrant(
  response: Erc7715PermissionResponse,
  grant: SecureSessionGrant,
  sessionAccount: EvmAddress,
  operation: "request" | "redeem",
): BaseSepoliaAdapterFailure | null {
  if (response.chainId !== BASE_SEPOLIA_CHAIN_ID_HEX || !sameAddress(response.from, grant.account) || !sameAddress(response.to, sessionAccount)) {
    return failure("invalid", operation, BASE_SEPOLIA_SESSION_ERROR_CODE.INVALID_RESPONSE, "permission_response_not_bound");
  }
  if (response.expiry < grant.validFrom || response.expiry > grant.validUntil) {
    return failure("invalid", operation, BASE_SEPOLIA_SESSION_ERROR_CODE.INVALID_RESPONSE, "permission_response_expired");
  }
  if (response.permission.isAdjustmentAllowed) {
    return failure("invalid", operation, BASE_SEPOLIA_SESSION_ERROR_CODE.INVALID_RESPONSE, "permission_response_not_bound");
  }
  return null;
}

function validRequest(
  request: unknown,
  grant: SecureSessionGrant,
  module: BaseSepoliaPermissionModule,
): request is Erc7715PermissionRequest {
  if (!isRecord(request)) return false;
  const chainId = parseChainId(request.chainId);
  const from = normalizeAddress(request.from);
  const to = normalizeAddress(request.to);
  const expiry = asInteger(request.expiry);
  const permission = request.permission;
  const rules = request.rules;
  if (chainId !== BASE_SEPOLIA_CHAIN_ID_HEX || !from || !to || !sameAddress(from, grant.account) || !sameAddress(to, grant.delegateAccount) || expiry === null || expiry < grant.validFrom || expiry > grant.validUntil || !isRecord(permission) || typeof permission.type !== "string" || !module.permissionTypes.includes(permission.type) || permission.isAdjustmentAllowed !== false || !isRecord(permission.data) || !Array.isArray(rules)) return false;
  const ruleTypes = rules.map((rule) => isRecord(rule) && typeof rule.type === "string" ? rule.type : null);
  if (ruleTypes.some((type) => type === null)) return false;
  if (module.ruleTypes.some((type) => !ruleTypes.includes(type))) return false;
  return rules.every((rule) => isRecord(rule) && isRecord(rule.data));
}

function permissionMatchesModule(
  permission: Erc7715PermissionResponse,
  module: BaseSepoliaPermissionModule,
): boolean {
  if (!module.permissionTypes.includes(permission.permission.type)) return false;
  const ruleTypes = permission.rules.map((rule) => rule.type);
  return module.ruleTypes.every((type) => ruleTypes.includes(type))
    && ruleTypes.every((type) => module.ruleTypes.includes(type));
}

function safePolicyReason(value: unknown): BaseSepoliaAdapterFailure["reason"] {
  if (isRecord(value) && typeof value.reason === "string") {
    const reason = value.reason;
    const allowed = new Set<BaseSepoliaAdapterFailure["reason"]>([
      "grant_invalid",
      "grant_not_active",
      "chain_not_allowed",
      "account_not_allowed",
      "delegate_account_not_allowed",
      "target_not_allowed",
      "selector_not_allowed",
      "asset_not_allowed",
      "per_call_spend_limit_exceeded",
      "aggregate_spend_limit_exceeded",
      "call_limit_exceeded",
      "expired",
      "replay_detected",
    ]);
    if (allowed.has(reason as BaseSepoliaAdapterFailure["reason"])) return reason as BaseSepoliaAdapterFailure["reason"];
    if (reason === "session_grant_not_active") return "grant_not_active";
    if (reason === "session_grant_expired") return "expired";
    if (reason === "session_chain_not_allowed") return "chain_not_allowed";
    if (reason === "session_account_not_allowed") return "account_not_allowed";
    if (reason === "session_delegate_account_not_allowed") return "delegate_account_not_allowed";
    if (reason === "session_contract_not_allowed") return "target_not_allowed";
    if (reason === "session_selector_not_allowed") return "selector_not_allowed";
    if (reason === "session_asset_not_allowed") return "asset_not_allowed";
    if (reason === "session_per_call_spend_limit_exceeded") return "per_call_spend_limit_exceeded";
    if (reason === "session_aggregate_spend_limit_exceeded") return "aggregate_spend_limit_exceeded";
    if (reason === "session_call_limit_exceeded") return "call_limit_exceeded";
    if (reason === "session_replay_detected") return "replay_detected";
  }
  return "grant_invalid";
}

export class BaseSepoliaErc7715Adapter {
  readonly chainId = BASE_SEPOLIA_CHAIN_ID;
  readonly chainIdHex = BASE_SEPOLIA_CHAIN_ID_HEX;
  #wallet: Erc7715WalletProvider | null;
  #module: BaseSepoliaPermissionModule | null;
  #account: Erc4337SmartAccount | null;
  #bundler: Erc4337Bundler | null;
  #submittedReplayKeys = new Set<string>();

  constructor(options: {
    readonly wallet?: Erc7715WalletProvider | null;
    readonly module?: BaseSepoliaPermissionModule | null;
    readonly account?: Erc4337SmartAccount | null;
    readonly bundler?: Erc4337Bundler | null;
  }) {
    this.#wallet = options?.wallet ?? null;
    this.#module = options?.module ?? null;
    this.#account = options?.account ?? null;
    this.#bundler = options?.bundler ?? null;
  }

  async detectSupport(): Promise<BaseSepoliaSupportResult> {
    if (!this.#wallet || typeof this.#wallet.request !== "function") {
      return failure("provider_unavailable", "detect", BASE_SEPOLIA_SESSION_ERROR_CODE.PROVIDER_UNAVAILABLE, "wallet_interface_missing");
    }
    if (!moduleConfigurationValid(this.#module)) {
      return failure("blocked", "detect", BASE_SEPOLIA_SESSION_ERROR_CODE.MODULE_UNAVAILABLE, "module_configuration_invalid");
    }
    const response = await this.#walletRequest(ERC7715_METHOD.GET_SUPPORTED, "detect", []);
    if (!response.ok) return response.failure;
    const parsed = parseCapabilityMap(response.value);
    if (parsed.status !== "supported") return parsed;
    for (const permissionType of this.#module.permissionTypes) {
      const support = parsed.permissions[permissionType];
      if (!support) {
        return failure("unsupported", "detect", BASE_SEPOLIA_SESSION_ERROR_CODE.UNSUPPORTED_WALLET, "permission_type_not_supported");
      }
      if (!support.chainIds.includes(BASE_SEPOLIA_CHAIN_ID_HEX)) {
        return failure("unsupported", "detect", BASE_SEPOLIA_SESSION_ERROR_CODE.UNSUPPORTED_WALLET, "wrong_chain_not_supported");
      }
      for (const ruleType of this.#module.ruleTypes) {
        if (!support.ruleTypes.includes(ruleType)) {
          return failure("unsupported", "detect", BASE_SEPOLIA_SESSION_ERROR_CODE.UNSUPPORTED_WALLET, "rule_type_not_supported");
        }
      }
    }
    return parsed;
  }

  async detectCapabilities(): Promise<BaseSepoliaSupportResult> {
    return this.detectSupport();
  }

  async requestPermission(grant: SecureSessionGrant): Promise<BaseSepoliaPermissionResult> {
    try {
      assertSecureSessionGrant(grant);
    } catch {
      return failure("invalid", "request", BASE_SEPOLIA_SESSION_ERROR_CODE.INVALID_RESPONSE, "malformed_permission_request");
    }
    if (!moduleConfigurationValid(this.#module)) {
      return failure("blocked", "request", BASE_SEPOLIA_SESSION_ERROR_CODE.MODULE_UNAVAILABLE, this.#module === null ? "permission_module_missing" : "module_configuration_invalid");
    }
    const support = await this.detectSupport();
    if (support.status !== "supported") return support;
    let requests: readonly Erc7715PermissionRequest[];
    try {
      requests = await this.#module.buildPermissionRequests({ grant, sessionAccount: grant.delegateAccount });
    } catch {
      return failure("invalid", "request", BASE_SEPOLIA_SESSION_ERROR_CODE.INVALID_RESPONSE, "malformed_permission_request");
    }
    if (!Array.isArray(requests) || requests.length === 0 || requests.some((request) => !validRequest(request, grant, this.#module!))) {
      return failure("invalid", "request", BASE_SEPOLIA_SESSION_ERROR_CODE.INVALID_RESPONSE, "malformed_permission_request");
    }
    const response = await this.#walletRequest(ERC7715_METHOD.REQUEST, "request", [requests]);
    if (!response.ok) return response.failure;
    if (!Array.isArray(response.value) || response.value.length !== requests.length) {
      return failure("invalid", "request", BASE_SEPOLIA_SESSION_ERROR_CODE.INVALID_RESPONSE, "permission_response_count_mismatch");
    }
    const permissions: Erc7715PermissionResponse[] = [];
    for (const rawPermission of response.value) {
      const permission = parsePermissionResponse(rawPermission);
      if (!permission) return failure("invalid", "request", BASE_SEPOLIA_SESSION_ERROR_CODE.INVALID_RESPONSE, "malformed_permission_response");
      if (!permissionMatchesModule(permission, this.#module!)) return failure("invalid", "request", BASE_SEPOLIA_SESSION_ERROR_CODE.INVALID_RESPONSE, "permission_module_rejected_response");
      const bindingFailure = permissionMatchesGrant(permission, grant, grant.delegateAccount as EvmAddress, "request");
      if (bindingFailure) return bindingFailure;
      try {
        await this.#module.validatePermissionResponse({ response: permission, grant });
      } catch {
        return failure("invalid", "request", BASE_SEPOLIA_SESSION_ERROR_CODE.INVALID_RESPONSE, "permission_module_rejected_response");
      }
      permissions.push(permission);
    }
    return { status: "granted", grant, permission: permissions[0], permissions };
  }

  async listPermissions(): Promise<BaseSepoliaListResult> {
    if (!moduleConfigurationValid(this.#module)) {
      return failure("blocked", "list", BASE_SEPOLIA_SESSION_ERROR_CODE.MODULE_UNAVAILABLE, this.#module === null ? "permission_module_missing" : "module_configuration_invalid");
    }
    const support = await this.detectSupport();
    if (support.status !== "supported") return support;
    const response = await this.#walletRequest(ERC7715_METHOD.GET_GRANTED, "list", []);
    if (!response.ok) return response.failure;
    if (!Array.isArray(response.value)) {
      return failure("invalid", "list", BASE_SEPOLIA_SESSION_ERROR_CODE.INVALID_RESPONSE, "malformed_permission_response");
    }
    const permissions: Erc7715PermissionResponse[] = [];
    for (const rawPermission of response.value) {
      const permission = parsePermissionResponse(rawPermission);
      if (!permission || permission.chainId !== BASE_SEPOLIA_CHAIN_ID_HEX) {
        return failure("invalid", "list", BASE_SEPOLIA_SESSION_ERROR_CODE.INVALID_RESPONSE, "malformed_permission_response");
      }
      if (!permissionMatchesModule(permission, this.#module!)) {
        return failure("invalid", "list", BASE_SEPOLIA_SESSION_ERROR_CODE.INVALID_RESPONSE, "permission_module_rejected_response");
      }
      if (this.#account && !sameAddress(permission.to, this.#account.address)) {
        return failure("invalid", "list", BASE_SEPOLIA_SESSION_ERROR_CODE.INVALID_RESPONSE, "permission_response_not_bound");
      }
      permissions.push(permission);
    }
    return { status: "listed", permissions };
  }

  async revokePermission(context: Hex): Promise<BaseSepoliaRevokeResult> {
    if (!isByteHex(context, false)) {
      return failure("invalid", "revoke", BASE_SEPOLIA_SESSION_ERROR_CODE.INVALID_RESPONSE, "malformed_permission_response");
    }
    if (!moduleConfigurationValid(this.#module)) {
      return failure("blocked", "revoke", BASE_SEPOLIA_SESSION_ERROR_CODE.MODULE_UNAVAILABLE, this.#module === null ? "permission_module_missing" : "module_configuration_invalid");
    }
    const support = await this.detectSupport();
    if (support.status !== "supported") return support;
    const response = await this.#walletRequest(ERC7715_METHOD.REVOKE, "revoke", [{ permissionContext: context }]);
    if (!response.ok) return response.failure;
    if (!emptyRpcResult(response.value)) {
      return failure("invalid", "revoke", BASE_SEPOLIA_SESSION_ERROR_CODE.INVALID_RESPONSE, "malformed_permission_response");
    }
    return { status: "revoked", context };
  }

  async redeem(input: BaseSepoliaRedeemInput): Promise<BaseSepoliaRedeemResult> {
    if (!moduleConfigurationValid(this.#module)) {
      return failure("blocked", "redeem", BASE_SEPOLIA_SESSION_ERROR_CODE.MODULE_UNAVAILABLE, this.#module === null ? "permission_module_missing" : "module_configuration_invalid");
    }
    if (!this.#account) {
      return failure("blocked", "redeem", BASE_SEPOLIA_SESSION_ERROR_CODE.ACCOUNT_UNAVAILABLE, "smart_account_missing");
    }
    if (!this.#bundler) {
      return failure("blocked", "redeem", BASE_SEPOLIA_SESSION_ERROR_CODE.BUNDLER_UNAVAILABLE, "bundler_missing");
    }
    let grant: SecureSessionGrant;
    try {
      assertSecureSessionGrant(input.grant);
      grant = input.grant;
    } catch {
      return failure("policy_denied", "redeem", BASE_SEPOLIA_SESSION_ERROR_CODE.POLICY_DENIED, "grant_invalid");
    }
    const accountAddress = normalizeAddress(this.#account.address);
    const expectedDelegate = normalizeAddress(grant.delegateAccount);
    if (!accountAddress || !expectedDelegate || !sameAddress(accountAddress, expectedDelegate)) {
      return failure("policy_denied", "redeem", BASE_SEPOLIA_SESSION_ERROR_CODE.POLICY_DENIED, "delegate_account_not_allowed");
    }
    const permission = parsePermissionResponse(input.permission);
    if (!permission) {
      return failure("invalid", "redeem", BASE_SEPOLIA_SESSION_ERROR_CODE.INVALID_RESPONSE, "malformed_permission_response");
    }
    if (!permissionMatchesModule(permission, this.#module)) {
      return failure("invalid", "redeem", BASE_SEPOLIA_SESSION_ERROR_CODE.INVALID_RESPONSE, "permission_module_rejected_response");
    }
    const bindingFailure = permissionMatchesGrant(permission, grant, accountAddress, "redeem");
    if (bindingFailure) return bindingFailure;
    try {
      await this.#module.validatePermissionResponse({ response: permission, grant });
    } catch {
      return failure("invalid", "redeem", BASE_SEPOLIA_SESSION_ERROR_CODE.INVALID_RESPONSE, "permission_module_rejected_response");
    }
    const target = normalizeAddress(input.execution?.target);
    const value = input.execution?.value;
    const callData = input.execution?.callData;
    if (!target || typeof value !== "bigint" || value < 0n || !isByteHex(callData)) {
      return failure("policy_denied", "redeem", BASE_SEPOLIA_SESSION_ERROR_CODE.POLICY_DENIED, "grant_invalid");
    }
    const selector = callData.length >= 10 ? `0x${callData.slice(2, 10).toLowerCase()}` : "0x";
    const amount = input.execution.amount ?? value;
    const asset = input.execution.asset ?? (value > 0n ? "native" : undefined);
    const nativeAsset = asset === "native" || asset === "0x0000000000000000000000000000000000000000";
    if ((value > 0n && !nativeAsset) || (nativeAsset && amount !== value)) {
      return failure("policy_denied", "redeem", BASE_SEPOLIA_SESSION_ERROR_CODE.POLICY_DENIED, "asset_not_allowed");
    }
    const replayIdentity = `${grant.id}:${grant.replay.namespace}:${input.execution.replayKey}`;
    if (this.#submittedReplayKeys.has(replayIdentity)) {
      return failure("policy_denied", "redeem", BASE_SEPOLIA_SESSION_ERROR_CODE.POLICY_DENIED, "replay_detected");
    }
    let nextGrant: SecureSessionGrant;
    try {
      nextGrant = authorizeSessionAction(grant, {
        contract: target,
        selector,
        asset,
        amount,
        chainId: BASE_SEPOLIA_CHAIN_ID,
        account: grant.account,
        delegateAccount: accountAddress,
        replayKey: input.execution.replayKey,
        now: input.now,
      }) as SecureSessionGrant;
    } catch (error) {
      return failure("policy_denied", "redeem", BASE_SEPOLIA_SESSION_ERROR_CODE.POLICY_DENIED, safePolicyReason(error));
    }
    const mode = input.mode ?? ERC7710_SINGLE_DEFAULT_MODE;
    if (!isByteHex(mode, false) || mode.length !== 66) {
      return failure("invalid", "redeem", BASE_SEPOLIA_SESSION_ERROR_CODE.INVALID_RESPONSE, "malformed_redeem_call");
    }
    let redeemCall: Erc4337Call;
    try {
      redeemCall = await this.#module.encodeRedeemDelegations({
        permissionContext: permission.context,
        delegationManager: permission.delegationManager,
        mode,
        execution: input.execution,
      });
    } catch {
      return failure("invalid", "redeem", BASE_SEPOLIA_SESSION_ERROR_CODE.INVALID_RESPONSE, "malformed_redeem_call");
    }
    const redeemTarget = normalizeAddress(redeemCall?.to);
    if (!redeemTarget || !sameAddress(redeemTarget, permission.delegationManager) || !isByteHex(redeemCall?.data, false) || (redeemCall.value !== undefined && (typeof redeemCall.value !== "bigint" || redeemCall.value !== 0n))) {
      return failure("invalid", "redeem", BASE_SEPOLIA_SESSION_ERROR_CODE.INVALID_RESPONSE, "malformed_redeem_call");
    }
    let callDataForAccount: Hex;
    try {
      callDataForAccount = await this.#account.encodeCalls({ calls: [{ ...redeemCall, to: redeemTarget }] });
    } catch {
      return failure("blocked", "redeem", BASE_SEPOLIA_SESSION_ERROR_CODE.ACCOUNT_UNAVAILABLE, "smart_account_missing");
    }
    if (!isByteHex(callDataForAccount, false)) {
      return failure("invalid", "redeem", BASE_SEPOLIA_SESSION_ERROR_CODE.INVALID_RESPONSE, "malformed_redeem_call");
    }
    let userOperationHash: Hex;
    try {
      userOperationHash = await this.#bundler.sendUserOperation({
        sender: accountAddress,
        callData: callDataForAccount,
        chainId: BASE_SEPOLIA_CHAIN_ID,
      });
    } catch {
      return failure("blocked", "redeem", BASE_SEPOLIA_SESSION_ERROR_CODE.BUNDLER_UNAVAILABLE, "bundler_missing");
    }
    if (!isByteHex(userOperationHash, false) || userOperationHash.length !== 66) {
      return failure("invalid", "redeem", BASE_SEPOLIA_SESSION_ERROR_CODE.INVALID_RESPONSE, "malformed_user_operation_hash");
    }
    this.#submittedReplayKeys.add(replayIdentity);
    return { status: "submitted", grant: nextGrant, permission, userOperationHash };
  }

  async #walletRequest(
    method: Erc7715Method,
    operation: BaseSepoliaAdapterOperation,
    params: readonly unknown[],
  ): Promise<{ ok: true; value: unknown } | { ok: false; failure: BaseSepoliaAdapterFailure }> {
    if (!this.#wallet || typeof this.#wallet.request !== "function") {
      return { ok: false, failure: failure("provider_unavailable", operation, BASE_SEPOLIA_SESSION_ERROR_CODE.PROVIDER_UNAVAILABLE, "wallet_interface_missing") };
    }
    try {
      return { ok: true, value: await this.#wallet.request({ method, params }) };
    } catch (error) {
      if (isUserRejection(error)) {
        return {
          ok: false,
          failure: failure("rejected", operation, BASE_SEPOLIA_SESSION_ERROR_CODE.USER_REJECTED, "user_rejected"),
        };
      }
      if (isMethodUnsupported(error)) {
        return {
          ok: false,
          failure: failure("unsupported", operation, BASE_SEPOLIA_SESSION_ERROR_CODE.UNSUPPORTED_WALLET, "method_not_supported"),
        };
      }
      return {
        ok: false,
        failure: failure("provider_unavailable", operation, BASE_SEPOLIA_SESSION_ERROR_CODE.PROVIDER_UNAVAILABLE, "provider_request_failed"),
      };
    }
  }
}

export function createBaseSepoliaErc7715Adapter(options: {
  readonly wallet?: Erc7715WalletProvider | null;
  readonly module?: BaseSepoliaPermissionModule | null;
  readonly account?: Erc4337SmartAccount | null;
  readonly bundler?: Erc4337Bundler | null;
}): BaseSepoliaErc7715Adapter {
  return new BaseSepoliaErc7715Adapter(options);
}

export const BaseSepoliaERC7715Adapter = BaseSepoliaErc7715Adapter;
export const BaseSepoliaERC7710Adapter = BaseSepoliaErc7715Adapter;
export const createBaseSepoliaERC7715Adapter = createBaseSepoliaErc7715Adapter;
