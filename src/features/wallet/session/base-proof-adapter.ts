import {
  WALLET_SESSION_ERROR_CODE,
  asProviderFailure,
  isUserConsentRejection,
  WalletSessionError,
} from "./errors";
import { assertNoSecretMaterial } from "./no-secrets";
import {
  applyBaseObservation,
  assertSessionVenue,
  clearAuthorityState,
  createBaseProofSession,
  markBaseProofSigned,
  errorSession,
} from "./session-state";
import type { BaseProofSession, BaseSignedMessage, WalletSessionAdapter } from "./types";
import { normalizeEvmAddress as normalizeDomainEvmAddress } from "../../prism-identity/domain/identifiers";
import { isHexString, bytesToHex, utf8ToBytes } from "../../prism-identity/domain/hex";
import type { Hex } from "../../prism-identity/domain/hex";

/** Minimal EIP-1193 surface. RPC URLs and credentials are intentionally absent. */
export interface BaseProofProvider {
  request(input: { method: string; params?: readonly unknown[] }): Promise<unknown>;
  disconnect?(): Promise<void>;
}

export interface BaseProofSessionAdapterOptions {
  readonly expectedChainId: string;
}

function requireAccountList(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0 || typeof value[0] !== "string") {
    throw new WalletSessionError(WALLET_SESSION_ERROR_CODE.PROVIDER_DISCONNECTED, "base_account_not_authorized");
  }
  return value[0];
}

function requireChainId(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new WalletSessionError(WALLET_SESSION_ERROR_CODE.NETWORK_UNKNOWN, "base_chain_id_unknown");
  }
  return value;
}

function requireSignature(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new WalletSessionError(WALLET_SESSION_ERROR_CODE.PROVIDER_FAILURE, "base_signature_missing");
  }
  return value;
}

export class BaseProofSessionAdapter implements WalletSessionAdapter<BaseProofSession> {
  readonly venue = "base" as const;
  private readonly expectedChainId: string;

  constructor(
    private readonly provider: BaseProofProvider,
    options: BaseProofSessionAdapterOptions,
  ) {
    assertNoSecretMaterial(provider, "base_provider");
    assertNoSecretMaterial(options, "base_adapter_options");
    if (!provider || typeof provider.request !== "function") {
      throw new WalletSessionError(WALLET_SESSION_ERROR_CODE.PROVIDER_FAILURE, "eip1193_request_required");
    }
    if (!options.expectedChainId || options.expectedChainId.trim().length === 0) {
      throw new WalletSessionError(WALLET_SESSION_ERROR_CODE.NETWORK_UNKNOWN, "expected_base_chain_required");
    }
    this.expectedChainId = options.expectedChainId;
  }

  async connect(now: number): Promise<BaseProofSession> {
    let session = createBaseProofSession({ now, expectedChainId: this.expectedChainId });
    try {
      const [accounts, chainId] = await Promise.all([
        this.provider.request({ method: "eth_requestAccounts" }),
        this.provider.request({ method: "eth_chainId" }),
      ]);
      return applyBaseObservation(session, {
        accountAddress: requireAccountList(accounts),
        chainId: requireChainId(chainId),
      }, now);
    } catch (error) {
      const refused = isUserConsentRejection(error);
      const mapped = refused
        ? new WalletSessionError(WALLET_SESSION_ERROR_CODE.CONSENT_DENIED, "base_connection_denied")
        : asProviderFailure(error);
      session = errorSession(
        session,
        mapped.code,
        mapped.detail ?? "base_connect_failed",
        now,
        refused ? "consent-required" : "unknown",
      );
      return session;
    }
  }

  async refresh(session: BaseProofSession, now: number): Promise<BaseProofSession> {
    assertSessionVenue(session, "base");
    try {
      const [accounts, chainId] = await Promise.all([
        this.provider.request({ method: "eth_accounts" }),
        this.provider.request({ method: "eth_chainId" }),
      ]);
      return applyBaseObservation(session, {
        accountAddress: requireAccountList(accounts),
        chainId: requireChainId(chainId),
      }, now);
    } catch (error) {
      const mapped = asProviderFailure(error);
      return errorSession(session, mapped.code, mapped.detail ?? "base_refresh_failed", now);
    }
  }

