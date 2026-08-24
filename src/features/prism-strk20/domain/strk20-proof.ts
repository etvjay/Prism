// Proof boundary for STRK20 Wallet API route.
// Authority: @starknet-io/types-js 0.10.3 STRK20_CALL_AND_PROOF + starknet.js 10.4.0 WalletAccountV6 strk20PrepareInvoke.
// When simulate=true, proof fields are empty but present; submission requires non-empty proof.

import { Strk20Error, STRK20_ERROR_CODE } from "./errors";
import { assertNoViewingKey } from "./privacy-guard";

export type Hex = `0x${string}`;

export interface Strk20Proof {
  readonly data: string;
  readonly output: readonly string[];
  readonly proof_facts: readonly string[];
}

export interface Strk20Call {
  readonly contractAddress: Hex;
  readonly entrypoint: string;
  readonly calldata: readonly string[];
}

export interface Strk20CallAndProof {
  readonly call: Strk20Call;
  readonly proof: Strk20Proof;
}

/**
 * An empty proof is returned by simulate=true prepare. It is not submittable.
 * Empty = data === "" && output.length===0 && proof_facts.length===0
 */
export function isEmptyProof(proof: Strk20Proof): boolean {
  return proof.data === "" && proof.output.length === 0 && proof.proof_facts.length === 0;
}

export function isValidProof(proof: Strk20Proof): boolean {
  return !isEmptyProof(proof);
}

export function assertProofPresent(proof: Strk20Proof, context = "proof"): void {
  assertNoViewingKey(proof, context);
  if (isEmptyProof(proof)) {
    throw new Strk20Error(STRK20_ERROR_CODE.PROOF_REQUIRED, `empty_proof_in_${context}_simulate_true_not_submittable`);
  }
}

export function assertNotEmptyProofForSubmission(callAndProof: Strk20CallAndProof): void {
  assertNoViewingKey(callAndProof, "callAndProof");
  if (isEmptyProof(callAndProof.proof)) {
    throw new Strk20Error(STRK20_ERROR_CODE.PROOF_REQUIRED, "simulate_proof_must_not_be_submitted");
  }
}

/**
 * Build an empty proof placeholder for simulation/preflight responses.
 */
export function makeEmptyProof(): Strk20Proof {
  return { data: "", output: [], proof_facts: [] };
}

/**
 * Build a non-empty stub proof for test doubles (X2).
 */
export function makeStubProof(overrides: Partial<Strk20Proof> = {}): Strk20Proof {
  return {
    data: overrides.data ?? "0x010203",
    output: overrides.output ?? ["0x1", "0x2"],
    proof_facts: overrides.proof_facts ?? ["0xabc"],
  };
}

export function makeSimulatedCallAndProof(call: Strk20Call): Strk20CallAndProof {
  return { call, proof: makeEmptyProof() };
}

export function makeReadyCallAndProof(call: Strk20Call, proof: Strk20Proof = makeStubProof()): Strk20CallAndProof {
  if (isEmptyProof(proof)) throw new Strk20Error(STRK20_ERROR_CODE.PROOF_REQUIRED, "ready_proof_must_not_be_empty");
  return { call, proof };
}
