import { describe, expect, it } from "vitest";
import { createIsolatedFactory } from "../factory";
import { BINDING_ERROR_CODE } from "../../features/prism-identity/domain/binding-disclosure";

const SESSION = {
  sessionId: "sess_factory_bindings",
  userId: "owner-1",
  issuedAt: 1_789_000_000 - 1,
  expiresAt: 1_789_000_000 + 600,
};

describe("application factory binding disclosure wiring", () => {
  it("constructs the durable v0 store/service and exposes only the public projection without owner auth", async () => {
    const factory = createIsolatedFactory(1_789_000_000, { submitPortRegistryVersion: "v1" });

    expect(factory.bindingDisclosureStore).toBeDefined();
    expect(factory.bindingDisclosureService).toBeDefined();
    expect(factory.privateBindingProtection).toBeDefined();

    const publicList = await factory.handlers.listPublicBindings({ payload: { prismId: "prism:P7F21" } });
    expect(publicList).toMatchObject({ ok: true, data: [] });

    const ownerPrivate = await factory.handlers.listOwnerPrivateBindings({
      headers: { requestId: "factory-private" },
      session: SESSION,
      payload: { prismId: "prism:P7F21" },
    });
    expect(ownerPrivate).toMatchObject({ ok: false, error: { code: BINDING_ERROR_CODE.OWNER_AUTHORIZATION_REQUIRED, httpStatusHint: 401 } });

    await factory.shutdown();
  });
});
