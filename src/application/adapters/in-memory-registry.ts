// In-memory Registry adapters for tests — implements RegistryReadPort +
// StarknetSubmitPort with minimal honest semantics (no fake receipts).
// Submitted != completed is preserved: submit* returns txHash and
// records operation as SUBMITTED; completion requires reconciliation.
// No chain liveness is simulated beyond txHash generation.

import type { Hex } from "../../features/prism-operations/domain/operation";
import type { RegistryReadPort, StarknetSubmitPort } from "../ports";

// Felt-bounded digest mapping for consumed_digests parity with Starknet registry.
// In-memory double must mimic onchain felt keying: a full 256-bit keccak that
// maps to same felt as already-consumed should be rejected as replay (ERR-007).
const DIGEST_MASK_250 = (1n << 250n) - 1n;
function toDigestKey(digest: Hex, mode: "v1" | "v2"): string {
  if (!/^0x[0-9a-fA-F]{64}$/.test(digest)) return digest.toLowerCase();
  const v = BigInt(digest);
  if (mode === "v2") return `0x${v.toString(16).padStart(64, "0")}`.toLowerCase();
  const masked = v <= DIGEST_MASK_250 ? v : v & DIGEST_MASK_250;
  return `0x${masked.toString(16).padStart(64, "0")}`.toLowerCase();
}

function randomTxHash(seed: string): Hex {
  // Deterministic pseudo-hash for tests — 64 hex chars.
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const hex = h.toString(16).padStart(8, "0");
  const repeated = (hex + hex.repeat(7)).slice(0, 64);
  return `0x${repeated}` as Hex;
}

export class InMemoryRegistry implements RegistryReadPort, StarknetSubmitPort {
  private readonly identities = new Map<string, { controller: string; createdAtBlock: number; version: number }>();
  private readonly bindings = new Map<string, { status: "ACTIVE" | "REVOKED" }>();
  private readonly consumedDigests = new Set<string>();
  private digestMode: "v1" | "v2" = "v1";
  private failNextSubmitWith?: Error;
  private txCounter = 1;

  constructor(initial?: Array<{ prismId: string; controller: string }>) {
    if (initial) {
      for (const i of initial) this.identities.set(i.prismId, { controller: i.controller.toLowerCase(), createdAtBlock: 1, version: 0 });
    }
  }

  get registryVersion(): "v1" | "v2" {
    return this.digestMode;
  }

  setDigestMode(mode: "v1" | "v2"): void {
    this.digestMode = mode;
  }

  seedIdentity(prismId: string, controller: string): void {
    this.identities.set(prismId, { controller: controller.toLowerCase(), createdAtBlock: 1, version: 0 });
  }

  seedBinding(prismId: string, venue: string, executionAccount: string, digest?: Hex): void {
    const key = bindingKey(prismId, venue, executionAccount);
    this.bindings.set(key, { status: "ACTIVE" });
    if (digest) this.consumedDigests.add(toDigestKey(digest, this.digestMode));
  }

  // RegistryReadPort
  async getIdentity(prismId: string): Promise<{ controller: string; createdAtBlock: number; version: number } | null> {
    const rec = this.identities.get(prismId);
    return rec ? { ...rec } : null;
  }

  async resolve(prismId: string, venue: string): Promise<{ executionAccount: string | null; watermark: number }> {
    // Find first ACTIVE binding for (prismId, venue)
    for (const [k, v] of this.bindings.entries()) {
      const [p, ven, acc] = k.split("|");
      if (p === prismId && ven === venue.toUpperCase() && v.status === "ACTIVE") {
        return { executionAccount: acc, watermark: 100 };
      }
    }
    return { executionAccount: null, watermark: 100 };
  }

  async getBinding(prismId: string, venue: string, executionAccount: string): Promise<{ status: "ACTIVE" | "REVOKED" | null }> {
    const rec = this.bindings.get(bindingKey(prismId, venue, executionAccount));
    return rec ? { status: rec.status } : { status: null };
  }

  async isDigestConsumed(digest: Hex): Promise<boolean> {
    return this.consumedDigests.has(toDigestKey(digest, this.digestMode));
  }

