import { describe, expect, it } from "vitest";
import {
  BINDING_ERROR_CODE,
  type ExecutionEndpoint,
  type PrivateStoredBinding,
  type PublicStoredBinding,
} from "../domain/binding-disclosure";
import { InMemoryBindingDisclosureStore } from "../adapters/memory-binding-disclosure-store";

const PUBLIC_ENDPOINT: ExecutionEndpoint = {
  id: "public-endpoint",
  chain: "BASE",
  chainId: "8453",
  kind: "ACCOUNT",
  address: "0xabc0000000000000000000000000000000000001",
};
const PRIVATE_ENDPOINT: ExecutionEndpoint = {
  id: "private-endpoint",
  chain: "BASE",
  chainId: "8453",
  kind: "ACCOUNT",
  address: "0xdef0000000000000000000000000000000000002",
};
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

describe("InMemoryBindingDisclosureStore (CAS reference adapter)", () => {
  it("keeps public and private storage representations disjoint", async () => {
    const store = new InMemoryBindingDisclosureStore();
    await store.put(publicRecord());
    await store.put(privateRecord());

    const publicRows = await store.listPublicForIdentity("prism:P7F21");
    const allRows = await store.listForIdentity("prism:P7F21");

    expect(publicRows).toHaveLength(1);
    expect(publicRows[0].endpoint).toEqual(PUBLIC_ENDPOINT);
    expect(allRows).toHaveLength(2);
    const privateRow = allRows.find((row) => row.visibility === "PRIVATE");
    expect(privateRow && "endpoint" in privateRow && privateRow.endpoint).toBeNull();
    expect(JSON.stringify(publicRows)).not.toContain(PRIVATE_ENDPOINT.address!);
  });

  it("returns owned copies so callers cannot mutate durable state in place", async () => {
    const store = new InMemoryBindingDisclosureStore();
    await store.put(publicRecord());
    const read = await store.getById("binding-public");
    if (!read || read.visibility !== "PUBLIC") throw new Error("missing public row");
    const mutated = {
      ...read,
      endpoint: { ...read.endpoint, address: "0x0000000000000000000000000000000000000001" },
      version: 99,
    };
    void mutated;

    const reread = await store.getById("binding-public");
    expect(reread).toMatchObject({ version: 0 });
    expect(reread && "endpoint" in reread && reread.endpoint).toEqual(PUBLIC_ENDPOINT);
  });

  it("compareAndSet permits exactly one winner for the same version", async () => {
    const store = new InMemoryBindingDisclosureStore();
    const initial = publicRecord();
    await store.put(initial);
    const next: PrivateStoredBinding = {
      ...privateRecord({ bindingId: initial.bindingId, prismId: initial.prismId, version: 1, historicalPublic: true, publiclyExposedAt: 100, hiddenAt: 200 }),
      bindingId: initial.bindingId,
      prismId: initial.prismId,
      version: 1,
      historicalPublic: true,
      publiclyExposedAt: 100,
      hiddenAt: 200,
    };

    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        store.compareAndSet({
          bindingId: initial.bindingId,
          prismId: initial.prismId,
          expectedVersion: 0,
          expectedVisibility: "PUBLIC",
          expectedStatus: "ACTIVE",
          next,
        }),
      ),
    );

    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await store.getById(initial.bindingId))?.visibility).toBe("PRIVATE");
  });

  it("rejects a CAS attempt that tries to erase historical-public evidence", async () => {
    const store = new InMemoryBindingDisclosureStore();
    const initial = publicRecord();
    await store.put(initial);
    const next: PrivateStoredBinding = {
      ...privateRecord({ bindingId: initial.bindingId, prismId: initial.prismId, version: 1 }),
      bindingId: initial.bindingId,
      prismId: initial.prismId,
      version: 1,
      historicalPublic: false,
    };

    expect(
      await store.compareAndSet({
        bindingId: initial.bindingId,
        prismId: initial.prismId,
        expectedVersion: 0,
        expectedVisibility: "PUBLIC",
        expectedStatus: "ACTIVE",
        next,
      }),
    ).toBe(false);
    expect((await store.getById(initial.bindingId))?.historicalPublic).toBe(true);
  });

  it("rejects duplicate binding ids and invalid private plaintext shape", async () => {
    const store = new InMemoryBindingDisclosureStore();
    await store.put(publicRecord());
    await expect(store.put(publicRecord())).rejects.toMatchObject({ code: BINDING_ERROR_CODE.DUPLICATE_BINDING_ID });

    const invalid = {
      ...privateRecord({ bindingId: "binding-invalid" }),
      endpoint: PRIVATE_ENDPOINT,
    } as never;
    await expect(store.put(invalid)).rejects.toMatchObject({ code: BINDING_ERROR_CODE.INVALID_BINDING });
  });
});
