import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAppFactory } from "@/application/factory";
import { POST as bindPost } from "../identity/[prismId]/bindings/route";

vi.mock("@/application/factory", () => ({
  getAppFactory: vi.fn(),
}));

const bind = vi.fn();
const session = {
  sessionId: "sess-api-proof",
  userId: "user-api-proof",
  issuedAt: 1_789_000_000,
  expiresAt: 1_789_000_600,
};

function request(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new Request("http://localhost/v1/identity/prism%3AP7F21/bindings", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ session, ...body }),
  });
}

describe("bind REST proof reference boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAppFactory).mockResolvedValue({ handlers: { bind } } as never);
  });

  it("rejects a digest-only request before the application handler", async () => {
    const response = await bindPost(
      request(
        {
          venue: "BASE",
          executionAccount: "0x1111111111111111111111111111111111111111",
          proofDigest: `0x${"f".repeat(64)}`,
          controllerAddress: "0x1111",
        },
        { "x-request-id": "req-missing-proof-reference" },
      ),
      { params: Promise.resolve({ prismId: "prism:P7F21" }) },
    );
    const body = (await response.json()) as { error: { code: string; detail?: string } };

    expect(response.status).toBe(422);
    expect(body.error.code).toBe("ERR-005");
    expect(body.error.detail).toBe("missing_binding_proof_reference");
    expect(bind).not.toHaveBeenCalled();
  });

  it("rejects an explicit SELECTIVE selector rather than treating canonical bind as PUBLIC", async () => {
    const response = await bindPost(
      request({
        visibility: "SELECTIVE",
        venue: "BASE",
        executionAccount: "0x1111111111111111111111111111111111111111",
        proofDigest: `0x${"f".repeat(64)}`,
        challengeId: `0x${"a".repeat(64)}`,
        chainId: 84532,
        expiresAt: 1_789_000_600,
        controllerAddress: "0x1111",
      }),
      { params: Promise.resolve({ prismId: "prism:P7F21" }) },
    );
    expect(response.status).toBe(501);
    expect((await response.json()).error.code).toBe("SELECTIVE_UNSUPPORTED");
    expect(bind).not.toHaveBeenCalled();
  });

  it("forwards the challenge reference and exact echoed fields to the application boundary", async () => {
    bind.mockResolvedValue({
      ok: false,
      error: {
        code: "ERR-012",
        name: "altered_message",
        category: "validation",
        retryable: "false_new_challenge",
        userAction: "restart_flow",
        httpStatusHint: 400,
        detail: "challenge_binding_mismatch:digest",
      },
    });
    const challengeId = `0x${"a".repeat(64)}`;
    const proofDigest = `0x${"b".repeat(64)}`;
    const response = await bindPost(
      request(
        {
          venue: "BASE",
          executionAccount: "0x1111111111111111111111111111111111111111",
          proofDigest,
          challengeId,
          chainId: 84532,
          expiresAt: 1_789_000_600,
          controllerAddress: "0x1111",
        },
        { "x-request-id": "req-proof-reference" },
      ),
      { params: Promise.resolve({ prismId: "prism:P7F21" }) },
    );

    expect(response.status).toBe(400);
    expect(bind).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        challengeId,
        proofDigest,
        chainId: 84532,
        expiresAt: 1_789_000_600,
      }),
    }));
  });
});
