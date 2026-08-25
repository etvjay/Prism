import {
  cloneResolutionSnapshot,
  parseResolutionSnapshotKey,
  resolutionSnapshotKey,
  ResolutionSnapshotStoreError,
  validateKey,
  validateResolutionSnapshot,
  type ResolutionSnapshot,
  type ResolutionSnapshotLookupKey,
  type ResolutionSnapshotStore,
} from "../domain/snapshot";

/** In-memory reference adapter for deterministic local/test runs. */
export class InMemoryResolutionSnapshotStore implements ResolutionSnapshotStore {
  private readonly snapshots = new Map<string, ResolutionSnapshot>();
  private closed = false;

  async get(key: ResolutionSnapshotLookupKey): Promise<ResolutionSnapshot | null> {
    this.assertOpen();
    const parsedKey = parseResolutionSnapshotKey(key);
    const snapshot = this.snapshots.get(resolutionSnapshotKey(parsedKey));
    return snapshot ? cloneResolutionSnapshot(snapshot) : null;
  }

  async save(snapshot: ResolutionSnapshot, expectedVersion: number | null): Promise<ResolutionSnapshot> {
    this.assertOpen();
    try {
      validateResolutionSnapshot(snapshot);
    } catch (cause) {
      throw new ResolutionSnapshotStoreError("snapshot_store_invalid", cause instanceof Error ? cause.message : "invalid_snapshot");
    }
    if (expectedVersion !== null && (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0)) {
      throw new ResolutionSnapshotStoreError("snapshot_store_invalid", "expected_version_invalid");
    }
    const current = this.snapshots.get(snapshot.key);
    if (expectedVersion === null) {
      if (current) throw new ResolutionSnapshotStoreError("snapshot_version_conflict", "snapshot_already_exists");
      if (snapshot.version !== 1) throw new ResolutionSnapshotStoreError("snapshot_version_conflict", "initial_snapshot_version_must_be_1");
    } else {
      if (!current || current.version !== expectedVersion || snapshot.version !== expectedVersion + 1) {
        throw new ResolutionSnapshotStoreError("snapshot_version_conflict", "snapshot_version_mismatch");
      }
    }
    const owned = cloneResolutionSnapshot(snapshot);
    this.snapshots.set(snapshot.key, owned);
    return cloneResolutionSnapshot(owned);
  }

  async put(snapshot: ResolutionSnapshot, expectedVersion: number | null): Promise<ResolutionSnapshot> {
    return this.save(snapshot, expectedVersion);
  }

  async getLatest(key: ResolutionSnapshotLookupKey): Promise<ResolutionSnapshot | null> {
    return this.get(key);
  }

  async upsert(snapshot: ResolutionSnapshot, expectedVersion: number | null): Promise<ResolutionSnapshot> {
    return this.save(snapshot, expectedVersion);
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  private assertOpen(): void {
    if (this.closed) throw new ResolutionSnapshotStoreError("snapshot_store_unavailable", "snapshot_store_closed");
  }
}

export { resolutionSnapshotKey };
