"use client";

import Link from "next/link";
import Image from "next/image";
import { FormEvent, useMemo, useState } from "react";

type CheckerStatus = "GTD" | "FCFS" | "NOT_ELIGIBLE";
type CheckerResult = {
  eligible: boolean;
  status: CheckerStatus;
};

const EVM_WALLET = /^0x[0-9a-fA-F]{40}$/;

async function checkWallet(walletAddress: string) {
  const response = await fetch("/api/checker", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ walletAddress }),
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({})) as {
    result?: CheckerResult;
    error?: string;
  };
  if (!response.ok || !data.result) {
    throw new Error(data.error || "The wallet could not be checked.");
  }
  return data.result;
}

function shortWallet(wallet: string) {
  return `${wallet.slice(0, 8)}…${wallet.slice(-6)}`;
}

const resultCopy: Record<CheckerStatus, { kicker: string; title: string; body: string }> = {
  GTD: {
    kicker: "ACCESS CONFIRMED",
    title: "YOU'RE GTD.",
    body: "Your wallet holds a Guaranteed spot in BunnyHood.",
  },
  FCFS: {
    kicker: "ACCESS CONFIRMED",
    title: "YOU'RE FCFS.",
    body: "Your wallet is on the First Come, First Served list. Be ready when mint opens.",
  },
  NOT_ELIGIBLE: {
    kicker: "NOT ELIGIBLE YET",
    title: "STAY CLOSE.",
    body: "Not eligible yet? Follow @BunnysHood — we keep adding new spots daily.",
  },
};

const shareCopy: Record<CheckerStatus, string> = {
  GTD: "I'm GTD for @BunnysHood 🐰\n\nCheck your wallet:",
  FCFS: "I'm FCFS for @BunnysHood 🐰\n\nCheck your wallet:",
  NOT_ELIGIBLE: "@BunnysHood keeps adding new spots daily 🐰\n\nCheck your wallet:",
};

export function CheckerApp() {
  const [wallet, setWallet] = useState("");
  const [checkedWallet, setCheckedWallet] = useState("");
  const [result, setResult] = useState<CheckerResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");

  const normalizedWallet = wallet.trim();
  const valid = EVM_WALLET.test(normalizedWallet);
  const copy = useMemo(() => result ? resultCopy[result.status] : null, [result]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!valid || checking) {
      setError("Enter a valid EVM wallet address.");
      return;
    }
    setChecking(true);
    setError("");
    setResult(null);
    try {
      const [nextResult] = await Promise.all([
        checkWallet(normalizedWallet),
        new Promise((resolve) => window.setTimeout(resolve, 720)),
      ]);
      setCheckedWallet(normalizedWallet);
      setResult(nextResult);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "The wallet could not be checked.");
    } finally {
      setChecking(false);
    }
  }

  function reset() {
    setWallet("");
    setCheckedWallet("");
    setResult(null);
    setError("");
  }

  function shareOnX(status: CheckerStatus) {
    const target = new URL("https://x.com/intent/post");
    target.searchParams.set("text", shareCopy[status]);
    target.searchParams.set("url", `${window.location.origin}/Checker`);
    window.open(target.toString(), "_blank", "noopener,noreferrer");
  }

  return (
    <main className={`checker-page${checking ? " is-scanning" : ""}${result ? ` has-result result-${result.status.toLowerCase()}` : ""}`}>
      <div className="checker-noise" aria-hidden="true" />
      <div className="checker-grid" aria-hidden="true" />
      <div className="checker-aurora" aria-hidden="true" />

      <header className="checker-nav">
        <Link className="checker-brand" href="/" aria-label="BunnyHood home">
          <span><Image src="/assets/bunny-hood-mark.webp" alt="" width={74} height={74} priority /></span>
          <strong>BUNNYHOOD</strong>
        </Link>
        <div className="checker-live"><i /> WALLET INDEX · LIVE</div>
      </header>

      <section className="checker-stage">
        <div className="checker-copy">
          <p className="checker-kicker"><span>BH / 001</span> ACCESS CHECKER</p>
          <h1>FIND<br /><em>YOUR SPOT.</em></h1>
          <p className="checker-intro">Search your wallet to see if you are GTD or FCFS. Not eligible yet? Follow @BunnysHood — we keep adding spots daily.</p>
          <div className="checker-meta">
            <span><b>01</b> ENTER WALLET</span>
            <span><b>02</b> SCAN LIST</span>
            <span><b>03</b> GET STATUS</span>
          </div>
        </div>

        <div className="checker-terminal">
          <div className="terminal-orbit" aria-hidden="true">
            <i className="orbit-a" /><i className="orbit-b" /><i className="orbit-c" />
            <span className="orbit-core"><Image src="/assets/bunny-hood-mark.webp" alt="" width={88} height={88} /></span>
          </div>

          <div className="terminal-panel">
            <div className="terminal-head">
              <span>ELIGIBILITY TERMINAL</span>
              <span>ROBINHOOD CHAIN</span>
            </div>

            {!result && (
              <form className="checker-form" onSubmit={submit} noValidate>
                <label htmlFor="checker-wallet">EVM WALLET ADDRESS</label>
                <div className="checker-input-shell">
                  <span>0x</span>
                  <input
                    id="checker-wallet"
                    value={wallet.replace(/^0x/i, "")}
                    onChange={(event) => {
                      setWallet(event.target.value ? `0x${event.target.value.replace(/^0x/i, "")}` : "");
                      setError("");
                    }}
                    placeholder="36b5009B7407C83b149D3EDb96Ec2442b20d6334"
                    maxLength={42}
                    autoComplete="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    disabled={checking}
                  />
                  <i className={valid ? "valid" : ""}>{valid ? "READY" : "40 HEX"}</i>
                </div>
                {error && <p className="checker-error" role="alert">{error}</p>}
                <button type="submit" disabled={checking || !valid}>
                  <span>{checking ? "SCANNING THE HOOD…" : "CHECK MY WALLET"}</span>
                  <b>{checking ? <i className="button-loader" /> : "↗"}</b>
                </button>
                <p className="checker-privacy">READ-ONLY CHECK · NO WALLET CONNECTION OR SIGNATURE</p>
              </form>
            )}

            {result && copy && (
              <section className="checker-result" aria-live="polite">
                <div className="result-signal" aria-hidden="true"><i /><i /><i /></div>
                <p>{copy.kicker}</p>
                <h2>{copy.title}</h2>
                <span>{copy.body}</span>
                <code>{shortWallet(checkedWallet)}</code>
                <div className="result-footer">
                  <button type="button" onClick={() => shareOnX(result.status)}>SHARE ON X ↗</button>
                  <button type="button" onClick={reset}>CHECK ANOTHER WALLET ↗</button>
                </div>
              </section>
            )}
          </div>
        </div>
      </section>

      <footer className="checker-footer">
        <span>© 2026 BUNNYHOOD</span>
        <span>BUILT FOR THE HOOD</span>
        <a href="https://x.com/BunnysHood" target="_blank" rel="noreferrer">FOLLOW @BUNNYSHOOD ↗</a>
      </footer>
    </main>
  );
}
