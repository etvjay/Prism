"use client";

import { useState } from "react";
import { STRK_SEPOLIA } from "./m5/constants";
import { useSession } from "../wallet/session/SessionProvider";
import styles from "./PrivacyInvokeTestPanel.module.css";

type Status = { tone: "blocked" | "ready" | "observed" | "error"; title: string; detail: string };

function safeFailure(error: unknown, stage: "fee observation" | "wallet submission"): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string" && /^STRK20[-_A-Z0-9]+$/.test(code)) return `Provider stopped during ${stage} at ${code}. No receipt is claimed.`;
  return `The wallet/provider stopped during ${stage}. No transaction hash or receipt is claimed.`;
}

export default function PrivateTransferTestPanel() {
  const { snapshot, getM5Provider } = useSession();
  const [amount, setAmount] = useState("0.000000000000000001");
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);

  const runTest = async () => {
    let value: bigint;
    try {
      if (!/^\d+(\.\d{1,18})?$/.test(amount) || Number(amount) <= 0) throw new Error("invalid_amount");
      const [whole, fraction = ""] = amount.split(".");
      value = BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, "0"));
      if (value <= 0n) throw new Error("invalid_amount");
    } catch {
      setStatus({ tone: "error", title: "Invalid amount", detail: "Enter a positive STRK amount with up to 18 decimal places." });
      return;
    }

    setRunning(true);
    let stage: "fee observation" | "wallet submission" = "fee observation";
    try {
      const provider = getM5Provider();
      if (!provider) throw new Error("wallet_provider_unavailable");
      const recipient = await provider.getAddress();
      await provider.getFeeAmount();
      stage = "wallet submission";
      const result = await provider.strk20InvokeTransaction([{
        type: "transfer",
        token: STRK_SEPOLIA,
        amount: `0x${value.toString(16)}`,
        recipient,
      }]);
      const txHash = result.transaction_hash;
      if (typeof txHash !== "string" || !/^0x[0-9a-fA-F]+$/.test(txHash)) throw new Error("malformed_transaction_hash");
      setStatus({ tone: "ready", title: "Submitted by Ready X", detail: `Transaction ${txHash.slice(0, 14)}… returned. Receipt readback is pending; no completion is claimed.` });
    } catch (error) {
      setStatus({ tone: "error", title: "Private transfer stopped", detail: safeFailure(error, stage) });
    } finally {
      setRunning(false);
    }
  };

  const connected = snapshot.session.accountAddress !== null;
  const onSepolia = snapshot.session.environment === "SN_SEPOLIA" || snapshot.session.network.chainId === "SN_SEPOLIA";

  return (
    <section aria-labelledby="private-transfer-test-title" className={styles.panel} data-testid="private-transfer-test">
      <div className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Core privacy / provider-injected</p>
          <h3 id="private-transfer-test-title">private_transfer · SN_SEPOLIA</h3>
        </div>
        <span className={styles.badge}>Self-transfer plumbing</span>
      </div>
      <p className={styles.intro}>
        Core STRK20 self-transfer test. This deliberately excludes Vesu, lending, and custom helper contracts. Ready X owns proving, notes, authorization, and submission.
      </p>
      <div className={styles.facts}>
        <span><b>Route</b> STRK20 transfer only</span>
        <span><b>Wallet</b> {connected ? "connected" : "not connected"}</span>
        <span><b>Network</b> {onSepolia ? "observed SN_SEPOLIA" : "not observed"}</span>
      </div>
      <label className={styles.amountLabel} htmlFor="private-transfer-amount">STRK amount</label>
      <div className={styles.controls}>
        <input id="private-transfer-amount" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} />
        <button disabled={running || !connected || !onSepolia} onClick={() => void runTest()} type="button">
          {running ? "Running private transfer…" : "Run self-transfer"}
        </button>
      </div>
      <p className={styles.hint}>Token {STRK_SEPOLIA.slice(0, 10)}… · recipient is the connected Ready X account · use only a minimal test amount.</p>
      {status ? <div aria-live="polite" className={`${styles.status} ${styles[`status--${status.tone}`]}`}><strong>{status.title}</strong><span>{status.detail}</span></div> : <p className={styles.empty}>No core private-transfer test has been run.</p>}
    </section>
  );
}
