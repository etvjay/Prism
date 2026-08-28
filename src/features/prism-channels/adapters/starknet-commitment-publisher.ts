// Typed Starknet commitment publisher boundary for PrismChannel.
//
// This adapter deliberately does not construct an Account, read a key, or
// invent a Cairo ABI. A caller must inject an accepted contract adapter that
// owns Starknet RPC/signing and exposes an independent read path. Until that
// provider is supplied and observed, the channel remains X2.

import {
  CHANNEL_STATUSES,
  type ChannelStatus,
  type Hex,
} from "../domain/channel";
import {
  CHANNEL_ERROR_CODE,
  PrismChannelError,
} from "../domain/errors";
import {
  STARKNET_CHANNEL_ANCHOR_ABI_VERSION,
  type StarknetAnchorPayload,
  type StarknetAnchorSubmission,
  type StarknetCommitmentContractPort,
  type StarknetCommitmentPublisherPort,
} from "../domain/ports";
import { normalizeStarknetContractAddress } from "../../prism-identity/domain/starknet-boundary";

const FULL_COMMITMENT = /^0x[0-9a-fA-F]{64}$/;
const TX_HASH = /^0x[0-9a-fA-F]{1,64}$/;

function assertCommitment(value: unknown, label: string): asserts value is Hex {
  if (typeof value !== "string" || !FULL_COMMITMENT.test(value)) {
    throw new PrismChannelError(CHANNEL_ERROR_CODE.ANCHOR_INCONSISTENT, `${label}_must_be_32_byte_commitment`);
  }
}

function assertSafeAnchorMetadata(input: Pick<StarknetAnchorPayload, "version" | "observedAt" | "state">): void {
  if (!Number.isSafeInteger(input.version) || input.version <= 0) {
    throw new PrismChannelError(CHANNEL_ERROR_CODE.ANCHOR_INCONSISTENT, "anchor_version_invalid");
  }
  if (!Number.isSafeInteger(input.observedAt) || input.observedAt < 0) {
    throw new PrismChannelError(CHANNEL_ERROR_CODE.ANCHOR_INCONSISTENT, "anchor_timestamp_invalid");
  }
  if (!(CHANNEL_STATUSES as readonly string[]).includes(input.state)) {
    throw new PrismChannelError(CHANNEL_ERROR_CODE.ANCHOR_INCONSISTENT, "anchor_state_invalid");
  }
}

function validatePayload(payload: StarknetAnchorPayload): StarknetAnchorPayload {
  assertCommitment(payload.anchorRef, "anchor_ref");
  assertCommitment(payload.commitment, "commitment");
  if (payload.relatedCommitment !== null) assertCommitment(payload.relatedCommitment, "related_commitment");
  assertSafeAnchorMetadata(payload);
  if (payload.kind === "channel") {
    if (payload.relatedCommitment !== null || payload.anchorRef.toLowerCase() !== payload.commitment.toLowerCase()) {
      throw new PrismChannelError(CHANNEL_ERROR_CODE.ANCHOR_INCONSISTENT, "channel_anchor_shape_invalid");
    }
  } else if (payload.kind === "message") {
    if (payload.relatedCommitment === null) {
      throw new PrismChannelError(CHANNEL_ERROR_CODE.ANCHOR_INCONSISTENT, "message_anchor_channel_reference_missing");
    }
  } else {
    throw new PrismChannelError(CHANNEL_ERROR_CODE.ANCHOR_INCONSISTENT, "anchor_kind_invalid");
  }
  return {
    ...payload,
    anchorRef: payload.anchorRef.toLowerCase() as Hex,
    commitment: payload.commitment.toLowerCase() as Hex,
    relatedCommitment: payload.relatedCommitment === null ? null : payload.relatedCommitment.toLowerCase() as Hex,
  };
}

function normalizeTransactionHash(value: unknown): Hex {
  if (typeof value !== "string" || !TX_HASH.test(value.trim())) {
    throw new PrismChannelError(CHANNEL_ERROR_CODE.ANCHOR_UNAVAILABLE, "anchor_provider_returned_invalid_transaction_hash");
  }
  return `0x${value.trim().slice(2).toLowerCase().padStart(64, "0")}` as Hex;
}

