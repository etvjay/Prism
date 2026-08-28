import { describe, expect, it } from "vitest";
import { createPrismApiHandlers } from "../../../application/handlers";
import { PrivacyReceiptService, projectPrivacyReceipt } from "../../../application/privacy-receipt-service";
import { parseStrk20ActionPayload, serializePrivacyActionView } from "../../../application/strk20-transport";
import { PrivacyActionService, type PrivacyActionView } from "../application/privacy-action-service";
import type { Strk20WalletPort } from "../domain/ports";
import { STRK20_POOL_ADDRESS } from "../domain/strk20-action-port";

const TX = "0x0000000000000000000000000000000000000000000000000000000000000001" as const;
const TOKEN = "0x0000000000000000000000000000000000000000000000000000000000000003" as const;
const RECIPIENT = "0x0000000000000000000000000000000000000000000000000000000000000004" as const;
const session = { sessionId: "session-1", userId: "user-1", issuedAt: 1_000, expiresAt: 2_000 };

type ReceiptMode = "pending" | "success" | "eventless" | "reverted" | "unknown";

function makeWallet() {
  let receiptMode: ReceiptMode = "success";
  let transfers = 0;
  const wallet: Strk20WalletPort = {
    observeCapability: async () => ({ apiVersions: ["0.10.3"], specs: [], chainId: "SN_SEPOLIA" }),
    observeChainId: async () => "SN_SEPOLIA",
    isRegistered: async () => true,
    observeFee: async () => ({ fee: 9n, blockNumber: 10 }),
    requestApproval: async () => TX,
    requestShield: async () => ({
      txHash: TX,
      executionStatus: "SUCCEEDED",
      finalityStatus: "ACCEPTED_ON_L2",
      screening: "approved",
      blockNumber: 100,
      receiptEvents: [],
    }),
    requestPrivateBalances: async () => ({ balances: [], consent: "granted" }),
    requestPrivateTransfer: async () => {
      transfers += 1;
      return { txHash: TX, executionStatus: "RECEIVED", finalityStatus: "RECEIVED", blockNumber: null, receiptEvents: [] };
    },
    observeReceipt: (async () => {
      if (receiptMode === "pending") {
        return { txHash: TX, executionStatus: "PENDING", finalityStatus: "PENDING", blockNumber: null, receiptEvents: [] };
      }
      if (receiptMode === "unknown") {
        return { txHash: TX, executionStatus: "mystery", finalityStatus: "mystery", blockNumber: null, receiptEvents: [] } as never;
      }
      if (receiptMode === "reverted") {
        return { txHash: TX, executionStatus: "REVERTED", finalityStatus: "ACCEPTED_ON_L2", blockNumber: 102, receiptEvents: [] };
      }
      return {
        txHash: TX,
        executionStatus: "SUCCEEDED",
        finalityStatus: "ACCEPTED_ON_L2",
        blockNumber: 101,
        receiptEvents: receiptMode === "success" ? [{ address: STRK20_POOL_ADDRESS, keys: ["0xabc"] }] : [],
      };
    }) as unknown as Strk20WalletPort["observeReceipt"],
  };
  return {
    wallet,
    setReceiptMode: (mode: ReceiptMode) => { receiptMode = mode; },
    get transfers() { return transfers; },
  };
}

function payload(id: string, operation: "create" | "prepare" | "submit" | "observe_receipt" = "create") {
  return {
    actionId: id,
    kind: "private_transfer" as const,
    execution: "wallet_managed" as const,
    token: TOKEN,
    amount: "7",
    recipient: RECIPIENT,
    quotedFee: "9",
    consentTokens: [TOKEN],
    operation,
  };
}

function requestEnvelope(body: Record<string, unknown>, idempotencyKey = "idem-1") {
  return {
    headers: { requestId: "req-1", idempotencyKey },
    session,
    payload: body,
  } as never;
}

