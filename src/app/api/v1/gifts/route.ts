import { getPaymentHttpRuntime } from "@/features/prism-payments/application/http-runtime";
import { parseHeaders, readJson, requireSession, jsonData, jsonPaymentError, nowSeconds, publicGift } from "@/features/prism-payments/application/http-helpers";
import { BASE_SEPOLIA_CHAIN_ID } from "@/features/prism-payments/domain/claimable-gift";
import { PaymentClaimError, PAYMENT_CLAIM_ERROR_CODE } from "@/features/prism-payments/domain/errors";

export async function POST(req: Request): Promise<Response> {
  const parsed = parseHeaders(req);
  const body = await readJson(req);
  if (body === null) return jsonPaymentError(new Error("bad"), parsed);
  const sessionOrErr = requireSession(req, body);
  if ("error" in sessionOrErr) return sessionOrErr.error;
  try {
    const sender = String(body.sender ?? "");
    if (sender.toLowerCase() !== sessionOrErr.userId.toLowerCase()) {
      throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.UNAUTHORIZED, "authenticated_sender_required");
    }
    const runtime = await getPaymentHttpRuntime();
    const data = await runtime.gifts.create({
      claimId: String(body.claimId ?? crypto.randomUUID()),
      sender: sessionOrErr.userId as `0x${string}`,
      asset: body.asset as `0x${string}`,
      amount: BigInt(String(body.amount)),
      chainId: Number(body.chainId ?? BASE_SEPOLIA_CHAIN_ID) as typeof BASE_SEPOLIA_CHAIN_ID,
      expiresAt: Number(body.expiresAt),
      nullifierCommitment: String(body.nullifierCommitment) as `0x${string}`,
      now: Number(body.now ?? nowSeconds()),
    });
    return jsonData(publicGift(data), parsed, 201);
  } catch (error) {
    return jsonPaymentError(error, parsed);
  }
}
