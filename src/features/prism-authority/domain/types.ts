import type { PrismId } from "../../prism-identity/domain/identifiers";

export type { PrismId } from "../../prism-identity/domain/identifiers";

export const AUTHORITY_STATUSES = ["ACTIVE", "REVOKED"] as const;
export type AuthorityStatus = (typeof AUTHORITY_STATUSES)[number];

export type AuthoritySubject =
  | { readonly type: "OWNER"; readonly account: string }
  | { readonly type: "SESSION_KEY"; readonly publicKey: string };

export interface Authority {
  readonly id: string;
  readonly endpointId: string;
  readonly subject: AuthoritySubject;
  readonly status: AuthorityStatus;
}

export const SESSION_GRANT_STATUSES = ["CREATED", "ACTIVE", "EXPIRED", "REVOKED", "EXHAUSTED"] as const;
export type SessionGrantStatus = (typeof SESSION_GRANT_STATUSES)[number];

export interface SessionTokenLimit {
  readonly token: string;
  readonly maxAmount: bigint;
}

/** Provider-neutral per-asset spend bounds. Amounts are integer base units. */
export interface SessionSpendLimit {
  readonly asset: string;
  readonly maxPerCall: bigint;
  readonly maxTotal: bigint;
}

/** Replay identity is supplied by the caller for each action and consumed once. */
export interface SessionReplayProtection {
  readonly mode: "unique-key";
  readonly namespace: string;
}

export interface SessionGrantScope {
  /** Target contracts that the delegate may call. */
  readonly contracts?: readonly string[];
  /** Function selectors that the delegate may use. */
  readonly selectors?: readonly string[];
  /** Legacy total token limits retained for compatibility with the v0 domain. */
  readonly tokenLimits?: readonly SessionTokenLimit[];
  /** Provider-neutral per-call and aggregate asset limits. */
  readonly spendLimits?: readonly SessionSpendLimit[];
  /** Maximum number of executions across the grant lifetime. */
  readonly maxCalls?: number;
}

export interface SessionGrantUsage {
  readonly calls: number;
  /** Asset-keyed accounting. The old name is retained for wire compatibility. */
  readonly spentByToken: Readonly<Record<string, bigint>>;
  readonly consumedReplayKeys?: readonly string[];
}

export interface SessionGrant {
  readonly id: string;
  readonly prismId: PrismId;
  readonly endpointId: string;
  readonly delegatePublicKey: string;
  /** Optional on the legacy shape, required by `createSecureSessionGrant`. */
  readonly chainId?: number;
  /** Optional on the legacy shape, required by `createSecureSessionGrant`. */
  readonly account?: string;
  /** Optional on the legacy shape, required by `createSecureSessionGrant`. */
  readonly delegateAccount?: string;
  /** Optional on the legacy shape, required by `createSecureSessionGrant`. */
  readonly replay?: SessionReplayProtection;
  readonly scope: SessionGrantScope;
  readonly validFrom: number;
  readonly validUntil: number;
  readonly status: SessionGrantStatus;
  /** Runtime authorization accounting; absent only on untrusted external input. */
  readonly usage?: SessionGrantUsage;
}

/** Fully-bound grant accepted by a venue adapter. */
export type SecureSessionGrant = SessionGrant & {
  readonly chainId: number;
  readonly account: string;
  readonly delegateAccount: string;
  readonly replay: SessionReplayProtection;
  readonly scope: SessionGrantScope & {
    readonly contracts: readonly string[];
    readonly selectors: readonly string[];
    readonly spendLimits: readonly SessionSpendLimit[];
    readonly maxCalls: number;
  };
  readonly usage: SessionGrantUsage & { readonly consumedReplayKeys: readonly string[] };
};

export interface CreateSessionGrantInput {
  readonly id: string;
  readonly prismId: PrismId;
  readonly endpointId: string;
  readonly delegatePublicKey: string;
  readonly chainId?: number;
  readonly account?: string;
  readonly delegateAccount?: string;
  readonly replay?: SessionReplayProtection;
  readonly scope: SessionGrantScope;
  readonly validFrom: number;
  readonly validUntil: number;
}

export interface SessionAction {
  readonly contract: string;
  readonly selector: string;
  readonly token?: string;
  readonly asset?: string;
  readonly amount?: bigint;
  readonly chainId?: number;
  readonly account?: string;
  readonly delegateAccount?: string;
  readonly replayKey?: string;
  readonly now: number;
}

export interface SessionGrantTransitionInput {
  readonly to: SessionGrantStatus;
  readonly now?: number;
}
