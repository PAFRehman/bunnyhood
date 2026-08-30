"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type TaskProgress = { startedAt: string | null; completedAt: string | null };
type Entry = {
  id: string;
  joinNumber: number;
  walletAddress: string;
  referralCode: string;
  referralCount: number;
  bonusPoints: number;
  points: number;
  rank: number;
  joinedAt: string;
  bonusPostUrl: string | null;
};
type State = {
  csrfToken: string;
  incomingReferralCode: string | null;
  totalEntries: number;
  serverNow: string;
  tasks: { followNotifications: TaskProgress; engagePost: TaskProgress };
  entry: Entry | null;
  leaderboard: Entry[];
  actions: { profileUrl: string; postUrl: string | null };
};

async function api<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const data = await response.json().catch(() => ({})) as T & { error?: string; code?: string };
  if (!response.ok) {
    const error = new Error(data.error || "The request could not be completed.");
    Object.assign(error, { code: data.code, status: response.status });
    throw error;
  }
  return data;
}

const format = new Intl.NumberFormat("en-US");

function padJoinNumber(value: number) {
  return `#${String(value).padStart(4, "0")}`;
}

function xShareUrl(text: string, url?: string) {
  const target = new URL("https://x.com/intent/post");
  target.searchParams.set("text", text);
  if (url) target.searchParams.set("url", url);
  return target.toString();
}

function waitlistReferralUrl(referralCode: string) {
  const path = `/waitlist?ref=${referralCode}`;
  return typeof window === "undefined" ? path : `${window.location.origin}${path}`;
}

