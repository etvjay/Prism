import { describe, expect, it } from "vitest";
import {
  DOCUMENTED_GENERAL_NEAR_INTENTS_CAPABILITIES,
  NEAR_INTENTS_ONE_CLICK_PROVIDER_ID,
  NearIntentsOneClickProvider,
  assessNearIntentsAvailability,
  mapNearIntentsStatus,
  type NearIntentsQuote,
  type NearIntentsQuoteRequest,
  type NearIntentsReceiptReader,
  type NearIntentsRoute,
  type NearIntentsStatusResponse,
  type NearIntentsTransport,
} from "../adapter";

const NOW = Date.parse("2026-08-28T12:00:00.000Z");
const LATER = "2026-08-28T12:10:00.000Z";
const BASE_ASSET = "test:base-sepolia:USDC";
const STARKNET_ASSET = "test:sn-sepolia:STRK";
const BASE_RECIPIENT = "0x1111111111111111111111111111111111111111";
const STARKNET_RECIPIENT = "0x222222222222222222222222222222222222222222222222222222222222";
const DEPOSIT_ADDRESS = "0x3333333333333333333333333333333333333333";
const DEPOSIT_TX = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const DESTINATION_TX = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const REFUND_TX = "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

const observedCapabilities = {
  evidenceLevel: "observed_testnet" as const,
  baseSepoliaSupported: true,
  snSepoliaSupported: true,
  observedRoutes: ["BASE_SEPOLIA->SN_SEPOLIA", "SN_SEPOLIA->BASE_SEPOLIA"],
  supportedAssetPairs: [
    `${BASE_ASSET}->${STARKNET_ASSET}`,
    `${STARKNET_ASSET}->${BASE_ASSET}`,
  ],
  source: "test-only injected observation",
  observedAt: "2026-08-28T11:00:00.000Z",
};

const baseToStarknetRoute: NearIntentsRoute = {
  originNetwork: "BASE_SEPOLIA",
  destinationNetwork: "SN_SEPOLIA",
  originAsset: BASE_ASSET,
  destinationAsset: STARKNET_ASSET,
};

const quoteInput: NearIntentsQuoteRequest = {
  route: baseToStarknetRoute,
  amount: "1000",
  slippageBps: 100,
  recipient: STARKNET_RECIPIENT,
  refundTo: BASE_RECIPIENT,
  deadline: LATER,
  dry: false,
};

function quoteResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    correlationId: "corr-near-1click-1",
    timestamp: "2026-08-28T11:59:00.000Z",
    signature: "provider-signature",
    quoteRequest: {
      dry: false,
      swapType: "EXACT_INPUT",
      slippageTolerance: 100,
      originAsset: BASE_ASSET,
      depositType: "ORIGIN_CHAIN",
      destinationAsset: STARKNET_ASSET,
      amount: "1000",
      refundTo: BASE_RECIPIENT,
      refundType: "ORIGIN_CHAIN",
      recipient: STARKNET_RECIPIENT,
      recipientType: "DESTINATION_CHAIN",
      deadline: LATER,
    },
    quote: {
      depositAddress: DEPOSIT_ADDRESS,
      amountIn: "1000",
      amountInFormatted: "0.001",
      amountInUsd: "1",
      minAmountIn: "1000",
      amountOut: "990",
      amountOutFormatted: "990",
      amountOutUsd: "1",
      minAmountOut: "990",
      deadline: LATER,
      timeEstimate: 120,
      refundFee: "1",
      withdrawFee: "2",
    },
    ...overrides,
  };
}

class StubTransport implements NearIntentsTransport {
  readonly calls: Array<{ method: string; path: string; body?: string }> = [];
  constructor(private readonly responses: Array<{ status: number; body: unknown }> = []) {}

  async request(input: { method: string; path: string; headers: Record<string, string>; body?: string }) {
    this.calls.push({ method: input.method, path: input.path, body: input.body });
    const response = this.responses.shift() ?? { status: 200, body: {} };
    return { status: response.status, json: async () => response.body };
  }
}

async function enabledProvider(
  transport: NearIntentsTransport,
  options: { now?: () => number; receiptReader?: NearIntentsReceiptReader | null } = {},
): Promise<{ provider: NearIntentsOneClickProvider; quote: NearIntentsQuote }> {
  const provider = new NearIntentsOneClickProvider({
    transport,
    capabilities: observedCapabilities,
    now: options.now ?? (() => NOW),
    quoteSignatureVerifier: { verifyQuoteSignature: async () => true },
    receiptReader: options.receiptReader,
  });
  const quoted = await provider.requestQuote(quoteInput);
  expect(quoted.ok).toBe(true);
  return { provider, quote: (quoted as { ok: true; data: NearIntentsQuote }).data };
}

