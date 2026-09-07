/**
 * Read-only live-state surface (demo only, `?demo=livestate`).
 *
 * Reuses the privacy-flow wallet session machine:
 * connect -> capability detect -> session (sessionReducer +
 * StarknetWalletSessionAdapter over the mock provider). Once connected,
 * public chain state for the connected account + an explicitly selected Prism ID is read through
 * the typed `LiveStateReader` port (read-only; no broadcast, no signing,
 * no spending). The private-balance slot stays consent-gated per the
 * existing consent design: blocked/fallback copy until a real consent
 * grant, never retaining keys/notes/proofs.
 */

"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { createSessionReducerState, sessionReducer } from "../wallet/session/reducer";
import { selectSessionSnapshot } from "../wallet/session/selectors";
import {
  capabilitySummary,
  SESSION_STATE_GLYPHS,
  SESSION_STATE_LABELS,
  statusLine,
} from "../wallet/session/strings";
import {
  createStarknetWalletSession,
  denyConsent,
  requireConsent,
} from "../wallet/session/session-state";
import { StarknetWalletSessionAdapter } from "../wallet/session/starknet-wallet-adapter";
import { assertNoViewingKey } from "../prism-strk20/domain/privacy-guard";
import { isLiveStateDemoEnabled, selectedPrismIdFromSearch } from "./demoFlag";
import { buildConsentScope, decideConsent, type ConsentRecord, type ConsentScope } from "../privacy-flow/consent";
import { createStarknetWalletBoundary, createStarknetWalletDiscovery, type DiscoveredStarknetWallet } from "../wallet/session/starknet-wallet-provider";
import { createMockStarknetProvider, MOCK_SCENARIOS, MOCK_WALLET_LABELS, type MockWalletScenario } from "../privacy-flow/mockPrivacyWallet";
import {
  createBlockedLiveStateReader,
  type LiveStateReader,
} from "./liveStateAdapter";
import { createApiLiveStateReader } from "./apiLiveStateReader";
import { LIVE_STATE_FALLBACK_COPY, type LiveField, type LiveStateSnapshot } from "./liveStateTypes";
import styles from "./LiveStateTile.module.css";
import {
  BASE_SEPOLIA_CHAIN_ID,
  BaseWalletAdapter,
  createBaseWalletDiscovery,
  type BaseWalletDescriptor,
  type BaseWalletDiscovery,
  type OwnershipChallengeForSigning,
  type OwnershipProofMetadata,
} from "../wallet/base/base-wallet-adapter";

type BaseChallengeSummary = Omit<OwnershipChallengeForSigning, "messageToSign">;

function useDemoActive(): boolean {
  const [active, setActive] = useState(false);
  useEffect(() => {
    setActive(isLiveStateDemoEnabled(window.location.search));
  }, []);
  return active;
}

function useMockActive(): boolean {
  const [active, setActive] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setActive(params.get("demo") === "livestate-mock" || params.get("mock") === "livestate");
  }, []);
  return active;
}

function FieldCard({ field }: { field: LiveField }) {
  const tone = field.status === "live" ? "live" : "blocked";
  return (
    <div className={styles.field} data-testid={`live-field-${field.label}`}>
      <span className={styles.fieldLabel}>{field.label}</span>
      <span className={styles.badge} data-tone={tone}>
        {field.status === "live" ? "Live (read-only)" : field.status}
      </span>
      {field.status === "live" && field.value ? (
        <p className={styles.fieldValue}>{field.value}</p>
      ) : (
        <p className={styles.fieldFallback}>{field.fallback}</p>
      )}
    </div>
  );
}

