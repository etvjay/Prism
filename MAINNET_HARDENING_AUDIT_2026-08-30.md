# Prism Mainnet Hardening Audit — 2026-08-30

## Verdict

**BLOCKED** — not `MAINNET_READY`.

This is a read-only audit of fresh worktree `e3fa4b80e9b3e6a0277f39f620b7b264b35e5bf2` (`build: exclude vendored libraries from app typecheck`). No deployment, broadcast, `strk20.json` mutation, frontend mutation, or secret access was performed. X2 fixtures, source-level claims, and supplied receipts were not promoted to mainnet evidence.

## Evidence ledger reconciliation

`projects/prism/EVIDENCE_LEDGER.md` is v0.2. Current live evidence is testnet-scoped:

- `EVD-PRISM-004`: SN_SEPOLIA create/read, current `X3`, with independent provider reads; repeated durable reconciliation and full M1 closure remain open.
- `EVD-PRISM-014`: Registry V2 and direct M3 bind/revoke facts on SN_SEPOLIA, `X3`; durable/repeated projection and mainnet evidence remain open.
- `EVD-PRISM-005..007`, balances, and all `EVD-STRK20-001..006`: `X0` / `NOT_IMPLEMENTED`.
- `EVD-PRISM-012`: wallet capability local `X2`; `EVD-PRISM-013`: landing/local product `X2`.
- `strk20.json` remains intentionally empty (`transactions: []`, `contracts: []`, blank demo fields).

No SN_MAIN transaction hash, SN_MAIN deployment receipt, pool event, Prism-contract involvement, hub-equivalent `ok=true/pool=true/mine=true`, or independently rechecked final submission hash was found. No LayerZero evidence changes this: `evidence/lz-support-blocker-2026-08-30.md` records `LZ_BILATERAL_BLOCKED_EXACTLY`, including absent destination execution/readback.

## Configuration and version pins

- Mainnet manifest (`ops/target-network/manifest.yaml`) is `RELEASE_GATED_PROPOSED`; it declares SN_MAIN, Base Mainnet chain ID `8453`, and the canonical STRK20 pool only. It does **not** declare a mainnet Registry address/class hash, helper address/class hash, deployment block, or frozen contract set.
- Owner decision selects `testnet` only (`DEC-PRISM-OPS-001`); it does not authorize mainnet.
- `.env.example` is testnet-default (`SN_SEPOLIA`) and contains only placeholders. Mainnet pool address is a reference only.
- `src/application/factory.ts` rejects the canonical V2 configuration outside SN_SEPOLIA (`canonical_v2_network_mismatch`) and has no mainnet Registry V2 address/class-hash pin. A mainnet runtime cannot be claimed configured from current repository settings.
- JS pins: starknet `10.4.0`, `@starknet-io/types-js` `0.10.3`, get-starknet packages `6.0.3`, viem lockfile `2.55.19`, TypeScript lockfile `5.9.3`, Vitest lockfile `4.1.11`; Next package range is `^16.0.8` and lockfile resolves `16.3.1` (range, not exact pin).
- Cairo pins: Cairo/Scarb `2.20.0`, snforge `0.63.0`, OpenZeppelin `2.0.0`; vendored LayerZero is path-based and requires separate dependency/version provenance review before mainnet.
- REST contract is documented in `docs/api/openapi.yaml` as OpenAPI `3.1.0`, API version `1.0.0`; SDK/MCP are handwritten TypeScript boundaries. No generated schema artifact or automated OpenAPI/SDK/MCP parity validator was found.

## REST / SDK / MCP

Positive findings:

- REST handlers use stable error envelopes, request/correlation echo, idempotency and CAS headers, watermark/ETag fields, stack/detail redaction, and separate application-session vs controller/Base proof authority.
- MCP is a thin adapter over the same `PrismClient`; blocked names include viewing-key/signing/bypass operations; channel tools are explicitly testnet-only.
- Factory production mode fail-closes when Postgres, Starknet read, or concrete submit configuration is absent; test doubles are explicitly test-mode gated.

Open release findings:

- SDK pause `verify/release/approve` methods do not expose/forward the new `planHash`, `approvalScopeHash`, or `settlementOperationId` binding fields. The server may fall back to stored values, so this is incomplete end-to-end hardening and coverage, not proof of a bypass.
- `negotiateVersion()` treats a missing API-version header as supported `v1`; this is permissive rather than strict schema/version pinning.
- MCP input schemas are minimal and do not appear generated or runtime-validated against OpenAPI/application schemas. This is insufficient as a mainnet compatibility contract without a parity gate.
- Current factory/runtime docs explicitly leave Pause settlement adapters, live submit/receipt tail, repeated reconciliation, and testnet rehearsal open.

## Auth, rate limits, and observability

