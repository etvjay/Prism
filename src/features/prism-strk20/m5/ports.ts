// Provider-injected ports for M5 Vesu E2E runner.
// The dapp never holds viewing keys; wallet owns keys/notes/proving.
// All ports are narrow, wallet-mediated, and labeled X2 when doubled.

import type { Hex } from "../domain/receipt";

export type ScreeningOutcome = "approved" | "rejected" | "unavailable";

export interface CapabilityPort {
  supportedWalletApi(): Promise<string[]>;
  supportedSpecs(): Promise<string[]>;
  requestChainId(): Promise<string>;
}

export interface RegistrationPort {
  // null means the wallet/API does not expose registration readback; the runner
  // must then rely on the wallet's prepare/submit result without claiming that
  // registration was independently observed.
  isRegistered(): Promise<boolean | null>;
}

export interface FeePort {
  getFeeAmount(): Promise<{ fee: bigint; blockNumber: number | null }>;
}

// STRK20 actions — exact shape per @starknet-io/types-js 0.10.3
export type Strk20TransferAction = {
  type: "transfer";
  token: string;
  amount: string | "OPEN";
  recipient: string;
};
export type Strk20InvokeAction = {
  type: "invoke";
  contract: string;
  calldata: string[];
};
export type Strk20Action = Strk20TransferAction | Strk20InvokeAction;

export interface Strk20CallAndProof {
  call: { contract_address: string; entry_point: string; calldata: string[] };
  proof: { data: string; output: string[]; proof_facts: string[] };
}

export interface SubmissionPort {
  // simulate=true → empty proof, non-submittable (fee estimation / calldata shape)
  strk20PrepareInvoke(actions: Strk20Action[], simulate: boolean): Promise<Strk20CallAndProof>;
  // wallet-side proving + relay — long-running (SNIP-36)
  strk20InvokeTransaction(actions: Strk20Action[]): Promise<{ transaction_hash: Hex }>;
  // alternative path where prepare returns call+real proof and dapp submits
  executeWithProof?(calls: unknown, proof?: unknown): Promise<{ transaction_hash: Hex }>;
}

export interface ReceiptPort {
  getReceipt(txHash: Hex): Promise<{
    executionStatus: "SUCCEEDED" | "REVERTED" | "RECEIVED" | string;
    finalityStatus?: string;
    blockNumber: number | null;
    events: { address: string; keys: string[]; data?: string[] }[];
    executionResources?: unknown;
  } | null>;
  // Public ERC20 readback for conservation (helper balances)
  callBalance?(token: string, account: string): Promise<bigint>;
  // Alternative: getBlockNumber for polling
  getBlockNumber?(): Promise<number>;
}

export interface ValidatorPort {
  // Upstream hub validator — when configured, must return ok/pool/mine
  validate(hash: Hex): Promise<{ ok: boolean; pool: boolean; mine: boolean; reason?: string }>;
}

// Complete provider shape injected into runner
export interface M5Provider extends CapabilityPort, RegistrationPort, FeePort, SubmissionPort, ReceiptPort {
  // Wallet address for transfer recipient (self)
  getAddress(): Promise<string> | string;
  // For testing: allow provider to declare its environment
  _isMock?: boolean;
}

// Independent RPC readback — public/read-only, no secrets
export interface IndependentRpcReader {
  getTransactionReceipt(txHash: Hex): Promise<{
    executionStatus: string;
    finalityStatus?: string;
    blockNumber: number | null;
    events: { address: string; keys: string[] }[];
  } | null>;
  getBalance(token: string, account: string): Promise<bigint>;
  getBlockNumber?(): Promise<number>;
}
