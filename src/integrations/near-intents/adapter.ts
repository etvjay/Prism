// Typed, transport-neutral candidate adapter for NEAR Intents/1Click.
//
// This module deliberately does not instantiate a wallet, sign, broadcast, or
// transfer funds. It only requests/normalizes provider payloads through an
// injected transport and optionally correlates a provider terminal status with
// an independently injected native-chain receipt reader.
//
// The default capability assessment is unavailable for Base Sepolia ↔
// SN_SEPOLIA: the current first-party documentation describes Base and
// Starknet generally but explicitly says that NEAR Intents has no testnet
// version. An observed-testnet capability assertion is therefore required for
// any injected fixture transport. Such a fixture path remains X2 until real
// provider behavior and independent receipt readback are observed.

import type { OperationState } from "../../features/prism-operations/domain/operation";

export const NEAR_INTENTS_ONE_CLICK_PROVIDER_ID = "near-intents-1click" as const;
export const NEAR_INTENTS_ONE_CLICK_BASE_URL = "https://1click.chaindefuser.com" as const;
export const BASE_SEPOLIA_CHAIN_ID = 84532 as const;
export const BASE_SEPOLIA_NETWORK = "BASE_SEPOLIA" as const;
export const SN_SEPOLIA_NETWORK = "SN_SEPOLIA" as const;

export type NearIntentsNetwork = typeof BASE_SEPOLIA_NETWORK | typeof SN_SEPOLIA_NETWORK;
export type NearIntentsRouteDirection = "BASE_TO_STARKNET" | "STARKNET_TO_BASE";
export type NearIntentsSwapType = "EXACT_INPUT";

export interface NearIntentsRoute {
  readonly originNetwork: NearIntentsNetwork;
  readonly destinationNetwork: NearIntentsNetwork;
  /** Provider asset ID, preserved literally at the transport boundary. */
  readonly originAsset: string;
  /** Provider asset ID, preserved literally at the transport boundary. */
  readonly destinationAsset: string;
}

export interface NearIntentsQuoteRequest {
  readonly route: NearIntentsRoute;
  /** Smallest-unit integer string; decimal human-readable amounts are invalid. */
  readonly amount: string;
  readonly slippageBps: number;
  readonly recipient: string;
  readonly refundTo: string;
  /** ISO timestamp at which provider refund processing may begin. */
  readonly deadline: string;
  readonly dry?: boolean;
  readonly swapType?: NearIntentsSwapType;
}

export type NearIntentsCapabilityEvidenceLevel = "none" | "documented_general" | "observed_testnet";
export type NearIntentsEvidenceCeiling = "X2";

/**
 * Capability evidence is intentionally explicit. Documentation that lists a
 * chain generally is not enough to mark a requested testnet route available.
 */
export interface NearIntentsCapabilityEvidence {
  readonly evidenceLevel: NearIntentsCapabilityEvidenceLevel;
  readonly baseSepoliaSupported: boolean;
  readonly snSepoliaSupported: boolean;
  readonly observedRoutes: readonly string[];
  readonly supportedAssetPairs: readonly string[];
  readonly source: string;
  readonly observedAt?: string | null;
}

export const DOCUMENTED_GENERAL_NEAR_INTENTS_CAPABILITIES: NearIntentsCapabilityEvidence = Object.freeze({
  evidenceLevel: "documented_general",
  baseSepoliaSupported: false,
  snSepoliaSupported: false,
  observedRoutes: [],
  supportedAssetPairs: [],
  source: "first-party documentation lists Base/Starknet generally; testnet support is not proven",
  observedAt: null,
});

export const DEFAULT_NEAR_INTENTS_CAPABILITIES = DOCUMENTED_GENERAL_NEAR_INTENTS_CAPABILITIES;

export interface NearIntentsAvailabilityAssessment {
  readonly provider: typeof NEAR_INTENTS_ONE_CLICK_PROVIDER_ID;
  readonly available: boolean;
  readonly evidenceLevel: NearIntentsCapabilityEvidenceLevel;
  readonly evidenceCeiling: NearIntentsEvidenceCeiling;
  readonly blocker: string | null;
  readonly missingEvidence: readonly string[];
  readonly source: string;
}

export type NearIntentsErrorCode =
  | "PROVIDER_UNAVAILABLE"
  | "INVALID_REQUEST"
  | "INVALID_QUOTE"
  | "QUOTE_EXPIRED"
  | "ROUTE_UNSUPPORTED"
  | "INVALID_RESPONSE"
  | "STALE_STATUS"
  | "RECEIPT_MISMATCH"
  | "PROVIDER_REQUEST_FAILED";

export type NearIntentsFailureKind =
  | "provider_unavailable"
  | "invalid_request"
  | "invalid_quote"
  | "quote_expired"
  | "route_unsupported"
  | "invalid_response"
  | "stale_status"
  | "receipt_mismatch"
  | "provider_request_failed";

export type NearIntentsRetryPolicy = "poll_only" | "new_quote_only";

export interface NearIntentsTrustDisclosure {
  readonly custodyModel: "temporary_transfer_to_trusted_swapping_agent";
  /** Deliberately false: no non-custodial claim is made by this adapter. */
  readonly nonCustodialClaimAllowed: false;
  readonly disclosure: string;
}

export const NEAR_INTENTS_TRUST_DISCLOSURE: NearIntentsTrustDisclosure = Object.freeze({
  custodyModel: "temporary_transfer_to_trusted_swapping_agent",
  nonCustodialClaimAllowed: false,
  disclosure:
    "The 1Click flow may temporarily transfer assets to a trusted swapping agent. Prism coordinates the provider flow; Prism is not the solver and does not receive authority to move user assets.",
});

export interface NearIntentsSuccess<T> {
  readonly ok: true;
  readonly provider: typeof NEAR_INTENTS_ONE_CLICK_PROVIDER_ID;
  readonly data: T;
}

export interface NearIntentsFailure {
  readonly ok: false;
  readonly provider: typeof NEAR_INTENTS_ONE_CLICK_PROVIDER_ID;
  readonly kind: NearIntentsFailureKind;
  readonly code: NearIntentsErrorCode;
  readonly detail: string;
  readonly evidenceCeiling: NearIntentsEvidenceCeiling;
  /** Non-null for an unavailable dependency or missing evidence boundary. */
  readonly blocker: string | null;
  readonly missingEvidence: readonly string[];
  readonly retryable: boolean;
  /** True when the safe next action is polling/readback rather than resubmission. */
  readonly pollOnly: boolean;
  readonly observation?: NearIntentsStatusObservation;
  readonly trust: NearIntentsTrustDisclosure;
}

export type NearIntentsResult<T> = NearIntentsSuccess<T> | NearIntentsFailure;

export interface NearIntentsTransportRequest {
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly headers: Record<string, string>;
  readonly body?: string;
}

export interface NearIntentsTransportResponse {
  readonly status: number;
  json(): Promise<unknown>;
}

/**
 * Official 1Click quote/status payloads are signed. The cryptographic
 * implementation (for example the provider's reviewed SDK verifier) is
 * injected so this module does not invent a key or verification algorithm.
 */
export type NearIntentsQuoteSignatureVerifier =
  | ((payload: unknown) => boolean | Promise<boolean>)
  | {
      verifyQuoteSignature(payload: unknown): boolean | Promise<boolean>;
    };

/** No default transport is created; callers inject a reviewed HTTP boundary. */
export interface NearIntentsTransport {
  request(input: NearIntentsTransportRequest): Promise<NearIntentsTransportResponse>;
}

