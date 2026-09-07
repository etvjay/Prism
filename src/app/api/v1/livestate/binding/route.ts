import { promises as fs } from "node:fs";
import { RpcProvider } from "starknet";
import { StarknetEventIndexerAdapter } from "@/features/prism-operations/adapters/starknet-event-indexer";
import { LIVE_STATE_IDS } from "@/features/live-state/liveStateTypes";
import { getAppFactory } from "@/application/factory";

const RPC_TIMEOUT_MS = 10_000;
const REGISTRY_V2 = LIVE_STATE_IDS.registryV2;

async function getRpcUrl(): Promise<string | null> {
  try {
    const value = (await fs.readFile("/tmp/sepolia_rpc_url", "utf8")).trim();
    if (/^https?:\/\//i.test(value)) return value;
  } catch { /* use env */ }
  const value = (process.env.STARKNET_RPC_URL ?? "").trim();
  return /^https?:\/\//i.test(value) ? value : null;
}

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("binding_receipt_timeout")), RPC_TIMEOUT_MS); }),
  ]).finally(() => { if (timer) clearTimeout(timer); });
}

function normalizeHash(raw: string | null): string | null {
  const value = (raw ?? "").trim().toLowerCase();
  return /^0x[0-9a-f]{1,64}$/.test(value) ? `0x${value.slice(2).padStart(64, "0")}` : null;
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const txHash = normalizeHash(url.searchParams.get("txHash"));
  const prismId = url.searchParams.get("prismId") ?? "";
  const executionAccount = (url.searchParams.get("executionAccount") ?? "").toLowerCase();
  if (!txHash || !/^prism:[1-9][0-9]*$/.test(prismId) || !/^0x[0-9a-f]{1,64}$/.test(executionAccount)) {
    return Response.json({ ok: false, status: "failed", error: "malformed_binding_query" }, { status: 400 });
  }
  const nodeUrl = await getRpcUrl();
  if (!nodeUrl) return Response.json({ ok: false, status: "failed", error: "binding_receipt_unavailable" }, { status: 503 });
  try {
    const provider = new RpcProvider({ nodeUrl });
    const receipt = await withTimeout(provider.getTransactionReceipt(txHash));
    const finality = String((receipt as { finality_status?: unknown }).finality_status ?? "").toUpperCase();
    const execution = String((receipt as { execution_status?: unknown }).execution_status ?? "").toUpperCase();
    if (execution.includes("REVERT") || finality.includes("REJECT")) return Response.json({ ok: true, status: "failed", txHash });
    if (!finality.includes("ACCEPTED") && !execution.includes("SUCCEEDED")) return Response.json({ ok: true, status: "pending", txHash });
    const blockNumberRaw = (receipt as { block_number?: number }).block_number;
    if (typeof blockNumberRaw !== "number" || !Number.isSafeInteger(blockNumberRaw)) return Response.json({ ok: true, status: "pending", txHash });
    const blockNumber = blockNumberRaw;
    const indexer = new StarknetEventIndexerAdapter({ reader: provider as never, registryAddress: REGISTRY_V2, registryVersion: "v2", network: "SN_SEPOLIA" });
    const page = await withTimeout(indexer.fetchRegistryEvents({ fromBlock: blockNumber, toBlock: blockNumber }));
    const matches = page.events.filter((event) => event.txHash.toLowerCase() === txHash && event.kind === "ExecutionIdentityBound" && "prismId" in event.payload && event.payload.prismId === prismId && "executionAccount" in event.payload && event.payload.executionAccount.toLowerCase() === executionAccount);
    if (matches.length !== 1) return Response.json({ ok: true, status: matches.length > 1 ? "failed" : "pending", txHash, ...(matches.length > 1 ? { error: "ambiguous_receipt" } : {}) });
    let resolvedBinding = executionAccount;
    try {
      const factory = await getAppFactory();
      if (factory.resolveService) {
        const resolved = await factory.resolveService.resolve(prismId, "BASE", { allowStale: false });
        if (resolved.executionAccount?.toLowerCase() !== executionAccount) return Response.json({ ok: true, status: "failed", txHash, error: "binding_readback_mismatch" });
        resolvedBinding = resolved.executionAccount;
      }
    } catch {
      return Response.json({ ok: true, status: "pending", txHash });
    }
    return Response.json({ ok: true, status: "succeeded", txHash, resolvedBinding }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ ok: true, status: "pending", txHash }, { headers: { "cache-control": "no-store" } });
  }
}
