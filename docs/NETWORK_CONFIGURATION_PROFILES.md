# Network configuration profiles

The application has two isolated, typed configuration profiles:

- `TESTNET_PROFILE` (`SN_SEPOLIA+BASE_SEPOLIA`) is the default and contains only the existing testnet Registry V2 facts.
- `MAINNET_PROFILE` (`SN_MAIN+BASE_MAINNET`) is release-gated and intentionally contains `null` figures until the exact deployed values are supplied.

`src/config/network-profile.ts` is the validation boundary. A mainnet profile is runnable only when all of the following are present and independently validated:

- SN_MAIN Registry address, class hash, deployment block, constructor parameters, ABI version, and schema version.
- Base Mainnet Registry, helper, and OApp address, class hash, deployment block, constructor parameters, ABI version, and schema version.
- Exact network identity and chain ID (`SN_MAIN+BASE_MAINNET`, `8453`).
- A non-empty immutable contract set containing all four contracts.
- `status: READY`, `independentlyValidated: true`, and a non-empty validation source.

Nulls, placeholders, malformed addresses, missing blocks/constructor parameters/version pins, cross-network chain IDs, and incomplete immutable sets throw before a provider or effectful runtime can consume the profile. No address or class hash is guessed or copied from testnet.

The machine-readable manifest mirrors these fields under `environments.mainnet` and remains `RELEASE_GATED_PROPOSED`; it is not an authorization to deploy. `strk20.json` is not written by profile validation and remains outside this change.

Verification (read-only):

```bash
npm test -- --run src/config/__tests__/mainnet-profile.test.ts
node ops/target-network/validate.mjs
npm run typecheck
```
