import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QueryResult } from "pg";
import type { PrivateStoredBinding, PublicStoredBinding } from "../domain/binding-disclosure";

interface CapturedQuery {
  text: string;
  values?: unknown[];
}

class FakePool {
  static queries: CapturedQuery[] = [];
  static queue: Array<{ result?: Partial<QueryResult>; error?: unknown }> = [];
  static endCount = 0;

  static reset(): void {
    FakePool.queries = [];
    FakePool.queue = [];
    FakePool.endCount = 0;
  }

  constructor(_config?: unknown) {}

  async query(text: string, values?: unknown[]): Promise<Partial<QueryResult>> {
    FakePool.queries.push({ text, values });
    const next = FakePool.queue.shift();
    if (next?.error) throw next.error;
    return next?.result ?? { rowCount: 0, rows: [] };
  }

  async connect(): Promise<never> {
    throw new Error("connect not expected in unit tier");
  }

  async end(): Promise<void> {
    FakePool.endCount += 1;
  }
}

function installFakePool(): typeof FakePool {
  FakePool.reset();
  vi.doMock("pg", () => ({ Pool: FakePool }));
  return FakePool;
}

beforeEach(() => {
  vi.resetModules();
});

async function loadStoreModule() {
  return await import("../adapters/postgres-binding-disclosure-store");
}

const PUBLIC_ENDPOINT = {
  id: "endpoint-public",
  chain: "BASE" as const,
  chainId: "8453",
  kind: "ACCOUNT" as const,
  address: "0xabc0000000000000000000000000000000000001",
};
const PRIVATE_ADDRESS = "0xdef0000000000000000000000000000000000002";
const PROTECTED = {
  ciphertext: "opaque-ciphertext-1",
  evidence: {
    encryptionAtRest: "PROVEN" as const,
    keyOwnership: "PROVEN" as const,
    recovery: "PROVEN" as const,
    keyRef: "owner-key-ref-1",
    algorithm: "provider-defined",
    schemaVersion: 1,
  },
};

function publicRecord(overrides: Partial<PublicStoredBinding> = {}): PublicStoredBinding {
  return {
    schemaVersion: 1,
    bindingId: "binding-public",
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
    ...overrides,
  };
}

