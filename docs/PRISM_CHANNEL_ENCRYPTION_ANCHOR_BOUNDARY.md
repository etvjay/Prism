# PrismChannel Encryption and Starknet Anchor Boundary

Status: **implemented locally, X2**

This addendum replaces the C1 placeholder paths without claiming a live
Starknet deployment or live participant-key service. It is scoped to
`src/features/prism-channels/**` and keeps STRK20 notes, claims, and receipts
outside the channel implementation.

## Participant-owned encryption

`ParticipantCommunicationEncryptionPort` is the application boundary. Prism
owns routing and authorization, but it does not generate, export, persist, or
recover communication keys. The injected provider owns that lifecycle and
receives transient `Uint8Array` plaintext only for the duration of encryption.

The provider input is authenticated context:

```text
channelId + messageId + sender + recipient
+ senderKeyCommitment + recipientKeyCommitment
+ associatedData
```

The provider must return an opaque ciphertext envelope plus the two
commitments. The service rejects missing/malformed envelopes and commitment
mismatches. Decryption is available only to an authenticated channel
participant whose expected recipient commitment matches the message. Provider
or AEAD failures are mapped to stable errors and never include provider text or
plaintext in an error detail.

The opt-in `WebCryptoParticipantCommunicationEncryption` adapter uses the
maintained Web Crypto AES-GCM primitive. It accepts an injected
`ParticipantEncryptionKeyProvider`; it never generates or exports keys. The
nonce is prefixed to the ciphertext envelope and associated data is
authenticated. A deployment may inject another maintained provider only after
its protocol/version and key ownership are accepted.

## Durable storage

`PostgresChannelStore` and `PostgresMessageStore` are production-oriented
adapters with a versioned migration. `prism_channel_messages` stores:

- ciphertext;
- encryption version;
- sender and recipient key commitments;
- content type and timestamp;
- opaque `payment_ref`, `claim_ref`, and `receipt_ref` values.

The message table has no plaintext column and requires an authenticated
encrypted envelope. Opaque references are checked as hex before persistence.
The adapters use parameterized SQL and read back typed rows, so a second store
instance can recover the encrypted record. Live PostgreSQL execution remains
unobserved in this lane.

## Starknet commitment anchor

`StarknetCommitmentPublisher` is a typed, fail-closed provider boundary. It
requires an injected `StarknetCommitmentContractPort` declaring the exact
`prism-channel-anchor-v1` ABI version, a non-zero ContractAddress, a submission
method, and an independent read method. The adapter does not construct an
`Account`, read a key file, invent a Cairo entrypoint, or fall back to the old
recorder when this provider is configured.

The allowed anchor payload is:

```text
kind: channel | message
anchorRef: 32-byte opaque commitment
commitment: 32-byte opaque commitment
relatedCommitment: optional 32-byte opaque commitment
version: positive integer
observedAt: non-negative safe timestamp
state: channel state enum
```

Channel commitments are Keccak-256 hashes of sorted communication-key
commitments and the versioned domain tag. Participant identifiers and channel
identifiers are absent from that public preimage. Message anchors carry the
ciphertext hash and a hash-only channel relation; memo plaintext, message IDs,
private keys, viewing keys, notes, balances, and unapproved participant links
are not sent to the contract provider.

Anchor submission errors are `ERR-054` and ABI/address mismatches are
`ERR-055`. A readback with a mismatched reference or invalid shape is
`ERR-056`. Short provider transaction hashes are normalized to the canonical
64-hex representation; malformed hashes fail closed.

The existing `InMemoryPublicChainPublisher` remains explicitly marked as an
X2 test recorder for legacy fixture tests. It is not a Starknet publisher and
must not be used as deployment evidence. Its ciphertext digest path now uses
viem Keccak-256 rather than the former deterministic placeholder.

## Evidence ceiling and open gates

The implementation and tests prove X2 local behavior, including:

- participant authorization, recipient binding, commitment authentication;
- AES-GCM ciphertext and associated-data tamper rejection;
- replay rejection before provider invocation;
- no plaintext in stored records, public anchor payloads, or sanitized errors;
- durable adapter migration/round-trip behavior through an injected database;
- typed anchor payload validation, provider-unavailable failure, and readback
  consistency checks.

This does **not** prove X3. Promotion requires all of the following:

1. an accepted/deployed immutable Starknet channel-anchor contract and exact
   ABI/calldata/event specification;
2. a user-controlled, maintained communication-key provider with recovery and
   device-sync decisions accepted;
3. a real PostgreSQL migration and restart/readback run;
4. a real Starknet submission plus receipt and independent RPC/explorer
   readback of the exact anchor;
5. a privacy review of anchor correlation and participant disclosure.

Until those gates are observed, PrismChannel remains X2 and no `strk20.json`,
transaction manifest, deployment record, or evidence-ledger promotion is
created by this lane.
