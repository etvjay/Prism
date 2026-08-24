# BACKEND_POST_CONVERGENCE_REDTEAM_FINAL — HEAD 19bce24

**Scope:** Review-only re-red-team of the factory-repair diff (`e022477..19bce24`, "fix(m2-runtime): clear factory reader indexer and submit wiring") against the prior red-team at `BACKEND_POST_CONVERGENCE_REDTEAM.md` (written at `e022477`). No source edit, no commit/push/deploy/broadcast. No frontend / M8+ / M9 / secrets / `strk20.json` touched. Muse Spark free lane honored; no ChatGPT/Codex.

**Method:** Read prior red-team doc from `e022477`; inspected full repair diff (`factory.ts` +119/−, `starknet-registry-reader.ts` rewritten to wrapper, new `factory-wiring-fix.test.ts` 286 lines); read M1/M2/M3/M4/M5/M7 closeout docs' evidence-ceiling statements. Executed read-only: targeted test + typecheck only (per instruction, no full build/test).

**Verification ran at HEAD 19bce24 (read-only):**
```
npm test -- src/application/__tests__/factory-wiring-fix.test.ts
  → Test Files 1 passed (1), Tests 16 passed (16), 913ms
npm run typecheck          → tsc --noEmit PASS, 0 errors
git status                 → clean except untracked BACKEND_POST_CONVERGENCE_REDTEAM.md (prior doc)
```

---

## 1. Confirmation of required items

### 1.1 Factory shared read provider actually reaches event indexer getEvents — CONFIRMED
- `factory.ts createStarknetReadPorts` no longer builds the throwing `indexer_getEvents_requires_explicit_reader_injection` shim. It creates one provider (`overrides.starknetReadProvider ?? new RpcProvider({nodeUrl})`) and passes **the same instance** to `StarknetRegistryReader`, `StarknetLedgerStatusAdapter`, and `StarknetEventIndexerAdapter({ reader: provider })`.
- Fail-closed wiring validation added: missing `callContract`/`call` → throws `starknet_reader_missing_callContract`; missing `getEvents` → `starknet_indexer_requires_getEvents`; indexer init failure → `starknet_indexer_init_failed`. No silent shim.
- Proven by tests: `createStarknetReadPorts with shared fake provider proves fetchAllRegistryEvents reaches injected getEvents` (spy counts `getEventsCalls > 0`, watermark 7, pagesFetched 1) and the factory-level variant (`factory.eventIndexerAdapter.fetchRegistryEvents` + `observeIndexer` both hit injected `getEvents`). Both green.
- Residual honesty note: this is still X2 via an *injected fake* provider. The real-RPC path uses `RpcProvider` cast through `as unknown as` and is not exercised against a live node here — correctly still inside the open runtime gate, not claimed otherwise.

### 1.2 Wrapper reader delegates to strict canonical reader — CONFIRMED
- `src/application/adapters/starknet-registry-reader.ts` is now a thin delegating wrapper over `StarknetRegistryReadAdapter` (canonical M1 adapter). All four port methods (`getIdentity/resolve/getBinding/isDigestConsumed`) are one-line `this.delegate.…` calls. All parsing/normalization (Option vs bare-struct, controller validation, felt conversion, ERR-002/023/021) lives solely in the canonical adapter — the divergent duplicate parsing (silent-null malformed prismId, unvalidated `res[1]` controller, local `toBaseFelt`) is deleted.
- Error compatibility preserved: `export { StarknetRegistryReadError as StarknetRegistryReaderError }` so legacy catch sites see identical codes.
- Proven by tests: malformed `prism:001`/`prism:P1` throw `ERR-002` identically on both paths; overflow beyond `FELT_PRIME` throws `ERR-023` on both; malformed controller hex throws `ERR-002` on both; bare-struct Some returns identical controller/block; factory `registryReadPort` (the real configured path) throws `ERR-002`, never silent null. Dual-reader drift HIGH from the prior red-team is resolved.

### 1.3 submitPort mode explicit TEST_DOUBLE_X2 unless injected — CONFIRMED
- `AppFactory` gains `submitPortMode: "TEST_DOUBLE_X2" | "STARKNET_INJECTED"` and `isStarknetSubmitConfigured` (true only when a submit port was explicitly injected; never derived from env). Default in both memory and Postgres paths is `overrides?.submitPort ?? registry` → mode `TEST_DOUBLE_X2`.
- Secret hygiene proven by tests: even with `STARKNET_PRIVATE_KEY=0xdead` set in env, factory does NOT consume it — `submitPort.constructor.name === "InMemoryRegistry"`, mode stays `TEST_DOUBLE_X2`, `isStarknetSubmitConfigured false`. A console-log-capture test proves no env/RPC values are logged during construction. Injected `StarknetSubmitAdapter` yields `STARKNET_INJECTED` and works end-to-end via a fake account.
- Minor observation (LOW): the `void "submit_unconfigured…"` statement in `createMemoryFactory` is a no-op string expression — it documents intent but has zero runtime effect. The explicit mode fields are the actual signal; consider replacing with a comment or a real warning hook later. Not a defect.

