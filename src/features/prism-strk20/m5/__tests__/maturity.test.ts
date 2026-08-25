import { describe, expect, it } from "vitest";
import {
  evaluateM5Maturity,
  type M5MaturityObservation,
} from "../maturity";
import { M5_ERROR_CODE } from "../runner";

describe("M5 maturity-state contract", () => {
  const base: M5MaturityObservation = {
    confirmedBlock: 100,
    maturityTargetBlock: 110,
    currentBlock: 109,
    balanceConsent: "granted",
  };

  it("keeps a note maturing before the explicit protocol target", () => {
    expect(evaluateM5Maturity(base)).toMatchObject({ state: "maturing", ready: false });
    expect(() => evaluateM5Maturity({ ...base, currentBlock: 109, balanceConsent: "granted" })).not.toThrow();
  });

  it("requires an explicit consented read at or after the target", () => {
    expect(evaluateM5Maturity({ ...base, currentBlock: 110, balanceConsent: "granted" })).toMatchObject({ state: "privately_available", ready: true });
    expect(() => evaluateM5Maturity({ ...base, currentBlock: 110, balanceConsent: "denied" })).toThrow(M5_ERROR_CODE.MATURITY_PENDING);
    expect(() => evaluateM5Maturity({ ...base, currentBlock: 110, balanceConsent: "unknown" })).toThrow(M5_ERROR_CODE.MATURITY_PENDING);
  });

  it("rejects impossible block observations and does not derive maturity from a receipt alone", () => {
    expect(() => evaluateM5Maturity({ ...base, maturityTargetBlock: 99 })).toThrow(M5_ERROR_CODE.MATURITY_PENDING);
    expect(() => evaluateM5Maturity({ ...base, currentBlock: Number.NaN })).toThrow(M5_ERROR_CODE.MATURITY_PENDING);
  });
});
