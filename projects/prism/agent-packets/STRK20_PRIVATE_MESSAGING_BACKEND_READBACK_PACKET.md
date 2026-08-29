# STRK20 Private Messaging Backend Readback Packet

Status: **local boundary audit, X2 only**

This packet records the safe closeout boundary for the STRK20 private-transfer and encrypted-messaging backend lane. It does not claim a deployed InvokeExternal helper, an available discovery indexer, a live provider, or mainnet evidence.

## Verified local surfaces

- `PrismChannelService` supports local channel lifecycle, participant authorization, authenticated key-commitment binding, ciphertext-only message creation, replay rejection by `messageId`, AEAD provider delegation, and participant-only message listing.
- `ParticipantCommunicationEncryptionPort` keeps communication-key generation, storage, rotation, recovery, encryption, and decryption with the participant-owned provider. Prism stores no viewing key, private key, plaintext, or proving material.
- `PostgresChannelStore`/`PostgresMessageStore` use parameterized SQL, typed readback, migration versioning, ciphertext and opaque-reference checks, and require authenticated encryption metadata for durable messages.
- `PrivacyActionService` exposes explicit local STRK20 lifecycle states. Submission is fenced, finality and pool-event evidence are required before confirmation, and receipt/provider errors are sanitized.
- `POST /v1/strk20/actions` remains the only wired STRK20 command route. It admits lifecycle vocabulary only and rejects proof, calldata, provider response, viewing-key, private-key, and secret fields.
- `GET /v1/strk20/actions/:actionId` now requires an authenticated app session. When an action was created through the same handler instance, reads and lifecycle advances are fenced to the creating session/user and cross-user access is returned as not-found.

## Missing or intentionally unimplemented surfaces

No channel REST routes are wired into `AppFactory` or `PrismApiHandlers`, and the channel stores/provider are not factory-configured. Adding `/channels`, `/messages/send`, or `/messages/discover` would otherwise create an in-memory-only API that cannot honestly claim durable discovery or production readiness. Keep these routes absent until a factory-owned channel service is injected with:

1. durable channel/message stores and migration/readback;
2. authenticated participant/session-to-Prism-ID authorization;
3. participant-owned encryption/key-commitment provider;
4. explicit pagination and a stable discovery watermark;
5. replay/idempotency persistence across process restart;
6. provider outage and malformed-envelope mapping;
7. an accepted onchain helper ABI and independent indexer read contract.

The official private-messaging description is insufficient to safely invent the Cairo entrypoint, calldata schema, events, storage layout, indexer query contract, or sender-anonymity correlation rules. Do not implement or broadcast an InvokeExternal helper from this lane.

## Required implementation/readback contract before promotion

When the missing protocol inputs are accepted, the implementation packet must pin:

- helper contract address, network, immutable ABI/version, entrypoint name and exact calldata types;
- whether the helper calls the STRK20 pool through `InvokeExternal`, plus authorization and replay/nullifier rules;
- encrypted per-channel storage key and value schema, maximum envelope size, nonce/version rules, and whether message IDs are provider-generated or client-generated;
- discovery indexer endpoint, authentication, ordering, cursor/watermark semantics, reorg behavior, retention, and whether it returns ciphertext or only opaque references;
- sender anonymity invariant, including what public event fields are emitted and how correlation with relayers/timing is bounded;
- independent readback fields for submitted transaction, receipt, helper event, pool event, and indexer observation.

Until all are available from an accepted first-party source and independently exercised, state is **dependency unavailable / X2 preparation**, not sent, indexed, confirmed, or private-transfer evidence.

## Privacy and failure invariants

- Device-side decryption remains the only plaintext release path. No REST route should accept plaintext or return decrypted bytes.
- Ciphertext must be structurally validated before storage or publication. Invalid AEAD envelopes, commitment mismatches, malformed references, and provider-returned malformed envelopes fail closed.
- Action IDs, message IDs, idempotency keys, and cursors are replay fences, not authority. They must not be used to infer wallet ownership or relayer identity.
- A provider timeout after submission is ambiguous. Never retry automatically after the submission fence; require receipt observation/readback.
- Screening rejection, screening unavailability, unsupported wallet, stale state, and missing indexer/provider are distinct states. None may be rendered as completed.
- Public anchors and receipts may expose hashes, timing, pool/helper events, and other protocol artifacts. They must not expose plaintext, viewing keys, private keys, notes, balances, or unnecessary participant links.

## Evidence ceiling

Local tests and injected database/provider doubles establish controlled X2 behavior only. No live PostgreSQL run, participant key-provider run, helper deployment, indexer observation, transaction receipt, or mainnet STRK20 evidence was authorized or fabricated by this lane.
