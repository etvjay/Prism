export type DiscoveryCandidateStatus = "ACTIVE" | "SUSPENDED" | "UNKNOWN";
export interface DiscoveryCandidate { readonly prismId: string; readonly status: DiscoveryCandidateStatus; readonly watermark: number | null }
export type DiscoveryState = "NONE" | "FOUND" | "MULTIPLE" | "UNKNOWN" | "UNAVAILABLE";
export interface DiscoveryResult { readonly state: DiscoveryState; readonly candidates: readonly DiscoveryCandidate[]; readonly watermark: number | null; readonly source: string }
export interface ProjectionIdentity { readonly prismId: string; readonly controller: string }
export type CanonicalIdentityReader = (prismId: string) => Promise<{ controller: string; createdAtBlock: number; version: number } | null>;

export function normalizeControllerAddress(value: string): string {
  const normalized=value.trim().toLowerCase();
  if(!/^0x[0-9a-f]{1,64}$/.test(normalized)) throw new Error("controller_address_invalid");
  return normalized;
}

export async function discoverControllerIdentities(rows: readonly ProjectionIdentity[], controller: string, read: CanonicalIdentityReader, watermark: number | null): Promise<DiscoveryResult> {
  const normalized=normalizeControllerAddress(controller);
  const matched=rows.filter(row=>{try{return normalizeControllerAddress(row.controller)===normalized}catch{return false}});
  const candidates: DiscoveryCandidate[]=[];
  for(const row of matched){
    const canonical=await read(row.prismId);
    if(!canonical) continue;
    if(normalizeControllerAddress(canonical.controller)!==normalized) continue;
    candidates.push({prismId:row.prismId,status:"UNKNOWN",watermark});
  }
  const state: DiscoveryState=candidates.length===0?"NONE":candidates.length===1?"FOUND":"MULTIPLE";
  return {state,candidates,watermark,source:"scoped_public_event_projection+canonical_starknet_read"};
}
