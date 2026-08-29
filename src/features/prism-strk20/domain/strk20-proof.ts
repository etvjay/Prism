// Proof boundary for STRK20 Wallet API route.
// Authority: @starknet-io/types-js 0.10.3 STRK20_CALL_AND_PROOF + starknet.js 10.4.0 WalletAccountV6 strk20PrepareInvoke.
// When simulate=true, proof fields are empty but present; submission requires non-empty proof.

import { Strk20Error, STRK20_ERROR_CODE } from "./errors";
import { assertNoViewingKey } from "./privacy-guard";

export type Hex = `0x${string}`;

/** Exact WalletAccountV6 / wallet_addInvokeTransaction call shape. */
export interface Strk20Call {
  readonly contract_address: Hex;
  readonly entry_point: string;
  readonly calldata: readonly string[];
}

export interface Strk20Proof {
  readonly data: string;
  readonly output: readonly string[];
  readonly proof_facts: readonly string[];
}

export interface Strk20CallAndProof {
  readonly call: Strk20Call;
  readonly proof: Strk20Proof;
}

function hasProofShape(value: unknown): value is Strk20Proof {
  if (typeof value !== "object" || value === null) return false;
  const proof = value as Record<string, unknown>;
  return (
    typeof proof.data === "string" &&
    Array.isArray(proof.output) &&
    proof.output.every((item) => typeof item === "string") &&
    Array.isArray(proof.proof_facts) &&
    proof.proof_facts.every((item) => typeof item === "string")
  );
}

function hasCallShape(value: unknown): value is Strk20Call {
  if (typeof value !== "object" || value === null) return false;
  const call = value as Record<string, unknown>;
  return (
    typeof call.contract_address === "string" &&
    typeof call.entry_point === "string" &&
    Array.isArray(call.calldata) &&
    call.calldata.every((item) => typeof item === "string")
  );
}

export function assertProofShape(value: unknown, context = "proof"): asserts value is Strk20Proof {
  assertNoViewingKey(value, context);
  if (!hasProofShape(value)) {
    throw new Strk20Error(STRK20_ERROR_CODE.PROOF_REQUIRED, `malformed_proof_in_${context}`);
  }
}

export function assertCallAndProofShape(value: unknown, context = "call_and_proof"): asserts value is Strk20CallAndProof {
  assertNoViewingKey(value, context);
  if (typeof value !== "object" || value === null) {
    throw new Strk20Error(STRK20_ERROR_CODE.DEPENDENCY_FAILURE, `malformed_call_and_proof_in_${context}`);
  }
  const pair = value as Record<string, unknown>;
  if (!hasCallShape(pair.call)) {
    throw new Strk20Error(STRK20_ERROR_CODE.DEPENDENCY_FAILURE, `malformed_call_in_${context}`);
  }
  assertProofShape(pair.proof, `${context}.proof`);
}

/**
 * An empty proof is returned by simulate=true prepare. It is not submittable.
 * Malformed proof material is never considered valid or submittable.
 */
export function isEmptyProof(proof: unknown): proof is Strk20Proof {
  return hasProofShape(proof) && proof.data === "" && proof.output.length === 0 && proof.proof_facts.length === 0;
}

export function isValidProof(proof: unknown): proof is Strk20Proof {
  return hasProofShape(proof) && !isEmptyProof(proof);
}

export function assertProofPresent(proof: unknown, context = "proof"): asserts proof is Strk20Proof {
  assertProofShape(proof, context);
  if (isEmptyProof(proof)) {
    throw new Strk20Error(STRK20_ERROR_CODE.PROOF_REQUIRED, `empty_proof_in_${context}_simulate_true_not_submittable`);
  }
}

export function assertNotEmptyProofForSubmission(callAndProof: unknown): asserts callAndProof is Strk20CallAndProof {
  assertCallAndProofShape(callAndProof, "callAndProof");
  if (isEmptyProof(callAndProof.proof)) {
    throw new Strk20Error(STRK20_ERROR_CODE.PROOF_REQUIRED, "simulate_proof_must_not_be_submitted");
  }
}

/** Build an empty proof placeholder for simulation/preflight responses. */
export function makeEmptyProof(): Strk20Proof {
  return { data: "", output: [], proof_facts: [] };
}

/** Build a non-empty stub proof for test doubles (X2). */
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
  assertCallAndProofShape({ call, proof }, "ready_call_and_proof");
  if (isEmptyProof(proof)) throw new Strk20Error(STRK20_ERROR_CODE.PROOF_REQUIRED, "ready_proof_must_not_be_empty");
  return { call, proof };
}