export default function LiveStateTile({ reader }: { reader?: LiveStateReader }) {
  const [initial] = useState(() =>
    createSessionReducerState(
      createStarknetWalletSession({ now: Date.now(), expectedEnvironment: "SN_SEPOLIA" }),
    ),
  );
  const [state, dispatch] = useReducer(sessionReducer, initial);
  const [scenario, setScenario] = useState<MockWalletScenario>("supported-sepolia");
  const [wallets, setWallets] = useState<readonly DiscoveredStarknetWallet[]>([]);
  const [discoveryReady, setDiscoveryReady] = useState(false);
  const [activeWalletId, setActiveWalletId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [consentScope, setConsentScope] = useState<ConsentScope | null>(null);
  const [consentRecord, setConsentRecord] = useState<ConsentRecord | null>(null);
  const [selectedPrismId, setSelectedPrismId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<LiveStateSnapshot | null>(null);
  const [reading, setReading] = useState(false);
  const [identityStatus, setIdentityStatus] = useState<"idle" | "requested" | "pending" | "succeeded" | "failed">("idle");
  const [identityTxHash, setIdentityTxHash] = useState<string | null>(null);
  const [identityError, setIdentityError] = useState<string | null>(null);
  const activeBoundary = useRef<ReturnType<typeof createStarknetWalletBoundary> | null>(null);
  const [baseDiscovery, setBaseDiscovery] = useState<BaseWalletDiscovery | null>(null);
  const [baseWallets, setBaseWallets] = useState<readonly BaseWalletDescriptor[]>([]);
  const [baseAccount, setBaseAccount] = useState<string | null>(null);
  const [baseAdapter, setBaseAdapter] = useState<BaseWalletAdapter | null>(null);
  const [baseChallenge, setBaseChallenge] = useState<BaseChallengeSummary | null>(null);
  const baseChallengeRef = useRef<OwnershipChallengeForSigning | null>(null);
  const [baseProof, setBaseProof] = useState<OwnershipProofMetadata | null>(null);
  const [baseStatus, setBaseStatus] = useState<"idle" | "connecting" | "ready" | "signing" | "ready-to-submit" | "error">("idle");
  const [baseError, setBaseError] = useState<string | null>(null);
  const [bindingStatus, setBindingStatus] = useState<"idle" | "requested" | "pending" | "succeeded" | "failed">("idle");
  const [bindingTxHash, setBindingTxHash] = useState<string | null>(null);
  const [resolvedBinding, setResolvedBinding] = useState<string | null>(null);

  const sessionSnapshot = useMemo(() => selectSessionSnapshot(state), [state]);
  const { session, capabilities, state: uiState } = sessionSnapshot;
  const connected = session.accountAddress !== null;
  const consentGranted = session.consent.status === "granted";
  const discovery = useMemo(() => createStarknetWalletDiscovery(), []);
  const mockActive = useMockActive();

  useEffect(() => {
    setSelectedPrismId(selectedPrismIdFromSearch(window.location.search));
  }, []);

  useEffect(() => {
    if (!selectedPrismId) return;
    const next = createBaseWalletDiscovery(window);
    setBaseDiscovery(next);
    setBaseWallets(next.getWallets());
    next.refresh();
    return next.subscribe(setBaseWallets);
  }, [selectedPrismId]);

  useEffect(() => {
    if (mockActive) return;
    const sync = (next: readonly DiscoveredStarknetWallet[]) => {
      setWallets(next);
      setDiscoveryReady(true);
    };
    const unsubscribe = discovery.subscribe(sync);
    discovery.refresh();
    sync(discovery.getWallets());
    return unsubscribe;
  }, [discovery, mockActive]);
  const ready = uiState === "ready";
  const status = statusLine(uiState, {
    environment: session.environment,
    chainId: session.network.chainId,
    expectedEnvironment: session.expectedEnvironment,
    capabilitySummary: capabilitySummary(capabilities),
    blockNumber: null,
    reason: null,
  });

  // Read-only refresh through the typed port whenever session/consent changes.
  useEffect(() => {
    if (!connected || !ready) {
      setSnapshot(null);
      return;
    }
    setReading(true);
    // Default preview path reads real chain facts through the server-side
    // route (client never sees RPC URLs). Pass a mock/blocked reader
    // explicitly for deterministic tests or the all-blocked preview.
    const active: LiveStateReader = reader ?? createApiLiveStateReader({ prismId: selectedPrismId });
    void active
      .readLiveState({ accountAddress: session.accountAddress, consentGranted })
      .then(setSnapshot)
      .finally(() => setReading(false));
  }, [connected, ready, consentGranted, session.accountAddress, reader, selectedPrismId]);

  // Receipt/event observation is read-only and starts only after a wallet
  // submission has returned a transaction hash.
  useEffect(() => {
    if (!identityTxHash || mockActive) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch(`/api/v1/livestate/identity?txHash=${encodeURIComponent(identityTxHash)}`, { cache: "no-store" });
        const result = (await response.json()) as { ok?: boolean; status?: string; prismId?: string };
        if (cancelled) return;
        if (result.status === "failed") {
          setIdentityStatus("failed");
          setIdentityError("The wallet transaction failed. No Prism ID was selected.");
          return;
        }
        if (result.status === "succeeded" && result.prismId) {
          const prismId = result.prismId.replace(/^prism:/, "");
          setIdentityStatus("succeeded");
          setSelectedPrismId(prismId);
          const params = new URLSearchParams(window.location.search);
          params.set("prismId", prismId);
          window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
          return;
        }
        setIdentityStatus("pending");
      } catch {
        if (!cancelled) setIdentityError("Receipt status is temporarily unavailable; retrying.");
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 2_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [identityTxHash, mockActive]);

  useEffect(() => {
    if (!bindingTxHash || mockActive || !selectedPrismId || !baseAccount) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch(`/api/v1/livestate/binding?txHash=${encodeURIComponent(bindingTxHash)}&prismId=${encodeURIComponent(`prism:${selectedPrismId}`)}&executionAccount=${encodeURIComponent(baseAccount)}`, { cache: "no-store" });
        const result = (await response.json()) as { status?: "pending" | "succeeded" | "failed"; resolvedBinding?: string; error?: string };
        if (cancelled) return;
        if (result.status === "succeeded" && result.resolvedBinding) { setResolvedBinding(result.resolvedBinding); setBindingStatus("succeeded"); }
        else if (result.status === "failed") { setBindingStatus("failed"); setBaseError(result.error === "ambiguous_receipt" ? "Receipt was ambiguous. Binding remains unresolved." : "Binding failed or did not match the selected account."); }
        else setBindingStatus("pending");
      } catch { if (!cancelled) setBindingStatus("pending"); }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 2_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [bindingTxHash, mockActive, selectedPrismId, baseAccount]);

  const createPrismIdentity = () => {
    if (!connected || !ready || selectedPrismId || mockActive || !activeBoundary.current) return;
    setIdentityError(null);
    setIdentityStatus("requested");
    void activeBoundary.current.createPrismIdentity()
      .then(({ txHash }) => {
        setIdentityTxHash(txHash);
        setIdentityStatus("pending");
      })
      .catch(() => {
        setIdentityStatus("failed");
        setIdentityError("The wallet rejected or failed the create request. No Prism ID was selected.");
      });
  };

  const connectReal = (wallet: DiscoveredStarknetWallet) => {
    setBusy(true);
    setActiveWalletId(wallet.id);
    setConsentScope(null);
    setConsentRecord(null);
    setSnapshot(null);
    setIdentityStatus("idle");
    setIdentityTxHash(null);
    setIdentityError(null);
    dispatch({ type: "connection-started", walletId: wallet.id });
    const rpcUrl = (process.env.NEXT_PUBLIC_STARKNET_RPC_URL ?? "").trim() || null;
    const boundary = createStarknetWalletBoundary(wallet, rpcUrl, "SN_SEPOLIA");
    activeBoundary.current = boundary;
    const adapter = new StarknetWalletSessionAdapter(boundary.provider, { expectedEnvironment: "SN_SEPOLIA" });
    void adapter.connect(Date.now())
      .then((observed) => dispatch({ type: "session-observed", session: observed, walletId: wallet.id }))
      .catch(() => dispatch({ type: "notice", notice: "Wallet connection failed. Try again." }))
      .finally(() => setBusy(false));
  };

  const connectMock = (next: MockWalletScenario) => {
    setScenario(next);
    setBusy(true);
    setConsentScope(null);
    setConsentRecord(null);
    setSnapshot(null);
    dispatch({ type: "connection-started", walletId: `mock-${next}` });
    const adapter = new StarknetWalletSessionAdapter(createMockStarknetProvider(next), {
      expectedEnvironment: "SN_SEPOLIA",
    });
    void adapter
      .connect(Date.now())
      .then((observed) => {
        dispatch({ type: "session-observed", session: observed, walletId: `mock-${next}` });
      })
      .finally(() => setBusy(false));
  };

  const disconnect = () => {
    setConsentScope(null);
    setConsentRecord(null);
    setSnapshot(null);
    setBaseChallenge(null);
    baseChallengeRef.current = null;
    setBaseProof(null);
    setBindingStatus("idle");
    setBindingTxHash(null);
    setResolvedBinding(null);
    void activeBoundary.current?.provider.disconnect?.();
    activeBoundary.current = null;
    dispatch({
      type: "session-disconnected",
      session: createStarknetWalletSession({ now: Date.now(), expectedEnvironment: "SN_SEPOLIA" }),
    });
  };

  const openConsent = () => {
    if (!connected) return;
    assertNoViewingKey({ tokens: ["STRK"], intent: "private_balance" }, "livestate_consent_open");
    const scope = buildConsentScope({
      tokens: ["STRK"],
      sessionAddress: session.accountAddress,
      now: Date.now(),
    });
    setConsentScope(scope);
    dispatch({
      type: "session-observed",
      session: requireConsent(session, Date.now()),
      walletId: `mock-${scenario}`,
    });
  };

  const resolveConsent = (decision: "granted" | "denied") => {
    if (!consentScope) return;
    const { session: next, record } = decideConsent(session, consentScope, decision, Date.now());
    setConsentRecord(record);
    setConsentScope(decision === "granted" ? null : consentScope);
    if (decision === "denied") {
      dispatch({ type: "session-observed", session: denyConsent(next, Date.now()), walletId: `mock-${scenario}` });
      return;
    }
    dispatch({ type: "session-observed", session: next, walletId: `mock-${scenario}` });
  };

  const connectBase = async (walletId: string) => {
    if (!selectedPrismId || !baseDiscovery) return;
    const provider = baseDiscovery.getProvider(walletId);
    if (!provider) return;
    setBaseStatus("connecting");
    setBaseError(null);
    setBindingStatus("idle");
    setBindingTxHash(null);
    setResolvedBinding(null);
    try {
      const adapter = new BaseWalletAdapter(provider);
      const account = await adapter.connect();
      const readyBase = await adapter.assertReady(account);
      const response = await fetch("/api/v1/challenge/issue", {
        method: "POST",
        headers: { "content-type": "application/json", "x-request-id": `base-proof-${Date.now()}` },
        body: JSON.stringify({ prismId: `prism:${selectedPrismId}`, venue: "BASE", executionAccount: account }),
      });
      const payload = (await response.json()) as { ok?: boolean; data?: OwnershipChallengeForSigning; error?: { detail?: string } };
      if (!response.ok || !payload.ok || !payload.data) throw new Error(payload.error?.detail ?? "challenge_unavailable");
      if (readyBase.chainId !== BASE_SEPOLIA_CHAIN_ID) throw new Error("wrong_chain");
      setBaseAdapter(adapter);
      setBaseAccount(account);
      baseChallengeRef.current = payload.data;
      const { messageToSign: _transientMessage, ...summary } = payload.data;
      void _transientMessage;
      setBaseChallenge(summary);
      setBaseStatus("ready");
    } catch (cause) {
      setBaseStatus("error");
      setBaseError(cause instanceof Error ? cause.message : "base_wallet_connection_failed");
    }
  };

  const signBaseOwnershipProof = async () => {
    const challenge = baseChallengeRef.current;
    if (!baseAdapter || !challenge) return;
    setBaseStatus("signing");
    setBaseError(null);
    try {
      const metadata = await baseAdapter.signOwnershipProof(challenge, Math.floor(Date.now() / 1000));
      setBaseProof(metadata);
      setBaseStatus("ready-to-submit");
    } catch (cause) {
      setBaseStatus("error");
      setBaseError(cause instanceof Error ? cause.message : "base_signature_failed");
    }
  };

  const submitBaseBinding = async () => {
    if (!activeBoundary.current || !selectedPrismId || !baseAccount || !baseChallenge || !baseProof || bindingStatus !== "idle") return;
    if (baseProof.challengeId !== baseChallenge.challengeId || baseProof.account !== baseAccount || baseProof.chainId !== BASE_SEPOLIA_CHAIN_ID || baseProof.signatureClass !== "EOA" || Math.floor(Date.now() / 1000) >= baseProof.expiresAt) {
      setBindingStatus("failed");
      setBaseError("Binding blocked: expired, mismatched, or malformed proof.");
      return;
    }
    setBindingStatus("requested");
    setBaseError(null);
    try {
      const { txHash } = await activeBoundary.current.submitBaseBinding({ prismId: `prism:${selectedPrismId}`, executionAccount: baseAccount, proofDigest: baseProof.proofDigest, expiresAt: baseProof.expiresAt });
      setBindingTxHash(txHash);
      setBindingStatus("pending");
    } catch (cause) {
      setBindingStatus("failed");
      setBaseError(cause instanceof Error ? cause.message : "binding_submission_failed");
    }
  };

  const fields: readonly LiveField[] | null = snapshot
    ? [snapshot.prismOwner, snapshot.baseBinding, snapshot.strkBalance, snapshot.baseEth]
    : null;

  return (
    <section aria-labelledby="livestate-heading" className={styles.flow} data-testid="live-state-tile">
      <div className={styles.flowHead}>
        <p className={styles.eyebrow}>Live state · explicit wallet actions only</p>
        <h3 id="livestate-heading">Live chain state</h3>
        <p className={styles.lede}>
          Same session machine as the privacy flow (connect → capability detect → session).
          Public state reads through a typed adapter. Binding is never automatic: the connected Starknet wallet prompts only after you press Submit binding.
        </p>
      </div>

      <div className={styles.tile} data-tile="session">
        <p className={styles.tileEyebrow}>Session · connect → capability → session</p>
        <div className={styles.stateRow}>
          <strong>
            <span aria-hidden="true" className={styles.glyph}>{SESSION_STATE_GLYPHS[uiState]}</span>
            {SESSION_STATE_LABELS[uiState]}
          </strong>
          {session.accountAddress ? <code className={styles.mono}>{session.accountAddress.slice(0, 10)}…</code> : null}
        </div>
        <p aria-live="polite" className={styles.status}>{status}</p>
        <div className={styles.walletGrid} role="list">
          {mockActive ? MOCK_SCENARIOS.map((option) => (
            <button
              className={styles.walletOption}
              data-active={scenario === option && connected}
              disabled={busy}
              key={option}
              onClick={() => connectMock(option)}
              role="listitem"
              type="button"
            >
              {MOCK_WALLET_LABELS[option]} (mock)
            </button>
          )) : wallets.map((wallet) => (
            <button
              className={styles.walletOption}
              data-active={activeWalletId === wallet.id && connected}
              disabled={busy}
              key={wallet.id}
              onClick={() => connectReal(wallet)}
              role="listitem"
              type="button"
            >
              Connect {wallet.name}
            </button>
          ))}
        </div>
        {!mockActive && discoveryReady && wallets.length === 0 ? (
          <>
            <p className={styles.blocked} role="status">
              No Starknet wallet detected. Install Ready, Xverse, or AVNU, then retry discovery.
            </p>
            <div className={styles.ctaRow}>
              <button
                className={styles.primary}
                onClick={() => {
                  setDiscoveryReady(false);
                  discovery.refresh();
                  setWallets(discovery.getWallets());
                  setDiscoveryReady(true);
                }}
                type="button"
              >
                Connect wallet / retry
              </button>
            </div>
          </>
        ) : null}
        <div className={styles.ctaRow}>
          {connected ? (
            <button className={styles.ghost} onClick={disconnect} type="button">
              Disconnect
            </button>
          ) : null}
        </div>
      </div>

      <div className={styles.tile} data-tile="create-identity">
        <p className={styles.tileEyebrow}>Prism identity · explicit wallet action</p>
        {!connected || !ready ? (
          <p className={styles.blocked}>Connect a SN_SEPOLIA wallet to create your Prism ID.</p>
        ) : selectedPrismId ? (
          <p className={styles.blocked}>Selected Prism ID: <strong>prism:{selectedPrismId}</strong></p>
        ) : (
          <>
            <h4>Create your Prism ID</h4>
            <p className={styles.lede}>Your connected SN_SEPOLIA wallet will prompt you to authorize <code>create_identity</code>.</p>
            <button className={styles.primary} disabled={identityStatus === "requested" || identityStatus === "pending"} onClick={createPrismIdentity} type="button">
              {identityStatus === "requested" ? "Waiting for wallet…" : identityStatus === "pending" ? "Creating Prism ID…" : "Create your Prism ID"}
            </button>
            {identityTxHash ? <p className={styles.meta}>Transaction {identityTxHash} · status: {identityStatus}</p> : null}
            {identityStatus === "succeeded" ? <p className={styles.status}>PrismIdentityCreated observed. Your new Prism ID is now selected.</p> : null}
            {identityError ? <p className={styles.blocked} role="status">{identityError}</p> : null}
          </>
        )}
        <p className={styles.meta}>Next step: <strong>Connect Base wallet to prove control</strong>. No Base binding is performed here.</p>
      </div>

      {selectedPrismId ? (
        <div className={styles.tile} data-tile="base-ownership-proof">
          <p className={styles.tileEyebrow}>Base ownership proof · explicit binding</p>
          <h4>Prove control of the Base account</h4>
          {!baseAccount ? (
            <>
              <p className={styles.lede}>Connect Base wallet after selecting a user-owned Prism ID. Base Sepolia (chain 84532) is required.</p>
              <div className={styles.walletGrid} role="list">
                {baseWallets.map((wallet) => (
                  <button className={styles.walletOption} key={wallet.id} onClick={() => void connectBase(wallet.id)} disabled={baseStatus === "connecting"} type="button">
                    Connect Base wallet{wallet.name === "Browser wallet" ? "" : ` · ${wallet.name}`}
                  </button>
                ))}
              </div>
              {baseWallets.length === 0 ? <p className={styles.blocked}>No EIP-6963 or window.ethereum Base wallet detected.</p> : null}
            </>
          ) : baseChallenge ? (
            <>
              <p className={styles.meta}>Connected {baseAccount.slice(0, 10)}… · Base Sepolia chain {BASE_SEPOLIA_CHAIN_ID}</p>
              <div className={styles.interstitialCard}>
                <p><strong>Exact challenge summary</strong></p>
                <ul>
                  <li>Domain: {baseChallenge.domain}</li>
                  <li>Chain ID: {baseChallenge.chainId}</li>
                  <li>Prism ID: {baseChallenge.prismId}</li>
                  <li>Execution account: {baseChallenge.executionAccount}</li>
                  <li>Expires: {new Date(baseChallenge.expiresAt * 1000).toISOString()}</li>
                </ul>
              </div>
              <button className={styles.primary} disabled={baseStatus === "signing" || baseStatus === "ready-to-submit"} onClick={() => void signBaseOwnershipProof()} type="button">
                {baseStatus === "signing" ? "Waiting for wallet…" : "Sign ownership proof"}
              </button>
              {baseProof ? (
                <div className={styles.interstitialCard}>
                  <p><strong>Binding proof summary</strong></p>
                  <ul>
                    <li>Challenge: <code className={styles.mono}>{baseProof.challengeId}</code></li>
                    <li>Proof digest: <code className={styles.mono}>{baseProof.proofDigest}</code></li>
                    <li>Signer: <code className={styles.mono}>{baseProof.account}</code></li>
                    <li>Signature class: {baseProof.signatureClass} · expires {new Date(baseProof.expiresAt * 1000).toISOString()}</li>
                  </ul>
                  <p className={styles.meta}>The signature itself is held only inside the wallet boundary and is not stored or logged.</p>
                  <button className={styles.primary} disabled={bindingStatus !== "idle"} onClick={() => void submitBaseBinding()} type="button">
                    {bindingStatus === "requested" ? "Waiting for wallet…" : bindingStatus === "pending" ? "Binding pending…" : "Submit binding"}
                  </button>
                  {bindingTxHash ? <p className={styles.meta}>Binding transaction {bindingTxHash} · status: {bindingStatus}</p> : null}
                  {bindingStatus === "succeeded" && resolvedBinding ? <p className={styles.status}>Binding succeeded · resolved account {resolvedBinding}</p> : null}
                </div>
              ) : null}
            </>
          ) : null}
          {baseError ? <p className={styles.blocked} role="status">{baseError}</p> : null}
          {baseStatus === "ready-to-submit" && !baseProof ? <p className={styles.meta}>Proof is ready, but binding is blocked until the proof summary is available.</p> : null}
        </div>
      ) : null}

      <div className={styles.tile} data-tile="public-state">
        <p className={styles.tileEyebrow}>Public chain state · {selectedPrismId ? `prism:${selectedPrismId}` : "no Prism ID selected"} + connected account</p>
        {!connected || !ready ? (
          <p className={styles.blocked} role="status">{LIVE_STATE_FALLBACK_COPY["not-connected"]}</p>
        ) : reading && !snapshot ? (
          <p className={styles.blocked} role="status">{LIVE_STATE_FALLBACK_COPY.loading}</p>
        ) : fields ? (
          <div className={styles.fieldGrid}>
            {fields.map((field) => (
              <FieldCard field={field} key={field.label} />
            ))}
          </div>
        ) : null}
        <p className={styles.meta}>
          Registry V2 0x06f77b…530d · {selectedPrismId ? `selected Prism ID prism:${selectedPrismId}` : "No Prism ID selected; no linked identity is read."}. A Base binding is shown only when the connected wallet owns the selected Prism ID (EVD-PRISM-005/006).
          Reads are read-only; blocked states render fallback copy and claim no value.
        </p>
      </div>

      <div className={styles.tile} data-tile="private-balance">
        <p className={styles.tileEyebrow}>Private balance · consent-gated</p>
        {!connected ? (
          <p className={styles.blocked} role="status">{LIVE_STATE_FALLBACK_COPY["not-connected"]}</p>
        ) : !consentGranted ? (
          <>
            <p className={styles.blocked} role="status">{LIVE_STATE_FALLBACK_COPY["consent-required"]}</p>
            <div className={styles.ctaRow}>
              <button className={styles.primary} onClick={openConsent} type="button">
                Review &amp; sign consent
              </button>
            </div>
          </>
        ) : snapshot?.privateBalance.status === "live" && snapshot.privateBalance.value ? (
          <p className={styles.fieldValue}>{snapshot.privateBalance.value}</p>
        ) : (
          <p className={styles.blocked} role="status">{LIVE_STATE_FALLBACK_COPY.blocked}</p>
        )}
        {consentRecord ? (
          <p className={styles.meta}>
            Consent {consentRecord.decision} · {consentRecord.consentReference} · no key, note, or proof retained.
          </p>
        ) : null}
      </div>

      {consentScope ? (
        <div className={styles.interstitial} role="dialog" aria-modal="true" aria-labelledby="livestate-consent-title">
          <div className={styles.interstitialCard}>
            <p className={styles.eyebrow}>Consent required</p>
            <h4 id="livestate-consent-title">Reveal private balance?</h4>
            <p>Allow this session to reveal the shielded balance preview for:</p>
            <ul>
              <li>Tokens: {consentScope.tokens.join(", ")}</li>
              <li>Session: {consentScope.sessionAddress ?? "none"}</li>
              <li>Requested: {new Date(consentScope.requestedAt).toISOString()}</li>
            </ul>
            <p className={styles.meta}>No key, note, or proof is stored. Denial keeps the slot blocked.</p>
            <div className={styles.ctaRow}>
              <button className={styles.primary} onClick={() => resolveConsent("granted")} type="button">Grant</button>
              <button className={styles.ghost} onClick={() => resolveConsent("denied")} type="button">Deny</button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

/** Gated slot: renders nothing unless `?demo=livestate` (aliases: live-state, live). */
export function LiveStateDemoSlot({ reader }: { reader?: LiveStateReader }) {
  const active = useDemoActive();
  if (!active) return null;
  // Default preview path reads real chain facts through the server-side
  // route; pass `createBlockedLiveStateReader()` (or the mock reader) to
  // preview the all-blocked fallback copy or deterministic fixtures.
  void createBlockedLiveStateReader;
  return <LiveStateTile reader={reader} />;
}
