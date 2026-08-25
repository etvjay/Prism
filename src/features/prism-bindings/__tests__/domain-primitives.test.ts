import { describe, expect, it } from "vitest";
import {
  activateBinding,
  assertBinding,
  assertBindingUsesAuthority,
  assertBindingUsesDisclosurePolicy,
  changeBindingVisibility,
  createBinding,
  createExecutionEndpoint,
  expireBinding,
  revokeBinding,
} from "../domain/invariants";
import type { Binding } from "../domain/types";
import {
  createDisclosurePolicy,
  isDisclosureAllowed,
} from "../../prism-disclosure/domain/policy";
import {
  activateAuthority,
  createAuthority,
  revokeAuthority,
} from "../../prism-authority/domain/authority";
import {
  activateSessionGrant,
  authorizeSessionAction,
  createSessionGrant,
  revokeSessionGrant,
  type SessionGrant,
} from "../../prism-authority/domain/sessions";

const NOW = 1_789_000_000;
const OWNER = "0xowner";

function activeBinding(overrides: Partial<Binding> = {}): Binding {
  return createBinding({
    id: "binding-main",
    prismId: "prism:owner",
    endpointId: "endpoint-main",
    authorityId: "authority-owner",
    disclosurePolicyId: "policy-public",
    visibility: "PUBLIC",
    lifecycle: "PERSISTENT",
    status: "ACTIVE",
    createdAt: NOW,
    ...overrides,
  });
}

describe("execution endpoint invariants", () => {
  it("requires an address for ordinary accounts but not private contexts", () => {
    expect(() => createExecutionEndpoint({
      id: "account-without-address",
      chain: "STARKNET",
      chainId: "SN_SEPOLIA",
      kind: "ACCOUNT",
    })).toThrow("account_address_required");

    expect(createExecutionEndpoint({
      id: "private-context",
      chain: "STARKNET",
      chainId: "SN_SEPOLIA",
      kind: "STRK20_PRIVATE_CONTEXT",
    }).address).toBeUndefined();
  });

  it("rejects a STRK20 endpoint on a non-Starknet chain", () => {
    expect(() => createExecutionEndpoint({
      id: "wrong-chain-private-context",
      chain: "BASE",
      chainId: "84532",
      kind: "STRK20_PRIVATE_CONTEXT",
    })).toThrow("strk20_endpoint_requires_starknet");
  });
});

