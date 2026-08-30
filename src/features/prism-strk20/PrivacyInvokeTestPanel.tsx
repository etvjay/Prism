"use client";

import { useEffect, useState } from "react";
import { M5VesuRunner } from "./m5/runner";
import { loadM5Operation } from "./m5/operation";
import { M5_BLOCKED_BY_ENVIRONMENT_EVIDENCE } from "./m5/errors";
import { STRK_SEPOLIA, VTOKEN_STRK_SEPOLIA, HELPER_ADDRESS_SEPOLIA, PRIVACY_POOL_SEPOLIA } from "./m5/constants";
import { useSession } from "../wallet/session/SessionProvider";
import styles from "./PrivacyInvokeTestPanel.module.css";

type Status = { tone: "blocked" | "ready" | "observed" | "error"; title: string; detail: string };

export function privacyInvokeStatus(result: unknown): Status {
  if (!result || typeof result !== "object") {
    return { tone: "error", title: "Runner error", detail: "No runner result was returned." };
  }
  const value = result as {
    verdict?: string;
    reason?: string;
    detail?: string;
    predicates?: { receiptObserved?: boolean };
  };
  if (value.verdict === M5_BLOCKED_BY_ENVIRONMENT_EVIDENCE) {
    return {
      tone: "blocked",
      title: value.reason === "NO_WALLET" ? "Blocked: no WalletAccountV6 provider" : "Blocked: environment evidence unavailable",
      detail: value.detail ?? "The provider-injected runner did not receive the required wallet/prover surface.",
    };
  }
  if (value.verdict === "M5_E2E_SUCCESS_X3" && value.predicates?.receiptObserved) {
    return { tone: "observed", title: "Observed: M5 X3 result", detail: "The runner reports a terminal receipt and its configured evidence predicates. Review the receipt evidence before using it elsewhere." };
  }
  return { tone: "ready", title: "Runner ready, live closure not observed", detail: "The runner returned without an independently observed terminal receipt." };
}

export default function PrivacyInvokeTestPanel() {
  const { snapshot, getM5Provider } = useSession();
  const [amount, setAmount] = useState("1");
  const [running, setRunning] = useState(false);
  const [submissionFenced, setSubmissionFenced] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    const operation = loadM5Operation("privacy-invoke-ui-test");
    setSubmissionFenced(Boolean(operation?.submissionAttempted && !operation.txHash));
  }, []);

  const runTest = async () => {
    let inAmount: bigint;
    try {
      if (!/^\d+(\.\d{1,18})?$/.test(amount) || Number(amount) <= 0) throw new Error("invalid_amount");
      const [whole, fraction = ""] = amount.split(".");
      inAmount = BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, "0"));
    } catch {
      setStatus({ tone: "error", title: "Invalid amount", detail: "Enter a positive STRK amount with up to 18 decimal places." });
      return;
    }

    const persisted = loadM5Operation("privacy-invoke-ui-test");
    if (persisted?.submissionAttempted && !persisted.txHash) {
      setSubmissionFenced(true);
      setStatus({ tone: "error", title: "Submission fence active", detail: "A prior wallet submission timed out ambiguously. Retry is disabled; reconcile the transaction before submitting again." });
      return;
    }

    setRunning(true);
    try {
      const provider = getM5Provider();
      const result = await new M5VesuRunner({ inAmount, operationId: "privacy-invoke-ui-test" }).run(provider);
      setStatus(privacyInvokeStatus(result));
    } catch {
      const persisted = loadM5Operation("privacy-invoke-ui-test");
      const fenced = Boolean(persisted?.submissionAttempted && !persisted.txHash);
      setSubmissionFenced(fenced);
      setStatus(fenced
        ? { tone: "error", title: "Submission fence active", detail: "The wallet response was ambiguous. Retry is disabled until the transaction is reconciled." }
        : { tone: "error", title: "Runner stopped", detail: "The provider rejected or could not complete the bounded test. No receipt is claimed by this UI." });
    } finally {
      setRunning(false);
    }
  };

  const connected = snapshot.session.accountAddress !== null;
  const onSepolia = snapshot.session.environment === "SN_SEPOLIA" || snapshot.session.network.chainId === "SN_SEPOLIA";

  return (
    <section aria-labelledby="privacy-invoke-test-title" className={styles.panel} data-testid="privacy-invoke-test">
      <div className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Test surface / provider-injected</p>
          <h3 id="privacy-invoke-test-title">privacy_invoke · SN_SEPOLIA</h3>
        </div>
        <span className={styles.badge}>No live success implied</span>
      </div>
      <p className={styles.intro}>
        Bounded M5 harness for the canonical STRK → Vesu vToken helper route. WalletAccountV6 owns proving, notes, and authorization. This panel never invents balances, notes, receipts, or maturity.
      </p>
      <div className={styles.facts}>
        <span><b>Route</b> SN_SEPOLIA only</span>
        <span><b>Wallet</b> {connected ? "connected" : "not connected"}</span>
        <span><b>Network</b> {onSepolia ? "observed SN_SEPOLIA" : "not observed"}</span>
      </div>
      <label className={styles.amountLabel} htmlFor="privacy-invoke-amount">STRK amount</label>
      <div className={styles.controls}>
        <input id="privacy-invoke-amount" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} />
        <button disabled={running || submissionFenced || !connected || !onSepolia} onClick={() => void runTest()} type="button">
          {running ? "Running bounded test…" : "Run provider test"}
        </button>
      </div>
      <p className={styles.hint}>Configured public route: helper {HELPER_ADDRESS_SEPOLIA.slice(0, 10)}… · pool {PRIVACY_POOL_SEPOLIA.slice(0, 10)}… · out token {VTOKEN_STRK_SEPOLIA.slice(0, 10)}… · in token {STRK_SEPOLIA.slice(0, 10)}…</p>
      {status ? <div aria-live="polite" className={`${styles.status} ${styles[`status--${status.tone}`]}`}><strong>{status.title}</strong><span>{status.detail}</span></div> : <p className={styles.empty}>No test has been run. A disabled button means the required wallet/network facts are not observed.</p>}
    </section>
  );
}