  /**
   * Request a Base message signature. The signature is returned as an
   * ephemeral proof result and deliberately never written into the session.
   */
  async signMessage(session: BaseProofSession, message: string, now: number): Promise<BaseSignedMessage> {
    assertSessionVenue(session, "base");
    assertNoSecretMaterial({ message }, "base_sign_message");
    if (session.status === "unknown" || session.error !== null) {
      throw new WalletSessionError(WALLET_SESSION_ERROR_CODE.STALE_STATE, "unknown_session_not_sign_ready");
    }
    if (!session.accountAddress) {
      throw new WalletSessionError(WALLET_SESSION_ERROR_CODE.PROVIDER_DISCONNECTED, "base_account_required");
    }
    if (session.network.status !== "expected") {
      throw new WalletSessionError(WALLET_SESSION_ERROR_CODE.NETWORK_MISMATCH, "expected_base_network_required");
    }
    if (session.capability.status !== "supported") {
      throw new WalletSessionError(WALLET_SESSION_ERROR_CODE.CAPABILITY_UNKNOWN, "base_signing_capability_unknown");
    }
    if (typeof message !== "string" || message.length === 0) {
      throw new WalletSessionError(WALLET_SESSION_ERROR_CODE.PROVIDER_FAILURE, "base_message_required");
    }

    try {
      const signature = requireSignature(await this.provider.request({
        method: "personal_sign",
        params: [message, session.accountAddress],
      }));
      assertNoSecretMaterial({ signature }, "base_sign_message_result");
      return { session: markBaseProofSigned(session, now), signature };
    } catch (error) {
      if (error instanceof WalletSessionError) throw error;
      if (isUserConsentRejection(error)) {
        throw new WalletSessionError(WALLET_SESSION_ERROR_CODE.CONSENT_DENIED, "base_signature_denied");
      }
      throw asProviderFailure(error);
    }
  }

  async disconnect(session: BaseProofSession, now: number): Promise<BaseProofSession> {
    assertSessionVenue(session, "base");
    try {
      await this.provider.disconnect?.();
    } catch {
      // Local authority is still cleared if the provider does not acknowledge disconnect.
    }
    return clearAuthorityState(session, now);
  }

  accountChanged(session: BaseProofSession, now: number): BaseProofSession {
    assertSessionVenue(session, "base");
    return clearAuthorityState(session, now);
  }
}

export { BaseProofSessionAdapter as BaseWalletProofAdapter };

// ---------------------------------------------------------------------------
// Stateless public-result facade
// ---------------------------------------------------------------------------

export const BASE_SEPOLIA_CHAIN_ID = 84_532 as const;
export const BASE_SEPOLIA_CHAIN_ID_HEX = "0x14a34" as const;

export const BASE_PROOF_ERROR_CODE = {
  USER_REJECTED: "BASE_PROOF_USER_REJECTED",
  PROVIDER_UNKNOWN: "BASE_PROOF_PROVIDER_UNKNOWN",
  NETWORK_MISMATCH: "BASE_PROOF_NETWORK_MISMATCH",
  ACCOUNT_MISMATCH: "BASE_PROOF_ACCOUNT_MISMATCH",
  PROVIDER_INTERFACE_BLOCKED: "BLOCKED_BY_PROVIDER_INTERFACE",
} as const;

export type Eip1193Provider = BaseProofProvider;
export type BaseProofProviderOperation = "connect" | "observe" | "signMessage";

export interface BasePublicNetworkResult {
  readonly chainId: number;
  readonly chainIdHex: string;
}

export interface BaseConnectedResult extends BasePublicNetworkResult {
  readonly status: "connected";
  readonly account: `0x${string}`;
  readonly chainId: typeof BASE_SEPOLIA_CHAIN_ID;
  readonly chainIdHex: typeof BASE_SEPOLIA_CHAIN_ID_HEX;
}

export interface BaseSignedResult extends BasePublicNetworkResult {
  readonly status: "signed";
  readonly account: `0x${string}`;
  readonly signature: Hex;
  readonly chainId: typeof BASE_SEPOLIA_CHAIN_ID;
  readonly chainIdHex: typeof BASE_SEPOLIA_CHAIN_ID_HEX;
}