describe("binding lifecycle and visibility", () => {
  it("keeps lifecycle independent from disclosure visibility", () => {
    const privateEphemeral = activeBinding({
      id: "binding-private-ephemeral",
      visibility: "PRIVATE",
      disclosurePolicyId: "policy-private",
      lifecycle: "EPHEMERAL",
      expiresAt: NOW + 60,
    });

    expect(privateEphemeral.visibility).toBe("PRIVATE");
    expect(privateEphemeral.lifecycle).toBe("EPHEMERAL");
    expect(() => assertBinding(privateEphemeral)).not.toThrow();
    expect(() => assertBindingUsesDisclosurePolicy(
      privateEphemeral,
      createDisclosurePolicy({ id: "policy-private", visibility: "PRIVATE" }),
    )).not.toThrow();
    expect(() => assertBindingUsesDisclosurePolicy(privateEphemeral, createDisclosurePolicy({ id: "policy-other", visibility: "PUBLIC" }))).toThrow("binding_disclosure_policy_id_mismatch");
    expect(() => assertBindingUsesAuthority(privateEphemeral, createAuthority({
      id: "authority-owner",
      endpointId: "endpoint-main",
      subject: { type: "OWNER", account: OWNER },
    }))).not.toThrow();
    expect(() => expireBinding(privateEphemeral, NOW + 59)).toThrow("binding_not_expired");
    expect(expireBinding(privateEphemeral, NOW + 60).status).toBe("REVOKED");
  });

  it("enforces pending → active → revoked and forbids resurrection", () => {
    let binding = createBinding({
      id: "binding-lifecycle",
      prismId: "prism:owner",
      endpointId: "endpoint-main",
      authorityId: "authority-owner",
      disclosurePolicyId: "policy-public",
      visibility: "PUBLIC",
      lifecycle: "PERSISTENT",
      status: "PENDING",
      createdAt: NOW,
    });

    binding = activateBinding(binding, NOW + 1);
    expect(binding.status).toBe("ACTIVE");
    binding = revokeBinding(binding, NOW + 2);
    expect(binding.status).toBe("REVOKED");
    expect(binding.revokedAt).toBe(NOW + 2);
    expect(() => activateBinding(binding, NOW + 3)).toThrow("binding_transition_not_allowed");
    expect(() => revokeBinding(binding, NOW + 1)).toThrow("binding_already_revoked");
  });

  it("rejects malformed Prism IDs and revoked records without a revocation timestamp", () => {
    expect(() => createBinding({
      id: "binding-bad-id",
      prismId: "0xnot-a-prism-id",
      endpointId: "endpoint-main",
      authorityId: "authority-owner",
      disclosurePolicyId: "policy-public",
      visibility: "PUBLIC",
      lifecycle: "PERSISTENT",
      status: "ACTIVE",
      createdAt: NOW,
    })).toThrow("malformed_prism_id");

    expect(() => assertBinding({
      ...activeBinding(),
      status: "REVOKED",
      revokedAt: undefined,
    })).toThrow("revoked_binding_requires_revoked_at");
  });

  it("requires an explicit publish operation and preserves historical public exposure when hiding", () => {
    const privateBinding = activeBinding({
      id: "binding-private",
      visibility: "PRIVATE",
    });

    expect(() => changeBindingVisibility(privateBinding, "PUBLIC", NOW + 1)).toThrow("publish_confirmation_required");
    const published = changeBindingVisibility(privateBinding, "PUBLIC", NOW + 1, { publish: true });
    expect(published.binding.visibility).toBe("PUBLIC");
    expect(published.binding.publicExposure?.firstExposedAt).toBe(NOW + 1);

    const hidden = changeBindingVisibility(published.binding, "PRIVATE", NOW + 2);
    expect(hidden.binding.visibility).toBe("PRIVATE");
    expect(hidden.historicalPublic).toBe(true);
    expect(hidden.historyWarning).toBe(true);
    expect(hidden.binding.publicExposure?.firstExposedAt).toBe(NOW + 1);
    expect(hidden.binding.publicExposure?.unpublishedAt).toBe(NOW + 2);
    expect(hidden.previousPublicBinding?.status).toBe("REVOKED");
  });
});

describe("disclosure policy invariants", () => {
  it("does not allow contradictory public allowlists", () => {
    expect(() => createDisclosurePolicy({
      id: "public-with-allowlist",
      visibility: "PUBLIC",
      allowedPrincipals: ["prism:owner"],
    })).toThrow("public_policy_cannot_have_allowlist");
  });

  it("requires a requester capability for SELECTIVE and owner context for PRIVATE", () => {
    const selective = createDisclosurePolicy({
      id: "policy-selective",
      visibility: "SELECTIVE",
      allowedPrincipals: ["prism:alice"],
      allowedPurposes: ["PAYMENT"],
    });
    const privatePolicy = createDisclosurePolicy({ id: "policy-private", visibility: "PRIVATE" });

    expect(isDisclosureAllowed(selective, { requesterPrismId: "prism:bob", purpose: "PAYMENT" })).toBe(false);
    expect(isDisclosureAllowed(selective, { requesterPrismId: "prism:alice", purpose: "PAYMENT" })).toBe(true);
    expect(isDisclosureAllowed(privatePolicy, { requesterPrismId: "prism:owner", isOwner: false })).toBe(false);
    expect(isDisclosureAllowed(privatePolicy, { isOwner: true })).toBe(true);
  });

  it("rejects expired selective policies and empty selective audiences", () => {
    expect(() => createDisclosurePolicy({
      id: "selective-without-audience",
      visibility: "SELECTIVE",
    })).toThrow("selective_policy_requires_audience");

    const expired = createDisclosurePolicy({
      id: "expired-selective",
      visibility: "SELECTIVE",
      allowedApplications: ["trade.example"],
      expiresAt: NOW,
    });
    expect(isDisclosureAllowed(expired, { application: "trade.example", now: NOW })).toBe(false);
  });
});

describe("authority lifecycle", () => {
  it("keeps owner authority distinct from delegated session authority", () => {
    const owner = createAuthority({
      id: "authority-owner",
      endpointId: "endpoint-main",
      subject: { type: "OWNER", account: OWNER },
    });
    const delegated = createAuthority({
      id: "authority-session",
      endpointId: "endpoint-main",
      subject: { type: "SESSION_KEY", publicKey: "session-public-key" },
    });

    expect(owner.subject.type).toBe("OWNER");
    expect(delegated.subject.type).toBe("SESSION_KEY");
    expect(revokeAuthority(owner).status).toBe("REVOKED");
    expect(() => activateAuthority(revokeAuthority(delegated))).toThrow("authority_cannot_be_reactivated");
  });
});

