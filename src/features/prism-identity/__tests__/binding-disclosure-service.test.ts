import { describe, expect, it } from "vitest";
import {
  BINDING_ERROR_CODE,
  type BindingOwnerActor,
  type BindingOwnerAuthorizationPort,
  type ExecutionEndpoint,
  type PrivateBindingProtectionPort,
  type ProtectionEvidence,
  toPublicBindingView,
} from "../domain/binding-disclosure";
import { BindingDisclosureService } from "../application/binding-disclosure-service";
import { InMemoryBindingDisclosureStore } from "../adapters/memory-binding-disclosure-store";

const OWNER: BindingOwnerActor = { actorId: "owner-1", authorizationContext: "opaque-owner-proof" };
const ATTACKER: BindingOwnerActor = { actorId: "attacker", authorizationContext: "opaque-attacker-proof" };
const PRISM_ID = "prism:P7F21";
const PUBLIC_ENDPOINT: ExecutionEndpoint = {
  id: "endpoint-public",
  chain: "BASE",
  chainId: "8453",
  kind: "ACCOUNT",
  address: "0xabc0000000000000000000000000000000000001",
};
const PRIVATE_ENDPOINT: ExecutionEndpoint = {
  id: "endpoint-private",
  chain: "BASE",
  chainId: "8453",
  kind: "ACCOUNT",
  address: "0xdef0000000000000000000000000000000000002",
};

const PROOF: ProtectionEvidence = {
  encryptionAtRest: "PROVEN",
  keyOwnership: "PROVEN",
  recovery: "PROVEN",
  keyRef: "owner-key-ref-1",
  algorithm: "provider-defined",
  schemaVersion: 1,
};

class TestOwnerAuthorization implements BindingOwnerAuthorizationPort {
  constructor(private readonly allowed = new Set([OWNER.actorId])) {}

  async authorize(input: { prismId: string; actor: BindingOwnerActor; operation: string }): Promise<{ authorized: boolean }> {
    void input.prismId;
    void input.operation;
    return { authorized: this.allowed.has(input.actor.actorId) };
  }
}

class TestPrivateProtection implements PrivateBindingProtectionPort {
  readonly sealed = new Map<string, ExecutionEndpoint>();
  ready = true;
  includePlaintextInCiphertext = false;
  failReveal = false;

  async getReadiness(): Promise<
    | { status: "PROVEN"; evidence: ProtectionEvidence }
    | { status: "BLOCKED"; reason: string }
  > {
    return this.ready ? { status: "PROVEN", evidence: PROOF } : { status: "BLOCKED", reason: "recovery_not_proven" };
  }

  async protect(input: { bindingId: string; prismId: string; endpoint: ExecutionEndpoint }) {
    void input.prismId;
    this.sealed.set(input.bindingId, input.endpoint);
    return {
      ciphertext: this.includePlaintextInCiphertext ? `opaque:${input.endpoint.address}` : `opaque:${input.bindingId}`,
      evidence: PROOF,
    };
  }

  async reveal(input: { bindingId: string; prismId: string; protectedEndpoint: { ciphertext: string; evidence: ProtectionEvidence } }) {
    void input.prismId;
    if (this.failReveal) throw new Error("recovery_unavailable");
    const endpoint = this.sealed.get(input.bindingId);
    if (!endpoint) throw new Error("unknown_test_ciphertext");
    return { endpoint, evidence: input.protectedEndpoint.evidence };
  }
}

function makeService(options: {
  store?: InMemoryBindingDisclosureStore;
  owner?: BindingOwnerAuthorizationPort;
  protection?: PrivateBindingProtectionPort;
} = {}) {
  const store = options.store ?? new InMemoryBindingDisclosureStore();
  const protection = options.protection ?? new TestPrivateProtection();
  const service = new BindingDisclosureService({
    store,
    ownerAuthorization: options.owner ?? new TestOwnerAuthorization(),
    privateBindingProtection: protection,
    clock: { now: () => 1_789_000_000 },
    idGenerator: { generateBindingId: () => `binding-${store.size() + 1}` },
  });
  return { service, store, protection };
}

