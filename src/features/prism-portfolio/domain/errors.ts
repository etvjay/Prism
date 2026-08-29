import type { PortfolioError } from "./types";

export const PORTFOLIO_ERROR_CODE = {
  INVALID_PRISM_ID: "PORTFOLIO_INVALID_PRISM_ID",
  RESOLUTION_UNAVAILABLE: "PORTFOLIO_RESOLUTION_UNAVAILABLE",
  BALANCE_UNAVAILABLE: "PORTFOLIO_BALANCE_UNAVAILABLE",
  INVALID_OBSERVATION: "PORTFOLIO_INVALID_OBSERVATION",
  INFERRED_ACCOUNT_REJECTED: "PORTFOLIO_INFERRED_ACCOUNT_REJECTED",
  CONSENT_REQUIRED: "PORTFOLIO_CONSENT_REQUIRED",
  CONSENT_DENIED: "PORTFOLIO_CONSENT_DENIED",
  VALUATION_UNAVAILABLE: "PORTFOLIO_VALUATION_UNAVAILABLE",
  VALUATION_STALE: "PORTFOLIO_VALUATION_STALE",
  VALUATION_INCOMPATIBLE: "PORTFOLIO_VALUATION_INCOMPATIBLE",
} as const;

export type PortfolioErrorCode = (typeof PORTFOLIO_ERROR_CODE)[keyof typeof PORTFOLIO_ERROR_CODE];

export class PortfolioAggregationError extends Error {
  readonly code: PortfolioErrorCode;
  readonly detail?: string;

  constructor(code: PortfolioErrorCode, detail?: string) {
    super(`[${code}]${detail ? ` ${detail}` : ""}`);
    this.name = "PortfolioAggregationError";
    this.code = code;
    this.detail = detail;
  }

  toExternalShape(): PortfolioError {
    return {
      code: this.code,
      ...(this.detail ? { detail: this.detail } : {}),
    };
  }
}

export function isPortfolioAggregationError(value: unknown): value is PortfolioAggregationError {
  return value instanceof PortfolioAggregationError;
}
