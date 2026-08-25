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

export interface SessionGrantScope {
  readonly contracts?: readonly string[];
  readonly selectors?: readonly string[];
  readonly tokenLimits?: readonly SessionTokenLimit[];
  readonly maxCalls?: number;
}

export interface SessionGrantUsage {
  readonly calls: number;
  readonly spentByToken: Readonly<Record<string, bigint>>;
}

export interface SessionGrant {
  readonly id: string;
  readonly prismId: PrismId;
  readonly endpointId: string;
  readonly delegatePublicKey: string;
  readonly scope: SessionGrantScope;
  readonly validFrom: number;
  readonly validUntil: number;
  readonly status: SessionGrantStatus;
  /** Runtime authorization accounting; absent only on untrusted external input. */
  readonly usage?: SessionGrantUsage;
}

export interface CreateSessionGrantInput {
  readonly id: string;
  readonly prismId: PrismId;
  readonly endpointId: string;
  readonly delegatePublicKey: string;
  readonly scope: SessionGrantScope;
  readonly validFrom: number;
  readonly validUntil: number;
}

export interface SessionAction {
  readonly contract: string;
  readonly selector: string;
  readonly token?: string;
  readonly amount?: bigint;
  readonly now: number;
}

export interface SessionGrantTransitionInput {
  readonly to: SessionGrantStatus;
  readonly now?: number;
}