describe("BindingDisclosureService", () => {
  it("creates a PUBLIC binding and exposes it to public resolution", async () => {
    const { service } = makeService();

    const created = await service.createPublicBinding({ prismId: PRISM_ID, endpoint: PUBLIC_ENDPOINT, actor: OWNER });
    const publicRows = await service.listPublicBindings(PRISM_ID);

    expect(created.visibility).toBe("PUBLIC");
    expect(created.endpoint).toEqual(PUBLIC_ENDPOINT);
    expect(created.historicalPublicWarning).toBeNull();
    expect(publicRows).toHaveLength(1);
    expect(publicRows[0].endpoint).toEqual(PUBLIC_ENDPOINT);
  });

  it("blocks PRIVATE creation when encryption, key ownership, or recovery is not proven", async () => {
    const protection = new TestPrivateProtection();
    protection.ready = false;
    const { service, store } = makeService({ protection });

    await expect(service.createPrivateBinding({ prismId: PRISM_ID, endpoint: PRIVATE_ENDPOINT, actor: OWNER })).rejects.toMatchObject({
      code: BINDING_ERROR_CODE.BLOCKED_BY_KEY_MANAGEMENT,
    });
    expect(store.size()).toBe(0);
  });

  it("stores PRIVATE data behind an opaque protection envelope and never returns it publicly", async () => {
    const { service, store } = makeService();

    const created = await service.createPrivateBinding({ prismId: PRISM_ID, endpoint: PRIVATE_ENDPOINT, actor: OWNER });
    const publicRows = await service.listPublicBindings(PRISM_ID);
    const ownerRows = await service.listOwnerBindings(PRISM_ID, OWNER);
    const stored = await store.getById(created.bindingId);

    expect(created.visibility).toBe("PRIVATE");
    expect(created.endpoint).toEqual(PRIVATE_ENDPOINT);
    expect(publicRows).toEqual([]);
    expect(JSON.stringify(publicRows)).not.toContain(PRIVATE_ENDPOINT.address!);
    expect(ownerRows).toHaveLength(1);
    expect(ownerRows[0].endpoint).toEqual(PRIVATE_ENDPOINT);
    expect(stored).toMatchObject({ visibility: "PRIVATE", endpoint: null });
    expect(stored && "protectedEndpoint" in stored && stored.protectedEndpoint).toMatchObject({ ciphertext: "opaque:binding-1" });
  });

  it("requires the owner authorization port for private reads and mutations", async () => {
    const { service } = makeService();

    await expect(service.createPrivateBinding({ prismId: PRISM_ID, endpoint: PRIVATE_ENDPOINT, actor: ATTACKER })).rejects.toMatchObject({
      code: BINDING_ERROR_CODE.OWNER_NOT_AUTHORIZED,
    });
    await expect(service.createPublicBinding({ prismId: PRISM_ID, endpoint: PUBLIC_ENDPOINT, actor: ATTACKER })).rejects.toMatchObject({
      code: BINDING_ERROR_CODE.OWNER_NOT_AUTHORIZED,
    });
  });

  it("refuses an obvious plaintext-as-ciphertext result rather than persisting it", async () => {
    const protection = new TestPrivateProtection();
    protection.includePlaintextInCiphertext = true;
    const { service, store } = makeService({ protection });

    await expect(service.createPrivateBinding({ prismId: PRISM_ID, endpoint: PRIVATE_ENDPOINT, actor: OWNER })).rejects.toMatchObject({
      code: BINDING_ERROR_CODE.BLOCKED_BY_KEY_MANAGEMENT,
    });
    expect(store.size()).toBe(0);
  });

  it("PUBLIC -> PRIVATE requires proven protection and returns a historical-public warning", async () => {
    const protection = new TestPrivateProtection();
    const { service } = makeService({ protection });
    const created = await service.createPublicBinding({ prismId: PRISM_ID, endpoint: PUBLIC_ENDPOINT, actor: OWNER });

    const hidden = await service.hidePublicBinding({
      prismId: PRISM_ID,
      bindingId: created.bindingId,
      actor: OWNER,
      expectedVersion: created.version,
    });

    expect(hidden.visibility).toBe("PRIVATE");
    expect(hidden.endpoint).toEqual(PUBLIC_ENDPOINT);
    expect(hidden.historicalPublic).toBe(true);
    expect(hidden.historicalPublicWarning).toMatchObject({ code: "HISTORICAL_PUBLIC_LINKAGE" });
    expect(await service.listPublicBindings(PRISM_ID)).toEqual([]);
  });

  it("PUBLIC -> PRIVATE stays public when key management becomes unproven", async () => {
    const protection = new TestPrivateProtection();
    const { service } = makeService({ protection });
    const created = await service.createPublicBinding({ prismId: PRISM_ID, endpoint: PUBLIC_ENDPOINT, actor: OWNER });
    protection.ready = false;

    await expect(service.hidePublicBinding({ prismId: PRISM_ID, bindingId: created.bindingId, actor: OWNER, expectedVersion: created.version })).rejects.toMatchObject({
      code: BINDING_ERROR_CODE.BLOCKED_BY_KEY_MANAGEMENT,
    });
    expect((await service.listPublicBindings(PRISM_ID))[0].endpoint).toEqual(PUBLIC_ENDPOINT);
  });

  it("PRIVATE -> PUBLIC requires explicit exposure confirmation and proven recovery", async () => {
    const { service } = makeService();
    const created = await service.createPrivateBinding({ prismId: PRISM_ID, endpoint: PRIVATE_ENDPOINT, actor: OWNER });

    await expect(service.makePublic({ prismId: PRISM_ID, bindingId: created.bindingId, actor: OWNER, expectedVersion: created.version })).rejects.toMatchObject({
      code: BINDING_ERROR_CODE.PUBLIC_EXPOSURE_CONFIRMATION_REQUIRED,
    });
    const published = await service.makePublic({
      prismId: PRISM_ID,
      bindingId: created.bindingId,
      actor: OWNER,
      expectedVersion: created.version,
      confirmExposure: true,
    });

    expect(published.visibility).toBe("PUBLIC");
    expect(published.endpoint).toEqual(PRIVATE_ENDPOINT);
    expect((await service.listPublicBindings(PRISM_ID))[0].endpoint).toEqual(PRIVATE_ENDPOINT);
  });

  it("rejects stale concurrent visibility transitions with CAS and preserves one durable winner", async () => {
    const { service } = makeService();
    const created = await service.createPublicBinding({ prismId: PRISM_ID, endpoint: PUBLIC_ENDPOINT, actor: OWNER });

    const results = await Promise.allSettled([
      service.hidePublicBinding({ prismId: PRISM_ID, bindingId: created.bindingId, actor: OWNER, expectedVersion: created.version }),
      service.hidePublicBinding({ prismId: PRISM_ID, bindingId: created.bindingId, actor: OWNER, expectedVersion: created.version }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect((results.find((result) => result.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({
      code: BINDING_ERROR_CODE.STALE_BINDING_VERSION,
    });
    expect((await service.listOwnerBindings(PRISM_ID, OWNER))[0].historicalPublic).toBe(true);
  });

  it("does not allow a private endpoint to be transformed into a public publication without a public view", async () => {
    const { service, store } = makeService();
    const created = await service.createPrivateBinding({ prismId: PRISM_ID, endpoint: PRIVATE_ENDPOINT, actor: OWNER });
    const publicRows = await service.listPublicBindings(PRISM_ID);

    expect(created.visibility).toBe("PRIVATE");
    expect(publicRows).toEqual([]);
    await expect(service.getOwnerBinding({ prismId: PRISM_ID, bindingId: created.bindingId, actor: OWNER })).resolves.toMatchObject({ visibility: "PRIVATE" });
    const stored = await store.getById(created.bindingId);
    expect(() => toPublicBindingView(stored!)).toThrow(BINDING_ERROR_CODE.INVALID_BINDING);
  });

  it("revocation is owner-authorized and removes an active binding from public resolution", async () => {
    const { service } = makeService();
    const created = await service.createPublicBinding({ prismId: PRISM_ID, endpoint: PUBLIC_ENDPOINT, actor: OWNER });

    const revoked = await service.revokeBinding({ prismId: PRISM_ID, bindingId: created.bindingId, actor: OWNER, expectedVersion: created.version });

    expect(revoked.status).toBe("REVOKED");
    expect(await service.listPublicBindings(PRISM_ID)).toEqual([]);
    await expect(service.revokeBinding({ prismId: PRISM_ID, bindingId: created.bindingId, actor: ATTACKER })).rejects.toMatchObject({
      code: BINDING_ERROR_CODE.OWNER_NOT_AUTHORIZED,
    });
  });

  it("fails closed when recovery fails while reading a private binding", async () => {
    const protection = new TestPrivateProtection();
    const { service } = makeService({ protection });
    await service.createPrivateBinding({ prismId: PRISM_ID, endpoint: PRIVATE_ENDPOINT, actor: OWNER });
    protection.failReveal = true;

    await expect(service.listOwnerBindings(PRISM_ID, OWNER)).rejects.toMatchObject({
      code: BINDING_ERROR_CODE.BLOCKED_BY_KEY_MANAGEMENT,
    });
  });

  it("does not apply a PRIVATE revoke when recovery is not proven", async () => {
    const protection = new TestPrivateProtection();
    const { service, store } = makeService({ protection });
    const created = await service.createPrivateBinding({ prismId: PRISM_ID, endpoint: PRIVATE_ENDPOINT, actor: OWNER });
    protection.ready = false;

    await expect(service.revokeBinding({ prismId: PRISM_ID, bindingId: created.bindingId, actor: OWNER, expectedVersion: created.version })).rejects.toMatchObject({
      code: BINDING_ERROR_CODE.BLOCKED_BY_KEY_MANAGEMENT,
    });
    expect((await store.getById(created.bindingId))?.status).toBe("ACTIVE");
  });
});