function statusResponse(status: string, overrides: Record<string, unknown> = {}): NearIntentsStatusResponse {
  return {
    correlationId: "corr-near-1click-1",
    status,
    updatedAt: "2026-08-28T12:01:00.000Z",
    quoteResponse: quoteResponse(),
    swapDetails: {
      intentHashes: ["intent-hash"],
      nearTxHashes: ["near-tx-hash"],
      originChainTxHashes: [{ hash: DEPOSIT_TX, explorerUrl: "https://origin.example/tx" }],
      destinationChainTxHashes: [{ hash: DESTINATION_TX, explorerUrl: "https://destination.example/tx" }],
      amountIn: "1000",
      amountOut: "990",
      depositedAmount: "1000",
      refundedAmount: null,
      refundReason: null,
    },
    ...overrides,
  };
}

describe("NEAR Intents/1Click candidate availability and trust boundary", () => {
  it("returns a typed provider_unavailable blocker by default and never calls the transport", async () => {
    const transport = new StubTransport();
    const provider = new NearIntentsOneClickProvider({ transport, now: () => NOW });

    const result = await provider.requestQuote(quoteInput);

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({
      kind: "provider_unavailable",
      code: "PROVIDER_UNAVAILABLE",
      provider: NEAR_INTENTS_ONE_CLICK_PROVIDER_ID,
      pollOnly: false,
      retryable: false,
    });
    if (!result.ok) {
      expect(result.evidenceCeiling).toBe("X2");
      expect(result.blocker).toContain("Base Sepolia");
      expect(result.blocker).toContain("SN_SEPOLIA");
      expect(result.missingEvidence).toEqual(expect.arrayContaining([
        "verified Base Sepolia support",
        "verified SN_SEPOLIA support",
        "observed Base Sepolia↔SN_SEPOLIA quote/status behavior",
      ]));
    }
    expect(transport.calls).toHaveLength(0);
  });

  it("does not promote documentation-only general Base/Starknet support into testnet availability", () => {
    const assessment = assessNearIntentsAvailability(DOCUMENTED_GENERAL_NEAR_INTENTS_CAPABILITIES);

    expect(assessment.available).toBe(false);
    expect(assessment.evidenceLevel).toBe("documented_general");
    expect(assessment.blocker).toContain("testnet");
  });

  it("exposes the trusted-swapping-agent custody disclosure on an enabled fixture path", async () => {
    const transport = new StubTransport([{ status: 200, body: quoteResponse() }]);
    const { quote } = await enabledProvider(transport);

    expect(quote.trust.custodyModel).toBe("temporary_transfer_to_trusted_swapping_agent");
    expect(quote.trust.nonCustodialClaimAllowed).toBe(false);
    expect(quote.trust.disclosure).toContain("trusted swapping agent");
    expect(quote.trust.disclosure).toContain("Prism is not the solver");
  });
});

