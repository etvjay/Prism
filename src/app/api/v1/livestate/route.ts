/**
 * GET /api/v1/livestate?prismId=8 — read-only live chain state for the
 * `?demo=livestate` surface.
 *
 * Server-side only: reads prism owner via `get_identity`, the BASE binding
 * via `resolve`, the deployer/owner STRK balance via `balance_of`, and the
 * bound EOA's Base Sepolia ETH balance via `eth_getBalance`. All calls are
 * read-only RPC/API (no broadcast, no signing, no spending) with a timeout
 * and fail-closed error copy. The Starknet RPC URL is read at runtime from
 * `/tmp/sepolia_rpc_url` (0600) with `STARKNET_RPC_URL` as fallback and is
 * never logged, committed, or echoed to the client.
 */

import { promises as fs } from "node:fs";
import { StarknetRegistryReadAdapter } from "@/features/prism-operations/adapters/starknet-registry-read";
import { LIVE_STATE_FALLBACK_COPY, LIVE_STATE_IDS } from "@/features/live-state/liveStateTypes";
import { STRK_SEPOLIA } from "@/features/prism-strk20/m5/constants";
import { fetchBalanceViaRpc } from "@/features/prism-strk20/m5/rpc";

const REGISTRY_V2 = LIVE_STATE_IDS.registryV2;
const BASE_SEPOLIA_RPC = "https://sepolia.base.org";
const RPC_TIMEOUT_MS = 10_000;

// starknet.js `hash.getSelectorFromName("get_identity" | "resolve")` —
// pinned here so this route needs no signer/provider dependency. Verified
// against SN_SEPOLIA registry V2 before wiring.
const GET_IDENTITY_SELECTOR =
  "0x2c4943a27e820803a6ef49bb04b629950e2de615ab9ac0fb8baef037b168782";
const RESOLVE_SELECTOR =
  "0x2412dc2a4a0554946f855b8a477bb5d50aeb5d097ddd55c2f7b4dda077bf63a";

const UNAVAILABLE = "live_state_unavailable";

