import { describe, expect, it } from "vitest";
import { jsonError, parseHeaders, toHttpResponse } from "../http-helpers";

const PROOF_DIGEST = `0x${"a".repeat(64)}`;

describe("HTTP error redaction boundary", () => {
  it("redacts provider URLs, credentials, and proof-sized hex values", async () => {
    const response = jsonError(
      "req-safe",
      "ERR-021",
      503,
      `rpc_failure:https://rpc.example/v1?api_key=secret-token proof_digest=${PROOF_DIGEST}`,
    );
    const text = await response.text();

    expect(text).not.toContain("https://rpc.example");
    expect(text).not.toContain("secret-token");
    expect(text).not.toContain(PROOF_DIGEST);
    expect(text).toContain("dependency_unavailable");
  });

  it("redacts stable application error details before serializing them", async () => {
    const appResponse = {
      ok: false as const,
      error: {
        code: "ERR-021",
        name: "rpc_unavailable",
        category: "dependency",
        retryable: "true_backoff",
        userAction: "wait_retry",
        httpStatusHint: 503,
        detail: `provider returned https://rpc.example?token=secret-token ${PROOF_DIGEST}`,
      },
    };
    const parsed = parseHeaders(new Request("http://localhost", { headers: { "x-request-id": "req-safe-2" } }));
    const response = toHttpResponse(appResponse, parsed);
    const text = await response.text();

    expect(text).not.toContain("https://rpc.example");
    expect(text).not.toContain("secret-token");
    expect(text).not.toContain(PROOF_DIGEST);
    expect(text).toContain("dependency_unavailable");
  });
});
