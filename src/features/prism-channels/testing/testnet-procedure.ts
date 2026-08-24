// Testnet procedure / evidence fixture for C1.
// Describes steps, independent read requirements, and X3 envelope shape.
// No real network calls; fixture documents what testnet runner must observe.

import type { Hex } from "../domain/channel";
import type { PrismChannel } from "../domain/channel";
import type { ChannelMessage } from "../domain/message";

export interface TestnetStep {
  step: number;
  action: string;
  actor: string;
  expected: string;
  evidence: string;
}

export const C1_TESTNET_PROCEDURE: TestnetStep[] = [
  { step: 1, action: "create channel ALICE->BOB (PROPOSED)", actor: "ALICE", expected: "channel status PROPOSED, initiator commitment published", evidence: "channelId, commitments, status PROPOSED, public publisher hash" },
  { step: 2, action: "independent read (reader B) sees PROPOSED", actor: "independent_reader", expected: "readback matches writer's channelId/status", evidence: "second ChannelStore instance read, watermark" },
  { step: 3, action: "BOB accepts channel (ACTIVE)", actor: "BOB", expected: "status ACTIVE, both commitments present, distinct", evidence: "channel status ACTIVE, key_commitments both hex, keyReuse check" },
  { step: 4, action: "independent read sees ACTIVE", actor: "independent_reader", expected: "second read sees ACTIVE, version+1", evidence: "independent read watermark" },
  { step: 5, action: "ALICE sends encrypted payment_memo", actor: "ALICE", expected: "ciphertext stored, no plaintext on public surface", evidence: "messageId, contentType payment_memo, ciphertext hex, public publisher hash only" },
  { step: 6, action: "BOB reads/decrypts via authorized participant read", actor: "BOB", expected: "participant can list messages", evidence: "listByChannel length 1, ciphertext" },
  { step: 7, action: "independent read of messages matches", actor: "independent_reader", expected: "second MessageStore read matches ciphertext + commitment hashes", evidence: "independent read messages" },
  { step: 8, action: "BOB sends receipt reference", actor: "BOB", expected: "second message contentType receipt, opaque receiptRef hex", evidence: "messageId 2, receiptRef opaque" },
  { step: 9, action: "ALICE archives channel", actor: "ALICE", expected: "status ARCHIVED, no further sends allowed", evidence: "status ARCHIVED" },
  { step: 10, action: "independent read sees ARCHIVED", actor: "independent_reader", expected: "second read sees ARCHIVED", evidence: "watermarked read" },
  { step: 11, action: "revoke channel (alternative terminal path)", actor: "ALICE or BOB", expected: "status REVOKED terminal, no re-activation", evidence: "status REVOKED, revocation independent read" },
];

export interface C1EvidenceFixture {
  procedure: TestnetStep[];
  independentReadRequirement: string;
  noPlaintextRequirement: string;
  keySeparationRequirement: string;
  channels: PrismChannel[];
  messages: ChannelMessage[];
  publicCommitments: Array<{ channelId: string; payload: string }>;
  limitations: string[];
  maturity: "X2" | "X3";
  // Simulates independent verification artifact
  independentVerification: { reader: string; checks: string[] };
}

export function buildC1Fixture(input: {
  channels: PrismChannel[];
  messages: ChannelMessage[];
  publicCommitments: Array<{ channelId: string; payload: string }>;
}): C1EvidenceFixture {
  return {
    procedure: C1_TESTNET_PROCEDURE,
    independentReadRequirement: "Every status/message commitment must be read back via a separate ChannelStore/MessageStore instance (or separate RPC/explorer query) with watermark; writer read alone is insufficient (X2 only).",
    noPlaintextRequirement: "No plaintext social handle, amount, memo, or Prism ID linkage in ciphertext or public publisher payloads; ciphertext must be opaque hex (ERR-041).",
    keySeparationRequirement: "Communication-key commitments are from CommunicationKeyCommitmentPort only; no Starknet/Base/STRK20 viewing keys are imported or handled (INV-PRISM-012).",
    channels: input.channels,
    messages: input.messages,
    publicCommitments: input.publicCommitments,
    limitations: [
      "X2 fixture: in-memory stores, deterministic commitments, fake hash — no real Starknet/Base publish, no real encryption.",
      "For X3 testnet promotion: replace in-memory stores with durable (Postgres + onchain commitment publish), use real communication-key commitments, and attach independent RPC/explorer verification.",
    ],
    maturity: "X2",
    independentVerification: {
      reader: "independent_reader (separate store instance / second RPC node)",
      checks: ["channel status readback", "key_commitments distinct", "ciphertext opaque", "public surface contains only hashes", "revoked/archived blocks sends"],
    },
  };
}
