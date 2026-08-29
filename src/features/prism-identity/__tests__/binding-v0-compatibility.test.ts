import { describe, expect, it } from "vitest";
import { BindingDisclosureError, BINDING_ERROR_CODE } from "../domain/binding-disclosure";
import { BindingDisclosureService } from "../application/binding-disclosure-service";
import { InMemoryBindingDisclosureStore } from "../adapters/memory-binding-disclosure-store";
import type { BindingOwnerAuthorizationPort, ExecutionEndpoint, PrivateBindingProtectionPort, ProtectionEvidence } from "../domain/binding-disclosure";

const PRISM_ID = "prism:P7F21";
const OWNER = { actorId: "owner-1" } as const;
const ENDPOINT: ExecutionEndpoint = {
  id: "endpoint-1",
  chain: "BASE",
  chainId: "8453",
  kind: "ACCOUNT",
  address: "0xabc0000000000000000000000000000000000001",
};
const EVIDENCE: ProtectionEvidence = {
  encryptionAtRest: "PROVEN",
  keyOwnership: "PROVEN",
  recovery: "PROVEN",
  keyRef: "provider-key-ref",
  algorithm: "provider-defined",
  schemaVersion: 1,
};

const ownerAuthorization: BindingOwnerAuthorizationPort = {
  async authorize() {
    return { authorized: true };
  },
};
const protection: PrivateBindingProtectionPort = {
  async getReadiness() {
    return { status: "PROVEN" as const, evidence: EVIDENCE };
  },
  async protect(input) {
    return { ciphertext: `opaque:${input.bindingId}`, evidence: EVIDENCE };
  },
  async reveal() {
    return { endpoint: ENDPOINT, evidence: EVIDENCE };
  },
};

function service() {
  const store = new InMemoryBindingDisclosureStore();
  return new BindingDisclosureService({
    store,
    ownerAuthorization,
    privateBindingProtection: protection,
    clock: { now: () => 1_789_000_000 },
    idGenerator: { generateBindingId: () => "binding-1" },
  });
}

describe("v0 binding persistence compatibility", () => {
  it("rejects SELECTIVE instead of collapsing it into PUBLIC or PRIVATE", async () => {
    await expect(service().createBinding({
      prismId: PRISM_ID,
      endpoint: ENDPOINT,
      actor: OWNER,
      visibility: "SELECTIVE",
      lifecycle: "PERSISTENT",
    })).rejects.toMatchObject({
      code: BINDING_ERROR_CODE.SELECTIVE_UNSUPPORTED,
    });
  });

  it("rejects SESSION and EPHEMERAL lifecycles at the durable v0 boundary", async () => {
    for (const lifecycle of ["SESSION", "EPHEMERAL"] as const) {
      await expect(service().createBinding({
        prismId: PRISM_ID,
        endpoint: ENDPOINT,
        actor: OWNER,
        visibility: "PUBLIC",
        lifecycle,
      })).rejects.toMatchObject({
        code: BINDING_ERROR_CODE.LIFECYCLE_UNSUPPORTED,
      });
    }
  });

  it("accepts only persistent PUBLIC and PRIVATE records and retains the v0 boundary", async () => {
    const app = service();
    await expect(app.createBinding({ prismId: PRISM_ID, endpoint: ENDPOINT, actor: OWNER, visibility: "PUBLIC", lifecycle: "PERSISTENT" })).resolves.toMatchObject({ visibility: "PUBLIC" });
    await expect(app.createBinding({ prismId: PRISM_ID, endpoint: ENDPOINT, actor: OWNER, visibility: "PRIVATE", lifecycle: "PERSISTENT", bindingId: "binding-private" })).resolves.toMatchObject({ visibility: "PRIVATE" });
  });

  it("filters owner/private audience results without mixing public rows", async () => {
    const app = service();
    await app.createBinding({ prismId: PRISM_ID, endpoint: ENDPOINT, actor: OWNER, visibility: "PUBLIC", lifecycle: "PERSISTENT" });
    await app.createBinding({ prismId: PRISM_ID, endpoint: ENDPOINT, actor: OWNER, visibility: "PRIVATE", lifecycle: "PERSISTENT", bindingId: "binding-private" });

    const privateRows = await app.listOwnerPrivateBindings(PRISM_ID, OWNER);
    expect(privateRows).toHaveLength(1);
    expect(privateRows[0].visibility).toBe("PRIVATE");
    expect(privateRows[0].endpoint).toEqual(ENDPOINT);
  });

  it("classifies a SELECTIVE row injected at the persistence seam as deferred", async () => {
    const store = new InMemoryBindingDisclosureStore();
    const selective = {
      schemaVersion: 1,
      bindingId: "binding-selective",
      prismId: PRISM_ID,
      visibility: "SELECTIVE",
      status: "ACTIVE",
      version: 0,
      endpoint: ENDPOINT,
      protectedEndpoint: null,
      historicalPublic: false,
      publiclyExposedAt: null,
      hiddenAt: null,
      createdAt: 1_789_000_000,
      updatedAt: 1_789_000_000,
    } as never;
    await expect(store.put(selective)).rejects.toBeInstanceOf(BindingDisclosureError);
    await expect(store.put(selective)).rejects.toMatchObject({ code: BINDING_ERROR_CODE.SELECTIVE_UNSUPPORTED });
  });
});