export interface NearIntentsTransactionReference {
  readonly hash: string;
  readonly explorerUrl?: string | null;
}

/** Raw status shape from the documented 1Click API. */
export interface NearIntentsSwapDetailsResponse {
  readonly [key: string]: unknown;
  readonly intentHashes?: readonly unknown[];
  readonly nearTxHashes?: readonly unknown[];
  readonly originChainTxHashes?: readonly unknown[];
  readonly destinationChainTxHashes?: readonly unknown[];
  readonly amountIn?: unknown;
  readonly amountOut?: unknown;
  readonly depositedAmount?: unknown;
  readonly refundedAmount?: unknown;
  readonly refundReason?: unknown;
}

export interface NearIntentsStatusResponse {
  readonly correlationId: string;
  readonly status: string;
  readonly updatedAt: string;
  readonly quoteResponse: Record<string, unknown>;
  readonly swapDetails?: NearIntentsSwapDetailsResponse | null;
}

export interface NearIntentsQuote {
  readonly provider: typeof NEAR_INTENTS_ONE_CLICK_PROVIDER_ID;
  readonly correlationId: string;
  readonly timestamp: string;
  readonly signature: string;
  readonly signatureVerified: true;
  readonly evidenceCeiling: NearIntentsEvidenceCeiling;
  readonly canonicalState: "quote_ready";
  readonly prismOperationState: "ready";
  readonly route: NearIntentsRoute;
  readonly amount: string;
  readonly slippageBps: number;
  readonly recipient: string;
  readonly refundTo: string;
  readonly deadline: string;
  readonly dry: boolean;
  readonly depositAddress: string | null;
  readonly depositMemo: string | null;
  readonly amountIn: string;
  readonly minAmountIn: string;
  readonly amountOut: string;
  readonly minAmountOut: string;
  readonly timeEstimateSeconds: number;
  readonly refundFee: string | null;
  readonly withdrawFee: string | null;
  readonly trust: NearIntentsTrustDisclosure;
}

export type NearIntentsLifecycleState =
  | "quote_requested"
  | "quote_ready"
  | "pending_deposit"
  | "submitted"
  | "processing"
  | "confirmed"
  | "completed"
  | "failed"
  | "expired"
  | "refunded"
  | "unknown";

export interface NearIntentsStatusObservation {
  readonly provider: typeof NEAR_INTENTS_ONE_CLICK_PROVIDER_ID;
  readonly providerStatus: string;
  readonly correlationId: string;
  readonly updatedAt: string;
  readonly quoteSignatureVerified: true;
  readonly evidenceCeiling: NearIntentsEvidenceCeiling;
  /** Provider lifecycle; SUCCESS is completed at the provider boundary. */
  readonly canonicalState: NearIntentsLifecycleState;
  /** Prism Operation state never jumps to completed from provider SUCCESS. */
  readonly prismOperationState: OperationState | null;
  readonly terminal: boolean;
  readonly providerTerminal: boolean;
  readonly requiresIndependentReadback: boolean;
  readonly readbackVerified: boolean;
  readonly readbackSource: "none" | "base_native_receipt" | "starknet_native_receipt";
  readonly retryPolicy: NearIntentsRetryPolicy;
  readonly stale: boolean;
  readonly reason: string;
  readonly depositAddress: string | null;
  readonly depositMemo: string | null;
  readonly originChainTxHashes: readonly NearIntentsTransactionReference[];
  readonly destinationChainTxHashes: readonly NearIntentsTransactionReference[];
  readonly amountIn: string | null;
  readonly amountOut: string | null;
  readonly depositedAmount: string | null;
  readonly refundedAmount: string | null;
  readonly refundReason: string | null;
  readonly trust: NearIntentsTrustDisclosure;
}

export type NearIntentsNativeReceiptStatus = "SUCCEEDED" | "REVERTED" | "UNKNOWN";

export interface NearIntentsNativeReceipt {
  readonly network: NearIntentsNetwork;
  readonly txHash: string;
  readonly status: NearIntentsNativeReceiptStatus;
  readonly recipient: string;
  readonly assetId: string;
  readonly amount: string;
  readonly blockNumber: number | null;
}

export interface NearIntentsReceiptReader {
  /** Independent destination-chain receipt path; never the 1Click API response. */
  readDestinationReceipt(input: {
    readonly network: NearIntentsNetwork;
    readonly txHash: string;
    readonly quote: NearIntentsQuote;
  }): Promise<NearIntentsNativeReceipt | null>;
  /** Required to claim that a REFUNDED provider status returned funds. */
  readOriginReceipt?(input: {
    readonly network: NearIntentsNetwork;
    readonly txHash: string;
    readonly quote: NearIntentsQuote;
  }): Promise<NearIntentsNativeReceipt | null>;
}

export interface NearIntentsOneClickProviderOptions {
  readonly transport?: NearIntentsTransport | null;
  readonly capabilities?: NearIntentsCapabilityEvidence;
  /** Optional auth headers are supplied by the owner; this adapter never reads credentials. */
  readonly headers?: Readonly<Record<string, string>>;
  /** Required for an observed quote path; use the reviewed 1Click SDK or equivalent. */
  readonly quoteSignatureVerifier?: NearIntentsQuoteSignatureVerifier | null;
  readonly now?: () => number;
  readonly maxStatusAgeMs?: number;
  readonly receiptReader?: NearIntentsReceiptReader | null;
}

export const DEFAULT_STATUS_MAX_AGE_MS = 5 * 60 * 1000;

const KNOWN_STATUS = new Set([
  "PENDING_DEPOSIT",
  "KNOWN_DEPOSIT_TX",
  "PROCESSING",
  "SUCCESS",
  "INCOMPLETE_DEPOSIT",
  "REFUNDED",
  "FAILED",
]);

const TERMINAL_PROVIDER_STATUSES = new Set(["SUCCESS", "REFUNDED", "FAILED"]);

const EMPTY_MISSING_EVIDENCE: readonly string[] = [];

class ShapeError extends Error {
  constructor(readonly detail: string) {
    super(detail);
    this.name = "NearIntentsShapeError";
  }
}

function objectLike(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new ShapeError(`${field}_required`);
  return value;
}

function integerString(value: unknown, field: string, allowZero = true): string {
  if (typeof value !== "string" || !/^\d+$/.test(value)) throw new ShapeError(`${field}_must_be_integer_string`);
  try {
    const parsed = BigInt(value);
    if (!allowZero && parsed === 0n) throw new ShapeError(`${field}_must_be_positive`);
  } catch (cause) {
    if (cause instanceof ShapeError) throw cause;
    throw new ShapeError(`${field}_must_be_integer_string`);
  }
  return value;
}

function parseFiniteDate(value: unknown, field: string): number {
  if (typeof value !== "string" || !value.trim()) throw new ShapeError(`${field}_invalid_timestamp`);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new ShapeError(`${field}_invalid_timestamp`);
  return parsed;
}

function isEvmAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

function isStarknetAddress(value: string): boolean {
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(value)) return false;
  try {
    const parsed = BigInt(value);
    return parsed > 0n && parsed < (1n << 251n);
  } catch {
    return false;
  }
}

function validAddressForNetwork(value: string, network: NearIntentsNetwork): boolean {
  return network === BASE_SEPOLIA_NETWORK ? isEvmAddress(value) : isStarknetAddress(value);
}

