"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { LastDanceMintCountdown } from "./mint-countdown";

type MissingRequirement = "ENGAGEMENT" | "X_POST" | "ROBINHOOD_NFT" | "ROBINHOOD_TRANSACTION";
type Capacity = { claimed: number; total: number; remaining: number };
type LastDanceState = {
  authenticated: boolean;
  settings: {
    publicEnabled: boolean;
    engagementPostUrl: string;
    postText: string;
    mintOpensAt: string | null;
  };
  capacity: Capacity;
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

function CapacityMeter({ capacity, inverse = false }: { capacity: Capacity; inverse?: boolean }) {
  const percentage = capacity.total > 0
    ? Math.min(100, Math.max(0, (capacity.claimed / capacity.total) * 100))
    : 0;
  return (
    <div className={`ld-capacity${inverse ? " inverse" : ""}`} aria-live="polite" aria-atomic="true">
      <div className="ld-capacity-label"><i /><span>LIVE CAPACITY</span><b>{capacity.remaining} REMAINING</b></div>
      <div className="ld-capacity-numbers"><strong>{capacity.claimed}</strong><span>/ {capacity.total} SPOTS CLAIMED</span></div>
      <div className="ld-capacity-track"><i style={{ width: `${percentage}%` }} /></div>
    </div>
  );
}

function StatusSeal({ complete }: { complete: boolean }) {
  return <span className={`ld-status-seal${complete ? " complete" : ""}`}>{complete ? "STAMPED ✓" : "OPEN"}</span>;
}

export function LastDanceApp() {
  const [state, setState] = useState<LastDanceState | null>(null);
  const [wallet, setWallet] = useState("");
  const [postUrl, setPostUrl] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [missing, setMissing] = useState<MissingRequirement[]>([]);

  const load = useCallback(async (silent = false) => {
    try {
      setState(await requestJson<LastDanceState>("/api/last-dance/state"));
    } catch (error) {
      if (!silent) setNotice(error instanceof Error ? error.message : "The Last Dance could not be loaded.");
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    const refresh = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(true);
    }, 5_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(refresh);
    };
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
      await load(true);
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
      await load(true);
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
      await load(true);
    } catch (error) {
      if (error instanceof LastDanceApiError && error.missing?.length) setMissing(error.missing);
      else setNotice(error instanceof Error ? error.message : "Your entry could not be completed.");
    } finally {
      setBusy("");
    }
  }

  async function downloadPassCard(entryId: string, xUsername: string) {
    if (busy) return;
    setBusy("download");
    setNotice("");
    try {
      const response = await fetch(`/api/last-dance/pass/${encodeURIComponent(entryId)}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Your pass image could not be created.");
      const objectUrl = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `bunnyhood-last-dance-${xUsername}.png`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
      setNotice("Your confirmed GTD pass is downloading.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Your pass could not be downloaded.");
    } finally {
      setBusy("");
    }
  }

  function sharePassCard(entryId: string) {
    const shareUrl = `${window.location.origin}/TheLastDance/pass/${encodeURIComponent(entryId)}`;
    const target = new URL("https://x.com/intent/post");
    target.searchParams.set("text", `I secured a Confirmed GTD Spot in The Last Dance by @BunnysHood. My wallet will be added soon.\n\n${shareUrl}`);
    window.open(target.toString(), "_blank", "noopener,noreferrer");
  }

  if (!state) {
    return (
      <section className="ld-loading">
        <div className="ld-loading-mark"><i /><i /><span>BH</span></div>
        <p>LIGHTING THE FLOOR</p>
      </section>
    );
  }

  const entry = state.authenticated ? state.entry : null;
  if (!entry && state.closed) {
    return (
      <section className="ld-closed">
        <div className="ld-closed-glow" aria-hidden="true" />
        <div className="ld-closed-lines" aria-hidden="true"><i /><i /><i /><i /><i /></div>
        <div className="ld-closed-copy">
          <p>THE FLOOR HAS REACHED CAPACITY</p>
          <h1>GTD IS <em>GTD.</em></h1>
          <h2>Form is now closed.</h2>
          <CapacityMeter capacity={state.capacity} inverse />
          <a href="https://opensea.io/collection/bunnyhoodxyz" target="_blank" rel="noreferrer">
            <OpenSeaMark /><span>VIEW BUNNYHOOD ON OPENSEA</span><b>↗</b>
          </a>
        </div>
      </section>
    );
  }

  return (
    <>
      <section className="ld-cover">
        <div className="ld-aurora ld-aurora-a" aria-hidden="true" />
        <div className="ld-aurora ld-aurora-b" aria-hidden="true" />
        <div className="ld-noise" aria-hidden="true" />
        <div className="ld-ghost-type" aria-hidden="true"><span>LAST</span><span>DANCE</span></div>

        <div className="ld-cover-copy">
          <p className="ld-overline"><i /> ROBINHOOD CHAIN · ONE NIGHT ONLY</p>
          <h1><span>THE</span> LAST<br /><em>DANCE</em></h1>
          <p className="ld-cover-note">Three proofs. One place on the floor. Connect your X identity and bring a wallet with real Robinhood Chain history.</p>
          <CapacityMeter capacity={state.capacity} />
        </div>

        <div className="ld-pass-scene" aria-hidden="true">
          <i className="ld-orbit ld-orbit-a" />
          <i className="ld-orbit ld-orbit-b" />
          <span className="ld-float-chip ld-chip-one">GTD / 4663</span>
          <span className="ld-float-chip ld-chip-two">ADMIT ONE</span>
          <div className="ld-holo-pass">
            <div className="ld-pass-header"><span>BH // FINAL INVITATION</span><b>LIVE</b></div>
            <div className="ld-rabbit-sigil"><i /><i /><span>BH</span></div>
            <div className="ld-pass-title"><small>ACCESS CEREMONY</small><strong>THE LAST<br />DANCE</strong></div>
            <div className="ld-pass-foot"><span>CHAIN<br /><b>ROBINHOOD</b></span><span>ENTRY<br /><b>GTD</b></span><em>4663</em></div>
            <div className="ld-pass-barcode">{Array.from({ length: 18 }, (_, index) => <i key={index} />)}</div>
          </div>
        </div>

        <div className="ld-cover-marquee" aria-hidden="true">
          <div>ANY NFT <i /> ANY TRANSACTION <i /> ONE VERIFIED X <i /> GTD IS GTD <i /> ANY NFT <i /> ANY TRANSACTION <i /> ONE VERIFIED X <i /> GTD IS GTD <i /></div>
        </div>
      </section>

      {!state.authenticated ? (
        <section className="ld-gate">
          <div className="ld-gate-orbit" aria-hidden="true"><i /><i /><span>01</span></div>
          <div className="ld-gate-copy">
            <p>THE FIRST MOVE</p>
            <h2>BRING YOUR<br /><em>X IDENTITY.</em></h2>
            <span>One connected account binds every proof to one real entry.</span>
          </div>
          <div className="ld-x-pass">
            <div className="ld-x-pass-top"><span>IDENTITY GATE</span><i>●</i></div>
            <strong>X</strong>
            <h3>Your invitation begins here.</h3>
            <p>Connect X to step onto the floor. The account is used only to verify the two campaign actions and prevent duplicate entries.</p>
            <a href="/api/spin/auth/x/start?returnTo=/TheLastDance"><span>CONNECT X ACCOUNT</span><b>↗</b></a>
          </div>
        </section>
      ) : entry ? (
        <section className="ld-confirmation">
          <div className="ld-confirmation-rays" aria-hidden="true">{Array.from({ length: 20 }, (_, index) => <i key={index} />)}</div>
          <div className="ld-confirmed-pass">
            <div className="ld-confirmed-head"><span>THE LAST DANCE</span><b>CONFIRMED</b></div>
            <p>CONFIRMED GTD SPOT · ROBINHOOD CHAIN VERIFIED</p>
            <h2>YOU&apos;RE ON<br /><em>THE FLOOR.</em></h2>
            <div className="ld-confirmed-identity">
              <span>@{state.user?.xUsername}</span>
              <code>{shortWallet(entry.walletAddress)}</code>
            </div>
            <div className="ld-confirmed-proof"><span>NFT HOLDING <b>FOUND ✓</b></span><span>CHAIN ACTIVITY <b>FOUND ✓</b></span></div>
            <div className="ld-wallet-note"><i /> YOUR WALLET WILL BE ADDED SOON.</div>
            <div className="ld-confirmed-number">LIVE CLAIMED / {Math.max(1, state.capacity.claimed).toString().padStart(3, "0")}</div>
          </div>
          <div className="ld-confirmation-copy">
            <p>YOUR ENTRY IS LOCKED</p>
            <h3>WELCOME TO<br />THE LAST DANCE.</h3>
            <LastDanceMintCountdown target={state.settings.mintOpensAt} />
            <CapacityMeter capacity={state.capacity} />
            <div className="ld-pass-actions">
              <button type="button" onClick={() => void downloadPassCard(entry.id, state.user?.xUsername ?? "gtd")} disabled={Boolean(busy)}><span>{busy === "download" ? "BUILDING PNG…" : "DOWNLOAD GTD CARD"}</span><b>↓</b></button>
              <button type="button" onClick={() => sharePassCard(entry.id)}><span>SHARE PASS ON X</span><b>↗</b></button>
              <a className="ld-opensea" href="https://opensea.io/collection/bunnyhoodxyz" target="_blank" rel="noreferrer"><OpenSeaMark /><span>GO TO OPENSEA MINT</span><b>↗</b></a>
            </div>
          </div>
        </section>
      ) : (
        <section className="ld-studio">
          <div className="ld-studio-glow" aria-hidden="true" />
          <header className="ld-studio-head">
            <div className="ld-user-chip"><span>{state.user?.xUsername.slice(0, 1).toUpperCase()}</span><p>CONNECTED DANCER <b>@{state.user?.xUsername}</b></p></div>
            <div><p>YOUR CHOREOGRAPHY</p><h2>THREE MOVES.<br /><em>ONE ENTRY.</em></h2></div>
            <div className="ld-completion-dial" style={{ "--ld-complete": `${completed * 33.333}%` } as React.CSSProperties}><strong>{completed}</strong><span>OF 3<br />STAMPED</span></div>
          </header>

          <div className="ld-board">
            <aside className="ld-board-spine">
              <span>BH</span>
              <b>FINAL ACCESS MANIFEST</b>
              <i />
              <small>ROBINHOOD CHAIN<br />NETWORK 4663</small>
            </aside>
            <div className="ld-board-main">
              <div className="ld-board-top"><span>COMPLETE IN ORDER</span><CapacityMeter capacity={state.capacity} inverse /></div>

              <article className={`ld-movement ld-movement-one${state.tasks?.engagementComplete ? " complete" : ""}${busy === "engagement" ? " active" : ""}`}>
                <div className="ld-move-index"><span>MOVE</span><b>01</b></div>
                <div className="ld-move-copy"><p>SIGNAL</p><h3>ENTER THE CONVERSATION.</h3><span>Open the official post, like it, repost it, and leave a real comment.</span></div>
                <div className="ld-move-action"><StatusSeal complete={Boolean(state.tasks?.engagementComplete)} /><button type="button" onClick={engage} disabled={Boolean(busy) || state.tasks?.engagementComplete}>{state.tasks?.engagementComplete ? "ENGAGED ✓" : busy === "engagement" ? "STAMPING…" : "OPEN OFFICIAL POST ↗"}</button></div>
              </article>

              <article className={`ld-movement ld-movement-two${state.tasks?.postComplete ? " complete" : ""}${busy === "post" ? " active" : ""}`}>
                <div className="ld-move-index"><span>MOVE</span><b>02</b></div>
                <div className="ld-move-copy"><p>VOICE</p><h3>MAKE THE CALL YOURS.</h3><span>Publish from the connected X account and keep the @BunnysHood tag in the post.</span></div>
                <div className="ld-move-action">
                  <StatusSeal complete={Boolean(state.tasks?.postComplete)} />
                  {state.tasks?.postComplete ? <button type="button" disabled>POST VERIFIED ✓</button> : (
                    <div className="ld-post-actions">
                      <button type="button" onClick={createPost} disabled={Boolean(busy)}>CREATE THE POST ↗</button>
                      <form onSubmit={verifyPost}>
                        <input value={postUrl} onChange={(event) => setPostUrl(event.target.value)} placeholder="Paste X post URL" aria-label="Your X post URL" />
                        <button type="submit" disabled={Boolean(busy) || !postUrl.trim()}>{busy === "post" ? "VERIFYING…" : "VERIFY"}</button>
                      </form>
                    </div>
                  )}
                </div>
              </article>

              <article className={`ld-movement ld-movement-three${busy === "enter" ? " active" : ""}`}>
                <div className="ld-move-index"><span>FINAL</span><b>03</b></div>
                <div className="ld-move-copy"><p>PROOF</p><h3>BRING AN ACTIVE WALLET.</h3><span>Any NFT holding plus any transaction on Robinhood Chain mainnet qualifies.</span></div>
                <div className="ld-move-action"><StatusSeal complete={false} /><form className="ld-wallet-form" onSubmit={enter}><input value={wallet} onChange={(event) => setWallet(event.target.value)} placeholder="0x wallet address" aria-label="Robinhood Chain wallet" maxLength={42} /><button type="submit" disabled={Boolean(busy)}>{busy === "enter" ? "READING MAINNET…" : "LOCK MY GTD ENTRY ↗"}</button></form></div>
              </article>
            </div>
          </div>
        </section>
      )}

      {notice && <div className="ld-toast" role="status"><i /><span>{notice}</span><button type="button" onClick={() => setNotice("")}>×</button></div>}
      {missing.length > 0 && (
        <div className="ld-modal" role="dialog" aria-modal="true" aria-labelledby="ld-missing-title" onMouseDown={(event) => {
          if (event.currentTarget === event.target) setMissing([]);
        }}>
          <div className="ld-modal-card">
            <button className="ld-modal-close" type="button" onClick={() => setMissing([])} aria-label="Close">×</button>
            <div className="ld-modal-sigil"><i /><i /><span>!</span></div>
            <p>THE GATE FOUND A GAP</p>
            <h2 id="ld-missing-title">{missing.length} PROOF{missing.length === 1 ? "" : "S"} STILL MISSING.</h2>
            <div className="ld-missing-list">{missing.map((item) => <article key={item}><b>!</b><span><strong>{missingCopy[item].title}</strong><small>{missingCopy[item].copy}</small></span></article>)}</div>
            <button className="ld-modal-return" type="button" onClick={() => setMissing([])}>RETURN TO THE FLOOR <b>↗</b></button>
          </div>
        </div>
      )}
    </>
  );
}
