import { describe, it, expect } from "vitest";
import { assertNoViewingKey, assertPrivacyCopy, SHIELD_TRUTH, PRIVATE_TRANSFER_TRUTH } from "../domain/privacy-guard";

// X2 — TEST DOUBLE: pure guards, no wallet, no SDK
describe("M4 Privacy Guard — X2", () => {
  it("forbids viewingKey field", () => {
    expect(() => assertNoViewingKey({ viewingKey: "0xabc" }, "test")).toThrow(/viewing_key_forbidden|forbidden_field/);
    expect(() => assertNoViewingKey({ viewing_key: "0xabc" }, "test")).toThrow();
  });

  it("forbids privateKey/seedPhrase", () => {
    expect(() => assertNoViewingKey({ privateKey: "secret" }, "test")).toThrow();
    expect(() => assertNoViewingKey({ seedPhrase: "abandon" }, "test")).toThrow();
  });

  it("forbids viewing key pattern in string", () => {
    expect(() => assertNoViewingKey("my viewing key is xyz", "note")).toThrow();
  });

  it("allows benign payloads", () => {
    expect(() => assertNoViewingKey({ token: "0xabc", amount: 100n }, "ok")).not.toThrow();
  });

  it("rejects privacy overclaims", () => {
    expect(() => assertPrivacyCopy("completely invisible transaction")).toThrow(/privacy_overclaim/);
    expect(() => assertPrivacyCopy("private everywhere, zero metadata")).toThrow();
    expect(() => assertPrivacyCopy("untraceable anonymous amount")).toThrow();
    expect(() => assertPrivacyCopy("all amounts hidden for shield")).toThrow();
  });

  it("allows honest copy", () => {
    expect(() => assertPrivacyCopy("Private balance")).not.toThrow();
    expect(() => assertPrivacyCopy("Send privately")).not.toThrow();
    expect(() => assertPrivacyCopy("Shield deposit is public; private transfer hides sender")).not.toThrow();
  });

  it("shield truth: amount is public", () => {
    expect(SHIELD_TRUTH.publicFields).toContain("amount");
    expect(SHIELD_TRUTH.hiddenFields).not.toContain("amount");
  });

  it("private transfer truth: sender/recipient hidden", () => {
    expect(PRIVATE_TRANSFER_TRUTH.hiddenFields).toContain("sender");
    expect(PRIVATE_TRANSFER_TRUTH.hiddenFields).toContain("amount");
  });
});
