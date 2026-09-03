# Prism Privacy + Runtime Closeout Runbook
## Secret-free evidence packet and live-gate procedure

**Status:** `PREPARATION_ONLY` — no wallet action, broadcast, deployment, external write, or `strk20.json` mutation is authorized by this document.  
**Prepared against:** repository `/home/ubuntu/prism-core-v1-closeout`, baseline HEAD `60460be3388c388472b83d7753d0c9d3d52970a3` (`core-v1-closeout`).  
**Evidence ceiling for this preparation:** `X2` local controlled implementation.  
**Protected scope:** do not edit frontend files, `strk20.json`, credentials, key stores, viewing-key material, or production configuration while preparing or validating this packet.

This is an implementation-ready runbook for the remaining Prism privacy and backend-runtime gates. It deliberately separates local implementation evidence from wallet/provider evidence, chain receipts, independent readback, release authorization, and STRK20 submission evidence.

---

## 1. Governing truths and evidence rules

### 1.1 Maturity scale

```text
X0  hypothesis / planned
X1  fixture or mock
X2  local controlled implementation
X3  realistic or testnet observed
X4  repeated / independently reproduced
X5  mainnet or production independently verifiable
```

A green local suite, a simulated wallet response, a dry-run, a worker report, or a transaction hash alone does not promote a claim. A claim is promotable only when the required receipt facts, independent readback, version/commit binding, and limitations are present.

### 1.2 Privacy boundary

The normal Prism dapp route is wallet-mediated:

```text
get-starknet 6.0.3
→ starknet.js 10.4.0 / WalletAccountV6
→ Wallet API / spec >= 0.10.3
→ privacy-enabled wallet
→ STRK20 pool
```

The wallet owns registration, viewing keys, private notes, proving, and private-state handling. Prism must never request, store, log, transmit, derive, or persist a viewing key, seed phrase, private key, mnemonic, raw proof material, or wallet export. Capability detection must use `supportedWalletApi` / `supportedSpecs`; it must not call a balance method as a feature probe.

The privacy claims must remain route-specific:

| Route | Public/observable facts | Claimable hidden facts only when the route is actually observed |
|---|---|---|
| Shield/deposit | depositor, token, amount, timing, pool interaction | do not describe the deposit itself as private |
| Private note-to-note transfer | proof/encrypted-note artifacts and timing may remain observable; pool event exists | sender, recipient, amount, token type, and spent-note relationship are hidden inside the supported private flow |
| Private application/helper action | pool/helper/protocol action, timing, amount or open-note output may be public | direct user identity may be hidden behind the privacy route; do not claim amount/timing privacy without separate proof |
| Unshield/withdrawal | destination, amount, timing | origin relationship may remain hidden subject to correlation |
| Base or other ordinary external-chain action | ordinary public chain metadata | no private-Base claim in this release |

Transaction `sender` is a relayer observation, not reliable user attribution. Attribute activity from the canonical pool/application event or wallet/session evidence, never by grouping on the transaction sender.

### 1.3 Current STRK20 sprint rules to re-check before submission

The current official sources fetched for this preparation are:

- `https://github.com/starkience/strk20-hackathon` (`README.md`, `main`)
- `https://strk20.starknet.io/hackathon`

The current source states: public open-source repository with a license; a live public demo; a three-minute demo video; and at least three distinct Starknet mainnet transactions against the live STRK20 pool listed in root `strk20.json`. The current hub page states a submission cutoff of **September 7, 23:59 UTC**; older repository documents in this worktree mention August 31 and are historical. Re-fetch the official source immediately before release and do not hard-code the deadline in an automation gate.

The repository's current validator audit additionally requires, for every listed hash:

```text
hash exists on SN_MAIN
execution_status == SUCCEEDED
receipt contains a canonical STRK20-pool event
if project contracts are declared, the transaction involves at least one declared project contract
```

Project-contract involvement must be evidenced by an event from a declared project contract or the declared project address appearing in transaction calldata. A preparatory G0 shield can prove reachability while remaining ineligible as a final submission hash. Do not populate `strk20.json` from this runbook; it is a separately authorized submission artifact.

---

## 2. Authorization packet: required before any live write

