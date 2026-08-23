# Starknet / sncast / provider / account — validation (secret-free)

All commands below are safe to run without secrets or live-network access.
Any command that would require a secret is marked `OFFLINE — requires env` and is **not** expected to pass in CI.

---

## 1. Static checks (no secrets, no RPC)

```bash
# Manifest is still PROPOSED (correctly blocking deployment)
node ops/target-network/validate.mjs
# Expected before owner decision:
#   ✕ owner_decision UNDECIDED — correctly blocking promotion

# Starknet templates contain no secrets and reference env vars
node ops/starknet/validate.mjs
# Checks performed:
#   - contracts/prism_identity_registry/snfoundry.toml has only commented placeholder profiles
#   - ops/starknet/sncast.toml.example + provider.example.toml + accounts.json.example contain no hex private key
#   - env var names STARKNET_RPC_URL / STARKNET_SEPOLIA_RPC_URL etc. are referenced, not hard-coded URLs with keys
#   - no mainnet profile is marked as default

# Evidence envelope builder (no deployment)
node ops/evidence/validate.mjs --self-test   # fixture envelopes: valid vs missing-field rejections

# Bundle hygiene (already required for review)
npm run typecheck
npm run build
git diff --check
npm test
```

Expected in Bundle 3T worktree before owner decision:

```
ops/target-network:  ✕ UNDECIDED (blocking — correct)
ops/starknet:        ✓ secret-free templates pass
ops/evidence:        ✓ self-test passes (promotion blocked when fields missing)
npm test:            ✓ 197 passed | 14 skipped (or similar, depending on harness count)
typecheck/build:     ✓ PASS
strk20.json:         ✕ empty (correct — do not populate from testnet)
```

---

## 2. Toolchain checks (no secrets, local only)

```bash
# Contract toolchain (no RPC, no deployment)
scarb build --manifest-path contracts/prism_identity_registry/Scarb.toml
snforge test --manifest-path contracts/prism_identity_registry/Scarb.toml
# Expected: scarb build ok, snforge 7+ tests pass (counter, auth, events)
# Pins: scarb 2.20.0 / snforge 0.63.0 per STACK_DECISIONS SD-007 — run `scy --version` only for record
```

---

## 3. Env contract (values live outside repo)

Required env vars for a real testnet run (provide via shell / `.env` file excluded by `.gitignore`):

```dotenv
# testnet (default) — see .env.example + ops/target-network/manifest.yaml
STARKNET_RPC_URL=https://<sepolia-rpc-without-committing>/v0_7
NEXT_PUBLIC_STARKNET_RPC_URL=https://<sepolia-rpc-public-or-restricted>/v0_7
NEXT_PUBLIC_STARKNET_NETWORK=SN_SEPOLIA
BASE_RPC_URL=https://<base-sepolia-rpc>
BASE_CHAIN_ID=84532
STARKNET_SEPOLIA_DEPLOYER_PRIVATE_KEY=<never commit>
# or: STARKNET_SEPOLIA_KEYSTORE_PATH=~/.starknet-accounts/keystores/sepolia.json
```

Validate presence without printing secrets:

```bash
test -n "$STARKNET_RPC_URL" && echo "STARKNET_RPC_URL set (redacted)" || echo "MISSING — expected for live testnet"
test -n "$BASE_RPC_URL" && echo "BASE_RPC_URL set (redacted)" || echo "MISSING — expected for live testnet"
# The harness `ops/testnet/decisive-sequence.harness.ts` asserts
# STARKNET_RPC_URL is present and chainId == 84532; it never logs the value.
```

---

## 4. Dry-run deployment command checks (offline, secret-free)

Every live `sncast` broadcast must first be validated with `--dry-run` (or `--simulate`) without touching RPC:

```bash
# Dry-run syntax validation (offline — no env, no RPC)
node ops/starknet/dry-run-check.mjs
# Checks: templates are env-var driven, manifest still PROPOSED/UNDECIDED,
# no active sncast.toml, no un-gated bare `sncast deploy` without --dry-run/OFFLINE marker.

# Toolchain dry-run (no RPC, no deployment) — validates class hash without broadcasting:
sncast --profile sepolia declare --contract-name PrismIdentityRegistry --dry-run
sncast --profile sepolia deploy --class-hash 0x... --constructor-calldata 0x... --dry-run
# These commands parse calldata, compile, and simulate without broadcasting;
# they are safe to run once STARKNET_SEPOLIA_RPC_URL is set, but still require owner gate.
# In Bundle 3T they are NOT executed — they are documented as the next dry-run gate after DEC-PRISM-OPS-001.
```

---

## 5. Live-network checks (OFFLINE — requires funded deployer + owner gate)

These are **NOT** run in Bundle 3T. They are documented only for the owner-approval packet that follows.

```bash
# Starknet account / provider (requires env + funded account)
sncast --profile sepolia account list          # should list sepolia-deployer without printing secret
sncast --profile sepolia call --contract-address 0x... --function get_identity --calldata 0x...

# Evidence envelope independent re-read (requires live tx + explorer/RPC)
node ops/evidence/build.mjs --env testnet --tx <TX_HASH> --out /tmp/envelope.json
node ops/evidence/validate.mjs /tmp/envelope.json --require-independent-read

# Decisive sequence (requires SN_SEPOLIA + Base Sepolia funded wallets)
npm run testnet:decisive -- --env testnet --prism-id auto --base-address 0x...
# Harness asserts create→read→Base proof→bind→resolve→revoke→NO_ACTIVE→P persists,
# independent reads, and X-maturity downgrade to X2 when live observation absent.
```

Live runs record their transaction hash, block, status, class hash, and independent read under `ops/evidence/envelopes/` and are promoted to `EVIDENCE_LEDGER.md` only after `X maturity = X3` (testnet) / `X4/X5` (mainnet + second read) per the ledger `evidence template`.

---

## 6. What must NOT happen

- No secret (RPC URL with key, private key, keystore content) is ever committed — `ops/starknet/validate.mjs` fails on any `0x` 64-hex private key literal or `alchemy.com/v2/<key>`-like string.
- No `sncast` profile is wired to a real RPC URL by default in the repo — all profiles reference env vars.
- No `strk20.json` transaction is written from any validator or harness.
- No live Starknet/Base network is contacted by any validator or test in this bundle (`validate.mjs` and `npm test` are fully offline).

---

*Keep the trust boundary explicit: the backend is a TRUSTED VERIFIER for proof validity only (DEC-PRISM-SYS-001 Option A); no “trustless” claim is made until onchain evidence exists.*