describe("bounded session grants", () => {
  function grant(overrides: Partial<SessionGrant> = {}): SessionGrant {
    return createSessionGrant({
      id: "grant-trading",
      prismId: "prism:owner",
      endpointId: "endpoint-main",
      delegatePublicKey: "session-public-key",
      scope: {
        contracts: ["avnu"],
        selectors: ["swap"],
        tokenLimits: [{ token: "USDC", maxAmount: 500n }],
        maxCalls: 2,
      },
      validFrom: NOW,
      validUntil: NOW + 6 * 60 * 60,
      ...overrides,
    });
  }

  it("rejects unbounded, malformed, and inverted grants", () => {
    expect(() => createSessionGrant({
      id: "unbounded",
      prismId: "prism:owner",
      endpointId: "endpoint-main",
      delegatePublicKey: "session-public-key",
      scope: {},
      validFrom: NOW,
      validUntil: NOW + 1,
    })).toThrow("session_scope_must_be_bounded");

    expect(() => grant({ validFrom: NOW + 10, validUntil: NOW })).toThrow("valid_until_must_be_after_valid_from");
    expect(() => grant({ scope: { contracts: ["avnu"], maxCalls: 0 } })).toThrow("max_calls_must_be_positive");
  });

  it("only activates during its validity window and never permits direct CREATED → REVOKED", () => {
    const created = grant();
    expect(() => authorizeSessionAction(created, {
      contract: "avnu",
      selector: "swap",
      token: "USDC",
      amount: 1n,
      now: NOW,
    })).toThrow("session_grant_not_active");
    expect(() => revokeSessionGrant(created)).toThrow("session_grant_transition_not_allowed");

    const active = activateSessionGrant(created, NOW);
    expect(active.status).toBe("ACTIVE");
    expect(() => activateSessionGrant(active, NOW + 1)).toThrow("session_grant_transition_not_allowed");
  });

  it("rejects wrong target, selector, and spend ceiling without consuming a call", () => {
    const active = activateSessionGrant(grant(), NOW);
    for (const action of [
      { contract: "other", selector: "swap", token: "USDC", amount: 1n },
      { contract: "avnu", selector: "transfer", token: "USDC", amount: 1n },
      { contract: "avnu", selector: "swap", token: "USDC", amount: 501n },
    ]) {
      expect(() => authorizeSessionAction(active, { ...action, now: NOW + 1 })).toThrow();
    }
    expect(active.usage?.calls).toBe(0);
  });

  it("accepts valid actions, exhausts at the call ceiling, and rejects expired/revoked grants", () => {
    let active = activateSessionGrant(grant(), NOW);
    active = authorizeSessionAction(active, {
      contract: "avnu",
      selector: "swap",
      token: "USDC",
      amount: 100n,
      now: NOW + 1,
    });
    expect(active.status).toBe("ACTIVE");
    expect(active.usage?.calls).toBe(1);
    expect(active.usage?.spentByToken.USDC).toBe(100n);

    active = authorizeSessionAction(active, {
      contract: "avnu",
      selector: "swap",
      token: "USDC",
      amount: 400n,
      now: NOW + 2,
    });
    expect(active.status).toBe("EXHAUSTED");
    expect(active.usage?.calls).toBe(2);
    expect(() => authorizeSessionAction(active, {
      contract: "avnu",
      selector: "swap",
      token: "USDC",
      amount: 1n,
      now: NOW + 3,
    })).toThrow("session_grant_not_active");

    const revoked = revokeSessionGrant(activateSessionGrant(grant({ id: "grant-revoked" }), NOW));
    expect(() => authorizeSessionAction(revoked, {
      contract: "avnu",
      selector: "swap",
      token: "USDC",
      amount: 1n,
      now: NOW + 1,
    })).toThrow("session_grant_not_active");

    const expired = activateSessionGrant(grant({ id: "grant-expired", validUntil: NOW + 2 }), NOW);
    expect(() => authorizeSessionAction(expired, {
      contract: "avnu",
      selector: "swap",
      token: "USDC",
      amount: 1n,
      now: NOW + 2,
    })).toThrow("session_grant_expired");
  });
});