- Signed HMAC app sessions exist (`PRISM_APP_SESSION_SECRET`, issuer/audience, expiry, revocation IDs, timing-safe signature comparison) and production `requireAuthenticatedSession` rejects unsigned fixtures. However, no production session issuance/identity-provider integration or deployment configuration was observed; SDK body/header fixture sessions work only in test mode.
- Viewing/private-key/seed/mnemonic fields are guarded in STRK20 and wallet-session boundaries; no secret values were printed or inspected. Private binding protection defaults to an explicit blocked adapter until a real provider proves encryption-at-rest, key ownership, and recovery.
- Correlation/request/idempotency/version headers and Pause/reconciliation metric hooks exist, but there is no HTTP rate-limit implementation: no `rate-limit`, `x-ratelimit`, `Retry-After`, or equivalent limiter was found in `src`. There is no production metrics exporter, structured audit log, tracing/telemetry integration, or alerting configuration. In-memory/Noop metrics are not operational observability evidence.
- `parseSession`/legacy `requireSession` contains permissive fixture-style parsing, while strict writes use `requireAuthenticatedSession`; every public/read route and every command route must be reviewed and tested against the intended production auth policy before exposure.

## Signer and funding preflight

- Locations are documented in `ops/starknet/sncast.toml.example`, `ops/starknet/provider.example.toml`, `ops/starknet/accounts.json.example`, and `ops/starknet/VALIDATION.md`.
- Templates reference env/keystore names and contain no secrets; no active `sncast.toml` is committed.
- No mainnet deployer address, keystore, signer policy, funding amount, fee reserve, multisig/approval procedure, or funded-account readback exists in this worktree. `mainnet-deployer` is a placeholder only.
- Mainnet provider names in the example are `STARKNET_MAINNET_RPC_URL`/`BASE_MAINNET_RPC_URL`, while application runtime configuration centers on `STARKNET_RPC_URL`/`BASE_RPC_URL`; this requires one explicit, reviewed environment contract before release.
- No dry-run/live mainnet signer or funding preflight was run. No secrets were accessed.

## Validation results

Passed:

- `node ops/target-network/validate.mjs`
- `node ops/starknet/validate.mjs`
- `node ops/starknet/dry-run-check.mjs`
- `node ops/evidence/validate.mjs --self-test`
- `node ops/m1-live-read/validate.mjs --self-test`
- `npm ci --ignore-scripts` — 177 packages, audit reported 0 vulnerabilities
- `npm test` — 134 files passed, 7 skipped; 1312 tests passed, 40 skipped
- `npm run typecheck`
- `npm run build` — Next 16.3.1, all listed routes built
- `scarb build` from `cairo/`
- `snforge test` from `cairo/` — 1 passed, 0 failed
- `git diff --check`

Initial fresh-worktree `npm test` failed only because dependencies were absent (`vitest/config` unresolved); after `npm ci --ignore-scripts`, the full suite passed. The documented `scarb build --manifest-path ...` command is invalid for Scarb 2.20.0; the equivalent build was run from `cairo/` and passed. This documentation/tooling drift should be corrected before release.

## Open gates — all are blocking for MAINNET_READY

1. Explicit owner mainnet release decision and accepted mainnet manifest; current state is testnet-selected plus `RELEASE_GATED_PROPOSED`.
2. Frozen exact SN_MAIN configuration: Registry/helper addresses, class hashes, deployment blocks, constructor parameters, ABI/schema versions, and immutable contract set.
3. Mainnet signer/funding preflight: approved signer policy, funded account, fee reserve, non-secret readback, and dry-run evidence.
4. SN_MAIN deployments and independent receipt/readback evidence for every required contract.
5. G0 supported-wallet STRK20 mainnet pool reachability and current fee/readiness observation.
6. Complete Prism-owned pool-integrated helper action with pool event, helper calldata, typed downstream result, privacy boundary, conservation/no-strand, and independent second read.
7. At least three final SN_MAIN transactions satisfying current hub `ok=true`, `pool=true`, and (contracts declared) `mine=true`; then independently recheck each against current upstream validator and only then populate `strk20.json`.
8. M3 live Base proof/bind/resolve/revoke decisive sequence, including chain ID 8453 where applicable, replay/expiry/wrong-signer/alteration cases, and independent reads.
9. M4/M5 live supported Wallet API/prover path, private-note/maturity/receipt evidence; current M5 evidence explicitly says `BLOCKED_BY_EXTERNAL_PRIVACY_PROVIDER` and no mock/X2 promotion is valid.
10. Band B release dependencies: Pause P0 canonical acceptance, P5 settlement adapters, P6 SDK/API hardening, P7 production observability, P8 testnet evidence, durable Postgres/restart reconciliation, and full M8 rehearsal.
11. Production auth integration and route-by-route authorization review, plus SDK signed-session/version behavior that is actually usable outside test fixtures.
12. Production HTTP rate limiting, abuse controls, structured/auditable telemetry, metrics export, alerting, and correlation-to-operation/receipt retention policy.
13. REST/OpenAPI/SDK/MCP schema parity and exact version compatibility gate; remove permissive missing-version negotiation.
14. Correct release documentation/tooling drift (`scarb --manifest-path` references) and an explicit mainnet environment-variable naming contract.

## Final classification

Local implementation and adversarial tests are green at X2; selected testnet facts reach X3 in limited ledger rows. The release contract is Band B, and its testnet rehearsal/mainnet prerequisites are not closed. **Final verdict: BLOCKED.**