function routeDirection(route: NearIntentsRoute): NearIntentsRouteDirection | null {
  if (route.originNetwork === BASE_SEPOLIA_NETWORK && route.destinationNetwork === SN_SEPOLIA_NETWORK) {
    return "BASE_TO_STARKNET";
  }
  if (route.originNetwork === SN_SEPOLIA_NETWORK && route.destinationNetwork === BASE_SEPOLIA_NETWORK) {
    return "STARKNET_TO_BASE";
  }
  return null;
}

function routeKey(route: NearIntentsRoute): string {
  return `${route.originNetwork}->${route.destinationNetwork}`;
}

function assetPairKey(route: NearIntentsRoute): string {
  return `${route.originAsset}->${route.destinationAsset}`;
}

function missingEvidenceForCapabilities(capabilities: NearIntentsCapabilityEvidence): string[] {
  const missing: string[] = [];
  if (!capabilities.baseSepoliaSupported) missing.push("verified Base Sepolia support");
  if (!capabilities.snSepoliaSupported) missing.push("verified SN_SEPOLIA support");
  if (capabilities.observedRoutes.length === 0) missing.push("observed Base Sepolia↔SN_SEPOLIA route support");
  if (capabilities.supportedAssetPairs.length === 0) missing.push("supported Base Sepolia/SN_SEPOLIA asset IDs");
  if (capabilities.evidenceLevel !== "observed_testnet") {
    missing.push("observed Base Sepolia↔SN_SEPOLIA quote/status behavior");
  }
  return missing;
}

export function assessNearIntentsAvailability(
  capabilities: NearIntentsCapabilityEvidence = DEFAULT_NEAR_INTENTS_CAPABILITIES,
): NearIntentsAvailabilityAssessment {
  const missingEvidence = missingEvidenceForCapabilities(capabilities);
  const available = missingEvidence.length === 0;
  return {
    provider: NEAR_INTENTS_ONE_CLICK_PROVIDER_ID,
    available,
    evidenceLevel: capabilities.evidenceLevel,
    evidenceCeiling: "X2",
    blocker: available
      ? null
      : "NEAR Intents/1Click testnet support for Base Sepolia and SN_SEPOLIA is not proven; no requested route may be claimed",
    missingEvidence,
    source: capabilities.source,
  };
}

function resultFailure(input: {
  kind: NearIntentsFailureKind;
  code: NearIntentsErrorCode;
  detail: string;
  blocker?: string | null;
  missingEvidence?: readonly string[];
  retryable?: boolean;
  pollOnly?: boolean;
  observation?: NearIntentsStatusObservation;
}): NearIntentsFailure {
  return {
    ok: false,
    provider: NEAR_INTENTS_ONE_CLICK_PROVIDER_ID,
    kind: input.kind,
    code: input.code,
    detail: input.detail,
    evidenceCeiling: "X2",
    blocker: input.blocker ?? null,
    missingEvidence: input.missingEvidence ?? EMPTY_MISSING_EVIDENCE,
    retryable: input.retryable ?? false,
    pollOnly: input.pollOnly ?? false,
    ...(input.observation ? { observation: input.observation } : {}),
    trust: NEAR_INTENTS_TRUST_DISCLOSURE,
  };
}

function resultSuccess<T>(data: T): NearIntentsSuccess<T> {
  return { ok: true, provider: NEAR_INTENTS_ONE_CLICK_PROVIDER_ID, data };
}

function validateRoute(route: NearIntentsRoute): void {
  if (!objectLike(route)) throw new ShapeError("route_required");
  if (!Object.values([BASE_SEPOLIA_NETWORK, SN_SEPOLIA_NETWORK]).includes(route.originNetwork)) {
    throw new ShapeError("origin_network_unsupported");
  }
  if (!Object.values([BASE_SEPOLIA_NETWORK, SN_SEPOLIA_NETWORK]).includes(route.destinationNetwork)) {
    throw new ShapeError("destination_network_unsupported");
  }
  if (!routeDirection(route)) throw new ShapeError("route_unsupported");
  if (typeof route.originAsset !== "string" || route.originAsset.trim().length === 0) {
    throw new ShapeError("origin_asset_required");
  }
  if (typeof route.destinationAsset !== "string" || route.destinationAsset.trim().length === 0) {
    throw new ShapeError("destination_asset_required");
  }
}

function validateQuoteRequest(input: NearIntentsQuoteRequest, now: number): NearIntentsQuoteRequest {
  if (!objectLike(input)) throw new ShapeError("quote_request_required");
  validateRoute(input.route);
  if (typeof input.amount !== "string") throw new ShapeError("amount_required");
  integerString(input.amount, "amount");
  if (!Number.isInteger(input.slippageBps) || input.slippageBps < 0 || input.slippageBps > 10_000) {
    throw new ShapeError("slippage_bps_invalid");
  }
  if (typeof input.recipient !== "string" || !validAddressForNetwork(input.recipient, input.route.destinationNetwork)) {
    throw new ShapeError("recipient_invalid");
  }
  if (typeof input.refundTo !== "string" || !validAddressForNetwork(input.refundTo, input.route.originNetwork)) {
    throw new ShapeError("refund_to_invalid");
  }
  const deadlineMs = parseFiniteDate(input.deadline, "deadline");
  if (deadlineMs <= now) throw new ShapeError("quote_deadline_elapsed");
  const dry = input.dry ?? false;
  if (typeof dry !== "boolean") throw new ShapeError("dry_invalid");
  if (input.swapType !== undefined && input.swapType !== "EXACT_INPUT") throw new ShapeError("swap_type_unsupported");
  return {
    ...input,
    dry,
    swapType: input.swapType ?? "EXACT_INPUT",
  };
}

function routeCapabilityFailure(
  route: NearIntentsRoute,
  capabilities: NearIntentsCapabilityEvidence,
): NearIntentsFailure | null {
  const direction = routeDirection(route);
  if (!direction) {
    return resultFailure({ kind: "route_unsupported", code: "ROUTE_UNSUPPORTED", detail: "only Base Sepolia↔SN_SEPOLIA is in the candidate scope" });
  }
  const assessment = assessNearIntentsAvailability(capabilities);
  const observedRoute = capabilities.observedRoutes.includes(routeKey(route));
  const observedAssets = capabilities.supportedAssetPairs.includes(assetPairKey(route));
  if (!assessment.available) {
    const missing = [...assessment.missingEvidence];
    if (!observedRoute) missing.push(`observed ${direction} route`);
    if (!observedAssets) missing.push("observed asset pair for requested route");
    return resultFailure({
      kind: "provider_unavailable",
      code: "PROVIDER_UNAVAILABLE",
      detail: "requested testnet route is unavailable at the provider boundary",
      blocker: assessment.blocker ?? "requested route capability was not observed",
      missingEvidence: [...new Set(missing)],
      retryable: false,
      pollOnly: false,
    });
  }
  if (!observedRoute || !observedAssets) {
    return resultFailure({
      kind: "route_unsupported",
      code: "ROUTE_UNSUPPORTED",
      detail: observedRoute ? "requested asset pair was not observed for the testnet route" : `requested ${direction} testnet route was not observed`,
    });
  }
  return null;
}

function apiQuotePayload(input: NearIntentsQuoteRequest): Record<string, unknown> {
  return {
    dry: input.dry ?? false,
    swapType: input.swapType ?? "EXACT_INPUT",
    slippageTolerance: input.slippageBps,
    originAsset: input.route.originAsset,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: input.route.destinationAsset,
    amount: input.amount,
    recipient: input.recipient,
    recipientType: "DESTINATION_CHAIN",
    refundTo: input.refundTo,
    refundType: "ORIGIN_CHAIN",
    deadline: input.deadline,
  };
}