export type BaseProofProviderFailure =
  | {
      readonly status: "rejected";
      readonly code: typeof BASE_PROOF_ERROR_CODE.USER_REJECTED;
      readonly operation: BaseProofProviderOperation;
      readonly detail: "user_rejected";
    }
  | {
      readonly status: "unknown";
      readonly code: typeof BASE_PROOF_ERROR_CODE.PROVIDER_UNKNOWN;
      readonly operation: BaseProofProviderOperation;
      readonly detail:
        | "provider_request_failed"
        | "malformed_accounts"
        | "no_connected_account"
        | "malformed_chain_id"
        | "malformed_message"
        | "malformed_signature"
        | "malformed_expected_account";
    }
  | {
      readonly status: "network_mismatch";
      readonly code: typeof BASE_PROOF_ERROR_CODE.NETWORK_MISMATCH;
      readonly operation: BaseProofProviderOperation;
      readonly detail: "wrong_network";
      readonly account?: `0x${string}`;
      readonly expectedChainId: typeof BASE_SEPOLIA_CHAIN_ID;
      readonly actualChainId: number;
      readonly actualChainIdHex: string;
    }
  | {
      readonly status: "account_mismatch";
      readonly code: typeof BASE_PROOF_ERROR_CODE.ACCOUNT_MISMATCH;
      readonly operation: "signMessage";
      readonly detail: "selected_account_mismatch";
      readonly expectedAccount: `0x${string}`;
      readonly actualAccount: `0x${string}`;
      readonly chainId: typeof BASE_SEPOLIA_CHAIN_ID;
      readonly chainIdHex: typeof BASE_SEPOLIA_CHAIN_ID_HEX;
    }
  | {
      readonly status: "blocked";
      readonly code: typeof BASE_PROOF_ERROR_CODE.PROVIDER_INTERFACE_BLOCKED;
      readonly operation: BaseProofProviderOperation;
      readonly detail: "eip1193_request_unavailable";
    };

export type BaseProofProviderResult = BaseConnectedResult | BaseSignedResult | BaseProofProviderFailure;
export type BaseProofResult = BaseProofProviderResult;
export type BaseProofProviderStatus = BaseProofProviderResult["status"];

/** Public-only port consumed by the challenge/proof application orchestration. */
export interface BaseProofProviderPort {
  connect(): Promise<BaseProofProviderResult>;
  observe?(): Promise<BaseProofProviderResult>;
  signMessage(input: { message: string; expectedAccount?: string } | string, expectedAccount?: string): Promise<BaseProofProviderResult>;
}

type Eip1193Method = "eth_requestAccounts" | "eth_accounts" | "eth_chainId" | "personal_sign";

const EIP1193_METHOD_ALLOWLIST: ReadonlySet<string> = new Set<Eip1193Method>([
  "eth_requestAccounts",
  "eth_accounts",
  "eth_chainId",
  "personal_sign",
]);

type PublicRequest = (input: { method: Eip1193Method; params?: readonly unknown[] }) => Promise<unknown>;
type ParsedChain = { readonly chainId: number; readonly chainIdHex: string };

function isAllowedEip1193Method(value: string): value is Eip1193Method {
  return EIP1193_METHOD_ALLOWLIST.has(value);
}

/**
 * EIP-1193 adapter that returns only public account/network/signature facts.
 * It intentionally has no sendTransaction/transaction method and captures only
 * a private, runtime-allowlisted request dispatcher, never a private key.
 */
export class Eip1193BaseProofAdapter implements BaseProofProviderPort {
  // ECMAScript private keeps the provider capability out of the public/runtime
  // object surface; callers can only use the explicitly supported operations.
  #request: PublicRequest | null;

  constructor(provider: Eip1193Provider | null | undefined) {
    assertNoSecretMaterial(provider, "base_public_provider");
    const candidate = provider as { request?: unknown } | null | undefined;
    const request = candidate?.request;
    this.#request = typeof request === "function"
      ? async (input) => {
        if (!isAllowedEip1193Method(input.method)) {
          throw new Error("unsupported_eip1193_method");
        }
        return await (request as (requestInput: { method: Eip1193Method; params?: readonly unknown[] }) => Promise<unknown>)
          .call(provider, input);
      }
      : null;
  }

  async connect(): Promise<BaseProofProviderResult> {
    const accounts = await this.#requestValue("eth_requestAccounts", "connect");
    if (!accounts.ok) return accounts.failure;
    return this.#publicSession(accounts.value, "connect");
  }

  async observe(): Promise<BaseProofProviderResult> {
    const accounts = await this.#requestValue("eth_accounts", "observe");
    if (!accounts.ok) return accounts.failure;
    return this.#publicSession(accounts.value, "observe");
  }

