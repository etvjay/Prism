import { Pool } from "pg";
import { InMemoryClaimNullifierStore, InMemoryClaimableGiftStore, InMemoryPaymentRequestStore } from "../adapters/memory-payment-claim-store";
import { PostgresClaimNullifierStore, PostgresClaimableGiftStore, PostgresPaymentRequestStore, PAYMENT_CLAIM_MIGRATION_SQL } from "../adapters/postgres-payment-claim-store";
import { ClaimableGiftService } from "./claimable-gift-service";
import { RequestPaymentService } from "./request-payment-service";
import type { ClaimableGiftStore, ClaimNullifierStore, PublicBaseSepoliaEscrowPort, ClaimProofVerifier, PaymentRequestStore } from "../domain/ports";

export interface PaymentHttpRuntime { payments: RequestPaymentService; gifts: ClaimableGiftService; }
const unavailable: PublicBaseSepoliaEscrowPort = { chainId: 84532, async createEscrow(){ throw new Error("escrow_unavailable"); }, async claimEscrow(){ throw new Error("escrow_unavailable"); }, async refundEscrow(){ throw new Error("escrow_unavailable"); }, async observeFunding(){ return null; } };
const verifier: ClaimProofVerifier = { async verify(){ return { valid:false, reason:"claim_proof_verifier_unavailable" }; } };
let runtime: PaymentHttpRuntime | null = null;
export async function getPaymentHttpRuntime(): Promise<PaymentHttpRuntime> {
 if(runtime) return runtime;
 let ps:PaymentRequestStore, gs:ClaimableGiftStore, ns:ClaimNullifierStore;
 const url=(process.env.PRISM_POSTGRES_TEST_URL??process.env.PRISM_POSTGRES_URL??"").trim();
 if(url){ const pool=new Pool({connectionString:url}); await pool.query(PAYMENT_CLAIM_MIGRATION_SQL); ps=new PostgresPaymentRequestStore(pool); gs=new PostgresClaimableGiftStore(pool); ns=new PostgresClaimNullifierStore(pool); }
 else { ps=new InMemoryPaymentRequestStore(); gs=new InMemoryClaimableGiftStore(); ns=new InMemoryClaimNullifierStore(); }
 runtime={payments:new RequestPaymentService({store:ps}), gifts:new ClaimableGiftService({store:gs,nullifierStore:ns,escrow:unavailable,claimProofVerifier:verifier})}; return runtime;
}
export function resetPaymentHttpRuntime(){ runtime=null; }