describe("NEAR Intents/1Click quote validation and native-wallet authority", () => {
  it("requests a quote with exact route fields and does not invoke a wallet or broadcast", async () => {
    const transport = new StubTransport([{ status: 200, body: quoteResponse() }]);
    const provider = new NearIntentsOneClickProvider({ transport, capabilities: observedCapabilities, now: () => NOW, quoteSignatureVerifier: { verifyQuoteSignature: async () => true } });

    const result = await provider.requestQuote(quoteInput);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.canonicalState).toBe("quote_ready");
      expect(result.data.prismOperationState).toBe("ready");
    }
    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0].method).toBe("POST");
    expect(transport.calls[0].path).toBe("/v0/quote");
    expect(JSON.parse(transport.calls[0].body ?? "{}")).toMatchObject({
      dry: false,
      swapType: "EXACT_INPUT",
      originAsset: BASE_ASSET,
      destinationAsset: STARKNET_ASSET,
      depositType: "ORIGIN_CHAIN",
      recipientType: "DESTINATION_CHAIN",
      refundType: "ORIGIN_CHAIN",
      amount: "1000",
      recipient: STARKNET_RECIPIENT,
      refundTo: BASE_RECIPIENT,
    });
  });

  it("blocks an observed route when no quote signature verifier is configured", async () => {
    const transport = new StubTransport([{ status: 200, body: quoteResponse() }]);
    const provider = new NearIntentsOneClickProvider({ transport, capabilities: observedCapabilities, now: () => NOW });

    const result = await provider.requestQuote(quoteInput);

    expect(result).toMatchObject({ ok: false, kind: "provider_unavailable", code: "PROVIDER_UNAVAILABLE" });
    if (!result.ok) expect(result.blocker).toContain("signature verifier");
    expect(transport.calls).toHaveLength(0);
  });

  it("rejects a quote when the injected verifier detects a signature mismatch", async () => {
    const transport = new StubTransport([{ status: 200, body: quoteResponse() }]);
    const provider = new NearIntentsOneClickProvider({
      transport,
      capabilities: observedCapabilities,
      now: () => NOW,
      quoteSignatureVerifier: { verifyQuoteSignature: async () => false },
    });

    const result = await provider.requestQuote(quoteInput);

    expect(result).toMatchObject({ ok: false, kind: "invalid_quote", code: "INVALID_QUOTE" });
    expect(transport.calls).toHaveLength(1);
  });

  it("rejects a malformed non-dry quote without retaining a deposit address", async () => {
    const transport = new StubTransport([{ status: 200, body: quoteResponse({ quote: { amountIn: "1000", minAmountOut: "990", amountOut: "990", deadline: LATER, timeEstimate: 120 } }) }]);
    const provider = new NearIntentsOneClickProvider({ transport, capabilities: observedCapabilities, now: () => NOW, quoteSignatureVerifier: { verifyQuoteSignature: async () => true } });

    const result = await provider.requestQuote(quoteInput);

    expect(result).toMatchObject({ ok: false, kind: "invalid_quote", code: "INVALID_QUOTE" });
    expect(transport.calls).toHaveLength(1);
  });

  it("rejects an expired quote before any provider request", async () => {
    const transport = new StubTransport();
    const provider = new NearIntentsOneClickProvider({ transport, capabilities: observedCapabilities, now: () => NOW, quoteSignatureVerifier: { verifyQuoteSignature: async () => true } });

    const result = await provider.requestQuote({ ...quoteInput, deadline: "2026-08-28T11:59:00.000Z" });

    expect(result).toMatchObject({ ok: false, kind: "quote_expired", code: "QUOTE_EXPIRED" });
    expect(transport.calls).toHaveLength(0);
  });

  it("rejects a route or asset pair not present in the explicit observed capability set", async () => {
    const transport = new StubTransport();
    const provider = new NearIntentsOneClickProvider({ transport, capabilities: observedCapabilities, now: () => NOW, quoteSignatureVerifier: { verifyQuoteSignature: async () => true } });

    const result = await provider.requestQuote({
      ...quoteInput,
      route: { ...baseToStarknetRoute, destinationAsset: "unobserved:sn-sepolia:TOKEN" },
    });

    expect(result).toMatchObject({ ok: false, kind: "route_unsupported", code: "ROUTE_UNSUPPORTED" });
    expect(transport.calls).toHaveLength(0);
  });

  it("requires explicit native-wallet approval before notifying 1Click of a deposit transaction", async () => {
    const transport = new StubTransport([{ status: 200, body: quoteResponse() }, { status: 200, body: statusResponse("KNOWN_DEPOSIT_TX") }]);
    const { provider, quote } = await enabledProvider(transport);

    const result = await provider.submitDepositTx({ quote, txHash: DEPOSIT_TX, userApproved: false });

    expect(result).toMatchObject({ ok: false, kind: "invalid_request", code: "INVALID_REQUEST" });
    expect(transport.calls).toHaveLength(1); // only the quote request; no notification was sent
  });

  it("notifies the provider only after user approval and never accepts the notification as a wallet receipt", async () => {
    const transport = new StubTransport([
      { status: 200, body: quoteResponse() },
      { status: 200, body: statusResponse("KNOWN_DEPOSIT_TX") },
    ]);
    const { provider, quote } = await enabledProvider(transport);

    const result = await provider.submitDepositTx({ quote, txHash: DEPOSIT_TX, userApproved: true });

    expect(result.ok).toBe(true);
    expect(transport.calls[1].method).toBe("POST");
    expect(transport.calls[1].path).toBe("/v0/deposit/submit");
    expect(JSON.parse(transport.calls[1].body ?? "{}")).toEqual({ txHash: DEPOSIT_TX, depositAddress: DEPOSIT_ADDRESS });
    if (result.ok) {
      expect(result.data.canonicalState).toBe("submitted");
      expect(result.data.readbackVerified).toBe(false);
      expect(result.data.retryPolicy).toBe("poll_only");
    }
  });
});

