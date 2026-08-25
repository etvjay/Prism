import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import {
  PostgresBindingDisclosureStore,
  PostgresBindingDisclosureStoreError,
} from "../adapters/postgres-binding-disclosure-store";
import type { PrivateStoredBinding, PublicStoredBinding } from "../domain/binding-disclosure";

const TEST_URL = process.env.PRISM_POSTGRES_TEST_URL;
const suite = TEST_URL ? describe : describe.skip;
const TEST_SCHEMA = `prism_binding_${process.pid}`;
const PUBLIC_ENDPOINT = {
  id: "endpoint-public",
  chain: "BASE" as const,
  chainId: "8453",
  kind: "ACCOUNT" as const,
  address: "0xabc0000000000000000000000000000000000001",
};
const PROTECTED = {
  ciphertext: "opaque-live-ciphertext",
  evidence: {
    encryptionAtRest: "PROVEN" as const,
    keyOwnership: "PROVEN" as const,
    recovery: "PROVEN" as const,
    keyRef: "live-test-key-ref",
    algorithm: "provider-defined",
    schemaVersion: 1,
  },
};

function publicRecord(id: string): PublicStoredBinding {
  return {
    schemaVersion: 1,
    bindingId: id,
    prismId: "prism:P7F21",
    visibility: "PUBLIC",
    status: "ACTIVE",
    version: 0,
    endpoint: PUBLIC_ENDPOINT,
    protectedEndpoint: null,
    historicalPublic: true,
    publiclyExposedAt: 100,
    hiddenAt: null,
    createdAt: 100,
    updatedAt: 100,
  };
}

function privateRecord(id: string, overrides: Partial<PrivateStoredBinding> = {}): PrivateStoredBinding {
  return {
    schemaVersion: 1,
    bindingId: id,
    prismId: "prism:P7F21",
    visibility: "PRIVATE",
    status: "ACTIVE",
    version: 0,
    endpoint: null,
    protectedEndpoint: PROTECTED,
    historicalPublic: false,
    publiclyExposedAt: null,
    hiddenAt: null,
    createdAt: 101,
    updatedAt: 101,
    ...overrides,
  };
}

function options(extra: Record<string, unknown> = {}) {
  return { connectionString: TEST_URL, options: `-c search_path=${TEST_SCHEMA}`, ...extra };
}

let admin: Pool;
let store: PostgresBindingDisclosureStore;

beforeAll(async () => {
  if (!TEST_URL) return;
  admin = new Pool({ connectionString: TEST_URL, max: 2 });
  await admin.query(`CREATE SCHEMA IF NOT EXISTS ${TEST_SCHEMA}`);
  store = await PostgresBindingDisclosureStore.create(options({ max: 10 }));
});