No live wallet, provider, deployment, settlement, or pool action may begin until an owner-approved authorization packet exists for the exact run. An accepted testnet decision does not authorize mainnet. The packet must contain no credential values; signer, RPC, wallet, prover, and database credentials remain out-of-band in a protected operator environment.

### 2.1 Required live authorization fields

Every authorization must fill these fields explicitly; `null`, a placeholder, or an inferred value fails closed:

```yaml
authorization:
  authorization_id: null
  status: PROPOSED                 # ACCEPTED is required before a live write
  decision_id: null
  authorized_by: null
  authorized_at: null
  approval_reference: null         # reference/record ID only; no signature or secret

  network: null                    # exact: SN_SEPOLIA or SN_MAIN
  base_network: null               # exact environment and chain ID when Base is involved
  maximum_transaction_count: null  # integer; includes approval, shield, private action, retries, and recovery reads that can write
  maximum_spend:
    asset: null
    amount: null
    unit: null
    includes_fees: true

  route: null                      # exact Wallet API / private-transfer / Prism-helper route
  exact_contract_scope:
    strk20_pool_address: 0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a
    project_contracts: []           # exact observed name/network/address entries; no guessed addresses
    allowed_entrypoints: []        # exact entrypoints or action types
    excluded_contracts: []

  expires_at: null
  stop_conditions:
    - observed network or chain ID differs from authorization
    - capability is unsupported, unknown, or cannot be read without private-state access
    - route, contract, entrypoint, asset, amount, fee, or count is outside this scope
    - an approval or action receipt is missing, malformed, reverted, or not final
    - screening is rejected or unavailable
    - explicit private-balance consent is denied, absent, or unexpectedly requested
    - note maturity is not observed; do not spend a fresh note
    - primary and independent readbacks disagree
    - pool event or required Prism-contract involvement is absent
    - conservation fails or a helper retains a non-zero balance
    - operation delivery is ambiguous or exceeds the observation timeout; do not rebroadcast
    - any credential, viewing-key material, or secret-bearing URL appears in a packet/log
    - the authorized transaction count or spend limit would be exceeded
```

`maximum_transaction_count` is a hard upper bound, not a target. It includes every state-changing approval, shield, private action, retry, or recovery submission authorized for the run; read-only reconciliation does not create permission to submit again. A provider timeout after a submission attempt consumes the attempt and leaves the operation fenced; the operator must stop and reconcile the existing hash out-of-band.

### 2.2 Authorization acceptance checklist

- [ ] Owner decision is `ACCEPTED`, append-only, and mirrored in the packet.
- [ ] Exact network is selected (`SN_SEPOLIA` for testnet rehearsal or `SN_MAIN` for final STRK20 evidence).
- [ ] Base network/chain ID is present when the route touches Base.
- [ ] Maximum transaction count and maximum spend include approval, pool, helper, recovery, and fee effects.
- [ ] Route is named precisely; no generic “STRK20 action” authorization.
- [ ] Exact contract scope lists only contracts allowed for this run.
- [ ] Stop conditions are accepted before wallet prompts begin.
- [ ] Protected credentials are provisioned out-of-band and are not copied into this packet, repository, or chat.
- [ ] `strk20.json` mutation is separately authorized; this packet does not authorize it.

---

## 3. Privacy gate sequence

Run the gates in order. Record one evidence envelope per material step or one packet with immutable step IDs. Never skip a gate because a later receipt looks successful.

### G0 — Freeze candidate and run secret-free preflight

From the frozen worktree:

```bash
git status --short --branch
git rev-parse HEAD
git diff --check
node ops/target-network/validate.mjs
node ops/starknet/validate.mjs
node ops/starknet/dry-run-check.mjs
node ops/evidence/validate.mjs --self-test
node ops/release/validate-mainnet.mjs --self-test
npm run typecheck
npm test
npm run build
```

Acceptance:

- candidate HEAD is recorded exactly;
- static validators pass;
- no active profile or secret is committed;
- evidence and release validators fail closed on missing fields;
- tests, typecheck, build, and diff check pass;
- `strk20.json` remains untouched.

A skipped integration test is not a pass. Record the skip and its missing prerequisite.

### G1 — Wallet capability

Use the injected Wallet API capability surface only:

```text
supportedWalletApi()
supportedSpecs()
requestChainId()
```

Acceptance facts:

- capability response is well-formed and contains a supported version/spec at or above `0.10.3`;
- the wallet/provider identity is recorded without credential material;
- no balance, note, viewing-key, or proving data was requested;
- unsupported and unknown wallets remain blocked rather than being treated as a degraded success.

Repository implementation anchor: `src/features/prism-strk20/domain/wallet-capability.ts`, `wallet-strk20-action-adapter.ts`, `injected-wallet.ts`.

### G2 — Network check

Compare the wallet-reported chain ID and the authorized target. Accept the canonical symbolic ID or its exact canonical felt encoding only. Reject unknown, look-alike, or mismatched values.

```yaml
network_observation:
  expected_network: null
  observed_chain_id: null
  classified_environment: null
  match: false
  observed_at: null
```

A network mismatch blocks readiness before any approval, consent, or action. Do not switch networks implicitly and do not fall back from `SN_MAIN` to `SN_SEPOLIA` or vice versa.

### G3 — Route, fee, and registration preflight

Record the exact route and read the current pool fee before amount calculation. Do not hard-code a historical fee. The pool account may require wallet-managed first-use registration; Prism may record `registered`, `required`, or `unknown`, but must not claim registration from absence of an exposed query.

For the normal consumer route, the wallet owns registration and proof generation. For an application-specific route, verify the Prism helper address, allowed entrypoint/calldata shape, token, output token, amount bounds, and atomicity before opening a prompt.

### G4 — Approval and shield/deposit

The shield sequence has two visible wallet operations:

```text
1. ERC-20 approval for the exact authorized token, amount, spender, and spend ceiling
2. STRK20 pool deposit/shield, with screening outcome and current fee recorded
```

Capture an approval hash and a shield hash separately. The approval must not be treated as the pool receipt. The deposit is public metadata and must be labeled accordingly.

Acceptance:

- approval parameters match the authorization and the exact spender;
- approval receipt is accepted before shield is requested;
- screening is explicitly `approved`;
- shield receipt has a matching hash, `SUCCEEDED`, accepted finality, non-null block, and the canonical pool event;
- amount plus fee remains within the authorized maximum spend;
- no combined deposit+private action is used unless the authorization explicitly accepts the resulting depositor/amount/timing correlation.

### G5 — Accepted receipt

A submitted hash is not completion. For each approval, shield, and later private action, record:

```yaml
receipt:
  transaction_hash: null
  execution_status: null       # SUCCEEDED required
  finality_status: null        # ACCEPTED_ON_L2 or ACCEPTED_ON_L1 required
  block_number: null           # required and non-negative
  pool_event_present: false    # required for STRK20 pool action
  sender_ignored_for_identity: true
```

`RECEIVED`, `PENDING`, `UNKNOWN`, missing block, malformed events, mismatched hash, and pre-confirmation `REVERTED` are not accepted receipts. A final reverted receipt is terminal failure and must never be relabeled successful.

### G6 — Pool event and attribution

Find the event whose origin is the canonical STRK20 pool address. The current SN_MAIN pool is:

```text
0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a
```

Record event index, origin address, keys/data as permitted by the public receipt schema, and block/hash. Do not infer private user identity from an event layout that has not been proven for the route. Do not use `sender` as attribution.

For a final submission transaction with declared project contracts, also prove one declared Prism contract event or a declared Prism address in raw transaction calldata. A pool event alone is insufficient after contracts are declared.

### G7 — Note maturity

Do not assume a new note is immediately spendable. The protocol commonly requires roughly ten blocks, but the packet must use an explicit adapter/session observation rather than a hard-coded delay or receipt block arithmetic.

```yaml
maturity:
  shield_transaction_hash: null
  confirmed_block: null
  maturity_target_block: null   # supplied by protocol/session adapter
  current_block: null
  state: null                   # maturing or privately_available
  ready: false
  observation_source: null
```

Acceptance requires `current_block >= maturity_target_block` and a provider/session observation that the note is spendable. If still `maturing`, stop the private-action lane and retain the operation as pending.

### G8 — Explicit private-balance consent and readback

Private-balance access is a deliberate feature, never a capability probe. Before calling the balance surface:

1. show the user a consent prompt explaining that private balance data will be requested;
2. bind consent to the action/session, token set, and timestamp;
3. require a wallet response of `consent: granted`;
4. record that a balance read occurred and what was displayed, without storing a viewing key, note, raw proof, or unnecessary balance payload in this packet;
5. if consent is denied or not returned, stop with `CONSENT_DENIED`/`CONSENT_REQUIRED`.

```yaml
private_balance_consent:
  requested: false
  prompt_presented: false
  user_decision: null          # granted or denied
  token_scope: []
  consent_reference: null      # non-secret audit/reference ID
  balance_readback_observed: false
  displayed_value_handling: OMITTED_OR_ACCESS_CONTROLLED
  raw_private_state_in_packet: false
```

The application service intentionally records consent rather than retaining private balance values. Any correctness assertion must point to an access-controlled wallet/session observation or redacted evidence artifact; it must not expose viewing-key material.

### G9 — Private action

Choose one exact route in the authorization:

- `private_transfer`: wallet-mediated note-to-note transfer; record recipient handling and private-claim boundary.
- `application`: Prism-owned STRK20 helper/anonymizer; record helper address, exact entrypoint/calldata, application result, and atomic rollback behavior.

The default Prism product route is `shield → maturity → consented private state → private action`, not an automatically composed deposit and spend. For a meaningful final Prism-owned helper action, the route must be product-aligned and not a no-op created only to increase transaction count.

The prepared/simulated proof is not evidence and cannot be submitted. A real prepare must return a non-empty wallet-generated proof; a submission fence is set before crossing the wallet/provider boundary.

### G10 — Independent readback

Use two explicitly labeled, different public sources. A second call through the same source or a duplicated response is not independent.

At minimum, independently re-read:

```text
transaction hash
execution status
finality status
block number
canonical pool event origin
helper/project-contract involvement (calldata or event)
public helper balances / no-stranded-balance facts where applicable
```

```yaml
independent_verification:
  primary_source_id: null
  independent_source_id: null
  source_ids_distinct: false
  transaction_hash_match: false
  execution_status_match: false
  finality_match: false
  block_match: false
  pool_event_match: false
  helper_involvement_match: false
  public_balance_match: false
  verified_at: null
```

A disagreement is a stop condition, not a value to be normalized away. The repository's `createIndependentRpcReader` and M5 runner require source IDs to differ and bind transaction/calldata reads to the requested hash.

### G11 — Conservation and no stranded balance

For a Prism-owned helper route, record the route-specific conservation identity. For the current M5/Vesu candidate, the minimum observed facts are:

```text
inputDelivered == authorized input amount
vTokenShares > 0
openNoteAmount > 0
vTokenShares == openNoteAmount
if Vesu shares are observed: Vesu shares == vTokenShares
helper STRK balance == 0
helper vToken balance == 0
```

```yaml
conservation:
  route: null
  input_delivered: null
  output_shares: null
  open_note_amount: null
  helper_public_balances:
    strk: null
    output_token: null
  equations_checked: []
  conservation_ok: false
  no_stranded_balance: false
  observation_source: null
```

Do not claim full conservation from a public helper-balance read alone. The wallet-owned note/open-note observation and the protocol/application event must also be present. A non-zero helper balance or any contradictory explicit observation blocks completion.

### G12 — Privacy limitation record

For each claim, record the observer model and the leakage boundary:

```yaml
privacy_claims:
  - claim_id: null
    route: null
    observer: null
    hidden_datum: []
    visible_datum: []
    linkability_assumptions: []
    amount_timing_leakage: null
    open_note_visibility: null
    claim_supported: false
    limitation: null
```

At minimum, state the public shield metadata, proof/event/timing visibility, relayer non-attribution rule, note-maturity and composition correlation, open-note amount visibility, and the fact that ordinary Base remains public. Do not use “completely invisible”, “untraceable”, “private everywhere”, “all amounts hidden”, “zero metadata”, or equivalent overclaims.

### G13 — Final STRK20 validation and submission boundary

Only after the selected route and evidence packet are accepted:

- collect exactly three distinct final `SN_MAIN` hashes;
- independently re-run the current upstream/hub validator logic for each;
- require `ok=true`, `pool=true`, and `mine=true` where project contracts are declared;
- bind each hash to the exact commit, route, user-visible step, receipt, event, limitations, and independent read;
- obtain separate authorization before editing `strk20.json`.

A repeated hash is one observation, not three submissions. A preparatory G0 hash may remain in the ledger without entering the final submission list.

---

## 4. Backend runtime / Pause / PostgreSQL / reconciliation closeout

This sequence closes the runtime durability and governance seams without conflating them with live privacy evidence.

### R0 — Runtime profile and database isolation

The process must select exactly one immutable profile:

```text
TESTNET → SN_SEPOLIA → prism_testnet
MAINNET → SN_MAIN    → prism_mainnet
```

Production-like runtime requires the explicit profile and its selected database URL. `MAINNET` must never read the testnet or ambiguous legacy URL. The factory creates the selected schema and sets `search_path=<profile schema>,public`; migration versions must be supported and `skipMigration` must not be used in a runtime factory.

Safe diagnostics, with values kept out of output:

```bash
printf 'profile=%s\n' "${PRISM_RUNTIME_PROFILE:-MISSING}"
printf 'network=%s\n' "${STARKNET_CHAIN_ID:-MISSING}"
pg_lsclusters
pg_isready -h 127.0.0.1 -p 5432
```

For an authorized disposable local integration database only, inject the test URL out-of-band and run the integration tier. Never put a production URL, password, or embedded credential in the packet or command transcript. A local socket accepting connections is not proof that the test process used the intended database.

### R1 — Static/runtime preflight

```bash
node ops/target-network/validate.mjs
node ops/starknet/validate.mjs
node ops/evidence/validate.mjs --self-test
node ops/release/validate-mainnet.mjs --self-test
npm run typecheck
npm test
npm run build
git diff --check
```

For an exact backend/runtime closeout, use the repository-native focused suites:

```bash
npx vitest run \
  src/application/__tests__/runtime-profile.test.ts \
  src/application/__tests__/factory-postgres-gating.test.ts \
  src/features/prism-operations/__tests__/event-projection-coordinator.test.ts \
  src/features/prism-operations/__tests__/reconciliation-worker.test.ts \
  src/features/prism-operations/__tests__/recovery-policy.test.ts \
  src/features/prism-pause/__tests__/m7-settlement-durability.test.ts \
  src/features/prism-pause/__tests__/p6-transport-sdk.test.ts \
  src/features/prism-pause/__tests__/p7-adversarial-closeout.test.ts
```

PostgreSQL integration suites are separate and only count when they execute against a dedicated disposable database:

```bash
npx vitest run \
  src/features/prism-identity/__tests__/postgres-ownership-proof-store.integration.test.ts \
  src/features/prism-identity/__tests__/postgres-binding-disclosure-store.integration.test.ts \
  src/features/prism-operations/__tests__/postgres-operation-store.integration.test.ts \
  src/features/prism-operations/__tests__/postgres-event-projection.integration.test.ts \
  src/features/prism-pause/__tests__/postgres-pause-store.integration.test.ts
```

Record the exact URL source as `protected out-of-band` and only report pass counts from the test runner. If the URL is absent and tests skip, record `SKIPPED — not evidence`.

### R2 — PostgreSQL migration, CAS, and reopen evidence

For each selected profile:

1. start or provision only the authorized disposable database;
2. verify profile/network/schema match before constructing stores;
3. let the store factory run idempotent migrations;
4. read back schema version and required tables through the protected test process;
5. round-trip an operation, event, checkpoint, identity proof, and pause;
6. close the stores/factory and reopen them;
7. prove durable values, versions, idempotency keys, submission fences, and checkpoints survive reopen;
8. run concurrent update tests and require exactly one CAS winner;
9. prove duplicate `(tx_hash,event_index)` insertion is benign and does not double-apply;
10. call `AppFactory.shutdown()` and verify worker/pools are closed.

Required invariants:

```text
profile mismatch          → fail closed
schema mismatch           → fail closed
newer unsupported schema  → fail closed
migration/write failure   → fail closed
checkpoint after failed event write → must not advance
operation CAS race        → one winner, stale loser
```

### R3 — Pause approval and release sequence