describe("NEAR Intents/1Click status normalization and lifecycle boundaries", () => {
  const fakeQuote = {
    provider: NEAR_INTENTS_ONE_CLICK_PROVIDER_ID,
    correlationId: "corr-near-1click-1",
    timestamp: "2026-08-28T11:59:00.000Z",
    signature: "provider-signature",
    signatureVerified: true,
    canonicalState: "quote_ready" as const,
    prismOperationState: "ready" as const,
    evidenceCeiling: "X2" as const,
    route: baseToStarknetRoute,
    amount: "1000",
    slippageBps: 100,
    recipient: STARKNET_RECIPIENT,
    refundTo: BASE_RECIPIENT,
    deadline: LATER,
    dry: false,
    depositAddress: DEPOSIT_ADDRESS,
    depositMemo: null,
    amountIn: "1000",
    minAmountIn: "1000",
    amountOut: "990",
    minAmountOut: "990",
    timeEstimateSeconds: 120,
    refundFee: "1",
    withdrawFee: "2",
    trust: {
      custodyModel: "temporary_transfer_to_trusted_swapping_agent" as const,
      nonCustodialClaimAllowed: false,
      disclosure: "Assets may be temporarily transferred to a trusted swapping agent; Prism is not the solver.",
    },
  } satisfies NearIntentsQuote;

  it.each([
    ["PENDING_DEPOSIT", "pending_deposit", "awaiting_authorization"],
    ["KNOWN_DEPOSIT_TX", "submitted", "submitted"],
    ["PROCESSING", "processing", "processing"],
    ["SUCCESS", "completed", "confirmed"],
    ["FAILED", "failed", "failed_terminal"],
    ["REFUNDED", "refunded", "failed_terminal"],
  ] as const)("maps provider %s to canonical %s without conflating Prism operation state", (raw, canonical, operationState) => {
    const mapped = mapNearIntentsStatus({
      quote: fakeQuote,
      response: statusResponse(raw),
      now: NOW,
    });

    expect(mapped.canonicalState).toBe(canonical);
    expect(mapped.prismOperationState).toBe(operationState);
    expect(mapped.providerStatus).toBe(raw);
    expect(mapped.quoteSignatureVerified).toBe(true);
  });

  it("maps an unknown provider status to an honest unknown/poll-only observation", () => {
    const mapped = mapNearIntentsStatus({ quote: fakeQuote, response: statusResponse("NEW_PROVIDER_STATE"), now: NOW });

    expect(mapped.canonicalState).toBe("unknown");
    expect(mapped.prismOperationState).toBe("requires_attention");
    expect(mapped.terminal).toBe(false);
    expect(mapped.retryPolicy).toBe("poll_only");
    expect(mapped.requiresIndependentReadback).toBe(true);
  });

  it("rejects a status payload when its signed quote envelope fails verification", async () => {
    let verificationCalls = 0;
    const transport = new StubTransport([
      { status: 200, body: quoteResponse() },
      { status: 200, body: statusResponse("PROCESSING") },
    ]);
    const provider = new NearIntentsOneClickProvider({
      transport,
      capabilities: observedCapabilities,
      now: () => NOW,
      quoteSignatureVerifier: {
        verifyQuoteSignature: async () => {
          verificationCalls += 1;
          return verificationCalls === 1;
        },
      },
    });
    const quoted = await provider.requestQuote(quoteInput);
    expect(quoted.ok).toBe(true);
    const result = await provider.getStatus({ quote: (quoted as { ok: true; data: NearIntentsQuote }).data });

    expect(result).toMatchObject({ ok: false, kind: "invalid_response", code: "INVALID_RESPONSE" });
    expect(verificationCalls).toBe(2);
  });

  it("rejects a status payload whose embedded quote signature differs from the stored quote", async () => {
    const transport = new StubTransport([
      { status: 200, body: quoteResponse() },
      { status: 200, body: statusResponse("PROCESSING", { quoteResponse: quoteResponse({ signature: "other-signature" }) }) },
    ]);
    const { provider, quote } = await enabledProvider(transport);

    const result = await provider.getStatus({ quote });

    expect(result).toMatchObject({ ok: false, kind: "receipt_mismatch", code: "RECEIPT_MISMATCH" });
    if (!result.ok) expect(result.detail).toContain("signature");
  });

  it("does not treat stale SUCCESS as completion", async () => {
    const transport = new StubTransport([
      { status: 200, body: quoteResponse() },
      { status: 200, body: statusResponse("SUCCESS", { updatedAt: "2026-08-28T10:00:00.000Z" }) },
    ]);
    const { provider, quote } = await enabledProvider(transport, { now: () => NOW });

    const result = await provider.getStatus({ quote });

    expect(result).toMatchObject({ ok: false, kind: "stale_status", code: "STALE_STATUS" });
    if (!result.ok) expect(result.observation?.canonicalState).toBe("unknown");
  });

  it("maps a status transport timeout to provider_unavailable and preserves poll-only recovery", async () => {
    const transport: NearIntentsTransport = {
      async request(input) {
        if (input.path === "/v0/quote") return { status: 200, json: async () => quoteResponse() };
        throw new Error("request_timeout");
      },
    };
    const { provider, quote } = await enabledProvider(transport);

    const result = await provider.getStatus({ quote });

    expect(result).toMatchObject({
      ok: false,
      kind: "provider_unavailable",
      code: "PROVIDER_UNAVAILABLE",
      pollOnly: true,
      retryable: true,
    });
    if (!result.ok) expect(result.blocker).toContain("poll");
  });

  it("rejects a status response whose quote/deposit correlation does not match the stored quote", async () => {
    const transport = new StubTransport([
      { status: 200, body: quoteResponse() },
      { status: 200, body: statusResponse("SUCCESS", { quoteResponse: quoteResponse({ correlationId: "other-correlation", quote: { ...quoteResponse().quote as object, depositAddress: "0x4444444444444444444444444444444444444444" } }) }) },
    ]);
    const { provider, quote } = await enabledProvider(transport);

    const result = await provider.getStatus({ quote });

    expect(result).toMatchObject({ ok: false, kind: "receipt_mismatch", code: "RECEIPT_MISMATCH" });
    if (!result.ok) expect(result.detail).toContain("deposit");
  });
});