function readQuoteRequest(value: unknown): Record<string, unknown> {
  if (!objectLike(value)) throw new ShapeError("quote_request_missing_from_response");
  return value;
}

function quoteRequestMatches(value: Record<string, unknown>, input: NearIntentsQuoteRequest): boolean {
  const expected = apiQuotePayload(input);
  return Object.entries(expected).every(([key, expectedValue]) => value[key] === expectedValue);
}

function validateQuotePricing(value: Record<string, unknown>): {
  amountIn: string;
  minAmountIn: string;
  amountOut: string;
  minAmountOut: string;
  timeEstimateSeconds: number;
  refundFee: string | null;
  withdrawFee: string | null;
  depositAddress: string | null;
  depositMemo: string | null;
  deadline: string;
} {
  const amountIn = integerString(value.amountIn, "quote.amountIn");
  const minAmountIn = integerString(value.minAmountIn, "quote.minAmountIn");
  const amountOut = integerString(value.amountOut, "quote.amountOut");
  const minAmountOut = integerString(value.minAmountOut, "quote.minAmountOut");
  if (typeof value.timeEstimate !== "number" || !Number.isFinite(value.timeEstimate) || value.timeEstimate < 0) {
    throw new ShapeError("quote.time_estimate_invalid");
  }
  const deadline = requiredString(value.deadline, "quote.deadline");
  parseFiniteDate(deadline, "quote.deadline");
  const depositAddress = value.depositAddress === undefined || value.depositAddress === null ? null : requiredString(value.depositAddress, "quote.depositAddress");
  const depositMemo = value.depositMemo === undefined || value.depositMemo === null ? null : requiredString(value.depositMemo, "quote.depositMemo");
  const refundFee = value.refundFee === undefined || value.refundFee === null ? null : integerString(value.refundFee, "quote.refundFee");
  const withdrawFee = value.withdrawFee === undefined || value.withdrawFee === null ? null : integerString(value.withdrawFee, "quote.withdrawFee");
  return {
    amountIn,
    minAmountIn,
    amountOut,
    minAmountOut,
    timeEstimateSeconds: value.timeEstimate,
    refundFee,
    withdrawFee,
    depositAddress,
    depositMemo,
    deadline,
  };
}

function normalizeQuoteResponse(
  response: unknown,
  input: NearIntentsQuoteRequest,
  now: number,
): NearIntentsQuote {
  if (!objectLike(response)) throw new ShapeError("quote_response_object_required");
  const correlationId = requiredString(response.correlationId, "correlation_id");
  const timestamp = requiredString(response.timestamp, "timestamp");
  parseFiniteDate(timestamp, "timestamp");
  const signature = requiredString(response.signature, "signature");
  const responseRequest = readQuoteRequest(response.quoteRequest);
  if (!quoteRequestMatches(responseRequest, input)) throw new ShapeError("quote_request_mismatch");
  if (!objectLike(response.quote)) throw new ShapeError("quote_missing");
  const pricing = validateQuotePricing(response.quote);
  const responseDeadlineMs = parseFiniteDate(pricing.deadline, "quote.deadline");
  const requestDeadlineMs = parseFiniteDate(input.deadline, "deadline");
  if (pricing.deadline !== input.deadline || responseDeadlineMs !== requestDeadlineMs) {
    throw new ShapeError("quote_deadline_mismatch");
  }
  if (responseDeadlineMs <= now) throw new ShapeError("quote_expired");
  if (!input.dry && pricing.depositAddress === null) throw new ShapeError("deposit_address_required_for_live_quote");
  if (pricing.depositAddress !== null && !validAddressForNetwork(pricing.depositAddress, input.route.originNetwork)) {
    throw new ShapeError("deposit_address_invalid");
  }
  return {
    provider: NEAR_INTENTS_ONE_CLICK_PROVIDER_ID,
    correlationId,
    timestamp,
    signature,
    signatureVerified: true,
    evidenceCeiling: "X2",
    canonicalState: "quote_ready",
    prismOperationState: "ready",
    route: input.route,
    amount: input.amount,
    slippageBps: input.slippageBps,
    recipient: input.recipient,
    refundTo: input.refundTo,
    deadline: input.deadline,
    dry: input.dry ?? false,
    depositAddress: pricing.depositAddress,
    depositMemo: pricing.depositMemo,
    amountIn: pricing.amountIn,
    minAmountIn: pricing.minAmountIn,
    amountOut: pricing.amountOut,
    minAmountOut: pricing.minAmountOut,
    timeEstimateSeconds: pricing.timeEstimateSeconds,
    refundFee: pricing.refundFee,
    withdrawFee: pricing.withdrawFee,
    trust: NEAR_INTENTS_TRUST_DISCLOSURE,
  };
}

function normalizeTransactionReferences(value: unknown, field: string): NearIntentsTransactionReference[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ShapeError(`${field}_must_be_array`);
  return value.map((item, index) => {
    if (!objectLike(item)) throw new ShapeError(`${field}[${index}]_invalid`);
    const hash = requiredString(item.hash, `${field}[${index}].hash`);
    if (!/^0x[0-9a-fA-F]{1,64}$/.test(hash)) throw new ShapeError(`${field}[${index}].hash_invalid`);
    const explorerUrl = item.explorerUrl === undefined || item.explorerUrl === null ? null : requiredString(item.explorerUrl, `${field}[${index}].explorerUrl`);
    return { hash, explorerUrl };
  });
}

function optionalIntegerString(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  return integerString(value, field);
}

function normalizeSwapDetails(value: unknown): {
  originChainTxHashes: readonly NearIntentsTransactionReference[];
  destinationChainTxHashes: readonly NearIntentsTransactionReference[];
  amountIn: string | null;
  amountOut: string | null;
  depositedAmount: string | null;
  refundedAmount: string | null;
  refundReason: string | null;
} {
  if (value === undefined || value === null) {
    return {
      originChainTxHashes: [],
      destinationChainTxHashes: [],
      amountIn: null,
      amountOut: null,
      depositedAmount: null,
      refundedAmount: null,
      refundReason: null,
    };
  }
  if (!objectLike(value)) throw new ShapeError("swap_details_invalid");
  return {
    originChainTxHashes: normalizeTransactionReferences(value.originChainTxHashes, "originChainTxHashes"),
    destinationChainTxHashes: normalizeTransactionReferences(value.destinationChainTxHashes, "destinationChainTxHashes"),
    amountIn: optionalIntegerString(value.amountIn, "swapDetails.amountIn"),
    amountOut: optionalIntegerString(value.amountOut, "swapDetails.amountOut"),
    depositedAmount: optionalIntegerString(value.depositedAmount, "swapDetails.depositedAmount"),
    refundedAmount: optionalIntegerString(value.refundedAmount, "swapDetails.refundedAmount"),
    refundReason: value.refundReason === undefined || value.refundReason === null ? null : requiredString(value.refundReason, "swapDetails.refundReason"),
  };
}

function responseQuoteObject(response: Record<string, unknown>): Record<string, unknown> {
  if (!objectLike(response.quoteResponse)) throw new ShapeError("status.quote_response_missing");
  if (!objectLike(response.quoteResponse.quote)) throw new ShapeError("status.quote_response_quote_missing");
  return response.quoteResponse;
}

