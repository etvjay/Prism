import { describe, expect, it } from "vitest";
import type { ExternalAlias } from "../../identity-alias/types";
import { StarknetIdAliasProvider } from "../adapter";
import type { StarknetIdLookupPort } from "../types";

const ALIAS: ExternalAlias = { provider: "starknet-id", value: "Alice" };

function resolvedLookup(overrides: Partial<Awaited<ReturnType<StarknetIdLookupPort["lookup"]>>> = {}) {
  return {
    subject: "starknet-subject:alice",
    canonicalValue: "alice.stark",
    ...overrides,
  };
}

describe("Starknet ID alias adapter boundary", () => {
  it("fails closed with BLOCKED_BY_INTERFACE_EVIDENCE when no first-party port is supplied", async () => {
    const provider = new StarknetIdAliasProvider();

    const result = await provider.resolve(ALIAS);

    expect(result.status).toBe("BLOCKED_BY_INTERFACE_EVIDENCE");
    expect(result.subject).toBeNull();
    expect(result).not.toHaveProperty("prismId");
  });

  it("maps a supplied typed port to provider-neutral alias evidence without minting a Prism ID", async () => {
    const port: StarknetIdLookupPort = {
      async lookup() {
        return resolvedLookup();
      },
    };
    const provider = new StarknetIdAliasProvider(port);

    const result = await provider.resolve(ALIAS);

    expect(result.status).toBe("RESOLVED");
    expect(result.alias).toEqual({ provider: "starknet-id", value: "alice" });
    expect(result.subject).toBe("starknet-subject:alice");
    expect(result.canonicalValue).toBe("alice.stark");
    expect(result).not.toHaveProperty("prismId");
  });

  it("turns provider transport errors into an unavailable result instead of throwing", async () => {
    const port: StarknetIdLookupPort = {
      async lookup() {
        throw new Error("transport unavailable");
      },
    };
    const provider = new StarknetIdAliasProvider(port);

    const result = await provider.resolve(ALIAS);

    expect(result.status).toBe("UNAVAILABLE");
    expect(result.subject).toBeNull();
  });

  it("rejects malformed provider records fail-closed", async () => {
    const port: StarknetIdLookupPort = {
      async lookup() {
        return resolvedLookup({ subject: "" });
      },
    };
    const provider = new StarknetIdAliasProvider(port);

    const result = await provider.resolve(ALIAS);

    expect(result.status).toBe("INVALID_RESPONSE");
    expect(result.subject).toBeNull();
  });

  it("does not accept an alias from another provider", async () => {
    const port: StarknetIdLookupPort = {
      async lookup() {
        throw new Error("must not be called");
      },
    };
    const provider = new StarknetIdAliasProvider(port);

    const result = await provider.resolve({ provider: "other-provider", value: "alice" });

    expect(result.status).toBe("INVALID_REQUEST");
    expect(result.subject).toBeNull();
  });
});