  async signMessage(input: { message: string; expectedAccount?: string } | string, accountOverride?: string): Promise<BaseProofProviderResult> {
    const requestInput = typeof input === "string" ? { message: input, expectedAccount: accountOverride } : input;
    if (typeof requestInput?.message !== "string" || requestInput.message.length === 0) {
      return this.unknown("signMessage", "malformed_message");
    }

    let expectedAccount: `0x${string}` | undefined;
    if (requestInput.expectedAccount !== undefined) {
      const normalized = normalizeDomainEvmAddress(requestInput.expectedAccount);
      if (!normalized || normalized === ZERO_ADDRESS) return this.unknown("signMessage", "malformed_expected_account");
      expectedAccount = normalized;
    }

    const accounts = await this.#requestValue("eth_accounts", "signMessage");
    if (!accounts.ok) return accounts.failure;
    const account = parsePublicAccounts(accounts.value);
    if (account === "malformed") return this.unknown("signMessage", "malformed_accounts");
    if (!account) return this.unknown("signMessage", "no_connected_account");

    const chain = await this.#requestChain("signMessage");
    if (!chain.ok) return chain.failure;
    if (chain.value.chainId !== BASE_SEPOLIA_CHAIN_ID) return this.networkMismatch("signMessage", account, chain.value);

    if (expectedAccount && expectedAccount !== account) {
      return {
        status: "account_mismatch",
        code: BASE_PROOF_ERROR_CODE.ACCOUNT_MISMATCH,
        operation: "signMessage",
        detail: "selected_account_mismatch",
        expectedAccount,
        actualAccount: account,
        chainId: BASE_SEPOLIA_CHAIN_ID,
        chainIdHex: BASE_SEPOLIA_CHAIN_ID_HEX,
      };
    }

    // Keep the human-readable message untouched for the application/server
    // verification path. Only the EIP-1193 wire parameter is hex-encoded.
    const humanReadableMessage = requestInput.message;
    const encodedMessage = bytesToHex(utf8ToBytes(humanReadableMessage));
    const signature = await this.#requestValue("personal_sign", "signMessage", [encodedMessage, account]);
    if (!signature.ok) return signature.failure;
    if (typeof signature.value !== "string" || !isHexString(signature.value) || signature.value.length < 4) {
      return this.unknown("signMessage", "malformed_signature");
    }

    // Re-read the provider binding after the prompt. If account or chain
    // changed while the wallet was signing, discard the signature rather than
    // returning proof tied to stale authority facts.
    const currentAccounts = await this.#requestValue("eth_accounts", "signMessage");
    if (!currentAccounts.ok) return currentAccounts.failure;
    const currentAccount = parsePublicAccounts(currentAccounts.value);
    if (currentAccount === "malformed") return this.unknown("signMessage", "malformed_accounts");
    if (!currentAccount) return this.unknown("signMessage", "no_connected_account");

    const currentChain = await this.#requestChain("signMessage");
    if (!currentChain.ok) return currentChain.failure;
    if (currentChain.value.chainId !== BASE_SEPOLIA_CHAIN_ID) {
      return this.networkMismatch("signMessage", currentAccount, currentChain.value);
    }
    if (currentAccount !== account) {
      return {
        status: "account_mismatch",
        code: BASE_PROOF_ERROR_CODE.ACCOUNT_MISMATCH,
        operation: "signMessage",
        detail: "selected_account_mismatch",
        expectedAccount: expectedAccount ?? account,
        actualAccount: currentAccount,
        chainId: BASE_SEPOLIA_CHAIN_ID,
        chainIdHex: BASE_SEPOLIA_CHAIN_ID_HEX,
      };
    }

    return {
      status: "signed",
      account,
      chainId: BASE_SEPOLIA_CHAIN_ID,
      chainIdHex: BASE_SEPOLIA_CHAIN_ID_HEX,
      signature: signature.value as Hex,
    };
  }

