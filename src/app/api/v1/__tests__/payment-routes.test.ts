import { describe, expect, it, beforeEach } from 'vitest';
import { POST as createPayment } from '../payments/requests/route';
import { GET as getPayment } from '../payments/requests/[requestId]/route';
import { resetPaymentHttpRuntime } from '@/features/prism-payments/application/http-runtime';
const hash=`0x${'a'.repeat(64)}`;
describe('request payment mounted route',()=>{beforeEach(()=>resetPaymentHttpRuntime());it('returns stable JSON and redacts private fields',async()=>{const r=await createPayment(new Request('http://x/v1/payments/requests',{method:'POST',headers:{'content-type':'application/json','Idempotency-Key':'k1','X-Request-Id':'r1'},body:JSON.stringify({requestId:'req1',requesterRef:'requester',recipient:{kind:'claim_token',commitment:hash},asset:'native',amount:'10',chainId:84532,expiresAt:200,now:100,memo:'secret'})}));expect(r.status).toBe(201);const j=await r.json();expect(j.ok).toBe(true);expect(j.data.amount).toBe('10');expect(JSON.stringify(j)).not.toContain('secret');const g=await getPayment(new Request('http://x'),{params:Promise.resolve({requestId:'req1'})});expect(g.status).toBe(200);});});
