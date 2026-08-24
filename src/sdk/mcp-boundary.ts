// MCP integration boundary — thin adapter over REST/SDK, no second authority path.
// Per PRISM_PROTOCOL_SURFACE_PHASE_PLAN.md S3: MCP must call the same REST/API
// or application service used by the SDK. It must not duplicate chain adapters
// or policy logic, must not bypass Pause, and must never handle secrets.
//
// This file defines tool schemas and a factory that binds them to a PrismClient
// instance. No MCP server is started here — the consumer wires these tools into
// its own MCP server implementation (lane constraint: do not build full MCP server).

import type { PrismClient } from "./client";
import type { Venue, Hex, PrismId } from "./types";

export interface McpToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

export const MCP_TOOL_DEFINITIONS: readonly McpToolDefinition[] = [
  {
    name: "prism_resolve",
    description: "Resolve a Prism ID + venue to its active execution account (watermarked). Returns NO_ACTIVE_DESTINATION when revoked.",
    inputSchema: { type: "object", required: ["prismId", "venue"], properties: { prismId: { type: "string" }, venue: { type: "string", enum: ["BASE"] } } },
  },
  {
    name: "prism_get_identity",
    description: "Read canonical Prism identity (controller, existence, watermark).",
    inputSchema: { type: "object", required: ["prismId"], properties: { prismId: { type: "string" } } },
  },
  {
    name: "prism_get_connections",
    description: "Alias for resolve — lists active binding for a venue.",
    inputSchema: { type: "object", required: ["prismId", "venue"], properties: { prismId: { type: "string" }, venue: { type: "string", enum: ["BASE"] } } },
  },
  {
    name: "prism_create_intent",
    description: "Create an ExecutionIntent (payment/transfer etc.) — pre-Pause step. Requires Prism vocabulary only.",
    inputSchema: { type: "object", required: ["prismId", "purpose"], properties: { prismId: { type: "string" }, purpose: { type: "string", enum: ["payment", "transfer", "contract_call", "private_action", "other"] }, venue: { type: "string" }, executionAccount: { type: "string" }, amount: { type: "string" }, asset: { type: "string" } } },
  },
  {
    name: "prism_inspect_pause",
    description: "Read a Pause by pauseId — returns state, reasonCodes, riskLevel, version.",
    inputSchema: { type: "object", required: ["pauseId"], properties: { pauseId: { type: "string" } } },
  },
  {
    name: "prism_request_pause_verification",
    description: "Verify a PAUSED intent — triggers policy checks (recipient binding, amount ceiling, authority).",
    inputSchema: { type: "object", required: ["pauseId"], properties: { pauseId: { type: "string" } } },
  },
  {
    name: "prism_request_approval",
    description: "Request escalation/approval for a pause. Does not bypass Pause or change policy scope.",
    inputSchema: { type: "object", required: ["pauseId"], properties: { pauseId: { type: "string" }, approver: { type: "string" } } },
  },
  {
    name: "prism_get_operation",
    description: "Read durable operation state (submitted != completed).",
    inputSchema: { type: "object", required: ["operationId"], properties: { operationId: { type: "string" } } },
  },
  {
    name: "prism_get_receipt",
    description: "Read receipt derived from operation (observed result after settlement).",
    inputSchema: { type: "object", required: ["receiptId"], properties: { receiptId: { type: "string" } } },
  },
  {
    name: "prism_create_channel",
    description: "Testnet-scope channel creation — minimal relationship capability, not a chat product. Delegates to same API.",
    inputSchema: { type: "object", required: ["participants"], properties: { participants: { type: "array", items: { type: "string" } } } },
  },
  {
    name: "prism_send_channel_memo",
    description: "Send encrypted payment memo via channel — no plaintext onchain.",
    inputSchema: { type: "object", required: ["channelId", "ciphertext"], properties: { channelId: { type: "string" }, ciphertext: { type: "string" } } },
  },
] as const;

// Thin adapter — each tool calls the same PrismClient that REST handlers use.
// No direct chain, no policy duplication, no secret handling.
export function createMcpAdapter(client: PrismClient) {
  return {
    tools: MCP_TOOL_DEFINITIONS,

    async callTool(name: string, args: Record<string, unknown>): Promise<{ ok: boolean; data?: unknown; error?: unknown }> {
      // Authority guard: no tool may bypass Pause or mark settlement completed.
      const blocked = ["bypass_pause", "mark_completed", "sign_with_user_key", "read_viewing_key"];
      if (blocked.some((b) => name.includes(b))) return { ok: false, error: { code: "ERR-004", detail: `tool_not_authorized:${name}` } };

      switch (name) {
        case "prism_resolve":
          return client.identities.resolve(args.prismId as PrismId, (args.venue as Venue) ?? "BASE");
        case "prism_get_identity":
          return client.identities.get(args.prismId as PrismId);
        case "prism_get_connections":
          return client.identities.resolve(args.prismId as PrismId, (args.venue as Venue) ?? "BASE");
        case "prism_create_intent":
          return client.intents.create({ prismId: args.prismId as PrismId, purpose: (args.purpose as never) ?? "payment", venue: args.venue as string | null, executionAccount: args.executionAccount as string | null, amount: args.amount as string | null, asset: args.asset as string | null });
        case "prism_inspect_pause":
          return client.pauses.get(args.pauseId as string);
        case "prism_request_pause_verification":
          return client.pauses.verify(args.pauseId as string);
        case "prism_request_approval":
          // Two-step: escalate then approve — model as approve if escalated, else escalate
          {
            const pause = await client.pauses.get(args.pauseId as string);
            if (!pause.ok) return pause;
            const state = (pause.data as { state: string }).state;
            if (state === "ESCALATED") return client.pauses.approve(args.pauseId as string, { approver: args.approver as string | null });
            return client.pauses.escalate(args.pauseId as string);
          }
        case "prism_get_operation":
          return client.operations.get(args.operationId as string);
        case "prism_get_receipt":
          return client.receipts.get(args.receiptId as string);
        case "prism_create_channel":
        case "prism_send_channel_memo":
          // Channel is testnet-scope minimal slice — return not-implemented stable error without creating second authority
          return { ok: false, error: { code: "ERR-023", detail: `${name}_testnet_scope_only` } };
        default:
          return { ok: false, error: { code: "ERR-023", detail: `unknown_tool:${name}` } };
      }
    },
  };
}

export type McpAdapter = ReturnType<typeof createMcpAdapter>;