  // StarknetSubmitPort — fail-closed on dependency error injection.
  async submitCreateIdentity(input: { operationId: string; controllerAddress: string }): Promise<{ txHash: Hex }> {
    if (this.failNextSubmitWith) {
      const e = this.failNextSubmitWith;
      this.failNextSubmitWith = undefined;
      throw e;
    }
    const txHash = randomTxHash(`create:${input.operationId}:${this.txCounter++}`);
    // Honest: do NOT mark identity as created synchronously as completed — caller
    // transitions operation to submitted only; identity creation becomes visible
    // only after reconciliation (tests can call seedIdentity to simulate).
    return { txHash };
  }

  async submitBind(input: { operationId: string; prismId: string; venue: string; executionAccount: string; proofDigest: Hex; controllerAddress: string }): Promise<{ txHash: Hex }> {
    if (this.failNextSubmitWith) {
      const e = this.failNextSubmitWith;
      this.failNextSubmitWith = undefined;
      throw e;
    }
    // Enforce controller-only and digest single-use as registry would (INV-SYS-002/004).
    const identity = this.identities.get(input.prismId);
    if (!identity) {
      const err = new Error("identity_not_found");
      (err as unknown as { code?: string }).code = "ERR-002";
      throw err;
    }
    if (identity.controller !== input.controllerAddress.toLowerCase()) {
      const err = new Error("not_controller");
      (err as unknown as { code?: string }).code = "ERR-004";
      throw err;
    }
    if (this.consumedDigests.has(toDigestKey(input.proofDigest, this.digestMode))) {
      const err = new Error("proof_digest_already_consumed");
      (err as unknown as { code?: string }).code = "ERR-007";
      throw err;
    }
    const bKey = bindingKey(input.prismId, input.venue, input.executionAccount);
    const existing = this.bindings.get(bKey);
    if (existing?.status === "ACTIVE") {
      const err = new Error("binding_already_active");
      (err as unknown as { code?: string }).code = "ERR-008";
      throw err;
    }
    const txHash = randomTxHash(`bind:${input.operationId}:${this.txCounter++}`);
    // Do not mutate bindings until reconciliation — preserve submitted != completed.
    // Record digest as pending-consumed? No — digest consumption is onchain atomic
    // at bind tx, so we defer until reconciliation. Tests that need active state
    // must seed or drive reconciliation manually.
    return { txHash };
  }

  async submitRevoke(input: { operationId: string; prismId: string; venue: string; executionAccount: string; controllerAddress: string }): Promise<{ txHash: Hex }> {
    if (this.failNextSubmitWith) {
      const e = this.failNextSubmitWith;
      this.failNextSubmitWith = undefined;
      throw e;
    }
    const identity = this.identities.get(input.prismId);
    if (!identity) {
      const err = new Error("identity_not_found");
      (err as unknown as { code?: string }).code = "ERR-002";
      throw err;
    }
    if (identity.controller !== input.controllerAddress.toLowerCase()) {
      const err = new Error("not_controller");
      (err as unknown as { code?: string }).code = "ERR-004";
      throw err;
    }
    const txHash = randomTxHash(`revoke:${input.operationId}:${this.txCounter++}`);
    return { txHash };
  }

  injectDependencyFailure(error: Error): void {
    this.failNextSubmitWith = error;
  }

  // Test helper to simulate reconciliation making a bind visible
  applyBindForTest(prismId: string, venue: string, executionAccount: string, digest: Hex): void {
    this.bindings.set(bindingKey(prismId, venue, executionAccount), { status: "ACTIVE" });
    this.consumedDigests.add(toDigestKey(digest, this.digestMode));
  }
  applyRevokeForTest(prismId: string, venue: string, executionAccount: string): void {
    this.bindings.set(bindingKey(prismId, venue, executionAccount), { status: "REVOKED" });
  }
}

function bindingKey(prismId: string, venue: string, executionAccount: string): string {
  return `${prismId}|${venue.toUpperCase()}|${executionAccount.toLowerCase()}`;
}
