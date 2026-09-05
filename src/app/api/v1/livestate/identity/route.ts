import { promises as fs } from "node:fs";
import { RpcProvider } from "starknet";
import { StarknetEventIndexerAdapter } from "@/features/prism-operations/adapters/starknet-event-indexer";
import { LIVE_STATE_IDS } from "@/features/live-state/liveStateTypes";

const REGISTRY_V2 = LIVE_STATE_IDS.registryV2;
const RPC_TIMEOUT_MS = 10_000;

async function rpcUrl(): Promise<string | null> {
  try {
    const value = (await fs.readFile("/tmp/sepolia_rpc_url", "utf8")).trim();
    if (/^https?:\/\//i.test(value)) return value;
  } catch { /* use env fallback */ }
  const value = (process.env.STARKNET_RPC_URL ?? "").trim();
  return /^https?:\/\//i.test(value) ? value : null;
}

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("identity_receipt_timeout")), RPC_TIMEOUT_MS); }),
  ]).finally(() => { if (timer) clearTimeout(timer); });
}

function txHash(raw: string | null): string | null {
  const value = (raw ?? "").trim().toLowerCase();
  return /^0x[0-9a-f]{1,64}$/.test(value) ? `0x${value.slice(2).padStart(64, "0")}` : null;
}

export async function GET(req: Request): Promise<Response> {
  const hash = txHash(new URL(req.url).searchParams.get("txHash"));
  if (!hash) return Response.json({ ok: false, error: "malformed_tx_hash" }, { status: 400 });
  const nodeUrl = await rpcUrl();
  if (!nodeUrl) return Response.json({ ok: false, status: "failed", error: "identity_receipt_unavailable" }, { status: 503 });

  try {
    const provider = new RpcProvider({ nodeUrl });
    const receipt = await withTimeout(provider.getTransactionReceipt(hash));
    const status = String((receipt as { finality_status?: unknown; execution_status?: unknown }).finality_status ?? "").toUpperCase();
    const execution = String((receipt as { execution_status?: unknown }).execution_status ?? "").toUpperCase();
    if (execution.includes("REVERT") || status.includes("REJECT")) {
      return Response.json({ ok: true, status: "failed", txHash: hash }, { headers: { "cache-control": "no-store" } });
    }
    if (!status.includes("ACCEPTED") && !execution.includes("SUCCEEDED")) {
      return Response.json({ ok: true, status: "pending", txHash: hash }, { headers: { "cache-control": "no-store" } });
    }

    const blockNumber = (receipt as { block_number?: number }).block_number;
    if (!Number.isSafeInteger(blockNumber)) return Response.json({ ok: true, status: "pending", txHash: hash });
    const confirmedBlock = blockNumber as number;
    const indexer = new StarknetEventIndexerAdapter({
      reader: provider as unknown as ConstructorParameters<typeof StarknetEventIndexerAdapter>[0]["reader"],
      registryAddress: REGISTRY_V2,
      registryVersion: "v2",
      network: "SN_SEPOLIA",
    });
    const page = await withTimeout(indexer.fetchRegistryEvents({ fromBlock: confirmedBlock, toBlock: confirmedBlock }));
    const created = page.events.find((event) => event.txHash.toLowerCase() === hash && event.kind === "PrismIdentityCreated");
    if (!created || !("prismId" in created.payload)) {
      return Response.json({ ok: true, status: "pending", txHash: hash }, { headers: { "cache-control": "no-store" } });
    }
    return Response.json({ ok: true, status: "succeeded", txHash: hash, prismId: created.payload.prismId }, { headers: { "cache-control": "no-store" } });
  } catch {
    // A just-submitted transaction may not be visible to the RPC yet.
    return Response.json({ ok: true, status: "pending", txHash: hash }, { headers: { "cache-control": "no-store" } });
  }
}

