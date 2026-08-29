# DECISION PACKET — chainId-v2 challenge hardening (SD-008 / e8886af)

- **Prepared by:** lane C (contract/security red team, ox-alpha), 2026-08-23
- **Worktree:** `backend-0x-closeout` @ baseline `b9018ab` (V8.3 canonical binding slice)
- **Status of the underlying question: UNRESOLVED — owner decision required.** This packet does NOT accept, reject, or canonicalize anything. It exists because no owner decision record for e8886af exists anywhere in-repo, and the instruction set forbids silently canonicalizing it.
- **Evidence level of everything cited here: X2 (local only).** No deployment or runtime evidence is claimed.

---

## 1. The decision being requested

Dispose of commit `e8886af0d9a…` ("security(prism-8): bind ownership challenges to chain id", branch `agent/prism-8-chainid-hardening`, parent `9a5c14e`, not merged):

```text
OPTION 1 — ACCEPT: merge e8886af onto the backend line + land its EXTEND-class
           spec companion (amend SD-005 envelope {domain, venue,
           execution_account, prism_id, nonce, expiry} → add chain_id as first
           ordered field; amend INV-SYS-011 tamper-evidence list md+yaml;
           bump OBJ-PRISM-005 persisted_fields; CHALLENGE_SCHEMA_VERSION 2).
OPTION 2 — REJECT/SUPERSEDE: record the rejection append-only in DECISIONS.md;
           WP-1 collapses to a spec-note documenting the accepted residual risk.
NO DEFAULT — deferral is itself a recorded decision with a named risk window.
```

## 2. Security assessment (red-team position)

**Recommendation: ACCEPT as a pre-deployment security gate (G2/G3 prerequisite).**

Without chainId binding, a proof signed over a challenge minted against Base
Sepolia can be presented at an SN_MAIN-era bind targeting Base mainnet: every
other challenge field (venue=BASE, account, prism_id, nonce, expiry) is
network-invariant, so nothing else in the digest distinguishes the networks.
The registry's onchain defenses (controller signature, digest single-use)
cannot see this replay — the digest would be fresh onchain. The backend is the
trusted verifier under DEC-PRISM-SYS-001 Option A, which makes the offchain
challenge envelope the ONLY place this class of cross-network replay can be
closed. Concretely:

| Attack | Without chainId | With e8886af |
|---|---|---|
| Testnet-signed proof replayed at mainnet bind | digest passes; bind succeeds if controller cooperates or is phished into signing the bind tx | ERR-003/ERR-012 — digest/message differ per chain |
| Same-network nonce reuse | blocked by INV-SYS-010 CAS + ERR-006 | unchanged |
| Onchain digest replay | blocked by ERR-007 single-use map | unchanged |

Mitigating factor honestly stated: exploitation requires either a hostile/
compromised backend or a controller signing a bind tx for a proof minted on
another network. The threat is real but second-order TODAY because nothing is
deployed and there is exactly one environment. It becomes FIRST-ORDER the
moment V7.5/V8.5 testnet deployments exist while mainnet evidence (V8.6/G0) is
on the roadmap — which is the sprint plan. Hence: gate it before ANY deploy.

## 3. Compatibility facts (verified from readiness packet §2, re-checked)

- Schema v1 challenges become unverifiable under v2 logic by construction.
  Acceptable now: the only store is the in-memory reference adapter, nothing
  deployed/persisted. Any future pre-v2 persisted rows must be invalidated at
  migration, never silently reinterpreted.
- All signing fixtures regenerate; wallets sign different message bytes
  (new `Chain ID:` line).
- New mandatory config `policy.defaultChainId` per environment — BLOCKED on the
  separate §7.2 target-network declaration (also unresolved, owner: Jason).
- API surface change is additive (`chainId` on issued-challenge views;
  `altered_fields:chain_id` error detail).
- e8886af was verified green at X2 in isolation: vitest 46/46.

## 4. What acceptance requires (companion work, bounded)

1. EXTEND-class spec amendment: SD-005, INV-SYS-011 (md+yaml),
   OBJ-PRISM-005 persisted_fields, schema-v2 note. No protected decision
   (DEC-PRISM-001..018, DEC-PRISM-SYS-001) is touched — this is additive
   tamper-evidence surface, consistent with INV-SYS-011's existing intent.
2. Merge e8886af; regenerate fixtures; hold the 46-test green baseline.
3. Record target networks per environment (§7.2) — hard prerequisite for
   wiring `defaultChainId`; without it acceptance cannot be operationalized.
4. Add TEST-8-2-x cross-network fixture rows (sign-over-chain-A /
   verify-against-chain-B → ERR-003/ERR-012).

## 5. What rejection requires

An append-only DECISIONS.md record naming the residual risk owner and the
revisit trigger (first multi-environment deployment plan). The red-team report
(RT-06) then records the open cross-network replay window explicitly.

## 6. Decision record template (for Jason)

```yaml
decision_id: DEC-PRISM-SYS-003        # next free System-layer id
layer: System/Security
status: <ACCEPTED | REJECTED>
subject: e8886af chainId-v2 challenge hardening (SD-008)
selected_option: <1 | 2>
decided_by: Jason
decided_at: <date>
companion_work: <§4 list if accepted / §5 note if rejected>
```

No artifact in this worktree fills this in. Until a record with this shape (or
equivalent) exists in DECISIONS.md, SD-008 stays an explicit open
pre-deployment gate in SYSTEM_CANONICAL and the readiness packet.
