import { describe, expect, it } from "vitest";
import { toU256Calldata } from "../domain/u256-digest";

describe("toU256Calldata", () => {
  it("serializes low then high u128 limbs without masking", () => {
    const [low, high] = toU256Calldata("0x1234567890abcdef1234567890abcdef00000000000000000000000000000042");
    expect(low).toBe("0x00000000000000000000000000000042");
    expect(high).toBe("0x1234567890abcdef1234567890abcdef");
  });

  it("preserves max u256 across both limbs", () => {
    expect(toU256Calldata(`0x${"f".repeat(64)}`)).toEqual([`0x${"f".repeat(32)}`, `0x${"f".repeat(32)}`]);
  });

  it("rejects malformed and short digests", () => {
    expect(() => toU256Calldata("0x1" as never)).toThrow(/ERR-023/);
    expect(() => toU256Calldata("not-hex" as never)).toThrow(/ERR-023/);
  });
});
