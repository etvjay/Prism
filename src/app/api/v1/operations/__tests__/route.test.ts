import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAppFactory } from "@/application/factory";
import { GET } from "../[operationId]/route";

vi.mock("@/application/factory", () => ({
  getAppFactory: vi.fn(),
}));

const PROOF_DIGEST = `0x${"b".repeat(64)}`;
const getOperation = vi.fn();

describe("GET /api/v1/operations/:operationId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAppFactory).mockResolvedValue({ handlers: { getOperation } } as never);
  });

  it("returns lifecycle data without durable idempotency fingerprints or proof material", async () => {
    getOperation.mockResolvedValue({
      ok: true,
      data: {
        id: "op-1",
        kind: "bind_execution_identity",
        state: "submitted",
        version: 3,
        createdAt: 100,
        updatedAt: 103,
        authoritativeSource: "starknet_rpc_tx_status",
        txHash: `0x${"a".repeat(64)}`,
        errorCode: null,
        errorDetail: null,
        attempts: 0,
        submissionAttempted: true,
        correlationId: "corr-1",
        reconciliationWatermark: null,
        idempotencyKey: "client-secret-idempotency-key",
        requestFingerprint: JSON.stringify({ proofDigest: PROOF_DIGEST }),
        reconciliationMetadata: { providerOutput: "private" },
      },
    });

    const response = await GET(
      new Request("http://localhost/api/v1/operations/op-1"),
      { params: Promise.resolve({ operationId: "op-1" }) },
    );
    const body: any = await response.json();
    const text = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({ id: "op-1", state: "submitted", version: 3 });
    expect(body.data).not.toHaveProperty("idempotencyKey");
    expect(body.data).not.toHaveProperty("requestFingerprint");
    expect(body.data).not.toHaveProperty("reconciliationMetadata");
    expect(text).not.toContain(PROOF_DIGEST);
    expect(text).not.toContain("client-secret-idempotency-key");
    expect(text).not.toContain("providerOutput");
  });
});
