import { getPaymentHttpRuntime } from "@/features/prism-payments/application/http-runtime";
import { parseHeaders, readJson, requireSession, jsonData, jsonPaymentError, nowSeconds, publicPayment } from "@/features/prism-payments/application/http-helpers";
import { BASE_SEPOLIA_CHAIN_ID } from "@/features/prism-payments/domain/payment-request";

export async function POST(req: Request): Promise<Response> {
  const parsed = parseHeaders(req);
  const body = await readJson(req);
  if (body === null) return jsonPaymentError(new Error("bad"), parsed);
  const sessionOrErr = requireSession(req, body);
  if ("error" in sessionOrErr) return sessionOrErr.error;
  try {
    const runtime = await getPaymentHttpRuntime();
    const data = await runtime.payments.create({
      requestId: String(body.requestId ?? crypto.randomUUID()),
      requesterRef: sessionOrErr.userId,
      recipient: body.recipient as never,
      asset: body.asset as never,
      amount: BigInt(String(body.amount)),
      chainId: Number(body.chainId ?? BASE_SEPOLIA_CHAIN_ID) as typeof BASE_SEPOLIA_CHAIN_ID,
      expiresAt: Number(body.expiresAt),
      now: Number(body.now ?? nowSeconds()),
      idempotencyKey: parsed.idempotencyKey ?? String(body.idempotencyKey ?? ""),
    });
    return jsonData(publicPayment(data), parsed, 201);
  } catch (error) {
    return jsonPaymentError(error, parsed);
  }
}
