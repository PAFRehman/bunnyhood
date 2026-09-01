"use client";

import Image from "next/image";
import { FormEvent, useMemo, useState } from "react";
import { SiteNav } from "../site-shell";

type CheckerStatus = "GTD" | "FCFS" | "PUBLIC";
type CheckerResult = {
  eligible: true;
  status: CheckerStatus;
};
type MintRound = {
  id: CheckerStatus;
  title: string;
  detail: string;
  eligible: boolean;
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

function mintRounds(status: CheckerStatus): MintRound[] {
  return [
    {
      id: "GTD",
      title: "GTD",
      detail: "Guaranteed mint access",
      eligible: status === "GTD",
    },
    {
      id: "FCFS",
      title: "FCFS",
      detail: "First come, first served",
      eligible: status === "FCFS",
    },
    {
      id: "PUBLIC",
      title: "PUBLIC",
      detail: "Open to every valid wallet",
      eligible: true,
    },
  ];
}

export function CheckerApp() {
  const [wallet, setWallet] = useState("");
  const [checkedWallet, setCheckedWallet] = useState("");
  const [result, setResult] = useState<CheckerResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");

  const normalizedWallet = wallet.trim();
  const valid = EVM_WALLET.test(normalizedWallet);
  const eligibleRounds = useMemo(
    () => result ? mintRounds(result.status).filter((round) => round.eligible) : [],
    [result],
  );

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
        new Promise((resolve) => window.setTimeout(resolve, 760)),
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

  function shareOnX() {
    if (!result) return;
    const names = eligibleRounds.map((round) => round.title);
    const roundCopy = names.length === 1
      ? `the ${names[0]} mint round`
      : `${names.length} mint rounds: ${names.join(" + ")}`;
    const target = new URL("https://x.com/intent/post");
    target.searchParams.set(
      "text",
      `I'm eligible for ${roundCopy} on @BunnysHood 🐰\n\nCheck your eligibility:`,
    );
    target.searchParams.set("url", `${window.location.origin}/checker`);
    window.open(target.toString(), "_blank", "noopener,noreferrer");
  }

  return (
    <main className={`checker-page${checking ? " is-scanning" : ""}${result ? " has-result" : ""}`}>
      <div className="page-intro" aria-hidden="true"><span>BH</span><i /><b>ENTER THE HOOD</b></div>

      <div className="checker-bg" aria-hidden="true" />
      <SiteNav />

      <section className="checker-stage">
        <div className="checker-shell">
          <aside className="checker-visual">
            <Image className="checker-mascot" src="/assets/bunny-hood-hero.webp" alt="BunnyHood mascot" fill sizes="(max-width: 850px) 100vw, 44vw" priority />
            <div className="checker-visual-shade" />
            <div className="visual-copy">
              <span>BH / MINT ACCESS</span>
              <strong>ONE WALLET.<br />EVERY ROUND.</strong>
            </div>
            <div className="visual-rounds"><span>GTD</span><span>FCFS</span><span>PUBLIC</span></div>
            {result && <div className="result-confetti" aria-hidden="true">{Array.from({ length: 14 }, (_, index) => <i key={index} />)}</div>}
          </aside>

          <section className="checker-content">
            {!result ? (
              <>
                <div className="checker-heading">
                  <p><i /> BUNNYHOOD MINT ACCESS</p>
                  <h1>CHECK YOUR<br /><em>ELIGIBILITY.</em></h1>
                  <span>Enter your EVM wallet to see every mint round you can access.</span>
                </div>

                <form className="checker-form" onSubmit={submit} noValidate>
                  <label htmlFor="checker-wallet">YOUR EVM WALLET</label>
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
                    <span>{checking ? "CHECKING YOUR ROUNDS…" : "CHECK ELIGIBILITY"}</span>
                    <b>{checking ? <i className="button-loader" /> : "↗"}</b>
                  </button>
                  <small>Every valid wallet is eligible for the Public round.</small>
                </form>
              </>
            ) : (
              <section className="checker-result" aria-live="polite">
                <div className="result-heading">
                  <p>CONGRATULATIONS!</p>
                  <h2>YOU&apos;RE ELIGIBLE.</h2>
                  <span>You&apos;re eligible for <strong>{eligibleRounds.length} BunnyHood mint {eligibleRounds.length === 1 ? "round" : "rounds"}</strong>.</span>
                  <code>{shortWallet(checkedWallet)}</code>
                </div>

                <div className="round-list">
                  {eligibleRounds.map((round) => (
                    <article className="round-row eligible" key={round.id}>
                      <div><strong>{round.title}</strong><span>ELIGIBLE</span></div>
                      <p>{round.detail}</p>
                    </article>
                  ))}
                </div>

                <div className="result-actions">
                  <button type="button" onClick={shareOnX}>SHARE ON X ↗</button>
                  <button type="button" onClick={reset}>CHECK ANOTHER WALLET</button>
                </div>
              </section>
            )}
          </section>
        </div>
      </section>

      <footer className="checker-footer">
        <span>© 2026 BUNNY HOOD</span>
        <strong>EVERY WALLET · PUBLIC ELIGIBLE</strong>
        <a href="https://x.com/BunnysHood" target="_blank" rel="noreferrer">FOLLOW @BUNNYSHOOD ↗</a>
      </footer>
    </main>
  );
}