export function WaitlistApp() {
  const [state, setState] = useState<State | null>(null);
  const [wallet, setWallet] = useState("");
  const [bonusPostUrl, setBonusPostUrl] = useState("");
  const [rankQuery, setRankQuery] = useState("");
  const [rankResult, setRankResult] = useState<Entry | null | undefined>(undefined);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadState = useCallback(async () => {
    const ref = new URLSearchParams(window.location.search).get("ref") ?? "";
    const data = await api<State>(`/api/waitlist/state?ref=${encodeURIComponent(ref)}`);
    setState(data);
    if (data.entry) setWallet(data.entry.walletAddress);
    return data;
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadState().catch((reason) => setError(reason instanceof Error ? reason.message : "Waitlist could not be loaded."));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadState]);

  useEffect(() => {
    if (!message && !error) return;
    const timer = window.setTimeout(() => { setMessage(""); setError(""); }, 7_000);
    return () => window.clearTimeout(timer);
  }, [message, error]);

  const referralLink = useMemo(() => {
    if (!state?.entry || typeof window === "undefined") return "";
    return `${window.location.origin}/waitlist?ref=${state.entry.referralCode}`;
  }, [state?.entry]);

  const bonusComposerUrl = useMemo(() => {
    if (!referralLink) return "";
    return xShareUrl(
      "I joined the @BunnysHood upcoming-products waitlist. Join through my referral link and climb the Hood with me. 🐰",
      referralLink,
    );
  }, [referralLink]);

  const followPendingStartedAt = state?.tasks.followNotifications.startedAt
    && !state.tasks.followNotifications.completedAt
    ? state.tasks.followNotifications.startedAt
    : null;
  const engagePendingStartedAt = state?.tasks.engagePost.startedAt
    && !state.tasks.engagePost.completedAt
    ? state.tasks.engagePost.startedAt
    : null;
  const stateServerNow = state?.serverNow ?? null;

  useEffect(() => {
    if (!stateServerNow) return;
    const pendingStarts = [followPendingStartedAt, engagePendingStartedAt]
      .filter((value): value is string => Boolean(value));
    if (!pendingStarts.length) return;
    const serverNowMs = new Date(stateServerNow).getTime();
    const nextDelay = Math.min(...pendingStarts.map((startedAt) => (
      Math.max(250, 5_150 - Math.max(0, serverNowMs - new Date(startedAt).getTime()))
    )));
    const timer = window.setTimeout(() => {
      void loadState().catch((reason) => {
        setError(reason instanceof Error ? reason.message : "Task status could not be refreshed.");
      });
    }, nextDelay);
    return () => window.clearTimeout(timer);
  }, [engagePendingStartedAt, followPendingStartedAt, loadState, stateServerNow]);

  const requiredComplete = Boolean(
    state?.tasks.followNotifications.completedAt && state.tasks.engagePost.completedAt,
  );

  async function post<T>(url: string, body: unknown) {
    if (!state) throw new Error("Waitlist is still loading.");
    return api<T>(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": state.csrfToken,
      },
      body: JSON.stringify(body),
    });
  }

  async function handleTask(
    task: "follow_notifications" | "engage_post",
    progress: TaskProgress,
    targetUrl: string | null,
  ) {
    if (!targetUrl) {
      setError("The BunnyHood post is not configured yet. Add WAITLIST_X_POST_URL in Vercel.");
      return;
    }
    setError("");
    setBusy(task);
    try {
      if (progress.startedAt) return;
      window.open(targetUrl, "_blank", "noopener,noreferrer");
      await post("/api/waitlist/tasks/start", { task });
      await loadState();
      setMessage("Task opened. Complete the action on X.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Task could not be updated.");
    } finally {
      setBusy(null);
    }
  }

  async function join(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("join");
    setError("");
    try {
      const result = await post<{ entry: Entry }>("/api/waitlist/join", { wallet });
      setState((current) => current ? { ...current, entry: result.entry } : current);
      await loadState();
      setMessage(`You joined as ${padJoinNumber(result.entry.joinNumber)}.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Waitlist entry could not be saved.");
    } finally {
      setBusy(null);
    }
  }

  async function submitBonus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("bonus");
    setError("");
    try {
      const result = await post<{ entry: Entry }>("/api/waitlist/bonus-post", { postUrl: bonusPostUrl });
      setState((current) => current ? { ...current, entry: result.entry } : current);
      await loadState();
      setMessage("Bonus accepted. +1 leaderboard point added.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Bonus post could not be saved.");
    } finally {
      setBusy(null);
    }
  }

  async function searchRank(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("search");
    setError("");
    try {
      const result = await api<{ entry: Entry | null }>(`/api/waitlist/rank?query=${encodeURIComponent(rankQuery)}`);
      setRankResult(result.entry);
    } catch (reason) {
      setRankResult(undefined);
      setError(reason instanceof Error ? reason.message : "Rank could not be searched.");
    } finally {
      setBusy(null);
    }
  }

  async function copy(value: string, label: string) {
    await navigator.clipboard.writeText(value);
    setMessage(`${label} copied.`);
  }

  if (!state) {
    return (
      <section className="waitlist-loading">
        <span>BH</span>
        <p>UPCOMING PRODUCTS · NO X LOGIN REQUIRED</p>
        <h1>GET<br />IN LINE.</h1>
        <ul><li>Follow + turn notifications on.</li><li>Like, repost + comment.</li></ul>
        <small>{error || "OPENING THE UPCOMING-PRODUCTS LIST"}</small>
      </section>
    );
  }

  const tasks = [
    {
      number: "01",
      type: "follow_notifications" as const,
      eyebrow: "STAY IN THE LOOP",
      title: "Follow + turn notifications on.",
      detail: "Follow @BunnysHood and enable post notifications so you do not miss the next product release.",
      progress: state.tasks.followNotifications,
      url: state.actions.profileUrl,
    },
    {
      number: "02",
      type: "engage_post" as const,
      eyebrow: "PUSH THE SIGNAL",
      title: "Like, repost + comment.",
      detail: "Open the official waitlist post, like it, repost it, and leave a real comment.",
      progress: state.tasks.engagePost,
      url: state.actions.postUrl,
    },
  ];

  return (
    <>
      <section className="waitlist-hero">
        <div className="waitlist-grid" aria-hidden="true" />
        <div className="waitlist-hero-copy">
          <p className="waitlist-kicker"><i /> UPCOMING PRODUCTS · EARLY ACCESS</p>
          <h1>GET<br /><em>IN LINE.</em></h1>
          <p>Complete two launch tasks, enter one EVM wallet, and secure your place for upcoming BunnyHood products. Every successful referral moves you higher.</p>
          <div className="waitlist-hero-stats">
            <span><b>{format.format(state.totalEntries)}</b> IN THE HOOD</span>
            <span><b>+1</b> PER REFERRAL</span>
            <span><b>NO X LOGIN</b> REQUIRED</span>
          </div>
        </div>
        <div className="waitlist-rank-art" aria-hidden="true">
          <div className="rank-orbit rank-orbit-one" />
          <div className="rank-orbit rank-orbit-two" />
          <div className="rank-card rank-card-back"><small>POSITION</small><strong>#003</strong></div>
          <div className="rank-card rank-card-mid"><small>POSITION</small><strong>#002</strong></div>
          <div className="rank-card rank-card-front"><small>YOUR MOVE</small><strong>#001</strong><i>CLIMB ↑</i></div>
        </div>
      </section>

      <section className="waitlist-flow" id="join">
        <header className="waitlist-heading">
          <div><p className="waitlist-kicker">TWO REQUIRED MOVES</p><h2>Earn your<br /><em>position.</em></h2></div>
          <p>Complete both actions to unlock wallet entry. Each completed task adds 1 point to your leaderboard score.</p>
        </header>

        <div className="waitlist-task-list">
          {tasks.map((task) => {
            const complete = Boolean(task.progress.completedAt);
            const started = Boolean(task.progress.startedAt);
            const disabled = busy === task.type || (!task.url && task.type === "engage_post") || started;
            return (
              <article className={`waitlist-task${complete ? " complete" : ""}`} key={task.type}>
                <span className="waitlist-task-number">{task.number}</span>
                <div><small>{task.eyebrow}</small><h3>{task.title}</h3><p>{task.detail}</p></div>
                <div className="waitlist-task-action">
                  <span>{complete ? "1 / 1 POINT" : "0 / 1 POINT"}</span>
                  <button type="button" disabled={disabled} onClick={() => void handleTask(task.type, task.progress, task.url)}>
                    {complete ? "CONFIRMED ✓" : !task.url ? "POST NOT CONFIGURED" : started ? "TASK OPENED…" : "OPEN TASK ↗"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>

        <div className="waitlist-entry-grid">
          <div className="waitlist-entry-copy">
            <p className="waitlist-kicker">ONE WALLET · ONE PLACE</p>
            <h2>{state.entry ? "YOU’RE\nIN." : "CLAIM\nYOUR #."}</h2>
            <p>Your join number never changes. The two tasks start you at 2 points; referrals and the one-time post bonus move you higher.</p>
          </div>

          {!state.entry ? (
            <form className="waitlist-wallet-form" onSubmit={join}>
              <div className="waitlist-lock-state">
                <span>{requiredComplete ? "02 / 02 COMPLETE" : `${Number(Boolean(state.tasks.followNotifications.completedAt)) + Number(Boolean(state.tasks.engagePost.completedAt))} / 02 COMPLETE`}</span>
                <div><i className={state.tasks.followNotifications.completedAt ? "done" : ""} /><i className={state.tasks.engagePost.completedAt ? "done" : ""} /></div>
              </div>
              <label htmlFor="waitlist-wallet">EVM WALLET ADDRESS</label>
              <input id="waitlist-wallet" name="wallet" value={wallet} onChange={(event) => setWallet(event.target.value)} placeholder="0x…" autoComplete="off" spellCheck={false} disabled={!requiredComplete} />
              {state.incomingReferralCode && <p className="waitlist-referred">REFERRAL LOCKED · {state.incomingReferralCode}</p>}
              <button type="submit" disabled={!requiredComplete || busy === "join" || !wallet.trim()}>
                <span>{busy === "join" ? "SECURING POSITION…" : requiredComplete ? "JOIN THE WAITLIST" : "COMPLETE BOTH TASKS"}</span><b>→</b>
              </button>
              <small>Wallet submission does not request a signature or transaction. It is used only as your unique waitlist identity.</small>
            </form>
          ) : (
            <div className="waitlist-ticket">
              <div className="waitlist-ticket-top"><span>JOIN NUMBER</span><strong>{padJoinNumber(state.entry.joinNumber)}</strong></div>
              <div className="waitlist-ticket-rank"><span>CURRENT RANK</span><strong>#{format.format(state.entry.rank)}</strong><small>{state.entry.points} POINT{state.entry.points === 1 ? "" : "S"}</small></div>
              <dl>
                <div><dt>REFERRALS</dt><dd>{state.entry.referralCount}</dd></div>
                <div><dt>POST BONUS</dt><dd>{state.entry.bonusPoints ? "+1" : "OPEN"}</dd></div>
                <div><dt>WALLET</dt><dd>{state.entry.walletAddress.slice(0, 8)}…{state.entry.walletAddress.slice(-5)}</dd></div>
              </dl>
              <div className="waitlist-ticket-actions">
                <button type="button" onClick={() => void copy(referralLink, "Referral link")}>COPY REFERRAL LINK</button>
                <a href={xShareUrl("I joined the BunnyHood upcoming-products waitlist. Join through my link and help me climb the Hood. 🐰", referralLink)} target="_blank" rel="noreferrer">INVITE ON X ↗</a>
              </div>
            </div>
          )}
        </div>
      </section>

      {state.entry && (
        <section className="waitlist-bonus">
          <div className="waitlist-bonus-copy"><p className="waitlist-kicker">OPTIONAL · +1 POINT</p><h2>POST FOR<br /><em>THE HOOD.</em></h2><p>Create a real BunnyHood post, then paste its X link. One unique post can award one wallet once.</p></div>
          {state.entry.bonusPoints ? (
            <div className="waitlist-bonus-complete"><span>POINT ADDED</span><strong>+1</strong><p>Your post bonus is locked in. Keep climbing with referrals.</p>{state.entry.bonusPostUrl && <a href={state.entry.bonusPostUrl} target="_blank" rel="noreferrer">VIEW SUBMITTED POST ↗</a>}</div>
          ) : (
            <form className="waitlist-bonus-form" onSubmit={submitBonus}>
              <a href={bonusComposerUrl} target="_blank" rel="noreferrer">CREATE A BUNNYHOOD POST ↗</a>
              <label htmlFor="bonus-post">PASTE YOUR X POST LINK</label>
              <input id="bonus-post" value={bonusPostUrl} onChange={(event) => setBonusPostUrl(event.target.value)} placeholder="https://x.com/username/status/…" spellCheck={false} />
              <button type="submit" disabled={busy === "bonus" || !bonusPostUrl.trim()}>{busy === "bonus" ? "CHECKING LINK…" : "SUBMIT FOR +1 POINT"}</button>
              <small>The URL must be a unique x.com status link that has not been submitted before.</small>
            </form>
          )}
        </section>
      )}

      <section className="waitlist-board">
        <header className="waitlist-heading">
          <div><p className="waitlist-kicker">LIVE POSITION</p><h2>Find your<br /><em>rank.</em></h2></div>
          <form onSubmit={searchRank} className="waitlist-rank-search">
            <label htmlFor="rank-query">WALLET OR REFERRAL CODE</label>
            <div><input id="rank-query" value={rankQuery} onChange={(event) => setRankQuery(event.target.value)} placeholder="0x… or bh…" spellCheck={false} /><button disabled={busy === "search"}>SEARCH →</button></div>
          </form>
        </header>

        {rankResult !== undefined && (
          <div className={`waitlist-search-result${rankResult ? "" : " empty"}`}>
            {rankResult ? <>
              <span>{padJoinNumber(rankResult.joinNumber)}</span>
              <strong>RANK #{format.format(rankResult.rank)}</strong>
              <p>{rankResult.walletAddress} · {rankResult.points} points · {rankResult.referralCount} referrals</p>
              <div className="waitlist-search-referral">
                <small>YOUR REFERRAL LINK</small>
                <code>{waitlistReferralUrl(rankResult.referralCode)}</code>
                <button type="button" onClick={() => void copy(waitlistReferralUrl(rankResult.referralCode), "Referral link")}>COPY REFERRAL LINK</button>
              </div>
            </> : <p>No waitlist entry matches that wallet or referral code.</p>}
          </div>
        )}

        <div className="waitlist-gtd-banner"><strong>TOP 50</strong><span>ON THE LEADERBOARD WILL RECEIVE GTD.</span></div>

        <div className="waitlist-leaderboard">
          <div className="waitlist-board-head"><span>RANK</span><span>WALLET</span><span>JOIN #</span><span>REFERRALS</span><span>POINTS</span></div>
          {state.leaderboard.length ? state.leaderboard.map((entry) => (
            <div className={`waitlist-board-row${entry.id === state.entry?.id ? " current" : ""}`} key={entry.id}>
              <strong>#{entry.rank}</strong><span>{entry.walletAddress}</span><span>{padJoinNumber(entry.joinNumber)}</span><span>{entry.referralCount}</span><b>{entry.points}</b>
            </div>
          )) : <div className="waitlist-board-empty">BE THE FIRST WALLET IN THE HOOD.</div>}
        </div>
      </section>

      {(message || error) && <div className={`waitlist-toast${error ? " error" : ""}`} role="status"><strong>{error ? "WAITLIST ERROR" : "HOOD UPDATE"}</strong><span>{error || message}</span><button type="button" onClick={() => { setMessage(""); setError(""); }}>×</button></div>}
    </>
  );
}
