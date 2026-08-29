// In-memory reference adapter for the binding/disclosure port.
// It is useful for unit/adversarial tests only; it is not durable and carries
// no encryption or recovery guarantees. Production persistence is PostgreSQL.

import {
  BINDING_ERROR_CODE,
  BindingDisclosureError,
  assertStoredBinding,
  type BindingCompareAndSetInput,
  type BindingDisclosureStore,
  type PrismId,
  type StoredBinding,
} from "../domain/binding-disclosure";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export class InMemoryBindingDisclosureStore implements BindingDisclosureStore {
  private readonly records = new Map<string, StoredBinding>();
  private closed = false;

  async put(record: StoredBinding): Promise<void> {
    this.assertOpen();
    assertStoredBinding(record);
    if (this.records.has(record.bindingId)) {
      throw new BindingDisclosureError(BINDING_ERROR_CODE.DUPLICATE_BINDING_ID, `duplicate:${record.bindingId}`);
    }
    this.records.set(record.bindingId, clone(record));
  }

  async getById(bindingId: string): Promise<StoredBinding | undefined> {
    this.assertOpen();
    const record = this.records.get(bindingId);
    return record ? clone(record) : undefined;
  }

  async listForIdentity(prismId: PrismId): Promise<readonly StoredBinding[]> {
    this.assertOpen();
    return [...this.records.values()]
      .filter((record) => record.prismId === prismId)
      .sort((left, right) => left.createdAt - right.createdAt || left.bindingId.localeCompare(right.bindingId))
      .map(clone);
  }

  async listPublicForIdentity(prismId: PrismId): Promise<readonly import("../domain/binding-disclosure").PublicStoredBinding[]> {
    this.assertOpen();
    return [...this.records.values()]
      .filter((record): record is import("../domain/binding-disclosure").PublicStoredBinding => record.prismId === prismId && record.visibility === "PUBLIC" && record.status === "ACTIVE")
      .sort((left, right) => left.createdAt - right.createdAt || left.bindingId.localeCompare(right.bindingId))
      .map(clone);
  }

  async compareAndSet(input: BindingCompareAndSetInput): Promise<boolean> {
    this.assertOpen();
    assertStoredBinding(input.next);
    if (input.next.bindingId !== input.bindingId || input.next.prismId !== input.prismId || input.next.version !== input.expectedVersion + 1) return false;
    const current = this.records.get(input.bindingId);
    if (!current) return false;
    if (current.prismId !== input.prismId || current.version !== input.expectedVersion || current.visibility !== input.expectedVisibility || current.status !== input.expectedStatus) return false;
    if (current.historicalPublic && !input.next.historicalPublic) return false;
    this.records.set(input.bindingId, clone(input.next));
    return true;
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  /** Test inspection only; returns copies. */
  size(): number {
    return this.records.size;
  }

  private assertOpen(): void {
    if (this.closed) throw new BindingDisclosureError(BINDING_ERROR_CODE.STORE_UNAVAILABLE, "store_closed");
  }
}
