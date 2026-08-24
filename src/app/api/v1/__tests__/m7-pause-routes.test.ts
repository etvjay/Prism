import { beforeEach, describe, expect, it, vi } from "vitest";
import { PauseError, PAUSE_ERROR_CODE } from "../../../../features/prism-pause/domain/errors";
import { getAppFactory } from "../../../../application/factory";
import { POST as pauseIntentPost } from "../intents/[intentId]/pause/route";
import { POST as verifyPausePost } from "../pauses/[pauseId]/verify/route";
import { GET as getPauseGet } from "../pauses/[pauseId]/route";
import { GET as getReceiptGet } from "../receipts/[receiptId]/route";

vi.mock("@/application/factory", () => ({
  getAppFactory: vi.fn(),
}));

const pauseService = {
  pauseIntent: vi.fn(),
  verifyPause: vi.fn(),
  getPause: vi.fn(),
  receiptService: { getReceipt: vi.fn() },
};

const session = {
  sessionId: "session-m7",
  userId: "user-m7",
  issuedAt: 1_000,
  expiresAt: 2_000,
};

function request(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ session, ...body }),
  });
}

describe("M7 Pause REST boundary regressions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAppFactory).mockResolvedValue({ pauseService, receiptService: pauseService.receiptService } as never);
  });

  it("preserves PauseError catalogue/status when pausing an expired intent", async () => {
    pauseService.pauseIntent.mockRejectedValue(new PauseError(PAUSE_ERROR_CODE.INTENT_EXPIRED, "intent-expired"));

    const response = await pauseIntentPost(
      request({}, { "x-request-id": "req-expired", "x-correlation-id": "corr-expired" }),
      { params: Promise.resolve({ intentId: "intent-expired" }) },
    );
    const body = (await response.json()) as { error: { code: string; name: string; httpStatusHint: number } };

    expect(response.status).toBe(410);
    expect(body.error.code).toBe("ERR-105");
    expect(body.error.name).toBe("intent_expired");
    expect(body.error.httpStatusHint).toBe(410);
  });

  it("echoes correlation on successful verification responses", async () => {
    pauseService.verifyPause.mockResolvedValue({ pauseId: "pause-1", state: "RELEASE_READY", version: 1 });

    const response = await verifyPausePost(
      request({}, { "x-request-id": "req-verify", "x-correlation-id": "corr-verify" }),
      { params: Promise.resolve({ pauseId: "pause-1" }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("req-verify");
    expect(response.headers.get("x-correlation-id")).toBe("corr-verify");
  });

  it("maps pause-store read failures to a stable dependency error", async () => {
    pauseService.getPause.mockRejectedValue(new Error("store_connection_failed"));

    const response = await getPauseGet(
      request({}, { "x-request-id": "req-read", "x-correlation-id": "corr-read" }),
      { params: Promise.resolve({ pauseId: "pause-1" }) },
    );
    const body = (await response.json()) as { error: { code: string; httpStatusHint: number } };

    expect(response.status).toBe(503);
    expect(body.error.code).toBe("ERR-021");
    expect(body.error.httpStatusHint).toBe(503);
    expect(response.headers.get("x-correlation-id")).toBe("corr-read");
  });

  it("maps receipt-store failures to a stable dependency error", async () => {
    pauseService.receiptService.getReceipt.mockRejectedValue(new Error("receipt_store_down"));

    const response = await getReceiptGet(
      request({}, { "x-request-id": "req-receipt", "x-correlation-id": "corr-receipt" }),
      { params: Promise.resolve({ receiptId: "receipt-1" }) },
    );
    const body = (await response.json()) as { error: { code: string; httpStatusHint: number } };

    expect(response.status).toBe(503);
    expect(body.error.code).toBe("ERR-021");
    expect(body.error.httpStatusHint).toBe(503);
    expect(response.headers.get("x-correlation-id")).toBe("corr-receipt");
  });
});