async function createHandler() {
  const providers = makeWallet();
  const actionService = new PrivacyActionService({ walletPort: providers.wallet, now: () => 1_000 });
  const handlers = createPrismApiHandlers({} as never, { privacyActionService: actionService });
  return { providers, actionService, handlers };
}

describe("STRK20 action API application boundary", () => {
  it("validates decimal transport and rejects raw action/provider material", () => {
    expect(parseStrk20ActionPayload({ actionId: "a-1", kind: "private_transfer", amount: "100000000000000000001" }).amount).toBe("100000000000000000001");
    for (const value of [1, -1, "01", "1.0", "1e3"]) {
      expect(() => parseStrk20ActionPayload({ actionId: "a-1", kind: "private_transfer", amount: value })).toThrow(/decimal_string/);
    }
    for (const field of ["actions", "proof", "calldata", "rawCall", "viewingKey", "privateNote", "privateKey", "providerResponse"]) {
      expect(() => parseStrk20ActionPayload({ actionId: "a-1", kind: "private_transfer", [field]: "forbidden" })).toThrow();
    }
    expect(() => parseStrk20ActionPayload({ actionId: "a-1", kind: "private_transfer", token: "0x0" })).toThrow(/starknet_address/);
  });

  it("creates idempotently and rejects a same-key replay with a different fingerprint", async () => {
    const { handlers } = await createHandler();
    const first = await handlers.createStrk20Action(requestEnvelope(payload("a-1"), "idem-a"));
    const replay = await handlers.createStrk20Action(requestEnvelope(payload("a-1"), "idem-a"));
    expect(first.ok && first.data.state).toBe("unknown");
    expect(replay.ok && replay.data.state).toBe("unknown");
    expect(replay.ok && replay.data.version).toBe(0);

    const conflict = await handlers.createStrk20Action(requestEnvelope({ ...payload("a-1"), amount: "8" }, "idem-a"));
    expect(conflict.ok).toBe(false);
    expect(conflict.ok ? null : conflict.error.code).toBe("STRK20-011");
    expect(conflict.ok ? null : conflict.error.name).toBe("idempotency_key_conflict");
  });

  it("keeps submitted, processing, confirmed, reverted, and unknown distinct", async () => {
    const { handlers, providers } = await createHandler();
    await handlers.createStrk20Action(requestEnvelope(payload("lifecycle"), "idem-lifecycle"));
    const ready = await handlers.createStrk20Action(requestEnvelope(payload("lifecycle", "prepare"), "idem-lifecycle"));
    expect(ready.ok && ready.data.state).toBe("awaiting-approval");

    const submitted = await handlers.createStrk20Action(requestEnvelope(payload("lifecycle", "submit"), "idem-lifecycle"));
    expect(submitted.ok && submitted.data.state).toBe("submitted");
    expect(submitted.ok && submitted.data.terminal).toBe(false);

    providers.setReceiptMode("pending");
    const processing = await handlers.createStrk20Action(requestEnvelope(payload("lifecycle", "observe_receipt"), "idem-lifecycle"));
    expect(processing.ok && processing.data.state).toBe("processing");
    expect(processing.ok && processing.data.receipt?.executionStatus).toBe("PENDING");
    expect(processing.ok && processing.data.terminal).toBe(false);

    providers.setReceiptMode("unknown");
    const unknown = await handlers.createStrk20Action(requestEnvelope(payload("lifecycle", "observe_receipt"), "idem-lifecycle"));
    expect(unknown.ok && unknown.data.state).toBe("unknown");
    expect(unknown.ok && unknown.data.terminal).toBe(false);

    providers.setReceiptMode("success");
    const confirmed = await handlers.createStrk20Action(requestEnvelope(payload("lifecycle", "observe_receipt"), "idem-lifecycle"));
    expect(confirmed.ok && confirmed.data.state).toBe("receipt-confirmed");
    expect(confirmed.ok && confirmed.data.terminal).toBe(true);

    // A second submit is a replay read, not a second transfer.
    const replaySubmit = await handlers.createStrk20Action(requestEnvelope(payload("lifecycle", "submit"), "idem-lifecycle"));
    expect(replaySubmit.ok).toBe(false); // terminal action remains immutable
    expect(providers.transfers).toBe(1);

    const reverted = await createHandler();
    await reverted.handlers.createStrk20Action(requestEnvelope(payload("reverted"), "idem-reverted"));
    await reverted.handlers.createStrk20Action(requestEnvelope(payload("reverted", "prepare"), "idem-reverted"));
    await reverted.handlers.createStrk20Action(requestEnvelope(payload("reverted", "submit"), "idem-reverted"));
    reverted.providers.setReceiptMode("reverted");
    const revertedView = await reverted.handlers.createStrk20Action(requestEnvelope(payload("reverted", "observe_receipt"), "idem-reverted"));
    expect(revertedView.ok && revertedView.data.state).toBe("reverted");
    expect(revertedView.ok && revertedView.data.terminal).toBe(true);
  });

  it("keeps consent-required and ambiguous submission as explicit non-success states", async () => {
    const consent = await createHandler();
    consent.providers.wallet.requestPrivateBalances = async () => ({ balances: [], consent: "required" });
    await consent.handlers.createStrk20Action(requestEnvelope(payload("consent"), "idem-consent"));
    const consentPrepare = await consent.handlers.createStrk20Action(requestEnvelope(payload("consent", "prepare"), "idem-consent"));
    expect(consentPrepare.ok).toBe(false);
    const consentView = await consent.handlers.getStrk20Action({ payload: { actionId: "consent" }, headers: { requestId: "req-consent" } });
    expect(consentView.ok && consentView.data.state).toBe("consent-required");

    const attention = await createHandler();
    attention.providers.wallet.requestPrivateTransfer = async () => {
      throw new Error("provider response privateKey must never be returned");
    };
    await attention.handlers.createStrk20Action(requestEnvelope(payload("attention"), "idem-attention"));
    await attention.handlers.createStrk20Action(requestEnvelope(payload("attention", "prepare"), "idem-attention"));
    const submit = await attention.handlers.createStrk20Action(requestEnvelope(payload("attention", "submit"), "idem-attention"));
    expect(submit.ok).toBe(false);
    const attentionView = await attention.handlers.getStrk20Action({ payload: { actionId: "attention" }, headers: { requestId: "req-attention" } });
    expect(attentionView.ok && attentionView.data.state).toBe("requires-attention");
    expect(JSON.stringify(attentionView)).not.toMatch(/privateKey|provider response/);
  });

  it("redacts proof/call material and serializes BigInt fee fields as decimal strings", async () => {
    const { actionService } = await createHandler();
    const view = actionService.create({ id: "redact", kind: "private_transfer", execution: "wallet_managed", token: TOKEN, amount: 7n, recipient: RECIPIENT, quotedFee: 9n });
    const serialized = serializePrivacyActionView({
      ...view,
      fee: { fee: 9n, blockNumber: 10, quotedFee: 9n },
      proof: { status: "ready", call: { contract_address: STRK20_POOL_ADDRESS, entry_point: "invoke", calldata: ["0xdeadbeef"] } },
      errorDetail: "provider response privateNote viewingKey 9n",
    } as unknown as PrivacyActionView);
    expect(serialized.fee).toEqual({ fee: "9", blockNumber: 10, quotedFee: "9" });
    expect(serialized.proof).toEqual({ status: "ready", call: null });
    expect(JSON.stringify(serialized)).not.toMatch(/calldata|deadbeef|privateNote|viewingKey|provider response|9n/);
  });

  it("returns unavailable when no wallet service is configured", async () => {
    const handlers = createPrismApiHandlers({} as never, { privacyActionService: null, privacyReceiptService: null });
    const action = await handlers.createStrk20Action(requestEnvelope(payload("unavailable")));
    expect(action.ok).toBe(false);
    expect(action.ok ? null : action.error.code).toBe("STRK20-019");
    expect(action.ok ? null : action.error.httpStatusHint).toBe(503);
    const receipt = await handlers.getPrivacyReceipt({ payload: { receiptId: "unavailable" }, headers: { requestId: "req-r" } });
    expect(receipt.ok).toBe(false);
    expect(receipt.ok ? null : receipt.error.code).toBe("STRK20-019");
  });
});

