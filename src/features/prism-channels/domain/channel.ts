// Pure PrismChannel domain — no framework/DB/RPC imports.
// Lifecycle: PROPOSED -> ACCEPTED -> ACTIVE -> ARCHIVED
//           any of PROPOSED|ACCEPTED|ACTIVE|ARCHIVED -> REVOKED (terminal)
// No general messenger: policy restricts to relationship/payment-reference domain.
// See docs/PRISM_DOCUMENTATION_V0_3.md §§15–19, PRISM_PROTOCOL_SURFACE_PHASE_PLAN S4.

import { CHANNEL_ERROR_CODE, PrismChannelError } from "./errors";

export type Hex = `0x${string}`;

export const CHANNEL_STATUSES = ["PROPOSED", "ACCEPTED", "ACTIVE", "ARCHIVED", "REVOKED"] as const;
export type ChannelStatus = (typeof CHANNEL_STATUSES)[number];

export const CONTENT_TYPES = ["payment_memo", "receipt", "claim_invitation", "authorization_request"] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

export interface ChannelPolicy {
  /** Allowed content types; default is all four. Narrowing is policy enforcement, not extension. */
  readonly allowedContentTypes: readonly ContentType[];
  /** Whether channel may carry authorization_request; separate check for implicit authority guard. */
  readonly allowAuthorizationRequest: boolean;
}

export const DEFAULT_CHANNEL_POLICY: ChannelPolicy = {
  allowedContentTypes: [...CONTENT_TYPES],
  allowAuthorizationRequest: true,
};

export interface PrismChannel {
  readonly channelId: string;
  readonly participants: readonly [string, string]; // sorted, distinct Prism IDs
  readonly keyCommitments: Readonly<Record<string, Hex | null>>; // participant -> commitment hex (null until provided)
  readonly createdAt: number;
  readonly status: ChannelStatus;
  readonly policy: ChannelPolicy;
  readonly version: number;
  readonly createdBy: string; // initiator
  readonly acceptedAt?: number | null;
  readonly archivedAt?: number | null;
  readonly revokedAt?: number | null;
  readonly revokedBy?: string | null;
}

export interface CreateChannelInput {
  channelId: string;
  initiator: string;
  peer: string;
  initiatorCommitment: Hex;
  policy?: Partial<ChannelPolicy>;
  now: number;
}

export interface AcceptChannelInput {
  channel: PrismChannel;
  caller: string;
  peerCommitment: Hex;
  now: number;
}

// Validation helpers — structural only; PrismId format checked here.
const PRISM_ID_PATTERN = /^prism:[0-9A-Za-z]{1,64}$/;
const CHANNEL_ID_PATTERN = /^[A-Za-z0-9_-]{6,64}$/;
const HEX_COMMITMENT_PATTERN = /^0x[0-9a-fA-F]{64}$/; // 32-byte commitment

export function assertValidPrismId(value: string): string {
  const t = value.trim();
  if (!PRISM_ID_PATTERN.test(t)) throw new PrismChannelError(CHANNEL_ERROR_CODE.INVALID_PRISM_ID, `malformed_prism_id:${value}`);
  return t;
}

export function assertValidChannelId(value: string): string {
  const t = value.trim();
  if (!CHANNEL_ID_PATTERN.test(t)) throw new PrismChannelError(CHANNEL_ERROR_CODE.INVALID_CHANNEL_ID, `malformed_channel_id:${value}`);
  return t;
}

export function assertValidCommitment(value: string): Hex {
  if (!HEX_COMMITMENT_PATTERN.test(value)) throw new PrismChannelError(CHANNEL_ERROR_CODE.KEY_COMMITMENT_INVALID, `malformed_commitment:${value.slice(0, 20)}`);
  return value as Hex;
}

function sortedParticipants(a: string, b: string): [string, string] {
  const pa = assertValidPrismId(a);
  const pb = assertValidPrismId(b);
  if (pa === pb) throw new PrismChannelError(CHANNEL_ERROR_CODE.INVALID_PARTICIPANTS, "participants_must_be_distinct");
  return pa < pb ? [pa, pb] : [pb, pa];
}

function normalizePolicy(input?: Partial<ChannelPolicy>): ChannelPolicy {
  if (!input) return DEFAULT_CHANNEL_POLICY;
  const allowed = input.allowedContentTypes ?? DEFAULT_CHANNEL_POLICY.allowedContentTypes;
  // Validate allowed types are within domain
  for (const ct of allowed) {
    if (!(CONTENT_TYPES as readonly string[]).includes(ct)) {
      throw new PrismChannelError(CHANNEL_ERROR_CODE.INVALID_CONTENT_TYPE, `policy_allows_unknown:${ct}`);
    }
  }
  // Policy must not expand beyond domain; allow only subset.
  if (allowed.length === 0) throw new PrismChannelError(CHANNEL_ERROR_CODE.POLICY_VIOLATION, "policy_must_allow_at_least_one_type");
  return {
    allowedContentTypes: [...allowed],
    allowAuthorizationRequest: input.allowAuthorizationRequest ?? DEFAULT_CHANNEL_POLICY.allowAuthorizationRequest,
  };
}

