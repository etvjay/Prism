# Private/Public Binding Storage Boundary

Status: implemented backend slice, locally verified at X2 (unit + local PostgreSQL evidence).

This document describes the storage and service boundary for binding disclosure. It does **not** claim deployed-chain, mainnet, browser, or production key-management evidence.

## Invariants

1. The domain binding model keeps `PUBLIC`, `SELECTIVE`, and `PRIVATE` distinct from the independent `PERSISTENT`, `SESSION`, and `EPHEMERAL` lifecycle axis.
2. Durable v0 narrows that model explicitly to `PERSISTENT` + `PUBLIC`/`PRIVATE`. `SELECTIVE`, `SESSION`, and `EPHEMERAL` are rejected/deferred at the service/store/route seam; they are never silently collapsed into a public or private row.
3. A stored binding has one current disclosure visibility: `PUBLIC` or `PRIVATE`.
4. `PUBLIC` storage contains an endpoint projection and no protected endpoint envelope.
5. `PRIVATE` storage contains an opaque protected endpoint envelope and **no endpoint plaintext**.
6. Owner authorization is a separate injected port. An app session, `userId`, actor label, or UI state is not ownership proof.
7. Version, current visibility, current status, and identity are part of every mutation CAS.
8. Once a binding has been public, `historicalPublic` and `publiclyExposedAt` cannot be erased by this boundary.
9. `PUBLIC -> PRIVATE` means stop future Prism publication/resolution after a protected replacement is durably available. It does not erase blockchain history or third-party indexes.
10. Private operations fail closed unless the key-management port proves encryption at rest, key ownership, and recovery.
11. No private endpoint is sent to an onchain/public publisher by this slice. Canonical chain publication is intentionally not wired here.

## Durable PostgreSQL schema

`PostgresBindingDisclosureStore` owns the `prism_binding_disclosures` table. The migration is exported as `BINDING_DISCLOSURE_STORE_MIGRATION_SQL` and is idempotent.

The database-level boundary is:

```text
PUBLIC:
  endpoint_json              NOT NULL
  protected_endpoint_json    NULL
  historical_public          TRUE
  publicly_exposed_at        NOT NULL

PRIVATE:
  endpoint_json              NULL
  protected_endpoint_json    NOT NULL
```

The schema also stores `version`, `status`, `historical_public`, `publicly_exposed_at`, `hidden_at`, and timestamps. An independent metadata table tracks the supported schema version. Values are written through parameterized PostgreSQL queries only.

The store's `compareAndSet` is one conditional `UPDATE` guarded by:

- `binding_id`;
- `prism_id`;
- expected version;
- expected current visibility;
- expected current status; and
- a monotonic historical-public predicate.

A losing concurrent writer receives `false`; it must not present its stale result as applied.

## Service boundary

`BindingDisclosureService` provides:

- `createPublicBinding` — owner-authorized public record;
- `createPrivateBinding` — owner-authorized, key-management-gated protected record;
- `listPublicBindings` — active PUBLIC rows only, with no owner authorization requirement;
- `listOwnerBindings` / `getOwnerBinding` — owner-authorized; PRIVATE endpoints are recovered through the protection port;
- `hidePublicBinding` — protected `PUBLIC -> PRIVATE` CAS with a historical-public warning;
- `makePublic` — explicit exposure confirmation plus proven recovery before `PRIVATE -> PUBLIC`;
- `revokeBinding` — owner-authorized versioned revocation.

The public view type has no PRIVATE variant. The owner view never returns protected ciphertext or key metadata.

The public HTTP contract is `GET /v1/identity/:prismId/bindings` (the existing `POST` canonical public bind route remains unchanged). It uses `listPublicForIdentity` and returns only ACTIVE PUBLIC projections. A `visibility=SELECTIVE`, private audience, or non-persistent lifecycle selector is rejected/deferred rather than interpreted as public.