The authoritative sequence is:

```text
create Intent
→ create and verify exact ExecutionPlan
→ create PAUSED record
→ evaluate policy and typed verification sources
→ RELEASE_READY or ESCALATED
→ approve escalation when policy/authority permits
→ RELEASE with exact plan_hash + approval_scope_hash + authority
→ persist durable settlement Operation before the Pause CAS
→ invoke the selected adapter at most once
→ observe receipt and reconcile
```

Acceptance requirements:

- `plan_hash` is verified and bound to the intent, recipient, policy version, and pause;
- `approval_scope_hash = sha256(pause_id + plan_hash + policy_version)` matches at every approval/release boundary;
- policy version drift, unknown blocking checks, wrong authority, wrong subject, replay, expiry, and stale CAS version fail closed;
- authority comes from the configured resolver; an operator is not authoritative by default;
- PostgreSQL Pause updates include the immutable `plan_hash` predicate;
- settlement operation persistence is preflighted before setting Pause `RELEASED`;
- a losing Pause CAS cancels an unlinked prepared operation when safe;
- `RELEASED` is not settlement completion, and `submitted` is not `completed`.

Owner decisions D-P0-001 through D-P0-005 remain separate gates for Pause canonicalization: scope, release authority, UNKNOWN policy, TTL/sweep policy, and MVP action class. Runtime X2 tests do not silently accept those product/system decisions.

### R4 — Reconciliation and event projection sequence

The durable operation happy path is:

```text
created
→ awaiting_authorization
→ ready
→ submitted
→ processing
→ confirming
→ confirmed
→ indexed
→ reconciled
→ completed
```

Failure states remain distinct: `failed_retryable`, `failed_terminal`, `reverted`, `expired`, `cancelled`, and `requires_attention`.

For every chain-touching operation:

1. persist the operation and idempotency fingerprint before submission;
2. set the submission fence before crossing the provider boundary;
3. persist the returned transaction hash without normalizing a contradictory hash;
4. on restart, load `listNonTerminal()` and resume from the durable hash/state;
5. use `ReconciliationWorker.recoverAtStartup()` / `tickAllOnce()` for bounded sweeps;
6. advance only one legal state at a time; never `submitted → completed`;
7. observe execution status, finality, block, and indexed event independently;
8. persist canonical events before checkpoint CAS;
9. deduplicate by scoped `(registry/network/version, tx_hash, event_index)`;
10. on timeout or ambiguity, move to `requires_attention` and do not rebroadcast automatically;
11. emit metrics for advances, no-ops, dependency failures, stale conflicts, escalation, and reverts;
12. reconcile the derived receipt only after the operation and event/indexer facts agree.

Current worker defaults are bounded and must be recorded if changed: `staleWatermarkK=5`, `sweepLimit=100`, `maxRetries=5`, base backoff `1000ms`, cap `30000ms`, and `requiresAttentionAfterMs=120000`. Serving resolution must refuse an ACTIVE projection older than `confirmedBlock - K` and expose the stale refusal rather than serving stale authority.

### R5 — Runtime acceptance packet

Runtime closeout is accepted only when the packet contains:

```text
exact candidate commit
profile/network/schema selection
migration version and store identity
focused test result counts
PostgreSQL integration result counts or explicit SKIPPED blocker
CAS/idempotency/reopen observations
Pause approval/release/settlement operation observations
worker recovery/reconciliation observations
submitted != completed assertion
checkpoint/event deduplication observations
shutdown result
known external gates and evidence ceiling
```

A worker report or local test count without exact HEAD, commands, and durable readback is not release evidence.

---

## 5. Evidence packet template

Copy this template to an operator-controlled packet file outside the repository. Keep all credential fields absent. Do not replace `null` values with guesses; a validator must reject incomplete records.

