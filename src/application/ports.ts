// Typed application ports — replaceable adapters boundary.
// Domain imports remain free of web/DB/RPC; ports express the only effectful
// surface the application layer needs (challenge store, operation store,
// Starknet registry read, Starknet submission). No HTTP deps.

import type { Hex, OperationState } from "../features/prism-operations/domain/operation";
import type { StoredOwnershipChallenge } from "../features/prism-identity/domain/ports";

// ---------------------------------------------------------------------------
// Challenge ports re-exported for wiring
// ---------------------------------------------------------------------------
export type { ChallengeCrypto, Clock, OwnershipProofStore, SmartWalletSignatureChecker } from "../features/prism-identity/domain/ports";
export type { OperationStore } from "../features/prism-operations/domain/operation-store";

// ---------------------------------------------------------------------------
// Starknet registry / submission boundary
// ---------------------------------------------------------------------------

/** Read-only registry view — canonical source (AUTHORITY_MATRIX A1/A6). */
export interface RegistryReadPort {
  /** Returns controller for prismId or null if not found (ERR-010 family). Never throws for not-found. */
  getIdentity(prismId: string): Promise<{ controller: string; createdAtBlock: number; version: number } | null>;
  /** Resolve returns ACTIVE account or null (= NO_ACTIVE_DESTINATION). */
  resolve(prismId: string, venue: string): Promise<{ executionAccount: string | null; watermark: number }>;
  /** Binding existence check (for revoke idempotence / ERR-009 vs ERR-011). */
  getBinding(prismId: string, venue: string, executionAccount: string): Promise<{ status: "ACTIVE" | "REVOKED" | null }>;
  /** Digest single-use check — true if already consumed onchain (INV-SYS-004). */
  isDigestConsumed(digest: Hex): Promise<boolean>;
}

/** Chain submission — the only place an operation's txHash is minted.
 *  The port never marks submitted as completed; it returns the txHash and
 *  the operation lifecycle advances via reconciliation (INV-SYS-005). */
export interface StarknetSubmitPort {
  /** Explicit marker for local-only adapters. Production factories reject marked test doubles. */
  readonly isTestDouble?: boolean;
  /** Concrete adapters declare their ABI; test doubles may omit this only when the factory receives explicit metadata. */
  readonly registryVersion?: "v1" | "v2";
  /** Concrete adapters declare the exact registry they invoke; test doubles may omit this only when the factory receives explicit metadata. */
  readonly registryAddress?: string;
  /** Submits create_identity; returns txHash. May throw dependency error (ERR-021). */
  submitCreateIdentity(input: { operationId: string; controllerAddress: string }): Promise<{ txHash: Hex }>;
  /** Submits bind_execution_identity; returns txHash. */
  submitBind(input: { operationId: string; prismId: string; venue: string; executionAccount: string; proofDigest: Hex; controllerAddress: string }): Promise<{ txHash: Hex }>;
  /** Submits revoke_binding; returns txHash. */
  submitRevoke(input: { operationId: string; prismId: string; venue: string; executionAccount: string; controllerAddress: string }): Promise<{ txHash: Hex }>;
}

/**
 * Production retry/factory guard: only a concrete adapter with explicit
 * registry metadata is allowed to be treated as a Starknet submitter. An
 * injected object may still be used by tests, but it must remain explicit and
 * cannot silently become a production chain boundary.
 */
export function isConcreteStarknetSubmitAdapter(port: StarknetSubmitPort | undefined | null): boolean {
  if (!port || port.isTestDouble === true) return false;
  return (
    typeof port.registryAddress === "string" &&
    port.registryAddress.trim().length > 0 &&
    (port.registryVersion === "v1" || port.registryVersion === "v2") &&
    typeof port.submitCreateIdentity === "function" &&
    typeof port.submitBind === "function" &&
    typeof port.submitRevoke === "function"
  );
}

// ---------------------------------------------------------------------------
// Id helpers
// ---------------------------------------------------------------------------

export interface IdGenerator {
  generateOperationId(): string;
}
