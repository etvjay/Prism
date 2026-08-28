import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAppFactory } from "@/application/factory";
import { POST as actionPost } from "../strk20/actions/route";
import { GET as actionGet } from "../strk20/actions/[actionId]/route";
import { GET as privacyReceiptGet } from "../privacy/receipts/[receiptId]/route";

vi.mock("@/application/factory", () => ({ getAppFactory: vi.fn() }));

const session = { sessionId: "session-1", userId: "user-1", issuedAt: 1_000, expiresAt: 2_000 };
const createStrk20Action = vi.fn();
const getStrk20Action = vi.fn();
const getPrivacyReceipt = vi.fn();

function post(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/v1/strk20/actions", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ session, ...body }),
  });
}

describe("STRK20/privacy frontend-facing routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAppFactory).mockResolvedValue({
      handlers: { createStrk20Action, getStrk20Action, getPrivacyReceipt },
    } as never);
    createStrk20Action.mockResolvedValue({
      ok: true,
      data: {
        actionId: "action-1",
        id: "action-1",
        kind: "private_transfer",
        state: "unknown",
        version: 0,
        terminal: false,
        fee: null,
        proof: { status: "not_requested", call: null },
      },
    });
    getStrk20Action.mockResolvedValue({
      ok: true,
      data: { actionId: "action-1", id: "action-1", state: "submitted", terminal: false },
    });
    getPrivacyReceipt.mockResolvedValue({
      ok: true,
      data: {
        receiptId: "receipt-1",
        actionId: "action-1",
        mechanism: "STRK20_PRIVATE_TRANSFER",
        observationStatus: "PENDING",
        evidenceSource: "NONE",
        protectedProperties: ["sender", "recipient", "amount"],
        publicProperties: ["proof_artifacts"],
        limitations: ["receipt_pending"],
      },
    });
  });

  it("rejects malformed JSON and missing app sessions before application handling", async () => {
    const malformed = await actionPost(new Request("http://localhost/api/v1/strk20/actions", {
      method: "POST",
      headers: { "content-type": "application/json", "x-request-id": "req-malformed" },
      body: "{",
    }));
    expect(malformed.status).toBe(400);
    expect((await malformed.json()).error.detail).toBe("malformed_json");

    const noSession = await actionPost(new Request("http://localhost/api/v1/strk20/actions", {
      method: "POST",
      headers: { "content-type": "application/json", "x-request-id": "req-session" },
      body: JSON.stringify({ actionId: "action-1", kind: "private_transfer" }),
    }));
    expect(noSession.status).toBe(401);
    expect(createStrk20Action).not.toHaveBeenCalled();
  });

  it("rejects private material/raw provider fields and never forwards them", async () => {
    for (const field of ["proof", "calldata", "rawCall", "viewingKey", "privateNote", "privateKey", "providerResponse", "secret"]) {
      const response = await actionPost(post({
        actionId: "action-1",
        kind: "private_transfer",
        [field]: "forbidden",
      }, { "x-request-id": "req-forbidden" }));
      const body = await response.json() as { error: { code: string; detail?: string } };
      expect(response.status).toBe(400);
      expect(body.error.code).toBe("STRK20-015");
      expect(body.error.detail).toContain("forbidden_field");
    }
    expect(createStrk20Action).not.toHaveBeenCalled();
  });

  it("passes only safe lifecycle vocabulary and preserves submitted != completed", async () => {
    const response = await actionPost(post({
      actionId: "action-1",
      prismId: "prism:1",
      kind: "private_transfer",
      operation: "create",
      walletSessionRef: "wallet-session-1",
    }, { "x-request-id": "req-1", "x-correlation-id": "corr-1", "idempotency-key": "idem-1" }));
    expect(response.status).toBe(200);
    expect(createStrk20Action).toHaveBeenCalledWith(expect.objectContaining({
      headers: expect.objectContaining({ idempotencyKey: "idem-1", correlationId: "corr-1" }),
      payload: expect.objectContaining({
        actionId: "action-1",
        kind: "private_transfer",
        operation: "create",
        prismId: "prism:1",
        walletSessionRef: "wallet-session-1",
      }),
    }));
    const body = await response.json() as { data: Record<string, unknown> };
    expect(body.data.state).toBe("unknown");
    expect(body.data.terminal).toBe(false);
    expect(JSON.stringify(body)).not.toMatch(/calldata|proof_facts|viewingKey|privateNote|providerResponse|completed/);
    expect(response.headers.get("x-request-id")).toBe("req-1");
    expect(response.headers.get("x-correlation-id")).toBe("corr-1");
  });

  it("routes GET action and policy-filtered privacy receipt through application handlers", async () => {
    const actionResponse = await actionGet(new Request("http://localhost/api/v1/strk20/actions/action-1", {
      headers: { "x-request-id": "req-2" },
    }), { params: Promise.resolve({ actionId: "action-1" }) });
    expect(actionResponse.status).toBe(200);
    expect(getStrk20Action).toHaveBeenCalledWith(expect.objectContaining({
      payload: { actionId: "action-1" },
      headers: { requestId: "req-2" },
    }));

    const receiptResponse = await privacyReceiptGet(new Request("http://localhost/api/v1/privacy/receipts/receipt-1", {
      headers: { "x-request-id": "req-3" },
    }), { params: Promise.resolve({ receiptId: "receipt-1" }) });
    expect(receiptResponse.status).toBe(200);
    expect(getPrivacyReceipt).toHaveBeenCalledWith(expect.objectContaining({
      payload: { receiptId: "receipt-1" },
      headers: { requestId: "req-3" },
    }));
    const body = await receiptResponse.json() as { data: Record<string, unknown> };
    expect(body.data.observationStatus).toBe("PENDING");
    expect(JSON.stringify(body)).not.toMatch(/providerResponse|privateNote|viewingKey|calldata|proof_facts/);
  });

  it("maps factory initialization failure without leaking provider/store details", async () => {
    vi.mocked(getAppFactory).mockRejectedValueOnce(new Error("postgres://user:password@host/db"));
    const response = await actionGet(new Request("http://localhost/api/v1/strk20/actions/action-1", {
      headers: { "x-request-id": "req-down" },
    }), { params: Promise.resolve({ actionId: "action-1" }) });
    const body = await response.json() as { error: { code: string; detail: string } };
    expect(response.status).toBe(503);
    expect(body.error.code).toBe("ERR-021");
    expect(body.error.detail).toBe("store_unavailable");
    expect(JSON.stringify(body)).not.toContain("password");
  });
});
