// Receipts derived from OperationStore — no chain bypass, submitted != completed preserved.
// Receipt is an observed, non-authoritative projection of an operation (ledger status
// + reconciliation). For M2 we derive receipt purely from persisted operation.

import type { OperationStore, PersistedOperation } from "../features/prism-operations/domain/operation-store";
import type { AppResponse } from "./schemas";
import { ok, err } from "./schemas";
import { APP_ERROR_CODE } from "./errors";

export interface ReceiptData {
  readonly receiptId: string;
  readonly operationId: string;
  readonly kind: string;
  readonly state: string;
  readonly txHash: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly watermark: number | null;
  readonly errorCode: string | null;
  readonly errorDetail: string | null;
  readonly correlationId: string | null;
}

export class ReceiptService {
  constructor(private readonly store: OperationStore) {}

  async getReceipt(operationIdOrReceiptId: string, requestId: string | null): Promise<AppResponse<ReceiptData>> {
    const op = await this.store.getById(operationIdOrReceiptId);
    if (!op) {
      return err({ code: APP_ERROR_CODE.IDENTITY_NOT_FOUND, name: "identity_not_found", category: "not_found", retryable: "no", userAction: "check_identifier", httpStatusHint: 404, detail: `unknown_receipt:${operationIdOrReceiptId}` }, requestId);
    }
    return ok<ReceiptData>(
      {
        receiptId: op.id,
        operationId: op.id,
        kind: op.kind,
        state: op.state,
        txHash: op.txHash,
        createdAt: op.createdAt,
        updatedAt: op.updatedAt,
        watermark: op.reconciliationWatermark,
        errorCode: op.errorCode,
        errorDetail: op.errorDetail,
        correlationId: op.correlationId,
      },
      { operationId: op.id, state: op.state as unknown as import("../features/prism-operations/domain/operation").OperationState, version: op.version },
      requestId,
      op.reconciliationWatermark,
    );
  }

  async getByOperationId(operationId: string, requestId: string | null): Promise<AppResponse<ReceiptData>> {
    return this.getReceipt(operationId, requestId);
  }
}
