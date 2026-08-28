import { getPaymentHttpRuntime } from "@/features/prism-payments/application/http-runtime";
import { parseHeaders, readJson, requireSession, jsonData, jsonPaymentError, nowSeconds, publicGift } from "@/features/prism-payments/application/http-helpers";
import { PaymentClaimError, PAYMENT_CLAIM_ERROR_CODE } from "@/features/prism-payments/domain/errors";

export async function GET(req: Request, ctx: { params: Promise<{ claimId: string }> }): Promise<Response> {
  const parsed = parseHeaders(req);
  try {
    const data = await (await getPaymentHttpRuntime()).gifts.get((await ctx.params).claimId);
    if (!data) throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.CLAIM_NOT_FOUND, "claim_not_found");
    return jsonData(publicGift(data), parsed);
  } catch (error) {
    return jsonPaymentError(error, parsed);
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ claimId: string }> }): Promise<Response> {
  const parsed = parseHeaders(req);
  const body = await readJson(req);
  if (body === null) return jsonPaymentError(new Error("bad"), parsed);
  const sessionOrErr = requireSession(req, body);
  if ("error" in sessionOrErr) return sessionOrErr.error;
  try {
    const runtime = await getPaymentHttpRuntime();
    const id = (await ctx.params).claimId;
    const operation = String(body.operation ?? "mark_claimable");
    let data;
    if (operation === "fund") data = await runtime.gifts.recordFunding(id, { now: Number(body.now ?? nowSeconds()) });
    else if (operation === "mark_claimable") data = await runtime.gifts.markClaimable(id, { now: Number(body.now ?? nowSeconds()) });
    else if (operation === "expire") data = await runtime.gifts.expire(id, { now: Number(body.now ?? nowSeconds()) });
    else if (operation === "refund") data = await runtime.gifts.refund(id, { now: Number(body.now ?? nowSeconds()), actor: sessionOrErr.userId as `0x${string}` });
    else if (operation === "claim") {
      const recipientAddress = String(body.recipientAddress ?? "");
      if (recipientAddress.toLowerCase() !== sessionOrErr.userId.toLowerCase()) {
        throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.UNAUTHORIZED, "authenticated_recipient_required");
      }
      data = await runtime.gifts.claim(id, { now: Number(body.now ?? nowSeconds()), proof: body.proof, recipientAddress: sessionOrErr.userId as `0x${string}` });
    } else throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.INVALID_REQUEST, "unsupported_operation");
    return jsonData(publicGift(data), parsed);
  } catch (error) {
    return jsonPaymentError(error, parsed);
  }
}
