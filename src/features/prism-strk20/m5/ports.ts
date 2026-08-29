// Provider-injected ports for M5 Vesu E2E runner.
// The dapp never holds viewing keys; wallet owns keys/notes/proving.
// All ports are narrow, wallet-mediated, and labeled X2 when doubled.

import type { Hex } from "../domain/receipt";
import type { ShadowAccountObservation } from "../domain/shadow-account";
import type {
  STRK20_ACTION,
  STRK20_CALL_AND_PROOF,
  STRK20_INVOKE_ACTION,
  STRK20_TRANSFER_ACTION,
} from "@starknet-io/types-js";

// These aliases intentionally track the pinned @starknet-io/types-js 0.10.3
// STRK20_ACTION / STRK20_CALL_AND_PROOF declarations instead of maintaining a
// second, looser action union.
export type Strk20Action = STRK20_ACTION;
export type Strk20InvokeAction = STRK20_INVOKE_ACTION;
export type Strk20TransferAction = STRK20_TRANSFER_ACTION;
export type Strk20CallAndProof = STRK20_CALL_AND_PROOF;
export interface CapabilityPort {
  supportedWalletApi(): Promise<string[]>;
  supportedSpecs(): Promise<string[]>;
  requestChainId(): Promise<string>;
  /** Optional metadata-only provider observation; never required for M5. */
  observeShadowAccountCapability?(): Promise<ShadowAccountObservation | null | undefined>;
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

export interface SubmissionPort {
  // simulate=true → empty proof, non-submittable (fee estimation / calldata shape)
  strk20PrepareInvoke(actions: Strk20Action[], simulate: boolean): Promise<Strk20CallAndProof>;
  // wallet-side proving + relay — long-running (SNIP-36)
  strk20InvokeTransaction(actions: Strk20Action[]): Promise<{ transaction_hash: Hex }>;
  // alternative path where prepare returns call+real proof and dapp submits
  executeWithProof?(calls: unknown, proof?: unknown): Promise<{ transaction_hash: Hex }>;
}

export interface M5TransactionObservation {
  /** Provider-returned identity, when the source exposes it. */
  transactionHash?: string;
  calldata: string[];
}

export interface M5VesuDepositObservation {
  contractAddress: string;
  receiver: string;
  assets: bigint;
  shares?: bigint;
}

export interface M5OpenNoteObservation {
  noteId: string;
  token: string;
  amount: bigint;
}

export interface M5MaturityObservationPort {
  confirmedBlock: number;
  maturityTargetBlock: number;
  currentBlock: number;
  balanceConsent: "granted" | "denied" | "unknown";
}

export interface M5ConservationObservation {
  inputDelivered: bigint;
  vTokenShares: bigint;
  noteAmount: bigint;
  helperStrkBalance: bigint;
  helperVTokenBalance: bigint;
}

export interface ReceiptPort {
  getReceipt(txHash: Hex): Promise<{
    transactionHash?: string;
    executionStatus: "SUCCEEDED" | "REVERTED" | "RECEIVED" | string;
    finalityStatus?: string;
    blockNumber: number | null;
    senderAddress?: string | null;
    events: { address: string; keys: string[]; data?: string[] }[];
    executionResources?: unknown;
  } | null>;
  // Public ERC20 readback for conservation (helper balances)
  callBalance?(token: string, account: string): Promise<bigint>;
  // Optional first-party JSON-RPC transaction read. No parser is assumed for
  // the privacy pool's nested calldata; the runner only checks helper address
  // presence numerically.
  getTransaction?(txHash: Hex): Promise<M5TransactionObservation | null>;
  // Optional explicit adapters. They are not implemented by WalletAccountV6
  // unless a first-party surface supplies the corresponding fact.
  observeVesuDeposit?(txHash: Hex): Promise<M5VesuDepositObservation | null>;
  observeOpenNote?(txHash: Hex): Promise<M5OpenNoteObservation | null>;
  observeMaturity?(txHash: Hex): Promise<M5MaturityObservationPort | null>;
  observeConservation?(txHash: Hex): Promise<M5ConservationObservation | null>;
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
  /** Optional stable label supplied by the caller to make the second path explicit. */
  readonly sourceId?: string;
  getTransactionReceipt(txHash: Hex): Promise<{
    transactionHash?: string;
    executionStatus: string;
    finalityStatus?: string;
    blockNumber: number | null;
    senderAddress?: string | null;
    events: { address: string; keys: string[]; data?: string[] }[];
  } | null>;
  getBalance(token: string, account: string): Promise<bigint>;
  getTransaction?(txHash: Hex): Promise<M5TransactionObservation | null>;
  getBlockNumber?(): Promise<number>;
}