function statusResponseMatchesQuote(response: Record<string, unknown>, quote: NearIntentsQuote): string | null {
  const correlationId = requiredString(response.correlationId, "status.correlation_id");
  if (correlationId !== quote.correlationId) return "deposit_quote_correlation_mismatch";
  const quoted = responseQuoteObject(response);
  const nestedCorrelationId = requiredString(quoted.correlationId, "status.quote_response.correlation_id");
  if (nestedCorrelationId !== quote.correlationId) return "deposit_quote_correlation_mismatch";
  const nestedSignature = requiredString(quoted.signature, "status.quote_response.signature");
  if (nestedSignature !== quote.signature) return "status_quote_signature_mismatch";
  const nestedTimestamp = requiredString(quoted.timestamp, "status.quote_response.timestamp");
  if (nestedTimestamp !== quote.timestamp) return "status_quote_timestamp_mismatch";
  const nestedRequest = readQuoteRequest(quoted.quoteRequest);
  const expectedInput: NearIntentsQuoteRequest = {
    route: quote.route,
    amount: quote.amount,
    slippageBps: quote.slippageBps,
    recipient: quote.recipient,
    refundTo: quote.refundTo,
    deadline: quote.deadline,
    dry: quote.dry,
    swapType: "EXACT_INPUT",
  };
  if (!quoteRequestMatches(nestedRequest, expectedInput)) return "status_quote_request_mismatch";
  if (!objectLike(quoted.quote)) return "status_quote_response_quote_missing";
  const nestedQuote = quoted.quote;
  const nestedDepositAddress = nestedQuote.depositAddress;
  if (quote.depositAddress !== null && nestedDepositAddress !== quote.depositAddress) return "deposit_address_mismatch";
  return null;
}

function rawStatusFromResponse(response: Record<string, unknown>): string {
  const status = requiredString(response.status, "status");
  return status;
}

function baseObservation(input: {
  quote: NearIntentsQuote;
  providerStatus: string;
  correlationId: string;
  updatedAt: string;
  canonicalState: NearIntentsLifecycleState;
  prismOperationState: OperationState | null;
  terminal: boolean;
  providerTerminal: boolean;
  requiresIndependentReadback: boolean;
  retryPolicy: NearIntentsRetryPolicy;
  stale: boolean;
  reason: string;
  details: ReturnType<typeof normalizeSwapDetails>;
}): NearIntentsStatusObservation {
  return {
    provider: NEAR_INTENTS_ONE_CLICK_PROVIDER_ID,
    providerStatus: input.providerStatus,
    correlationId: input.correlationId,
    updatedAt: input.updatedAt,
    quoteSignatureVerified: true,
    evidenceCeiling: "X2",
    canonicalState: input.canonicalState,
    prismOperationState: input.prismOperationState,
    terminal: input.terminal,
    providerTerminal: input.providerTerminal,
    requiresIndependentReadback: input.requiresIndependentReadback,
    readbackVerified: false,
    readbackSource: "none",
    retryPolicy: input.retryPolicy,
    stale: input.stale,
    reason: input.reason,
    depositAddress: input.quote.depositAddress,
    depositMemo: input.quote.depositMemo,
    originChainTxHashes: input.details.originChainTxHashes,
    destinationChainTxHashes: input.details.destinationChainTxHashes,
    amountIn: input.details.amountIn,
    amountOut: input.details.amountOut,
    depositedAmount: input.details.depositedAmount,
    refundedAmount: input.details.refundedAmount,
    refundReason: input.details.refundReason,
    trust: NEAR_INTENTS_TRUST_DISCLOSURE,
  };
}

/** Pure provider-status → canonical lifecycle mapping. No transport or mutation. */
export function mapNearIntentsStatus(input: {
  readonly quote: NearIntentsQuote;
  readonly response: NearIntentsStatusResponse;
  readonly now: number;
  readonly maxStatusAgeMs?: number;
}): NearIntentsStatusObservation {
  const responseRecord = input.response as unknown as Record<string, unknown>;
  const providerStatus = typeof responseRecord.status === "string" ? responseRecord.status : "UNKNOWN";
  const correlationId = typeof responseRecord.correlationId === "string" ? responseRecord.correlationId : input.quote.correlationId;
  const updatedAt = typeof responseRecord.updatedAt === "string" ? responseRecord.updatedAt : "";
  const updatedAtMs = updatedAt ? Date.parse(updatedAt) : Number.NaN;
  const details = normalizeSwapDetails(responseRecord.swapDetails);
  const maxAge = input.maxStatusAgeMs ?? DEFAULT_STATUS_MAX_AGE_MS;
  const stale = !Number.isFinite(updatedAtMs) || input.now - updatedAtMs > maxAge;

  let canonicalState: NearIntentsLifecycleState;
  let prismOperationState: OperationState | null;
  let terminal = false;
  let providerTerminal = false;
  let requiresIndependentReadback = true;
  let retryPolicy: NearIntentsRetryPolicy = "poll_only";
  let reason: string;

  if (providerStatus === "PENDING_DEPOSIT") {
    canonicalState = "pending_deposit";
    prismOperationState = "awaiting_authorization";
    requiresIndependentReadback = false;
    reason = "awaiting_origin_chain_deposit";
    if (input.now >= Date.parse(input.quote.deadline)) {
      canonicalState = "expired";
      prismOperationState = "expired";
      terminal = true;
      providerTerminal = true;
      reason = "quote_deadline_elapsed_before_deposit";
    }
  } else if (providerStatus === "KNOWN_DEPOSIT_TX") {
    canonicalState = "submitted";
    prismOperationState = "submitted";
    requiresIndependentReadback = true;
    reason = "provider_detected_deposit_transaction";
  } else if (providerStatus === "PROCESSING" || providerStatus === "INCOMPLETE_DEPOSIT") {
    canonicalState = "processing";
    prismOperationState = "processing";
    requiresIndependentReadback = true;
    reason = providerStatus === "PROCESSING" ? "provider_processing_swap" : "provider_incomplete_deposit_poll_only";
    if (providerStatus === "INCOMPLETE_DEPOSIT" && input.now >= Date.parse(input.quote.deadline)) {
      canonicalState = "expired";
      prismOperationState = "expired";
      terminal = true;
      providerTerminal = true;
      reason = "quote_deadline_elapsed_before_refund_observed";
    }
  } else if (providerStatus === "SUCCESS") {
    canonicalState = "completed";
    prismOperationState = "confirmed";
    terminal = true;
    providerTerminal = true;
    requiresIndependentReadback = true;
    reason = "provider_success_requires_destination_receipt_readback";
  } else if (providerStatus === "REFUNDED") {
    canonicalState = "refunded";
    prismOperationState = "failed_terminal";
    terminal = true;
    providerTerminal = true;
    requiresIndependentReadback = true;
    retryPolicy = "new_quote_only";
    reason = "provider_refund_requires_origin_receipt_readback";
  } else if (providerStatus === "FAILED") {
    canonicalState = "failed";
    prismOperationState = "failed_terminal";
    terminal = true;
    providerTerminal = true;
    requiresIndependentReadback = false;
    retryPolicy = "new_quote_only";
    reason = "provider_reported_failure_new_quote_only";
  } else {
    canonicalState = "unknown";
    prismOperationState = "requires_attention";
    requiresIndependentReadback = true;
    reason = "unknown_provider_status_poll_only";
  }

  if (stale) {
    canonicalState = "unknown";
    prismOperationState = "requires_attention";
    terminal = false;
    providerTerminal = false;
    requiresIndependentReadback = true;
    retryPolicy = "poll_only";
    reason = "stale_provider_status_poll_only";
  }

  return baseObservation({
    quote: input.quote,
    providerStatus,
    correlationId,
    updatedAt,
    canonicalState,
    prismOperationState,
    terminal,
    providerTerminal,
    requiresIndependentReadback,
    retryPolicy,
    stale,
    reason,
    details,
  });
}

