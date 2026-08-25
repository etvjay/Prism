import type { VerificationSourceProvider, VerificationSources } from "../domain/policy-engine";

/**
 * Test-only source double. It is never wired by the production factory; tests
 * must opt in through FactoryStarknetOverrides.verificationSourceProvider.
 */
export const testPauseVerificationSourceProvider: VerificationSourceProvider = ({ intent }) => {
  const unknown = [intent.requestedRecipient, intent.requestedAsset].some((value) => value.toLowerCase().includes("unknown"));
  if (unknown) {
    return {
      recipientBinding: { status: "UNKNOWN", observedValue: null },
      firstUse: { isFirstUse: null, unknown: true },
      agentAuthorized: { authorized: null, unknown: true },
      routeAllowed: { chainAllowed: null, assetAllowed: null, contractAllowed: null, notRevoked: null, unknown: true },
      intentPlanMatch: { matches: null, unknown: true },
      simulation: { success: null, effectMatches: null, freshnessOk: null, unknown: true },
      additionalApproval: { requiresApproval: null, unknown: true },
    } satisfies VerificationSources;
  }

  return {
    recipientBinding: { status: "BOUND", observedValue: intent.requestedRecipient },
    firstUse: { isFirstUse: false },
    agentAuthorized: { authorized: true },
    routeAllowed: { chainAllowed: true, assetAllowed: true, contractAllowed: true, notRevoked: true },
    intentPlanMatch: { matches: true },
    simulation: { success: true, effectMatches: true, freshnessOk: true },
    additionalApproval: { requiresApproval: false },
  } satisfies VerificationSources;
};