  async #publicSession(rawAccounts: unknown, operation: "connect" | "observe"): Promise<BaseProofProviderResult> {
    const account = parsePublicAccounts(rawAccounts);
    if (account === "malformed") return this.unknown(operation, "malformed_accounts");
    if (!account) return this.unknown(operation, "no_connected_account");
    const chain = await this.#requestChain(operation);
    if (!chain.ok) return chain.failure;
    if (chain.value.chainId !== BASE_SEPOLIA_CHAIN_ID) return this.networkMismatch(operation, account, chain.value);
    return {
      status: "connected",
      account,
      chainId: BASE_SEPOLIA_CHAIN_ID,
      chainIdHex: BASE_SEPOLIA_CHAIN_ID_HEX,
    };
  }

  async #requestChain(operation: BaseProofProviderOperation): Promise<{ ok: true; value: ParsedChain } | { ok: false; failure: BaseProofProviderFailure }> {
    const response = await this.#requestValue("eth_chainId", operation);
    if (!response.ok) return response;
    const parsed = parsePublicChain(response.value);
    return parsed ? { ok: true, value: parsed } : { ok: false, failure: this.unknown(operation, "malformed_chain_id") };
  }

  async #requestValue(
    method: string,
    operation: BaseProofProviderOperation,
    params?: readonly unknown[],
  ): Promise<{ ok: true; value: unknown } | { ok: false; failure: BaseProofProviderFailure }> {
    if (!isAllowedEip1193Method(method)) {
      return { ok: false, failure: this.unknown(operation, "provider_request_failed") };
    }
    if (!this.#request) return { ok: false, failure: this.blocked(operation) };
    try {
      return { ok: true, value: await this.#request({ method, ...(params ? { params } : {}) }) };
    } catch (failure) {
      if (isPublicConsentRejection(failure)) return { ok: false, failure: this.rejected(operation) };
      return { ok: false, failure: this.unknown(operation, "provider_request_failed") };
    }
  }

  private rejected(operation: BaseProofProviderOperation): BaseProofProviderFailure {
    return { status: "rejected", code: BASE_PROOF_ERROR_CODE.USER_REJECTED, operation, detail: "user_rejected" };
  }

  private unknown(operation: BaseProofProviderOperation, detail: BaseProofProviderFailure["detail"] & (
    "provider_request_failed" | "malformed_accounts" | "no_connected_account" | "malformed_chain_id" | "malformed_message" | "malformed_signature" | "malformed_expected_account"
  )): BaseProofProviderFailure {
    return { status: "unknown", code: BASE_PROOF_ERROR_CODE.PROVIDER_UNKNOWN, operation, detail };
  }

  private blocked(operation: BaseProofProviderOperation): BaseProofProviderFailure {
    return { status: "blocked", code: BASE_PROOF_ERROR_CODE.PROVIDER_INTERFACE_BLOCKED, operation, detail: "eip1193_request_unavailable" };
  }

  private networkMismatch(operation: BaseProofProviderOperation, account: `0x${string}`, chain: ParsedChain): BaseProofProviderFailure {
    return {
      status: "network_mismatch",
      code: BASE_PROOF_ERROR_CODE.NETWORK_MISMATCH,
      operation,
      detail: "wrong_network",
      account,
      expectedChainId: BASE_SEPOLIA_CHAIN_ID,
      actualChainId: chain.chainId,
      actualChainIdHex: chain.chainIdHex,
    };
  }
}

export { Eip1193BaseProofAdapter as BaseProofAdapter, Eip1193BaseProofAdapter as BaseProofProviderAdapter };

export function createEip1193BaseProofAdapter(provider: Eip1193Provider | null | undefined): Eip1193BaseProofAdapter {
  return new Eip1193BaseProofAdapter(provider);
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function parsePublicAccounts(value: unknown): `0x${string}` | "malformed" | null {
  if (!Array.isArray(value)) return "malformed";
  if (value.length === 0) return null;
  const account = typeof value[0] === "string" ? normalizeDomainEvmAddress(value[0]) : null;
  if (!account || account === ZERO_ADDRESS) return "malformed";
  return account;
}

function parsePublicChain(value: unknown): ParsedChain | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!/^0x[0-9a-f]+$/i.test(raw) && !/^[0-9]+$/.test(raw)) return null;
  try {
    const chainId = BigInt(raw);
    if (chainId <= 0n || chainId > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return { chainId: Number(chainId), chainIdHex: `0x${chainId.toString(16)}` };
  } catch {
    return null;
  }
}

function isPublicConsentRejection(value: unknown): boolean {
  const code = (value as { code?: unknown })?.code;
  if (code === 4001 || code === "4001") return true;
  if (isUserConsentRejection(value)) return true;
  const message = (value as { message?: unknown })?.message;
  return typeof message === "string" && /rejected|denied|cancelled|canceled/i.test(message);
}
