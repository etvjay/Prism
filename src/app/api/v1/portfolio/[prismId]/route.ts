import { getAppFactory } from "@/application/factory";
import { jsonError, parseHeaders, toHttpResponse } from "@/application/http-helpers";

// GET /v1/portfolio/:prismId — source/freshness-bearing derived read.
// Public Base/Starknet branches are resolved by the canonical binding port. A
// private STRK20 branch is requested only when the wallet explicitly grants
// consent; this route never accepts keys, notes, proofs, or provider payloads.
export async function GET(req: Request, ctx: { params: Promise<{ prismId: string }> }): Promise<Response> {
  const parsed = parseHeaders(req);
  const { prismId } = await ctx.params;
  let decodedPrismId: string;
  try {
    decodedPrismId = decodeURIComponent(prismId);
  } catch {
    return jsonError(parsed.requestId, "PORTFOLIO_INVALID_PRISM_ID", 422, "malformed_prism_id");
  }

  const consentHeader = req.headers.get("x-privacy-wallet-consent") ?? req.headers.get("x-prism-privacy-consent");
  let privacyWalletConsent: { status: "granted" | "denied" | "required"; walletSessionRef?: string } | undefined;
  if (consentHeader !== null) {
    if (consentHeader !== "granted" && consentHeader !== "denied" && consentHeader !== "required") {
      return jsonError(parsed.requestId, "PORTFOLIO_INVALID_CONSENT", 422, "invalid_privacy_wallet_consent");
    }
    const walletSessionRef = req.headers.get("x-privacy-wallet-session-ref") ?? req.headers.get("x-prism-wallet-session-ref");
    privacyWalletConsent = {
      status: consentHeader,
      ...(consentHeader === "granted" && walletSessionRef ? { walletSessionRef } : {}),
    };
  }

  let factory;
  try {
    factory = await getAppFactory();
  } catch {
    // Factory/provider failures are intentionally represented by one fixed,
    // public discriminator. Never forward exception text across HTTP.
    return jsonError(parsed.requestId, "ERR-021", 503, "dependency_unavailable");
  }

  const response = await factory.handlers.getPortfolio({
    payload: { prismId: decodedPrismId, privacyWalletConsent },
    headers: { requestId: parsed.requestId },
  });
  return toHttpResponse(response, parsed);
}