```yaml
packet_version: "prism-privacy-runtime-1"
packet_status: PREPARED_X2
prepared_for: null
candidate:
  repository: Prism
  worktree: /home/ubuntu/prism-core-v1-closeout
  commit_sha: 60460be3388c388472b83d7753d0c9d3d52970a3
  branch: core-v1-closeout
  source_dirty_at_freeze: null
  protected_files_untouched: null

track:
  release_track: null                  # core_v1 or strk20_submission
  environment: null                    # SN_SEPOLIA or SN_MAIN
  base_network: null
  base_chain_id: null
  exact_contract_scope:
    strk20_pool_address: 0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a
    project_contracts: []
    allowed_entrypoints: []
    excluded_contracts: []

authorization:
  authorization_id: null
  decision_id: null
  status: PROPOSED
  authorized_by: null
  authorized_at: null
  approval_reference: null
  network: null
  maximum_transaction_count: null
  maximum_spend:
    asset: null
    amount: null
    unit: null
    includes_fees: true
  route: null
  expires_at: null
  stop_conditions_acknowledged: false

build:
  commit_sha: 60460be3388c388472b83d7753d0c9d3d52970a3
  spec_versions:
    starknet_js: 10.4.0
    get_starknet: 6.0.3
    wallet_api_minimum: 0.10.3
    scarb: null
    snforge: null
  commands: []
  results: []

privacy_gates:
  wallet_capability:
    observed: false
    api_versions: []
    specs: []
    provider_reference: null
    balance_probe_used: false
  network_check:
    expected_network: null
    observed_chain_id: null
    classified_environment: null
    match: false
  route_preflight:
    route: null
    token: null
    fee_observed: null
    fee_block: null
    registration: unknown
    amount_within_authorization: false
  approval:
    requested: false
    transaction_hash: null
    receipt:
      execution_status: null
      finality_status: null
      block_number: null
    accepted_receipt: false
  shield:
    requested: false
    transaction_hash: null
    screening: null
    receipt:
      execution_status: null
      finality_status: null
      block_number: null
    accepted_receipt: false
    public_metadata_recorded: false
  pool_event:
    observed: false
    event_origin: null
    event_index: null
    block: null
    attribution_source: pool_event_only
    transaction_sender_used_as_identity: false
  maturity:
    confirmed_block: null
    maturity_target_block: null
    current_block: null
    state: null
    ready: false
    source: null
  private_balance_consent:
    requested: false
    prompt_presented: false
    user_decision: null
    token_scope: []
    consent_reference: null
    balance_readback_observed: false
    raw_private_state_in_packet: false
  private_action:
    kind: null                         # private_transfer or application
    transaction_hash: null
    helper_address: null
    entrypoint: null
    helper_calldata_match: false
    vesu_deposit_observed: false       # required only for the Vesu candidate route
    note_readback_observed: false
    accepted_receipt: false
    submitted_not_completed: true
  independent_readback:
    primary_source_id: null
    independent_source_id: null
    source_ids_distinct: false
    transaction_hash_match: false
    execution_status_match: false
    finality_match: false
    block_match: false
    pool_event_match: false
    project_contract_match: false
    public_balance_match: false
    verified_at: null
  conservation:
    route: null
    input_delivered: null
    output_shares: null
    open_note_amount: null
    helper_public_balances: {strk: null, output_token: null}
    equations_checked: []
    conservation_ok: false
    no_stranded_balance: false
  privacy_claims: []
  limitations: []

runtime_closeout:
  profile: null
  network: null
  postgres_schema: null
  migration_version: null
  stores: []
  postgres_integration:
    executed: false
    result: null
    skipped_reason: null
  pause:
    owner_decisions: []
    plan_hash_match: false
    approval_scope_hash_match: false
    authority_observed: false
    operation_preflight_persisted: false
    released_not_completed: true
  reconciliation:
    worker_recovered_non_terminal: false
    event_persist_before_checkpoint: false
    duplicate_event_idempotent: false
    cas_single_winner: false
    submitted_to_completed_skip_blocked: false
    requires_attention_on_timeout: false
    shutdown_verified: false

strk20_submission:
  final_hashes: []                    # exactly three distinct observed SN_MAIN hashes required
  each_hash_checks:
    - transaction_hash: null
      network: null
      execution_status: null
      block: null
      pool_event: false
      project_contract_involved: false
      hub_validator: {ok: false, pool: false, mine: false}
      independent_readback: false
      evidence_id: null
      strk20_json_included: false
  upstream_validator_source: null
  deadline_reverified_at: null
  separate_strk20_json_authorization: null

maturity:
  claimed: X2
  suggested: X2
  evidence_ceiling: X2
  promotion_blockers: []
  unresolved_gates: []

attestations:
  no_credentials_in_packet: true
  no_viewing_keys_in_packet: true
  no_live_action_by_preparer: true
  no_strk20_json_mutation_by_preparer: true
  no_frontend_changes_by_preparer: true
```

