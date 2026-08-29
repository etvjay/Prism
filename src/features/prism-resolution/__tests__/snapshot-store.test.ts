import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QueryResult } from "pg";
import type { ResolutionSnapshot } from "../domain/snapshot";
import {
  InMemoryResolutionSnapshotStore,
  resolutionSnapshotKey,
} from "../adapters/memory-resolution-snapshot-store";

const SNAPSHOT: ResolutionSnapshot = {
  key: resolutionSnapshotKey({ prismId: "prism:P7F21", venue: "BASE", purpose: "payment" }),
  prismId: "prism:P7F21",
  venue: "BASE",
  purpose: "payment",
  alias: { provider: "starknet-id", value: "alice" },
  externalSubject: "external-subject:alice",
  destination: { chain: "BASE", address: "0xabc" },
  bindingStatus: "ACTIVE",
  visibility: "PUBLIC",
  watermark: 100,
  observedAt: 1_789_000_000,
  version: 1,
};

describe("InMemoryResolutionSnapshotStore", () => {
  it("persists owned snapshots and returns copies", async () => {
    const store = new InMemoryResolutionSnapshotStore();
    await store.save(SNAPSHOT, null);

    const read = await store.get({ prismId: SNAPSHOT.prismId, venue: SNAPSHOT.venue, purpose: SNAPSHOT.purpose });
    expect(read).toEqual(SNAPSHOT);
    expect(read).not.toBe(SNAPSHOT);
    expect(read?.alias).not.toBe(SNAPSHOT.alias);
  });

  it("rejects a stale expected version instead of overwriting a newer snapshot", async () => {
    const store = new InMemoryResolutionSnapshotStore();
    await store.save(SNAPSHOT, null);
    const next = { ...SNAPSHOT, version: 2, observedAt: SNAPSHOT.observedAt + 1 };

    await expect(store.save(next, 0)).rejects.toMatchObject({ code: "snapshot_version_conflict" });
    expect((await store.get({ prismId: SNAPSHOT.prismId, venue: SNAPSHOT.venue, purpose: SNAPSHOT.purpose }))?.version).toBe(1);
  });

  it("keeps snapshot keys scoped by Prism ID, venue, and purpose", () => {
    expect(resolutionSnapshotKey({ prismId: "prism:1", venue: "BASE", purpose: "pay" })).not.toBe(
      resolutionSnapshotKey({ prismId: "prism:1", venue: "BASE", purpose: "view" }),
    );
  });
});

type CapturedQuery = { text: string; values?: unknown[] };

class FakePool {
  static queries: CapturedQuery[] = [];
  static queue: Array<{ error?: unknown; result?: Partial<QueryResult> }> = [];
  constructor(_config?: unknown) {}
  static reset() {
    FakePool.queries = [];
    FakePool.queue = [];
  }
  async query(text: string, values?: unknown[]) {
    FakePool.queries.push({ text, values });
    const next = FakePool.queue.shift();
    if (next?.error) throw next.error;
    return (next?.result ?? { rowCount: 1, rows: [] }) as QueryResult;
  }
  async end() {}
  async connect() {
    throw new Error("connect not expected in unit SQL test");
  }
}

beforeEach(() => {
  vi.resetModules();
});

describe("PostgresResolutionSnapshotStore SQL boundary", () => {
  it("uses a parameterized durable insert and never interpolates snapshot values", async () => {
    FakePool.reset();
    vi.doMock("pg", () => ({ Pool: FakePool }));
    const { PostgresResolutionSnapshotStore } = await import("../adapters/postgres-resolution-snapshot-store");
    const store = new PostgresResolutionSnapshotStore({});

    await store.save(SNAPSHOT, null);

    expect(FakePool.queries).toHaveLength(1);
    expect(FakePool.queries[0].text).toContain("INSERT INTO prism_resolution_snapshots");
    expect(FakePool.queries[0].text).not.toContain(SNAPSHOT.prismId);
    expect(FakePool.queries[0].text).not.toContain(SNAPSHOT.alias?.value ?? "");
    expect(FakePool.queries[0].values).toContain(SNAPSHOT.prismId);
    expect(FakePool.queries[0].values).toContain(SNAPSHOT.alias?.value);
  });

  it("maps a missing row to null and parameterizes the scoped lookup", async () => {
    FakePool.reset();
    vi.doMock("pg", () => ({ Pool: FakePool }));
    FakePool.queue.push({ result: { rowCount: 0, rows: [] } });
    const { PostgresResolutionSnapshotStore } = await import("../adapters/postgres-resolution-snapshot-store");
    const store = new PostgresResolutionSnapshotStore({});

    const result = await store.get({ prismId: "prism:P7F21", venue: "BASE", purpose: "payment" });

    expect(result).toBeNull();
    expect(FakePool.queries[0].text).toContain("WHERE prism_id = $1 AND venue = $2 AND purpose = $3");
    expect(FakePool.queries[0].values).toEqual(["prism:P7F21", "BASE", "payment"]);
  });

  it("round-trips a durable row with nullable alias and destination fields", async () => {
    FakePool.reset();
    vi.doMock("pg", () => ({ Pool: FakePool }));
    FakePool.queue.push({
      result: {
        rowCount: 1,
        rows: [{
          snapshot_key: SNAPSHOT.key,
          prism_id: SNAPSHOT.prismId,
          venue: SNAPSHOT.venue,
          purpose: SNAPSHOT.purpose,
          alias_provider: "starknet-id",
          alias_value: "alice",
          external_subject: "external-subject:alice",
          destination_chain: "BASE",
          destination_address: "0xabc",
          binding_status: "ACTIVE",
          visibility: "PUBLIC",
          watermark: "100",
          observed_at: String(SNAPSHOT.observedAt),
          version: "1",
        }],
      },
    });
    const { PostgresResolutionSnapshotStore } = await import("../adapters/postgres-resolution-snapshot-store");
    const store = new PostgresResolutionSnapshotStore({});

    await expect(store.get({ prismId: SNAPSHOT.prismId, venue: SNAPSHOT.venue, purpose: SNAPSHOT.purpose })).resolves.toEqual(SNAPSHOT);
  });
});