afterAll(async () => {
  if (store) await store.close().catch(() => undefined);
  if (admin) {
    await admin.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`).catch(() => undefined);
    await admin.end().catch(() => undefined);
  }
});

suite("PostgresBindingDisclosureStore (LIVE local PostgreSQL evidence)", () => {
  it("migrates and round-trips PUBLIC and PRIVATE records with disjoint columns", async () => {
    const publicRow = publicRecord("binding-live-public");
    const privateRow = privateRecord("binding-live-private");
    await store.put(publicRow);
    await store.put(privateRow);

    expect(await store.getById(publicRow.bindingId)).toEqual(publicRow);
    expect(await store.getById(privateRow.bindingId)).toEqual(privateRow);

    const raw = await admin.query(
      `SELECT binding_id, endpoint_json, protected_endpoint_json FROM ${TEST_SCHEMA}.prism_binding_disclosures WHERE binding_id IN ($1,$2) ORDER BY binding_id`,
      [publicRow.bindingId, privateRow.bindingId],
    );
    expect(raw.rows).toEqual([
      { binding_id: "binding-live-private", endpoint_json: null, protected_endpoint_json: JSON.stringify(PROTECTED) },
      { binding_id: "binding-live-public", endpoint_json: JSON.stringify(PUBLIC_ENDPOINT), protected_endpoint_json: null },
    ]);
  });

  it("public listing excludes PRIVATE and REVOKED rows", async () => {
    const privateRow = privateRecord("binding-live-private-filter");
    const revokedRow = { ...publicRecord("binding-live-revoked"), status: "REVOKED" as const };
    await store.put(privateRow);
    await store.put(revokedRow);

    const rows = await store.listPublicForIdentity("prism:P7F21");
    expect(rows.every((row) => row.visibility === "PUBLIC" && row.status === "ACTIVE")).toBe(true);
    expect(rows.some((row) => row.bindingId === privateRow.bindingId)).toBe(false);
    expect(rows.some((row) => row.bindingId === revokedRow.bindingId)).toBe(false);
  });

  it("CAS race across independent pools has one winner and preserves historical-public evidence", async () => {
    const initial = publicRecord("binding-live-cas");
    await store.put(initial);
    const next = privateRecord(initial.bindingId, {
      prismId: initial.prismId,
      version: 1,
      historicalPublic: true,
      publiclyExposedAt: 100,
      hiddenAt: 200,
    });
    const contenders = await Promise.all(Array.from({ length: 8 }, () => PostgresBindingDisclosureStore.create(options({ max: 2, skipMigration: true }))));
    try {
      const results = await Promise.all(contenders.map((candidate) => candidate.compareAndSet({
        bindingId: initial.bindingId,
        prismId: initial.prismId,
        expectedVersion: 0,
        expectedVisibility: "PUBLIC",
        expectedStatus: "ACTIVE",
        next,
      })));
      expect(results.filter(Boolean)).toHaveLength(1);
      expect((await store.getById(initial.bindingId))?.historicalPublic).toBe(true);
      expect((await store.getById(initial.bindingId))?.visibility).toBe("PRIVATE");
    } finally {
      await Promise.all(contenders.map((candidate) => candidate.close()));
    }
  });

  it("restart/reopen retains private envelope, CAS version, and historical warning state", async () => {
    const initial = publicRecord("binding-live-restart");
    await store.put(initial);
    const next = privateRecord(initial.bindingId, {
      prismId: initial.prismId,
      version: 1,
      historicalPublic: true,
      publiclyExposedAt: initial.publiclyExposedAt,
      hiddenAt: 300,
    });
    expect(await store.compareAndSet({
      bindingId: initial.bindingId,
      prismId: initial.prismId,
      expectedVersion: 0,
      expectedVisibility: "PUBLIC",
      expectedStatus: "ACTIVE",
      next,
    })).toBe(true);

    await store.close();
    store = await PostgresBindingDisclosureStore.create(options());
    const reopened = await store.getById(initial.bindingId);
    expect(reopened).toMatchObject({ visibility: "PRIVATE", version: 1, historicalPublic: true, hiddenAt: 300 });
    expect(reopened && "endpoint" in reopened && reopened.endpoint).toBeNull();
    expect(reopened && "protectedEndpoint" in reopened && reopened.protectedEndpoint).toEqual(PROTECTED);
  });

  it("database constraints reject a PRIVATE row that also carries endpoint plaintext", async () => {
    await expect(admin.query(
      `INSERT INTO ${TEST_SCHEMA}.prism_binding_disclosures
       (schema_version, binding_id, prism_id, visibility, status, version, endpoint_json, protected_endpoint_json, historical_public, publicly_exposed_at, hidden_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        1,
        "binding-live-invalid-private",
        "prism:P7F21",
        "PRIVATE",
        "ACTIVE",
        0,
        JSON.stringify(PUBLIC_ENDPOINT),
        JSON.stringify(PROTECTED),
        false,
        null,
        null,
        400,
        400,
      ],
    )).rejects.toMatchObject({ code: "23514" });
  });

  it("unreachable PostgreSQL fails closed during construction", async () => {
    await expect(PostgresBindingDisclosureStore.create({
      connectionString: "postgresql://nobody:***@127.0.0.1:1/prism_none",
      connectionTimeoutMillis: 1_500,
    })).rejects.toMatchObject({
      name: "PostgresBindingDisclosureStoreError",
      code: "store_connect_failed",
    } satisfies Partial<PostgresBindingDisclosureStoreError>);
  });
});