function normalizeStatusResponse(
  response: unknown,
  quote: NearIntentsQuote,
  now: number,
  maxStatusAgeMs: number,
): NearIntentsStatusObservation {
  if (!objectLike(response)) throw new ShapeError("status_response_object_required");
  const correlationId = requiredString(response.correlationId, "status.correlation_id");
  const providerStatus = rawStatusFromResponse(response);
  const updatedAt = requiredString(response.updatedAt, "status.updated_at");
  parseFiniteDate(updatedAt, "status.updated_at");
  const mismatch = statusResponseMatchesQuote(response, quote);
  if (mismatch) throw new ShapeError(mismatch);
  const mapped = mapNearIntentsStatus({
    quote,
    response: {
      correlationId,
      status: providerStatus,
      updatedAt,
      quoteResponse: response.quoteResponse as Record<string, unknown>,
      swapDetails: response.swapDetails as NearIntentsSwapDetailsResponse | null | undefined,
    },
    now,
    maxStatusAgeMs,
  });
  return mapped;
}

function validHash(value: string): boolean {
  return /^0x[0-9a-fA-F]{1,64}$/.test(value);
}

function sameAddress(left: string, right: string): boolean {
  if (!/^0x[0-9a-fA-F]+$/.test(left) || !/^0x[0-9a-fA-F]+$/.test(right)) return left.toLowerCase() === right.toLowerCase();
  try {
    return BigInt(left) === BigInt(right);
  } catch {
    return left.toLowerCase() === right.toLowerCase();
  }
}

function receiptMatches(
  receipt: NearIntentsNativeReceipt,
  expected: {
    network: NearIntentsNetwork;
    txHash: string;
    recipient: string;
    assetId: string;
    minimumAmount: string;
  },
): boolean {
  if (receipt.network !== expected.network) return false;
  if (!validHash(receipt.txHash) || receipt.txHash.toLowerCase() !== expected.txHash.toLowerCase()) return false;
  if (receipt.status !== "SUCCEEDED") return false;
  const blockNumber = receipt.blockNumber;
  if (blockNumber === null || !Number.isSafeInteger(blockNumber) || blockNumber < 0) return false;
  if (!sameAddress(receipt.recipient, expected.recipient)) return false;
  if (receipt.assetId !== expected.assetId) return false;
  if (!/^\d+$/.test(receipt.amount) || !/^\d+$/.test(expected.minimumAmount)) return false;
  try {
    return BigInt(receipt.amount) >= BigInt(expected.minimumAmount);
  } catch {
    return false;
  }
}

function successReadback(
  observation: NearIntentsStatusObservation,
  source: NearIntentsStatusObservation["readbackSource"],
): NearIntentsStatusObservation {
  return {
    ...observation,
    readbackVerified: true,
    readbackSource: source,
    requiresIndependentReadback: false,
    reason: "provider_terminal_status_correlated_with_independent_native_receipt",
  };
}

export class NearIntentsOneClickProvider {
  readonly providerId = NEAR_INTENTS_ONE_CLICK_PROVIDER_ID;
  readonly baseUrl = NEAR_INTENTS_ONE_CLICK_BASE_URL;
  private readonly transport: NearIntentsTransport | null;
  private readonly capabilities: NearIntentsCapabilityEvidence;
  private readonly headers: Record<string, string>;
  private readonly quoteSignatureVerifier: NearIntentsQuoteSignatureVerifier | null;
  private readonly now: () => number;
  private readonly maxStatusAgeMs: number;
  private readonly receiptReader: NearIntentsReceiptReader | null;

  constructor(options: NearIntentsOneClickProviderOptions = {}) {
    this.transport = options.transport ?? null;
    this.capabilities = options.capabilities ?? DEFAULT_NEAR_INTENTS_CAPABILITIES;
    this.headers = { ...(options.headers ?? {}), "content-type": "application/json" };
    this.quoteSignatureVerifier = options.quoteSignatureVerifier ?? null;
    this.now = options.now ?? (() => Date.now());
    this.maxStatusAgeMs = options.maxStatusAgeMs ?? DEFAULT_STATUS_MAX_AGE_MS;
    this.receiptReader = options.receiptReader ?? null;
    if (!Number.isSafeInteger(this.maxStatusAgeMs) || this.maxStatusAgeMs < 0) {
      throw new Error("invariant_violation: maxStatusAgeMs must be a non-negative safe integer");
    }
  }

  getAvailability(): NearIntentsAvailabilityAssessment {
    return assessNearIntentsAvailability(this.capabilities);
  }

  availability(): NearIntentsAvailabilityAssessment {
    return this.getAvailability();
  }

  private checkRoute(route: NearIntentsRoute): NearIntentsFailure | null {
    return routeCapabilityFailure(route, this.capabilities);
  }

  private unavailableForTransport(input: { pollOnly: boolean; detail: string }): NearIntentsFailure {
    return resultFailure({
      kind: "provider_unavailable",
      code: "PROVIDER_UNAVAILABLE",
      detail: input.detail,
      blocker: input.pollOnly
        ? "provider status could not be observed; poll again and do not infer failure or completion"
        : "provider transport is not configured or did not respond",
      retryable: true,
      pollOnly: input.pollOnly,
    });
  }

  private async callTransport(input: NearIntentsTransportRequest, pollOnly: boolean): Promise<NearIntentsResult<unknown>> {
    if (!this.transport) return this.unavailableForTransport({ pollOnly, detail: "1Click transport is not configured" });
    let response: NearIntentsTransportResponse;
    try {
      response = await this.transport.request(input);
    } catch {
      return this.unavailableForTransport({ pollOnly, detail: "1Click transport request failed" });
    }
    if (!response || !Number.isInteger(response.status)) {
      return resultFailure({
        kind: "invalid_response",
        code: "INVALID_RESPONSE",
        detail: "1Click transport returned an invalid HTTP response",
      });
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return resultFailure({
        kind: "invalid_response",
        code: "INVALID_RESPONSE",
        detail: "1Click response JSON could not be decoded",
      });
    }
    if (response.status < 200 || response.status >= 300) {
      return resultFailure({
        kind: "provider_request_failed",
        code: "PROVIDER_REQUEST_FAILED",
        detail: "1Click request was rejected",
        blocker: response.status >= 500 || response.status === 429 ? "provider may recover; retry within the safe boundary" : null,
        retryable: response.status >= 500 || response.status === 429,
        pollOnly,
      });
    }
    return resultSuccess(body);
  }

  private async verifyQuoteSignature(payload: unknown): Promise<NearIntentsResult<true>> {
    if (!this.quoteSignatureVerifier) {
      return resultFailure({
        kind: "provider_unavailable",
        code: "PROVIDER_UNAVAILABLE",
        detail: "1Click quote signature verifier is not configured",
        blocker: "a reviewed quote signature verifier is required before consuming provider quote fields",
        missingEvidence: ["verified 1Click quote signature verifier"],
        retryable: false,
        pollOnly: false,
      });
    }
    let verified: boolean;
    try {
      verified = typeof this.quoteSignatureVerifier === "function"
        ? await this.quoteSignatureVerifier(payload)
        : await this.quoteSignatureVerifier.verifyQuoteSignature(payload);
    } catch {
      return resultFailure({
        kind: "provider_unavailable",
        code: "PROVIDER_UNAVAILABLE",
        detail: "1Click quote signature verification failed",
        blocker: "quote authenticity could not be independently verified",
        retryable: true,
        pollOnly: false,
      });
    }
    if (verified !== true) {
      return resultFailure({
        kind: "invalid_quote",
        code: "INVALID_QUOTE",
        detail: "quote_signature_invalid",
      });
    }
    return resultSuccess(true);
  }