function privateRecord(overrides: Partial<PrivateStoredBinding> = {}): PrivateStoredBinding {
  return {
    schemaVersion: 1,
    bindingId: "binding-private",
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

describe("PostgresBindingDisclosureStore (unit SQL contract)", () => {
  it("inserts a PUBLIC record with parameterized endpoint JSON", async () => {
    const fake = installFakePool();
    const { PostgresBindingDisclosureStore: Store } = await loadStoreModule();
    const store = new Store({ connectionString: "postgres://u:***@db:5432/prism" });

    await store.put(publicRecord());

    expect(fake.queries).toHaveLength(1);
    expect(fake.queries[0].text).toContain("INSERT INTO prism_binding_disclosures");
    expect(fake.queries[0].text).not.toContain(PUBLIC_ENDPOINT.address);
    expect(fake.queries[0].values).toContain(JSON.stringify(PUBLIC_ENDPOINT));
  });

  it("inserts a PRIVATE record with no endpoint plaintext value", async () => {
    const fake = installFakePool();
    const { PostgresBindingDisclosureStore: Store } = await loadStoreModule();
    const store = new Store({});

    await store.put(privateRecord());

    const query = fake.queries[0];
    expect(query.text).not.toContain(PRIVATE_ADDRESS);
    expect(query.values).not.toContain(PRIVATE_ADDRESS);
    expect(query.values).toContain(JSON.stringify(PROTECTED));
    expect(query.values).not.toContain(JSON.stringify({ address: PRIVATE_ADDRESS }));
  });

  it("maps public and private snake_case rows without collapsing the boundary", async () => {
    const fake = installFakePool();
    const mod = await loadStoreModule();
    const store = new mod.PostgresBindingDisclosureStore({});
    fake.queue.push(
      {
        result: {
          rowCount: 1,
          rows: [{
            schema_version: 1,
            binding_id: "binding-public",
            prism_id: "prism:P7F21",
            visibility: "PUBLIC",
            status: "ACTIVE",
            version: "0",
            endpoint_json: JSON.stringify(PUBLIC_ENDPOINT),
            protected_endpoint_json: null,
            historical_public: true,
            publicly_exposed_at: "100",
            hidden_at: null,
            created_at: "100",
            updated_at: "100",
          }],
        },
      },
      {
        result: {
          rowCount: 1,
          rows: [{
            schema_version: 1,
            binding_id: "binding-private",
            prism_id: "prism:P7F21",
            visibility: "PRIVATE",
            status: "ACTIVE",
            version: "0",
            endpoint_json: null,
            protected_endpoint_json: JSON.stringify(PROTECTED),
            historical_public: false,
            publicly_exposed_at: null,
            hidden_at: null,
            created_at: "101",
            updated_at: "101",
          }],
        },
      },
    );

    const publicRead = await store.getById("binding-public");
    const privateRead = await store.getById("binding-private");

    expect(publicRead).toMatchObject({ visibility: "PUBLIC", endpoint: PUBLIC_ENDPOINT, protectedEndpoint: null });
    expect(privateRead).toMatchObject({ visibility: "PRIVATE", endpoint: null, protectedEndpoint: PROTECTED });
  });

  it("public listing is constrained to ACTIVE PUBLIC rows", async () => {
    const fake = installFakePool();
    const { PostgresBindingDisclosureStore: Store } = await loadStoreModule();
    const store = new Store({});
    await store.listPublicForIdentity("prism:P7F21");

    expect(fake.queries[0].text).toContain("visibility = 'PUBLIC'");
    expect(fake.queries[0].text).toContain("status = 'ACTIVE'");
    expect(fake.queries[0].values).toEqual(["prism:P7F21"]);
  });

  it("compareAndSet pins identity, version, visibility, status, and historical-public monotonicity", async () => {
    const fake = installFakePool();
    const { PostgresBindingDisclosureStore: Store } = await loadStoreModule();
    const store = new Store({});
    const next = privateRecord({ bindingId: "binding-public", prismId: "prism:P7F21", version: 1, historicalPublic: true, publiclyExposedAt: 100, hiddenAt: 200 });

    fake.queue.push({ result: { rowCount: 1, rows: [] } });
    await expect(store.compareAndSet({
      bindingId: "binding-public",
      prismId: "prism:P7F21",
      expectedVersion: 0,
      expectedVisibility: "PUBLIC",
      expectedStatus: "ACTIVE",
      next,
    })).resolves.toBe(true);

    const query = fake.queries[0];
    expect(query.text).toContain("WHERE binding_id = $1");
    expect(query.text).toContain("prism_id = $11");
    expect(query.text).toContain("version = $12");
    expect(query.text).toContain("visibility = $13");
    expect(query.text).toContain("status = $14");
    expect(query.text).toContain("(historical_public = FALSE OR $7 = TRUE)");
    expect(query.values).toContain("PRIVATE");
    expect(query.values).toContain(1);
  });

  it("classifies a binding primary-key collision and refuses corrupt private rows", async () => {
    installFakePool();
    const mod = await loadStoreModule();
    const duplicate = Object.assign(new Error("duplicate"), { code: "23505", constraint: "prism_binding_disclosures_pkey" });
    FakePool.queue.push({ error: duplicate });
    const store = new mod.PostgresBindingDisclosureStore({});
    await expect(store.put(publicRecord())).rejects.toMatchObject({ code: "duplicate_binding_id" });

    FakePool.queue.push({
      result: {
        rowCount: 1,
        rows: [{
          schema_version: 1,
          binding_id: "binding-private",
          prism_id: "prism:P7F21",
          visibility: "PRIVATE",
          status: "ACTIVE",
          version: 0,
          endpoint_json: JSON.stringify({ address: PRIVATE_ADDRESS }),
          protected_endpoint_json: JSON.stringify(PROTECTED),
          historical_public: false,
          publicly_exposed_at: null,
          hidden_at: null,
          created_at: 1,
          updated_at: 1,
        }],
      },
    });
    await expect(store.getById("binding-private")).rejects.toMatchObject({ code: "store_read_failed" });
  });

  it("fails closed on driver write/read errors and refuses operations after close", async () => {
    const fake = installFakePool();
    const mod = await loadStoreModule();
    const store = new mod.PostgresBindingDisclosureStore({});
    FakePool.queue.push({ error: new Error("connection terminated") });
    await expect(store.put(publicRecord())).rejects.toMatchObject({ code: "store_write_failed" });
    FakePool.queue.push({ error: new Error("connection terminated") });
    await expect(store.getById("binding-public")).rejects.toMatchObject({ code: "store_read_failed" });

    await store.close();
    await store.close();
    expect(fake.endCount).toBe(1);
    await expect(store.getById("binding-public")).rejects.toMatchObject({ code: "store_connect_failed" });
  });

  it("exposes schema checks for the public/private storage boundary and CAS versioning", async () => {
    installFakePool();
    const { BINDING_DISCLOSURE_STORE_MIGRATION_SQL: migration } = await loadStoreModule();
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS prism_binding_disclosures");
    expect(migration).toContain("visibility TEXT NOT NULL CHECK (visibility IN ('PUBLIC','PRIVATE'))");
    expect(migration).toContain("endpoint_json TEXT");
    expect(migration).toContain("protected_endpoint_json TEXT");
    expect(migration).toContain("historical_public BOOLEAN NOT NULL");
    expect(migration).toContain("version INTEGER NOT NULL CHECK (version >= 0)");
    expect(migration).toMatch(/endpoint_json IS NOT NULL\s+AND protected_endpoint_json IS NULL/);
    expect(migration).toMatch(/endpoint_json IS NULL\s+AND protected_endpoint_json IS NOT NULL/);
  });
});
