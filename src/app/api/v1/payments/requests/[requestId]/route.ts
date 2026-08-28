import { getPaymentHttpRuntime } from "@/features/prism-payments/application/http-runtime";
import { parseHeaders, readJson, requireAuthenticatedSession, jsonData, jsonPaymentError, nowSeconds, publicPayment } from "@/features/prism-payments/application/http-helpers";
import { BASE_SEPOLIA_CHAIN_ID } from "@/features/prism-payments/domain/payment-request";
import { PaymentClaimError, PAYMENT_CLAIM_ERROR_CODE } from "@/features/prism-payments/domain/errors";

export async function GET(req: Request, ctx: { params: Promise<{ requestId: string }> }): Promise<Response> {
  const parsed = parseHeaders(req);
  try {
    const runtime = await getPaymentHttpRuntime();
    const data = await runtime.payments.get((await ctx.params).requestId);
    if (!data) throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.PAYMENT_NOT_FOUND, "payment_not_found");
    return jsonData(publicPayment(data), parsed);
  } catch (error) {
    return jsonPaymentError(error, parsed);
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ requestId: string }> }): Promise<Response> {
  const parsed = parseHeaders(req);
  const body = await readJson(req);
  if (body === null) return jsonPaymentError(new Error("bad"), parsed);
  const sessionOrErr = requireAuthenticatedSession(req, body);
  if ("error" in sessionOrErr) return sessionOrErr.error;
  try {
    const runtime = await getPaymentHttpRuntime();
    const id = (await ctx.params).requestId;
    const operation = String(body.operation ?? "view");
    let data;
    if (operation === "view") {
      data = await runtime.payments.view(id, Number(body.now ?? nowSeconds()), sessionOrErr.userId);
    } else if (operation === "approve") {
      const approval = (body.approval && typeof body.approval === "object" ? body.approval : {}) as Record<string, unknown>;
      data = await runtime.payments.approve(id, {
        now: Number(body.now ?? nowSeconds()),
        approval: {
          ...approval,
          requestId: id,
          chainId: Number(approval.chainId ?? BASE_SEPOLIA_CHAIN_ID),
          amount: BigInt(String(approval.amount)),
        },
      } as never, sessionOrErr.userId);
    } else if (operation === "submit") {
      data = await runtime.payments.submit(id, sessionOrErr.userId);
    } else {
      throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.INVALID_REQUEST, "unsupported_operation");
    }
    return jsonData(publicPayment(data), parsed);
  } catch (error) {
    return jsonPaymentError(error, parsed);
  }
}