  private async verifyStatusSignature(payload: unknown): Promise<NearIntentsResult<true>> {
    if (!objectLike(payload)) {
      return resultFailure({ kind: "invalid_response", code: "INVALID_RESPONSE", detail: "status response object required" });
    }
    const verification = await this.verifyQuoteSignature(payload.quoteResponse);
    if (verification.ok) return verification;
    if (verification.kind === "invalid_quote") {
      return resultFailure({ kind: "invalid_response", code: "INVALID_RESPONSE", detail: "status_quote_signature_invalid" });
    }
    return verification;
  }

  async requestQuote(input: NearIntentsQuoteRequest): Promise<NearIntentsResult<NearIntentsQuote>> {
    const now = this.now();
    if (!Number.isFinite(now)) {
      return resultFailure({ kind: "provider_unavailable", code: "PROVIDER_UNAVAILABLE", detail: "clock unavailable", blocker: "a trusted clock is required before quote expiry checks", retryable: true });
    }
    let normalizedInput: NearIntentsQuoteRequest;
    try {
      normalizedInput = validateQuoteRequest(input, now);
    } catch (cause) {
      const detail = cause instanceof ShapeError ? cause.detail : "invalid_quote_request";
      if (detail === "quote_deadline_elapsed") {
        return resultFailure({ kind: "quote_expired", code: "QUOTE_EXPIRED", detail });
      }
      if (detail === "route_unsupported") {
        return resultFailure({ kind: "route_unsupported", code: "ROUTE_UNSUPPORTED", detail });
      }
      return resultFailure({ kind: "invalid_request", code: "INVALID_REQUEST", detail });
    }
    const capabilityFailure = this.checkRoute(normalizedInput.route);
    if (capabilityFailure) return capabilityFailure;
    if (!this.quoteSignatureVerifier) {
      return resultFailure({
        kind: "provider_unavailable",
        code: "PROVIDER_UNAVAILABLE",
        detail: "1Click quote signature verifier is not configured",
        blocker: "a reviewed quote signature verifier is required before consuming provider quote fields",
        missingEvidence: ["verified 1Click quote signature verifier"],
        retryable: false,
        pollOnly: false,
      });
    }
    const transportResult = await this.callTransport(
      {
        method: "POST",
        path: "/v0/quote",
        headers: { ...this.headers },
        body: JSON.stringify(apiQuotePayload(normalizedInput)),
      },
      false,
    );
    if (!transportResult.ok) return transportResult;
    const signatureResult = await this.verifyQuoteSignature(transportResult.data);
    if (!signatureResult.ok) return signatureResult;
    try {
      return resultSuccess(normalizeQuoteResponse(transportResult.data, normalizedInput, now));
    } catch (cause) {
      const detail = cause instanceof ShapeError ? cause.detail : "invalid_quote_response";
      if (detail === "quote_expired") return resultFailure({ kind: "quote_expired", code: "QUOTE_EXPIRED", detail });
      return resultFailure({ kind: "invalid_quote", code: "INVALID_QUOTE", detail });
    }
  }

  async getStatus(input: { readonly quote: NearIntentsQuote }): Promise<NearIntentsResult<NearIntentsStatusObservation>> {
    const now = this.now();
    if (!Number.isFinite(now)) {
      return this.unavailableForTransport({ pollOnly: true, detail: "clock unavailable while polling provider status" });
    }
    const capabilityFailure = this.checkRoute(input.quote.route);
    if (capabilityFailure) return { ...capabilityFailure, pollOnly: true, retryable: true };
    if (input.quote.dry || input.quote.depositAddress === null) {
      return resultFailure({ kind: "invalid_request", code: "INVALID_REQUEST", detail: "status requires a non-dry quote with a deposit address" });
    }
    const query = new URLSearchParams({ depositAddress: input.quote.depositAddress });
    if (input.quote.depositMemo !== null) query.set("depositMemo", input.quote.depositMemo);
    const transportResult = await this.callTransport(
      {
        method: "GET",
        path: `/v0/status?${query.toString()}`,
        headers: { ...this.headers },
      },
      true,
    );
    if (!transportResult.ok) return transportResult as NearIntentsFailure;
    const statusSignature = await this.verifyStatusSignature(transportResult.data);
    if (!statusSignature.ok) return statusSignature;
    let observation: NearIntentsStatusObservation;
    try {
      observation = normalizeStatusResponse(transportResult.data, input.quote, now, this.maxStatusAgeMs);
    } catch (cause) {
      const detail = cause instanceof ShapeError ? cause.detail : "invalid_status_response";
      if (detail.includes("mismatch")) {
        return resultFailure({ kind: "receipt_mismatch", code: "RECEIPT_MISMATCH", detail });
      }
      return resultFailure({ kind: "invalid_response", code: "INVALID_RESPONSE", detail });
    }
    if (observation.stale) {
      return resultFailure({
        kind: "stale_status",
        code: "STALE_STATUS",
        detail: "provider status is stale and cannot advance the operation",
        blocker: "poll provider status again before acting",
        retryable: true,
        pollOnly: true,
        observation,
      });
    }
    return resultSuccess(observation);
  }

  /**
   * Notify 1Click about a transaction already broadcast by the user's native
   * wallet. This function has no wallet capability and cannot broadcast. The
   * explicit approval flag prevents Prism from treating notification as an
   * autonomous spend authority.
   */
  async submitDepositTx(input: {
    readonly quote: NearIntentsQuote;
    readonly txHash: string;
    readonly userApproved: boolean;
  }): Promise<NearIntentsResult<NearIntentsStatusObservation>> {
    if (input.userApproved !== true) {
      return resultFailure({ kind: "invalid_request", code: "INVALID_REQUEST", detail: "explicit native-wallet approval is required before deposit notification" });
    }
    if (!validHash(input.txHash)) {
      return resultFailure({ kind: "invalid_request", code: "INVALID_REQUEST", detail: "deposit transaction hash is malformed" });
    }
    if (input.quote.depositAddress === null || input.quote.dry) {
      return resultFailure({ kind: "invalid_request", code: "INVALID_REQUEST", detail: "deposit notification requires a non-dry quote" });
    }
    const capabilityFailure = this.checkRoute(input.quote.route);
    if (capabilityFailure) return capabilityFailure;
    const body: Record<string, unknown> = {
      txHash: input.txHash,
      depositAddress: input.quote.depositAddress,
    };
    if (input.quote.depositMemo !== null) body.memo = input.quote.depositMemo;
    const transportResult = await this.callTransport(
      {
        method: "POST",
        path: "/v0/deposit/submit",
        headers: { ...this.headers },
        body: JSON.stringify(body),
      },
      true,
    );
    if (!transportResult.ok) return transportResult as NearIntentsFailure;
    const statusSignature = await this.verifyStatusSignature(transportResult.data);
    if (!statusSignature.ok) return statusSignature;
    const now = this.now();
    try {
      const observation = normalizeStatusResponse(transportResult.data, input.quote, now, this.maxStatusAgeMs);
      if (observation.stale) {
        return resultFailure({ kind: "stale_status", code: "STALE_STATUS", detail: "deposit notification returned stale provider status", blocker: "poll provider status again", retryable: true, pollOnly: true, observation });
      }
      return resultSuccess(observation);
    } catch (cause) {
      const detail = cause instanceof ShapeError ? cause.detail : "invalid_deposit_notification_response";
      if (detail.includes("mismatch")) return resultFailure({ kind: "receipt_mismatch", code: "RECEIPT_MISMATCH", detail });
      return resultFailure({ kind: "invalid_response", code: "INVALID_RESPONSE", detail });
    }
  }