The owner/private contract is `GET /v1/identity/:prismId/bindings/private`. It requires a session, passes the session only as an actor claim to the owner-authorization port, filters to PRIVATE rows, and has no public fallback. Missing/denied owner authority maps to a stable authorization response; missing/unproven/failed key management maps to `BLOCKED_BY_KEY_MANAGEMENT` without returning a private endpoint.

The application factory constructs the in-memory store only for isolated test/development factories and the PostgreSQL store (including migration and shutdown) when a PostgreSQL URL is configured. The default protection adapter is explicitly unconfigured and fail-closed; no encryption provider or ownership decision is fabricated.

## Key-management ceiling

This repository does not invent encryption, key generation, key ownership, or recovery. `PrivateBindingProtectionPort` is the typed integration point:

```text
getReadiness({ prismId, actor })
  -> PROVEN(encryptionAtRest, keyOwnership, recovery, keyRef, ...)
  -> BLOCKED

protect(endpoint)
  -> opaque ciphertext + the same proof

reveal(protectedEndpoint)
  -> endpoint + the same proof
```

If the port is missing, blocked, throws, changes its evidence, or returns an obvious plaintext-as-ciphertext result, the service returns `BLOCKED_BY_KEY_MANAGEMENT` and does not create or transition a private row. `UnconfiguredPrivateBindingProtection` is an explicit fail-closed adapter, not an encryption implementation.

The proof fields are evidence requirements, not proof that this repository has a secure provider. A real deployment still needs an independently reviewed provider with user/owner key binding, encryption-at-rest guarantees, backup/recovery tests, rotation/versioning, access controls, and operational evidence.

## Historical-public warning

A binding hidden after public exposure returns:

```text
HISTORICAL_PUBLIC_LINKAGE

This binding was public previously. Prism can stop future publication and
resolution, but blockchain history or third-party indexes may retain the
association.
```

The warning is derived from durable `historicalPublic` state and is not a claim of historical unlinkability.

## Public/onchain boundary

This slice contains no onchain binding publisher and does not modify the existing identity routes or registry contracts. A future publisher must accept only a public projection and must never receive a PRIVATE stored record or private endpoint plaintext. A public PostgreSQL row in this slice means it is available to the service's public-resolution projection; it is not evidence of a chain transaction.

No private endpoint is hidden merely by a frontend flag. This slice does not use `localStorage`, and it makes no claim that ordinary browser `localStorage` is secure storage. Browser-local demonstration storage, if added elsewhere, must be labeled demo-only and must not be treated as encrypted, owner-controlled, recoverable persistence.

## Evidence run

The following tests were run against the repository at the implementation baseline:

- `binding-disclosure-service.test.ts` — owner authorization, key-management blocking, public/private isolation, historical warning, explicit exposure confirmation, stale CAS, recovery failure, and revocation adversaries.
- `binding-disclosure-store.test.ts` — in-memory representation separation, owned copies, CAS winner, monotonic history, duplicate and malformed-row rejection.
- `postgres-binding-disclosure-store.test.ts` — parameterized SQL contract, schema constraints, row mapping, plaintext boundary checks, CAS predicates, driver failures, and lifecycle.
- `postgres-binding-disclosure-store.integration.test.ts` — gated on `PRISM_POSTGRES_TEST_URL`; with the local PostgreSQL service available, migration/round-trip, public filtering, independent-pool CAS, restart durability, and dead-endpoint behavior passed.

These are local implementation/evidence results. They do not establish production encryption, key ownership, disaster recovery, deployment, testnet/mainnet publication, or independent chain readback.

## Files

- `src/features/prism-identity/domain/binding-disclosure.ts`
- `src/features/prism-identity/application/binding-disclosure-service.ts`
- `src/features/prism-identity/adapters/memory-binding-disclosure-store.ts`
- `src/features/prism-identity/adapters/postgres-binding-disclosure-store.ts`
- `src/features/prism-identity/adapters/unconfigured-private-binding-protection.ts`
- corresponding unit, SQL-contract, adversarial, and gated PostgreSQL integration tests