describe("policy-filtered privacy receipt projection", () => {
  function baseView(overrides: Partial<PrivacyActionView> = {}): PrivacyActionView {
    return {
      id: "receipt-action",
      kind: "private_transfer",
      execution: "wallet_managed",
      state: "transfer_pending",
      phase: "submitted",
      version: 3,
      updatedAt: 1_000,
      capability: { capable: true, status: "supported", apiVersions: ["0.10.3"], specs: [], chainId: "SN_SEPOLIA", environment: "SN_SEPOLIA", mismatch: false, expected: "SN_SEPOLIA" },
      registration: { status: "registered" },
      fee: { fee: 9n, blockNumber: 10, quotedFee: 9n },
      consent: { status: "granted" },
      proof: { status: "wallet_managed", call: null },
      submissionAttempted: true,
      approvalTransactionHash: null,
      transactionHash: TX,
      receipt: null,
      terminal: false,
      errorCode: null,
      errorDetail: null,
      ...overrides,
    };
  }

  it("keeps submitted pending, and requires finality plus concrete pool evidence", () => {
    expect(projectPrivacyReceipt(baseView()).observationStatus).toBe("PENDING");
    expect(projectPrivacyReceipt(baseView({ receipt: {
      transactionHash: TX,
      executionStatus: "SUCCEEDED",
      finalityStatus: "ACCEPTED_ON_L2",
      blockNumber: 101,
      poolEventFound: false,
    } })).observationStatus).toBe("PENDING");
    const observed = projectPrivacyReceipt(baseView({
      state: "transfer_confirmed",
      phase: "terminal",
      terminal: true,
      receipt: { transactionHash: TX, executionStatus: "SUCCEEDED", finalityStatus: "ACCEPTED_ON_L2", blockNumber: 101, poolEventFound: true },
    }));
    expect(observed.observationStatus).toBe("OBSERVED");
    expect(observed.evidenceSource).toBe("PROVIDER_RECEIPT");
    expect(observed.blockNumber).toBe(101);
  });

  it("labels reverted/unknown evidence unavailable without exposing raw material", () => {
    const reverted = projectPrivacyReceipt(baseView({ receipt: { transactionHash: TX, executionStatus: "REVERTED", finalityStatus: "ACCEPTED_ON_L2", blockNumber: 101, poolEventFound: false } }));
    expect(reverted.observationStatus).toBe("UNAVAILABLE");
    const unknown = projectPrivacyReceipt(baseView({ receipt: { transactionHash: TX, executionStatus: "UNKNOWN", finalityStatus: "UNKNOWN", blockNumber: null, poolEventFound: false } }));
    expect(unknown.observationStatus).toBe("UNAVAILABLE");
    const shield = projectPrivacyReceipt(baseView({ kind: "shield", state: "confirmed", phase: "confirmed", terminal: false, receipt: null }));
    expect(shield.mechanism).toBe("NONE");
    expect(shield.limitations).toContain("shield_deposit_is_public");
    expect(shield.publicProperties).toContain("amount");
    expect(projectPrivacyReceipt(baseView({ kind: "application" })).publicProperties).toContain("amount");
    const text = JSON.stringify(projectPrivacyReceipt(baseView({ errorDetail: "providerResponse privateNote viewingKey 9n" })));
    expect(text).not.toMatch(/providerResponse|privateNote|viewingKey|9n/);
  });

  it("returns a not-found response for an unknown derived receipt", async () => {
    const service = new PrivacyReceiptService({ getAction: () => null });
    const result = await service.getReceipt("missing", "req-missing");
    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error.code).toBe("ERR-002");
    expect(result.ok ? null : result.error.httpStatusHint).toBe(404);
  });
});