  /** Alias with explicit notification terminology for callers avoiding submit ambiguity. */
  async notifyDeposit(input: {
    readonly quote: NearIntentsQuote;
    readonly txHash: string;
    readonly userApproved: boolean;
  }): Promise<NearIntentsResult<NearIntentsStatusObservation>> {
    return this.submitDepositTx(input);
  }

  /**
   * Correlate a provider terminal status with a venue-native read path.
   * Provider SUCCESS alone maps to Prism `confirmed`; only the caller's
   * operation/reconciliation boundary may later issue a Prism completed state.
   */
  async reconcileStatus(input: {
    readonly quote: NearIntentsQuote;
    readonly status: NearIntentsStatusObservation;
  }): Promise<NearIntentsResult<NearIntentsStatusObservation>> {
    const { quote, status } = input;
    const capabilityFailure = this.checkRoute(quote.route);
    if (capabilityFailure) return { ...capabilityFailure, pollOnly: true, retryable: true };
    if (status.correlationId !== quote.correlationId || status.depositAddress !== quote.depositAddress) {
      return resultFailure({ kind: "receipt_mismatch", code: "RECEIPT_MISMATCH", detail: "status quote/deposit correlation mismatch", observation: status });
    }
    if (status.canonicalState === "unknown" || status.stale || status.prismOperationState === "requires_attention") {
      return resultFailure({ kind: "provider_unavailable", code: "PROVIDER_UNAVAILABLE", detail: "provider status is unknown or stale", blocker: "poll provider status again; no failure or completion was inferred", retryable: true, pollOnly: true, observation: status });
    }
    if (status.canonicalState === "completed") {
      if (!this.receiptReader) {
        return resultFailure({ kind: "provider_unavailable", code: "PROVIDER_UNAVAILABLE", detail: "independent destination receipt reader is not configured", blocker: "destination receipt readback is required before completion can be claimed", retryable: true, pollOnly: true, observation: status });
      }
      const destination = status.destinationChainTxHashes[0];
      if (!destination) {
        return resultFailure({ kind: "receipt_mismatch", code: "RECEIPT_MISMATCH", detail: "provider SUCCESS has no destination transaction for readback", observation: status });
      }
      let receipt: NearIntentsNativeReceipt | null;
      try {
        receipt = await this.receiptReader.readDestinationReceipt({ network: quote.route.destinationNetwork, txHash: destination.hash, quote });
      } catch {
        return resultFailure({ kind: "provider_unavailable", code: "PROVIDER_UNAVAILABLE", detail: "destination receipt readback failed", blocker: "independent destination receipt could not be observed", retryable: true, pollOnly: true, observation: status });
      }
      if (!receipt) {
        return resultFailure({ kind: "provider_unavailable", code: "PROVIDER_UNAVAILABLE", detail: "destination receipt is not yet available", blocker: "poll the independent destination receipt before completion", retryable: true, pollOnly: true, observation: status });
      }
      if (!receiptMatches(receipt, { network: quote.route.destinationNetwork, txHash: destination.hash, recipient: quote.recipient, assetId: quote.route.destinationAsset, minimumAmount: quote.minAmountOut })) {
        return resultFailure({ kind: "receipt_mismatch", code: "RECEIPT_MISMATCH", detail: "destination receipt does not match provider quote", observation: status });
      }
      const source = quote.route.destinationNetwork === BASE_SEPOLIA_NETWORK ? "base_native_receipt" : "starknet_native_receipt";
      return resultSuccess(successReadback(status, source));
    }
    if (status.canonicalState === "refunded") {
      if (!this.receiptReader || typeof this.receiptReader.readOriginReceipt !== "function") {
        return resultFailure({ kind: "provider_unavailable", code: "PROVIDER_UNAVAILABLE", detail: "independent refund receipt reader is not configured", blocker: "origin-chain refund receipt is required before returned funds can be claimed", retryable: true, pollOnly: true, observation: status });
      }
      const refundTx = status.originChainTxHashes[status.originChainTxHashes.length - 1];
      if (!refundTx || status.refundedAmount === null) {
        return resultFailure({ kind: "receipt_mismatch", code: "RECEIPT_MISMATCH", detail: "provider REFUNDED status lacks refund transaction or amount", observation: status });
      }
      let receipt: NearIntentsNativeReceipt | null;
      try {
        receipt = await this.receiptReader.readOriginReceipt({ network: quote.route.originNetwork, txHash: refundTx.hash, quote });
      } catch {
        return resultFailure({ kind: "provider_unavailable", code: "PROVIDER_UNAVAILABLE", detail: "refund receipt readback failed", blocker: "independent origin-chain refund receipt could not be observed", retryable: true, pollOnly: true, observation: status });
      }
      if (!receipt) {
        return resultFailure({ kind: "provider_unavailable", code: "PROVIDER_UNAVAILABLE", detail: "refund receipt is not yet available", blocker: "poll the independent origin-chain refund receipt before claiming funds returned", retryable: true, pollOnly: true, observation: status });
      }
      if (!receiptMatches(receipt, { network: quote.route.originNetwork, txHash: refundTx.hash, recipient: quote.refundTo, assetId: quote.route.originAsset, minimumAmount: status.refundedAmount })) {
        return resultFailure({ kind: "receipt_mismatch", code: "RECEIPT_MISMATCH", detail: "refund receipt does not match provider refund details", observation: status });
      }
      return resultSuccess(successReadback(status, quote.route.originNetwork === BASE_SEPOLIA_NETWORK ? "base_native_receipt" : "starknet_native_receipt"));
    }
    if (status.canonicalState === "failed" || status.canonicalState === "expired") return resultSuccess(status);
    return resultSuccess(status);
  }

  async readback(input: {
    readonly quote: NearIntentsQuote;
    readonly status: NearIntentsStatusObservation;
  }): Promise<NearIntentsResult<NearIntentsStatusObservation>> {
    return this.reconcileStatus(input);
  }

  async reconcile(input: {
    readonly quote: NearIntentsQuote;
    readonly status: NearIntentsStatusObservation;
  }): Promise<NearIntentsResult<NearIntentsStatusObservation>> {
    return this.reconcileStatus(input);
  }
}

/** Compatibility aliases for callers that name this an adapter or 1Click. */
export const NearIntentsOneClickAdapter = NearIntentsOneClickProvider;
export const NearIntents1ClickAdapter = NearIntentsOneClickProvider;
export const NearIntentsProvider = NearIntentsOneClickProvider;

export function directionForNearIntentsRoute(route: NearIntentsRoute): NearIntentsRouteDirection | null {
  return routeDirection(route);
}

export function retryPolicyForNearIntentsStatus(status: string): NearIntentsRetryPolicy {
  return status === "FAILED" || status === "REFUNDED" ? "new_quote_only" : "poll_only";
}

export function isKnownNearIntentsStatus(status: string): boolean {
  return KNOWN_STATUS.has(status);
}

export function isTerminalNearIntentsStatus(status: string): boolean {
  return TERMINAL_PROVIDER_STATUSES.has(status);
}

export function mapNearIntentsProviderStatus(input: {
  readonly quote: NearIntentsQuote;
  readonly response: NearIntentsStatusResponse;
  readonly now: number;
  readonly maxStatusAgeMs?: number;
}): NearIntentsStatusObservation {
  return mapNearIntentsStatus(input);
}