describe("NEAR Intents/1Click independent venue readback and retry/refund policy", () => {
  const successfulReader: NearIntentsReceiptReader = {
    async readDestinationReceipt(input) {
      return {
        network: input.network,
        txHash: DESTINATION_TX,
        status: "SUCCEEDED",
        recipient: STARKNET_RECIPIENT,
        assetId: STARKNET_ASSET,
        amount: "990",
        blockNumber: 42,
      };
    },
    async readOriginReceipt(input) {
      return {
        network: input.network,
        txHash: REFUND_TX,
        status: "SUCCEEDED",
        recipient: BASE_RECIPIENT,
        assetId: BASE_ASSET,
        amount: "1000",
        blockNumber: 41,
      };
    },
  };

  it("requires an independent destination receipt before a provider SUCCESS can be considered readback-verified", async () => {
    const transport = new StubTransport([
      { status: 200, body: quoteResponse() },
      { status: 200, body: statusResponse("SUCCESS") },
    ]);
    const { provider, quote } = await enabledProvider(transport);
    const status = await provider.getStatus({ quote });
    expect(status.ok).toBe(true);

    const result = await provider.reconcileStatus({ quote, status: (status as { ok: true; data: unknown }).data as never });

    expect(result).toMatchObject({
      ok: false,
      kind: "provider_unavailable",
      code: "PROVIDER_UNAVAILABLE",
      pollOnly: true,
    });
    if (!result.ok) expect(result.blocker).toContain("destination receipt");
  });

  it("rejects a matching destination transaction when the native receipt has no confirmed block", async () => {
    const readerWithoutBlock: NearIntentsReceiptReader = {
      async readDestinationReceipt(input) {
        return {
          network: input.network,
          txHash: DESTINATION_TX,
          status: "SUCCEEDED",
          recipient: STARKNET_RECIPIENT,
          assetId: STARKNET_ASSET,
          amount: "990",
          blockNumber: null,
        };
      },
    };
    const transport = new StubTransport([
      { status: 200, body: quoteResponse() },
      { status: 200, body: statusResponse("SUCCESS") },
    ]);
    const { provider, quote } = await enabledProvider(transport, { receiptReader: readerWithoutBlock });
    const status = await provider.getStatus({ quote });
    expect(status.ok).toBe(true);

    const result = await provider.reconcileStatus({ quote, status: (status as { ok: true; data: unknown }).data as never });

    expect(result).toMatchObject({ ok: false, kind: "receipt_mismatch", code: "RECEIPT_MISMATCH" });
    if (!result.ok) expect(result.detail).toContain("receipt");
  });

  it("correlates SUCCESS with a matching Starknet-native receipt but leaves Prism operation completion to reconciliation", async () => {
    const transport = new StubTransport([
      { status: 200, body: quoteResponse() },
      { status: 200, body: statusResponse("SUCCESS") },
    ]);
    const { provider, quote } = await enabledProvider(transport, { receiptReader: successfulReader });
    const status = await provider.getStatus({ quote });
    expect(status.ok).toBe(true);

    const result = await provider.reconcileStatus({ quote, status: (status as { ok: true; data: unknown }).data as never });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.canonicalState).toBe("completed");
      expect(result.data.readbackVerified).toBe(true);
      expect(result.data.readbackSource).toBe("starknet_native_receipt");
      expect(result.data.prismOperationState).toBe("confirmed");
      expect(result.data.prismOperationState).not.toBe("completed");
    }
  });

  it("fails closed on destination receipt mismatch and never upgrades the operation", async () => {
    const mismatchedReader: NearIntentsReceiptReader = {
      async readDestinationReceipt(input) {
        return {
          network: input.network,
          txHash: DESTINATION_TX,
          status: "SUCCEEDED",
          recipient: BASE_RECIPIENT,
          assetId: STARKNET_ASSET,
          amount: "1",
          blockNumber: 42,
        };
      },
    };
    const transport = new StubTransport([
      { status: 200, body: quoteResponse() },
      { status: 200, body: statusResponse("SUCCESS") },
    ]);
    const { provider, quote } = await enabledProvider(transport, { receiptReader: mismatchedReader });
    const status = await provider.getStatus({ quote });
    expect(status.ok).toBe(true);

    const result = await provider.reconcileStatus({ quote, status: (status as { ok: true; data: unknown }).data as never });

    expect(result).toMatchObject({ ok: false, kind: "receipt_mismatch", code: "RECEIPT_MISMATCH" });
    if (!result.ok) expect(result.observation?.prismOperationState).not.toBe("completed");
  });

  it("requires independent refund readback and exposes refunded as new-quote-only, not retryable submission", async () => {
    const transport = new StubTransport([
      { status: 200, body: quoteResponse() },
      { status: 200, body: statusResponse("REFUNDED", { swapDetails: { ...statusResponse("REFUNDED").swapDetails, originChainTxHashes: [{ hash: REFUND_TX, explorerUrl: "https://origin.example/refund" }], refundedAmount: "1000", refundReason: "PARTIAL_DEPOSIT" } }) },
    ]);
    const { provider, quote } = await enabledProvider(transport, { receiptReader: successfulReader });
    const status = await provider.getStatus({ quote });
    expect(status.ok).toBe(true);

    const result = await provider.reconcileStatus({ quote, status: (status as { ok: true; data: unknown }).data as never });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.canonicalState).toBe("refunded");
      expect(result.data.readbackVerified).toBe(true);
      expect(result.data.retryPolicy).toBe("new_quote_only");
      expect(result.data.prismOperationState).toBe("failed_terminal");
    }
  });

  it("does not claim refunded funds without an origin-chain refund receipt", async () => {
    const readerWithoutOrigin: NearIntentsReceiptReader = {
      async readDestinationReceipt() {
        return null;
      },
    };
    const transport = new StubTransport([
      { status: 200, body: quoteResponse() },
      { status: 200, body: statusResponse("REFUNDED", { swapDetails: { ...statusResponse("REFUNDED").swapDetails, originChainTxHashes: [{ hash: REFUND_TX, explorerUrl: "https://origin.example/refund" }], refundedAmount: "1000", refundReason: "PARTIAL_DEPOSIT" } }) },
    ]);
    const { provider, quote } = await enabledProvider(transport, { receiptReader: readerWithoutOrigin });
    const status = await provider.getStatus({ quote });
    expect(status.ok).toBe(true);

    const result = await provider.reconcileStatus({ quote, status: (status as { ok: true; data: unknown }).data as never });

    expect(result).toMatchObject({ ok: false, kind: "provider_unavailable", code: "PROVIDER_UNAVAILABLE", pollOnly: true });
    if (!result.ok) expect(result.blocker).toContain("refund receipt");
  });
});
