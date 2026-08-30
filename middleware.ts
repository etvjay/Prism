import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { clientRateLimitKey, defaultRateLimiter, rateLimitResponse } from "./src/application/http-guards";

export function middleware(req: NextRequest) {
  const decision = defaultRateLimiter.check(clientRateLimitKey(req));
  if (!decision.allowed) return rateLimitResponse(req.headers.get("x-request-id"), decision);
  const response = NextResponse.next();
  response.headers.set("x-prism-api-version", "1.0.0");
  response.headers.set("x-ratelimit-remaining", String(decision.remaining));
  return response;
}

export const config = { matcher: "/api/:path*" };