### 1.4 Authority / replay / submitted-completed / privacy overclaims — NONE FOUND
- No authority drift: readers remain call-only (`callContract/call/getEvents/getTransactionStatus/getTransactionReceipt/getBlockNumber`); no `execute` in any read path. Submit remains test-double by default; live submission requires explicit injection, never env-secret pickup.
- Replay posture unchanged: `isDigestConsumed` now delegates to the canonical adapter's conservative `false` (chain-authoritative per DEC-PRISM-SYS-001 Option A) — same semantics as before, documented as best-effort pre-check in the M3 digest review. No replay-proof claim is made anywhere in the touched code.
- Submitted ≠ completed untouched by this diff; no operation transition, worker, or pause logic modified in `e022477..19bce24`.
- Privacy surfaces untouched: no viewing-key code, no `strk20Balances` detection, no strk20.json write path in the diff.

### 1.5 M1/M2/M3/M4/M5/M7 evidence ceilings remain X2 / open runtime as stated — CONFIRMED
Cross-checked each closeout doc's verdict lines against the repair diff:
| Lane | Doc ceiling | Still honest after 19bce24? |
|---|---|---|
| M1 | `M1_INDEXER_WATERMARK_RUNTIME_READY_X2`, live blocked by RPC evidence | Yes — shared-provider fix improves factory wiring but adds no independent/live read; X3 gate unchanged |
| M2 | `M2_BLOCKED_BY_RUNTIME_ENVIRONMENT`, X2 wired | Yes — the two factory HIGHs from the prior red-team are now repaired, which *strengthens* the X2 claim without inflating it; live Postgres + real RPC gates unchanged |
| M3 | `M3_BASE_SEQUENCE_RUNNER_READY_X2`, `M3_BLOCKED_BY_SIGNING_ENVIRONMENT` | Untouched by repair diff; unchanged |
| M4 | X2 wallet action port, live blocked | Untouched; unchanged |
| M5 | `M5_E2E_RUNNER_READY_X2` / `M5_BLOCKED_BY_ENVIRONMENT_EVIDENCE` | Untouched; unchanged |
| M7 | `M7_P0_P7_RUNTIME_READY_X2`, P0 `M7_BLOCKED_BY_OWNER_DECISIONS`, M8/P8 open | Untouched; unchanged |

No doc in the repair diff promotes any lane above its stated ceiling. The prior red-team's three HIGHs map 1:1 to this repair commit's own test file header and are each verifiably addressed.

---

## 2. Ranked findings

**CRITICAL — 0.**

**HIGH — 0.** All three HIGHs from the e022477 red-team (indexer dead shim, dual-reader drift, implicit submit-port ambiguity) are repaired and covered by 16 passing dedicated tests.

**MEDIUM — 0 blocking; 1 advisory:**
1. (Advisory, not a defect) The shared-provider real-RPC path (`new RpcProvider(...)` casts) is exercised only via injected fakes at this HEAD. This is exactly what the open runtime gates already state; nothing should be promoted to X3 until a live `STARKNET_RPC_URL` trace exists. Keep the existing `M2_BLOCKED_BY_RUNTIME_ENVIRONMENT` framing.

**LOW — 2:**
1. `void "submit_unconfigured…"` in `factory.ts` is a decorative no-op; the real signal is `submitPortMode`/`isStarknetSubmitConfigured`. Cosmetic cleanup candidate only.
2. Wrapper constructor duplicates registry-address/rpc-url regex validation before delegating (canonical adapter validates again internally). Benign redundancy; keeps legacy error timing stable.

---

## 3. Verdict

```text
BACKEND_CONVERGENCE_CLEAR_WITH_OPEN_RUNTIME_GATES
```

The factory repair at `19bce24` resolves all three HIGH defects recorded at `e022477`: the event indexer provably reaches a real (or injected) `getEvents` through one shared fail-closed provider, the legacy reader is now a strict delegating wrapper over the canonical adapter with identical error codes, and submit-port semantics are explicit (`TEST_DOUBLE_X2` default, injection-only live, never env-secret driven). Targeted test suite 16/16 green, typecheck clean, working tree clean apart from the prior review doc. Authority, replay, submitted≠completed, and privacy postures are unchanged and free of overclaims. Every lane's evidence ceiling remains honestly X2 with live/runtime gates explicitly open (M1 live RPC, M2 runtime environment, M3 signing environment, M4 wallet/prover, M5 environment evidence, M7 owner decisions + M8/P8).