export interface StarknetCommitmentPublisherOptions {
  /** No default is provided: using a fake publisher here would overclaim X3. */
  readonly contract: StarknetCommitmentContractPort | null | undefined;
}

export class StarknetCommitmentPublisher implements StarknetCommitmentPublisherPort {
  readonly isTestDouble = false as const;
  readonly abiVersion = STARKNET_CHANNEL_ANCHOR_ABI_VERSION;
  readonly contractAddress: string;
  private readonly contract: StarknetCommitmentContractPort;

  constructor(options: StarknetCommitmentPublisherOptions) {
    const contract = options.contract;
    if (!contract || typeof contract.submitAnchor !== "function" || typeof contract.readAnchor !== "function") {
      throw new PrismChannelError(CHANNEL_ERROR_CODE.ANCHOR_UNAVAILABLE, "starknet_commitment_provider_missing");
    }
    if (contract.abiVersion !== STARKNET_CHANNEL_ANCHOR_ABI_VERSION) {
      throw new PrismChannelError(CHANNEL_ERROR_CODE.ANCHOR_PROVIDER_MISMATCH, "unsupported_anchor_abi_version");
    }
    try {
      this.contractAddress = normalizeStarknetContractAddress(contract.contractAddress, "anchorContract");
    } catch {
      throw new PrismChannelError(CHANNEL_ERROR_CODE.ANCHOR_PROVIDER_MISMATCH, "invalid_anchor_contract_address");
    }
    this.contract = contract;
  }

  async publishChannelAnchor(input: {
    readonly commitment: Hex;
    readonly version: number;
    readonly observedAt: number;
    readonly state: ChannelStatus;
  }): Promise<StarknetAnchorSubmission> {
    const payload = validatePayload({
      kind: "channel",
      anchorRef: input.commitment,
      commitment: input.commitment,
      relatedCommitment: null,
      version: input.version,
      observedAt: input.observedAt,
      state: input.state,
    });
    return this.submit(payload);
  }

  async publishMessageAnchor(input: {
    readonly channelCommitment: Hex;
    readonly messageCommitment: Hex;
    readonly ciphertextHash: Hex;
    readonly version: number;
    readonly observedAt: number;
    readonly state: ChannelStatus;
  }): Promise<StarknetAnchorSubmission> {
    const payload = validatePayload({
      kind: "message",
      anchorRef: input.messageCommitment,
      commitment: input.ciphertextHash,
      relatedCommitment: input.channelCommitment,
      version: input.version,
      observedAt: input.observedAt,
      state: input.state,
    });
    return this.submit(payload);
  }

  private async submit(payload: StarknetAnchorPayload): Promise<StarknetAnchorSubmission> {
    try {
      const result = await this.contract.submitAnchor(payload);
      return { txHash: normalizeTransactionHash(result.transactionHash) };
    } catch (cause) {
      if (cause instanceof PrismChannelError) throw cause;
      // Never include provider messages: RPC errors can echo calldata or other
      // sensitive request context. The caller may retry this explicit gap.
      throw new PrismChannelError(CHANNEL_ERROR_CODE.ANCHOR_UNAVAILABLE, "starknet_commitment_submission_failed");
    }
  }

  async readAnchor(anchorRef: Hex): Promise<StarknetAnchorPayload | null> {
    assertCommitment(anchorRef, "anchor_ref");
    let observed: StarknetAnchorPayload | null;
    try {
      observed = await this.contract.readAnchor({ anchorRef: anchorRef.toLowerCase() as Hex });
    } catch {
      throw new PrismChannelError(CHANNEL_ERROR_CODE.ANCHOR_UNAVAILABLE, "starknet_commitment_read_failed");
    }
    if (observed === null) return null;
    try {
      const normalized = validatePayload(observed);
      if (normalized.anchorRef.toLowerCase() !== anchorRef.toLowerCase()) {
        throw new PrismChannelError(CHANNEL_ERROR_CODE.ANCHOR_INCONSISTENT, "anchor_reference_mismatch");
      }
      return normalized;
    } catch (cause) {
      if (cause instanceof PrismChannelError) throw cause;
      throw new PrismChannelError(CHANNEL_ERROR_CODE.ANCHOR_INCONSISTENT, "malformed_anchor_readback");
    }
  }
}
