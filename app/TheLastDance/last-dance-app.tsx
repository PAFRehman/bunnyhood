"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type MissingRequirement = "ENGAGEMENT" | "X_POST" | "ROBINHOOD_NFT" | "ROBINHOOD_TRANSACTION";
type LastDanceState = {
  authenticated: boolean;
  settings: {
    publicEnabled: boolean;
    engagementPostUrl: string;
    postText: string;
  };
  closed: boolean;
  user?: { xUsername: string; xName: string; xProfileImageUrl: string | null };
  tasks?: { engagementComplete: boolean; postComplete: boolean; postUrl: string | null };
  entry?: {
    id: string;
    walletAddress: string;
    nftCount: number;
    transactionCount: number;
    enteredAt: string;
  } | null;
};

type ApiError = {
  error?: string;
  code?: string;
  missing?: MissingRequirement[];
};

class LastDanceApiError extends Error {
  code?: string;
  missing?: MissingRequirement[];
  constructor(message: string, data: ApiError) {
    super(message);
    this.code = data.code;
    this.missing = data.missing;
  }
}

const EVM_WALLET = /^0x[0-9a-fA-F]{40}$/;
const missingCopy: Record<MissingRequirement, { title: string; copy: string }> = {
  ENGAGEMENT: { title: "ENGAGEMENT IS INCOMPLETE", copy: "Open the official post and complete the engagement step." },
  X_POST: { title: "YOUR X POST IS NOT VERIFIED", copy: "Post from your connected X account and tag @BunnysHood." },
  ROBINHOOD_NFT: { title: "NO ROBINHOOD CHAIN NFT FOUND", copy: "The entered wallet must currently hold at least one NFT on Robinhood Chain." },
  ROBINHOOD_TRANSACTION: { title: "NO ROBINHOOD TRANSACTION FOUND", copy: "The entered wallet needs at least one Robinhood Chain transaction." },
};

function readCsrfCookie() {
  const item = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("bh_spin_csrf="));
  return item ? decodeURIComponent(item.slice("bh_spin_csrf=".length)) : "";
}

async function requestJson<T>(url: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set("accept", "application/json");
  if (init?.method && init.method !== "GET") {
    headers.set("content-type", "application/json");
    headers.set("x-csrf-token", readCsrfCookie());
  }
  const response = await fetch(url, { ...init, headers, cache: "no-store" });
  const data = await response.json().catch(() => ({})) as T & ApiError;
  if (!response.ok) throw new LastDanceApiError(data.error || "The request could not be completed.", data);
  return data;
}

function ensureTag(text: string) {
  return /@bunnyshood/i.test(text) ? text : `${text.trim()}\n\n@BunnysHood`;
}

function shortWallet(wallet: string) {
  return `${wallet.slice(0, 8)}…${wallet.slice(-6)}`;
}

function OpenSeaMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 64 64">
      <circle cx="32" cy="32" r="30" fill="currentColor" />
      <path d="M20 40.5h28l-4.8 7.2H23.4L20 40.5Zm11.6-24.2 5.2 6.2-4.5 13.7H19.8l11.8-19.9Zm7 8.7 8.9 11.2H36.4L38.6 25Z" fill="#fff" />
    </svg>
  );
}

