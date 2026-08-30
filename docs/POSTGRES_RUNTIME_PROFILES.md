# PostgreSQL runtime profiles

The server selects one immutable runtime profile at startup:

- `TESTNET` → `SN_SEPOLIA`, `PRISM_POSTGRES_TESTNET_URL`, schema `prism_testnet`.
- `MAINNET` → `SN_MAIN`, `PRISM_POSTGRES_MAINNET_URL`, schema `prism_mainnet`.

Production requires `PRISM_RUNTIME_PROFILE` (or the existing `PRISM_TARGET_ENV` alias) and the selected profile URL. `MAINNET` never reads `PRISM_POSTGRES_TEST_URL` or the ambiguous `PRISM_POSTGRES_URL`. The legacy aliases remain TESTNET-only for compatibility.

The factory creates the selected schema before migrations and gives every PostgreSQL pool an explicit `search_path=<profile schema>,public`. Consequently, unqualified tables and migration metadata cannot cross networks when both profiles share a PostgreSQL cluster. A configured schema must exactly match the profile. Network mismatches, malformed URLs, missing production configuration, and invalid migration versions fail closed before stores are constructed.

`PRISM_POSTGRES_MIGRATION_VERSION` is an optional positive-integer deployment assertion. Store adapters still perform their own version checks and reject databases newer than the adapter; migrations are idempotent. Do not set `skipMigration` in a runtime factory.

All durable stores expose idempotent `close()` methods. `AppFactory.shutdown()` stops reconciliation and closes every pool; use it during graceful process shutdown and tests.

## Safe local test configuration

Use a disposable local database or separate schemas and never put production credentials in `.env` or test output. The unit contract tests run without PostgreSQL. Integration tests are opt-in through the existing `PRISM_POSTGRES_TEST_URL` path and should only point at a disposable local database.

This contract is implementation/readiness evidence only. It does not establish mainnet deployment, migration execution, chain configuration, or operational approval.