export function createChannel(input: CreateChannelInput): PrismChannel {
  assertValidChannelId(input.channelId);
  const participants = sortedParticipants(input.initiator, input.peer);
  const commitment = assertValidCommitment(input.initiatorCommitment);
  assertValidPrismId(input.initiator);
  assertValidPrismId(input.peer);
  if (!Number.isFinite(input.now)) throw new PrismChannelError(CHANNEL_ERROR_CODE.INVALID_STATUS_TRANSITION, "invalid_now");

  const policy = normalizePolicy(input.policy);

  // Key reuse guard within channel at creation: initiator commitment distinctness checked at accept time.
  // But if peer commitment provision is deferred, we still ensure no immediate duplicate placeholder.

  const keyCommitments: Record<string, Hex | null> = {};
  for (const p of participants) keyCommitments[p] = null;
  keyCommitments[input.initiator] = commitment;

  return {
    channelId: input.channelId,
    participants,
    keyCommitments,
    createdAt: input.now,
    status: "PROPOSED",
    policy,
    version: 0,
    createdBy: input.initiator,
    acceptedAt: null,
    archivedAt: null,
    revokedAt: null,
    revokedBy: null,
  };
}

export function acceptChannel(input: AcceptChannelInput): PrismChannel {
  const { channel, caller, peerCommitment, now } = input;
  if (channel.status !== "PROPOSED") throw new PrismChannelError(CHANNEL_ERROR_CODE.INVALID_STATUS_TRANSITION, `accept_only_from_PROPOSED:got_${channel.status}`);
  if (!channel.participants.includes(caller)) throw new PrismChannelError(CHANNEL_ERROR_CODE.NOT_PARTICIPANT, `caller_not_participant:${caller}`);
  if (caller === channel.createdBy) throw new PrismChannelError(CHANNEL_ERROR_CODE.NOT_PARTICIPANT, "initiator_cannot_accept_own_channel");
  const commitment = assertValidCommitment(peerCommitment);
  if (!Number.isFinite(now)) throw new PrismChannelError(CHANNEL_ERROR_CODE.INVALID_STATUS_TRANSITION, "invalid_now");

  // Key reuse check: peer commitment must differ from initiator's
  const initiatorCommitment = channel.keyCommitments[channel.createdBy];
  if (initiatorCommitment && initiatorCommitment.toLowerCase() === commitment.toLowerCase()) {
    throw new PrismChannelError(CHANNEL_ERROR_CODE.KEY_REUSE, "commitment_reuse_across_participants");
  }

  // Verify both commitments present after accept -> ACTIVE
  const nextCommitments: Record<string, Hex | null> = { ...channel.keyCommitments };
  nextCommitments[caller] = commitment;

  // Ensure both participants now have commitments
  const allHaveCommitments = channel.participants.every((p) => nextCommitments[p] !== null);
  const nextStatus: ChannelStatus = allHaveCommitments ? "ACTIVE" : "ACCEPTED";

  return {
    ...channel,
    keyCommitments: nextCommitments,
    status: nextStatus,
    version: channel.version + 1,
    acceptedAt: now,
  };
}

export function archiveChannel(channel: PrismChannel, caller: string, now: number): PrismChannel {
  if (!channel.participants.includes(caller)) throw new PrismChannelError(CHANNEL_ERROR_CODE.NOT_PARTICIPANT, `caller_not_participant:${caller}`);
  if (channel.status === "REVOKED") throw new PrismChannelError(CHANNEL_ERROR_CODE.CHANNEL_REVOKED, "channel_revoked");
  if (channel.status === "ARCHIVED") throw new PrismChannelError(CHANNEL_ERROR_CODE.INVALID_STATUS_TRANSITION, "already_archived");
  if (channel.status === "PROPOSED") throw new PrismChannelError(CHANNEL_ERROR_CODE.INVALID_STATUS_TRANSITION, "cannot_archive_PROPOSED");
  if (!Number.isFinite(now)) throw new PrismChannelError(CHANNEL_ERROR_CODE.INVALID_STATUS_TRANSITION, "invalid_now");
  // Only ACTIVE or ACCEPTED can archive; PROPOSED cannot.
  if (channel.status !== "ACTIVE" && channel.status !== "ACCEPTED") {
    throw new PrismChannelError(CHANNEL_ERROR_CODE.INVALID_STATUS_TRANSITION, `archive_from_${channel.status}_not_allowed`);
  }
  return {
    ...channel,
    status: "ARCHIVED",
    version: channel.version + 1,
    archivedAt: now,
  };
}

export function revokeChannel(channel: PrismChannel, caller: string, now: number): PrismChannel {
  if (!channel.participants.includes(caller)) throw new PrismChannelError(CHANNEL_ERROR_CODE.NOT_PARTICIPANT, `caller_not_participant:${caller}`);
  if (channel.status === "REVOKED") return channel; // idempotent benign
  if (!Number.isFinite(now)) throw new PrismChannelError(CHANNEL_ERROR_CODE.INVALID_STATUS_TRANSITION, "invalid_now");
  return {
    ...channel,
    status: "REVOKED",
    version: channel.version + 1,
    revokedAt: now,
    revokedBy: caller,
  };
}

export function canSendInStatus(status: ChannelStatus): boolean {
  return status === "ACTIVE";
}

export function isTerminal(status: ChannelStatus): boolean {
  return status === "REVOKED" || status === "ARCHIVED";
}

export function assertParticipant(channel: PrismChannel, caller: string): void {
  if (!channel.participants.includes(caller)) throw new PrismChannelError(CHANNEL_ERROR_CODE.NOT_PARTICIPANT, `caller_not_participant:${caller}`);
}