export function LastDanceApp() {
  const [state, setState] = useState<LastDanceState | null>(null);
  const [wallet, setWallet] = useState("");
  const [postUrl, setPostUrl] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [missing, setMissing] = useState<MissingRequirement[]>([]);

  const load = useCallback(async () => {
    try {
      setState(await requestJson<LastDanceState>("/api/last-dance/state"));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The Last Dance could not be loaded.");
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(initial);
  }, [load]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 7_000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const completed = useMemo(() => {
    if (!state?.authenticated) return 0;
    return Number(Boolean(state.tasks?.engagementComplete))
      + Number(Boolean(state.tasks?.postComplete))
      + Number(Boolean(state.entry));
  }, [state]);

  async function engage() {
    if (!state || busy) return;
    window.open(state.settings.engagementPostUrl, "_blank", "noopener,noreferrer");
    setBusy("engagement");
    setNotice("");
    try {
      const started = await requestJson<{ completed: boolean; waitMs: number }>("/api/last-dance/engagement", {
        method: "POST",
        body: JSON.stringify({ action: "start" }),
      });
      if (!started.completed) {
        await new Promise((resolve) => window.setTimeout(resolve, Math.max(250, started.waitMs + 250)));
        await requestJson("/api/last-dance/engagement", {
          method: "POST",
          body: JSON.stringify({ action: "complete" }),
        });
      }
      await load();
      setNotice("Engagement step confirmed.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The engagement step could not be confirmed.");
    } finally {
      setBusy("");
    }
  }

  function createPost() {
    if (!state) return;
    const target = new URL("https://x.com/intent/post");
    target.searchParams.set("text", ensureTag(state.settings.postText));
    window.open(target.toString(), "_blank", "noopener,noreferrer");
  }

  async function verifyPost(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy("post");
    setNotice("");
    try {
      await requestJson("/api/last-dance/post", {
        method: "POST",
        body: JSON.stringify({ postUrl }),
      });
      setPostUrl("");
      await load();
      setNotice("Your X post is verified.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Your X post could not be verified.");
    } finally {
      setBusy("");
    }
  }

  async function enter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!EVM_WALLET.test(wallet.trim())) {
      setNotice("Enter a valid EVM wallet address.");
      return;
    }
    setBusy("enter");
    setNotice("");
    setMissing([]);
    try {
      await requestJson("/api/last-dance/enter", {
        method: "POST",
        body: JSON.stringify({ walletAddress: wallet.trim() }),
      });
      await load();
    } catch (error) {
      if (error instanceof LastDanceApiError && error.missing?.length) setMissing(error.missing);
      else setNotice(error instanceof Error ? error.message : "Your entry could not be completed.");
    } finally {
      setBusy("");
    }
  }

  if (!state) {
    return <section className="ld-loading"><i /><span>SETTING THE STAGE</span></section>;
  }

  const entry = state.authenticated ? state.entry : null;
  if (!entry && state.closed) {
    return (
      <section className="ld-closed">
        <div className="ld-stage-rings" aria-hidden="true"><i /><i /><i /></div>
        <p>THE LAST DANCE · COMPLETE</p>
        <h1>GTD IS <em>GTD.</em></h1>
        <h2>Form is now closed.</h2>
        <a href="https://opensea.io/collection/bunnyhoodxyz" target="_blank" rel="noreferrer">
          <OpenSeaMark /><span>VIEW BUNNYHOOD ON OPENSEA</span><b>↗</b>
        </a>
      </section>
    );
  }

  return (
    <>
      <section className="ld-hero">
        <div className="ld-grid" aria-hidden="true" />
        <div className="ld-spotlight ld-spotlight-one" aria-hidden="true" />
        <div className="ld-spotlight ld-spotlight-two" aria-hidden="true" />
        <div className="ld-hero-copy">
          <p className="ld-kicker"><i /> ROBINHOOD CHAIN · FINAL CALL</p>
          <h1>THE LAST<br /><em>DANCE.</em></h1>
          <div className="ld-hero-note">
            <span>THREE MOVES. ONE ENTRY.</span>
            <p>Connect X, complete the final tasks, and prove your wallet is alive on Robinhood Chain.</p>
          </div>
        </div>
        <div className="ld-disc" aria-hidden="true">
          <div className="ld-disc-lines" />
          <span>BH</span>
          <i />
          <b>LAST<br />DANCE</b>
        </div>
        <div className="ld-scroll">SCROLL TO ENTER <span>↓</span></div>
      </section>

      {!state.authenticated ? (
        <section className="ld-connect">
          <div>
            <p>YOUR PASS STARTS WITH X</p>
            <h2>CONNECT TO<br /><em>STEP INSIDE.</em></h2>
          </div>
          <div className="ld-connect-card">
            <span className="ld-x">X</span>
            <h3>One verified identity. One final entry.</h3>
            <p>Your connected X account is used to bind the tasks and prevent duplicate entries.</p>
            <a href="/api/spin/auth/x/start?returnTo=/TheLastDance">CONNECT X <b>↗</b></a>
          </div>
        </section>
      ) : entry ? (
        <section className="ld-success">
          <div className="ld-success-burst" aria-hidden="true">{Array.from({ length: 18 }, (_, index) => <i key={index} />)}</div>
          <p>ENTRY LOCKED · ROBINHOOD CHAIN VERIFIED</p>
          <h2>YOU MADE THE<br /><em>LAST DANCE.</em></h2>
          <div className="ld-ticket">
            <span>GTD ENTRY</span>
            <strong>@{state.user?.xUsername}</strong>
            <code>{shortWallet(entry.walletAddress)}</code>
            <small>NFT HELD ✓ &nbsp; TRANSACTION FOUND ✓</small>
          </div>
          <a className="ld-opensea" href="https://opensea.io/collection/bunnyhoodxyz" target="_blank" rel="noreferrer">
            <OpenSeaMark /> OPEN BUNNYHOOD ON OPENSEA <b>↗</b>
          </a>
        </section>
      ) : (
        <section className="ld-missions">
          <header className="ld-missions-head">
            <div>
              <p>CONNECTED AS @{state.user?.xUsername}</p>
              <h2>MAKE YOUR<br /><em>FINAL MOVES.</em></h2>
            </div>
            <div className="ld-progress">
              <span>{completed} / 3 COMPLETE</span>
              <div>{[0, 1, 2].map((index) => <i className={completed > index ? "done" : ""} key={index} />)}</div>
            </div>
          </header>

          <div className="ld-task-list">
            <article className={state.tasks?.engagementComplete ? "done" : busy === "engagement" ? "active" : ""}>
              <span className="ld-number">01</span>
              <div className="ld-task-copy"><p>MOVE ONE · ENGAGE</p><h3>SHOW UP ON THE POST.</h3><span>Open the official post, like, repost, and leave a real comment.</span></div>
              <button type="button" onClick={engage} disabled={Boolean(busy) || state.tasks?.engagementComplete}>
                {state.tasks?.engagementComplete ? "CONFIRMED ✓" : busy === "engagement" ? "CONFIRMING…" : "OPEN THE POST ↗"}
              </button>
            </article>

            <article className={state.tasks?.postComplete ? "done" : busy === "post" ? "active" : ""}>
              <span className="ld-number">02</span>
              <div className="ld-task-copy"><p>MOVE TWO · CREATE</p><h3>POST FROM YOUR X.</h3><span>Use the connected account and keep the @BunnysHood tag in your public post.</span></div>
              {state.tasks?.postComplete ? <button type="button" disabled>VERIFIED ✓</button> : (
                <div className="ld-post-actions">
                  <button type="button" onClick={createPost} disabled={Boolean(busy)}>CREATE POST ↗</button>
                  <form onSubmit={verifyPost}>
                    <input value={postUrl} onChange={(event) => setPostUrl(event.target.value)} placeholder="Paste your X post URL" aria-label="Your X post URL" />
                    <button type="submit" disabled={Boolean(busy) || !postUrl.trim()}>{busy === "post" ? "…" : "VERIFY"}</button>
                  </form>
                </div>
              )}
            </article>

            <article className={busy === "enter" ? "active" : ""}>
              <span className="ld-number">03</span>
              <div className="ld-task-copy"><p>FINAL MOVE · ONCHAIN</p><h3>PROVE THE WALLET.</h3><span>It must hold at least one NFT and have at least one transaction on Robinhood Chain.</span></div>
              <form className="ld-wallet-form" onSubmit={enter}>
                <input value={wallet} onChange={(event) => setWallet(event.target.value)} placeholder="0x wallet address" aria-label="Robinhood Chain wallet" maxLength={42} />
                <button type="submit" disabled={Boolean(busy)}>{busy === "enter" ? "CHECKING CHAIN…" : "ENTER THE LAST DANCE ↗"}</button>
              </form>
            </article>
          </div>
        </section>
      )}

      {notice && <div className="ld-toast" role="status"><span>{notice}</span><button type="button" onClick={() => setNotice("")}>×</button></div>}
      {missing.length > 0 && (
        <div className="ld-modal" role="dialog" aria-modal="true" aria-labelledby="ld-missing-title" onMouseDown={(event) => {
          if (event.currentTarget === event.target) setMissing([]);
        }}>
          <div className="ld-modal-card">
            <button className="ld-modal-close" type="button" onClick={() => setMissing([])} aria-label="Close">×</button>
            <p>YOU&apos;RE NOT THROUGH YET</p>
            <h2 id="ld-missing-title">{missing.length} REQUIREMENT{missing.length === 1 ? "" : "S"} MISSING.</h2>
            <div>{missing.map((item) => <article key={item}><i>!</i><span><strong>{missingCopy[item].title}</strong><small>{missingCopy[item].copy}</small></span></article>)}</div>
            <button type="button" onClick={() => setMissing([])}>BACK TO THE TASKS</button>
          </div>
        </div>
      )}
    </>
  );
}