function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}_timeout`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function starknetCall(
  rpcUrl: string,
  contractAddress: string,
  selector: string,
  calldata: string[],
): Promise<string[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
  try {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "starknet_call",
        params: [{ contract_address: contractAddress, entry_point_selector: selector, calldata }, "latest"],
      }),
    });
    if (!res.ok) throw new Error(`starknet_call_http_${res.status}`);
    const json = (await res.json()) as { result?: unknown; error?: { message: string } };
    if (json.error || !Array.isArray(json.result)) throw new Error("starknet_call_failed");
    return json.result as string[];
  } finally {
    clearTimeout(timer);
  }
}

async function baseEthBalanceOf(account: string): Promise<bigint> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
  try {
    const res = await fetch(BASE_SEPOLIA_RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [account, "latest"] }),
    });
    if (!res.ok) throw new Error(`eth_getBalance_http_${res.status}`);
    const json = (await res.json()) as { result?: unknown; error?: { message: string } };
    if (json.error || typeof json.result !== "string" || !/^0x[0-9a-fA-F]+$/.test(json.result)) {
      throw new Error("eth_getBalance_failed");
    }
    return BigInt(json.result);
  } finally {
    clearTimeout(timer);
  }
}

/** Runtime-only secret read: file first, env fallback. Never logged. */
async function readStarknetRpcUrl(): Promise<string | null> {
  try {
    const raw = (await fs.readFile("/tmp/sepolia_rpc_url", "utf8")).trim();
    if (/^https?:\/\//i.test(raw)) return raw;
  } catch {
    // Fall through to env fallback.
  }
  const env = (process.env.STARKNET_RPC_URL ?? "").trim();
  return /^https?:\/\//i.test(env) ? env : null;
}

function normalizePrismId(raw: string | null): string | null {
  const value = (raw ?? "8").trim();
  if (/^[1-9][0-9]*$/.test(value)) return `prism:${value}`;
  if (/^prism:[1-9][0-9]*$/.test(value)) return value;
  return null;
}

/**
 * Starknet reads return 64-hex padded felts; the EVM binding needs the
 * 20-byte EOA form for `eth_getBalance`. Minimal-hex normalization keeps
 * the full value while matching canonical display (`0x47c0…`, `0xCf3E…`).
 */
function minimalHex(hex: string): string {
  const body = hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2).toLowerCase() : hex.toLowerCase();
  const stripped = body.replace(/^0+(?=[0-9a-f])/, "");
  return `0x${stripped}`;
}

/** 18-decimal raw -> "1,234.56" display. No precision claimed beyond 2dp. */
function formatToken2dp(raw: bigint): string {
  const unit = 10n ** 18n;
  const whole = raw / unit;
  const frac = ((raw % unit) * 100n) / unit;
  return `${whole.toLocaleString("en-US")}.${frac.toString().padStart(2, "0")}`;
}

/** Wei -> short ETH display (up to 6dp, trailing zeros trimmed). */
function formatEth(wei: bigint): string {
  const unit = 10n ** 18n;
  const whole = wei / unit;
  const fracFull = (wei % unit).toString().padStart(18, "0").slice(0, 6).replace(/0+$/, "");
  return fracFull.length > 0 ? `${whole}.${fracFull}` : `${whole}`;
}

function failClosed(status: number, detail: string): Response {
  const code = status === 400 ? "ERR-023" : status === 404 ? "ERR-010" : "ERR-021";
  return Response.json(
    {
      ok: false,
      error: {
        code,
        detail,
        fallback: LIVE_STATE_FALLBACK_COPY.blocked,
      },
      requestId: null,
    },
    { status, headers: { "cache-control": "no-store" } },
  );
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const prismId = normalizePrismId(url.searchParams.get("prismId"));
  const requestedAccount = url.searchParams.get("accountAddress");
  if (!prismId) {
    return failClosed(400, "malformed_prism_id:expected_8_or_prism:8");
  }
  if (!requestedAccount || !/^0x[0-9a-fA-F]+$/.test(requestedAccount)) {
    return failClosed(400, "malformed_account_address");
  }
  const connectedAccount = minimalHex(requestedAccount);

  const rpcUrl = await readStarknetRpcUrl();
  if (!rpcUrl) {
    return failClosed(503, UNAVAILABLE);
  }

  const reader = {
    callContract: (args: { contractAddress: string; entrypoint: string; calldata: string[] }) => {
      const selector = args.entrypoint === "get_identity" ? GET_IDENTITY_SELECTOR : RESOLVE_SELECTOR;
      return starknetCall(rpcUrl, args.contractAddress, selector, args.calldata);
    },
  };
  const registry = new StarknetRegistryReadAdapter({ reader, registryAddress: REGISTRY_V2 });

  let owner: string;
  let baseBinding: string | null;
  try {
    const identity = await withTimeout(registry.getIdentity(prismId), RPC_TIMEOUT_MS, "get_identity");
    if (!identity) {
      return failClosed(404, "identity_not_found");
    }
    owner = minimalHex(identity.controller);
    const resolved = await withTimeout(registry.resolve(prismId, "BASE"), RPC_TIMEOUT_MS, "resolve");
    baseBinding = resolved.executionAccount === null ? null : minimalHex(resolved.executionAccount);
  } catch {
    // Never leak provider text or the RPC URL to the client.
    return failClosed(503, UNAVAILABLE);
  }

  // Balances are best-effort per field: a balance failure marks that field
  // unavailable (claiming no value) without failing owner/binding.
  let strk: { status: "live" | "unavailable"; raw: string | null; display: string | null } = {
    status: "unavailable",
    raw: null,
    display: null,
  };
  try {
    const raw = await withTimeout(fetchBalanceViaRpc(rpcUrl, STRK_SEPOLIA, connectedAccount), RPC_TIMEOUT_MS, "strk_balance");
    strk = { status: "live", raw: raw.toString(), display: `${formatToken2dp(raw)} STRK` };
  } catch {
    strk = { status: "unavailable", raw: null, display: null };
  }

  let baseEth: { status: "live" | "unavailable"; rawWei: string | null; display: string | null } = {
    status: "unavailable",
    rawWei: null,
    display: null,
  };
  if (baseBinding) {
    try {
      const wei = await withTimeout(baseEthBalanceOf(baseBinding), RPC_TIMEOUT_MS, "base_eth");
      baseEth = { status: "live", rawWei: `0x${wei.toString(16)}`, display: `${formatEth(wei)} Base Sepolia ETH` };
    } catch {
      baseEth = { status: "unavailable", rawWei: null, display: null };
    }
  }

  return Response.json(
    {
      ok: true,
      data: {
        prismId,
        registry: REGISTRY_V2,
        owner,
        baseBinding,
        strkBalance: { account: connectedAccount, token: STRK_SEPOLIA, ...strk },
        baseEth: { account: baseBinding, ...baseEth },
      },
      requestId: null,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