### Packet promotion rules

- `PREPARED_X2` is the only valid status for this preparation artifact.
- Promote a named testnet facet to `X3` only after real testnet observation, accepted receipt, and independent readback.
- Promote repeated independent observations to `X4` only when the repetition is tied to the same implementation/spec and independently reproduced.
- Promote final STRK20 evidence to `X5` only when each final hash is a distinct successful SN_MAIN pool transaction, own-contract validation is satisfied when applicable, the privacy claim has a limitation record, and the current hub validator has been independently rechecked.
- Missing consent, maturity, note readback, conservation, independent readback, or upstream validator evidence keeps the corresponding claim below promotion even when a receipt exists.
- Never write a packet into `strk20.json`; copy only separately authorized, validator-approved final fields at the submission boundary.

---

## 6. Current baseline disposition and unresolved gates

Observed from the preparation baseline and existing repository records:

```text
Local STRK20 domain/adapter/runner implementation: present; X2 only
Wallet capability/manual ready-wallet observation: open
Live network/provider privacy session: not observed
Approval + shield receipt: not observed in this preparation
Accepted pool receipt/event: not observed in this preparation
Maturity oracle/session observation: open
Explicit private-balance consent/readback: open
Private action: local contracts/tests only; live action open
Independent STRK20 readback: open
Conservation/no-stranded-balance: local validators only; live facts open
Privacy limitation record: template/implementation boundary present; live claim record open
Three qualifying SN_MAIN hashes: open; root strk20.json intentionally empty
Owner-approved mainnet scope/authorization: open
PostgreSQL production-like profile/reopen evidence: external gate; local integration only when dedicated URL is injected
Pause owner decisions D-P0-001..005: open for canonicalization
Live settlement adapter/receipt tail: open
Worker process restart against real Postgres/RPC: open
```

The baseline's honest aggregate status is **`PREPARED_X2 / NOT_MAINNET_READY / PRIVACY_EXTERNAL_GATE_OPEN`**. No line in this runbook changes that status.

---

## 7. Source map

This runbook consolidates, without replacing, the following repository authorities:

- `projects/prism/EVIDENCE_LEDGER.md`
- `profiles/STRK20_PRIVACY_PROFILE.md`
- `profiles/STARKNET_MAINNET_EVIDENCE_PROFILE.md`
- `docs/STRK20_CONTEXT.md`
- `STRK20_INTEGRATION_PLAN.md`
- `ops/evidence/README.md`
- `ops/release/mainnet-release-packet.template.json`
- `ops/release/READINESS_CHECKLIST.md`
- `projects/prism/MAINNET_PREPARATION_HANDOFF.md`
- `docs/POSTGRES_RUNTIME_PROFILES.md`
- `BACKEND_RUNTIME_CLOSURE_AUDIT.md`
- `BACKEND_PHASE_M2_RUNTIME_LEDGER_RECONCILIATION_CLOSEOUT.md`
- `docs/BACKEND_RUNTIME_PAUSE_IDENTITY_LANE_RESTART.md`
- `docs/PAUSE_P0_OWNER_DECISION_PACKET.md`
- `docs/M7_PAUSE_RUNTIME_GAP_AUDIT.md`
- `src/features/prism-strk20/m5/runner.ts`, `validation.ts`, `maturity.ts`, `operation.ts`
- `src/features/prism-strk20/application/privacy-action-service.ts`
- `src/features/prism-strk20/domain/privacy-guard.ts`, `wallet-capability.ts`, `strk20-action-port.ts`
- `src/features/prism-operations/domain/operation.ts`, `reconciliation-worker.ts`, `event-projection-coordinator.ts`
- `src/features/prism-pause/application/pause-service.ts`, `pause-settlement-bridge.ts`
- official STRK20 sources listed in §1.3

Historical candidate SHAs in older handoffs are not substituted for the exact frozen HEAD recorded at the top of this artifact.
