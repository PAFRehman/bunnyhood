"use client";

import Image from "next/image";
import { FormEvent, type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FeedTheBunny, type BunnyUiState } from "./feed-the-bunny";

type TaskType = "follow" | "like" | "repost" | "comment" | "notifications";
type PrizeType = "GTD" | "FCFS1" | "FCFS2";
type ShopSpotType = "GTD" | "FCFS";
type SpinResult = PrizeType | "NONE" | "REFUND";

type WheelState = {
  authenticated: boolean;
  storageSafetyPaused: boolean;
  wheelAvailable: boolean;
  walletChangesAllowed: boolean;
  walletSubmissionsAllowed: boolean;
  user?: {
    id: string;
    xUserId: string;
    xUsername: string;
    xName: string;
    spinsEarned: number;
    spinsAvailable: number;
    spinsUsed: number;
    points: number;
    pointsEarned: number;
    pointsSpent: number;
    totalWins: number;
    roleWins: Record<PrizeType, number>;
  };
  referral?: {
    code: string;
    successfulReferrals: number;
    spinsEarned: number;
  };
  community: { connectedUsers: number };
  campaign: null | {
    id: string;
    title: string;
    roundNumber: number;
    tweetUrl: string;
    shopPostText: string;
    postTaskRequiresTag: boolean;
    startsAt: string;
    endsAt: string;
  };
  claimedTasks?: TaskType[];
  taskStarts?: Array<{ taskType: TaskType; readyAt: string; waitMs: number }>;
  codeRedemption?: null | { awardedSpins: number };
  postTask?: { completed: boolean; postUrl?: string; pointsAwarded?: number; verifiedAt?: string };
  bunny?: BunnyUiState;
  shop?: Array<{
    spotType: ShopSpotType;
    pointsPrice: number;
    totalCount: number;
    purchasedCount: number;
    remaining: number;
    purchasedByUser: boolean;
    winId: string | null;
  }>;
  wins?: Array<{
    id: string;
    prizeType: PrizeType;
    wonAt: string;
    wallet: string | null;
    walletSubmittedAt: string | null;
    source: "wheel" | "shop" | "bunny";
    shopSpotType: ShopSpotType | null;
    bunnyRewardType: ShopSpotType | null;
  }>;
};

type SpinOutcome = {
  eventId: string;
  result: SpinResult;
  spinsLeft: number;
  spinsUsed: number;
  totalWins: number;
  winId?: string;
};

type SpinBatchResponse = {
  batchId: string;
  requested: number;
  processed: number;
  consumedSpins: number;
  spinsLeft: number;
  spinsUsed: number;
  totalWins: number;
  results: SpinOutcome[];
  summary: {
    none: number;
    refunded: number;
    GTD: number;
    FCFS1: number;
    FCFS2: number;
  };
};

type ApiError = { error?: string; code?: string };

class ApiRequestError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly status?: number,
  ) {
    super(message);
  }
}

const PROJECT_X_URL = "https://x.com/BunnysHood";

const TASKS: Array<{ id: TaskType; action: string; eyebrow: string; title: string; copy: string; target: "profile" | "post" }> = [
  { id: "follow", action: "Follow", eyebrow: "01 · JOIN", title: "Follow Bunny Hood", copy: "Open the Bunny Hood X profile and follow the account properly.", target: "profile" },
  { id: "like", action: "Like", eyebrow: "02 · SUPPORT", title: "Like the post", copy: "Open the campaign post and like it properly on X.", target: "post" },
  { id: "repost", action: "Retweet", eyebrow: "03 · SHARE", title: "Retweet the post", copy: "Open the campaign post and retweet it properly on X.", target: "post" },
  { id: "comment", action: "Comment", eyebrow: "04 · SPEAK", title: "Leave a comment", copy: "Open the campaign post and leave a genuine reply.", target: "post" },
  { id: "notifications", action: "Turn notifications on", eyebrow: "05 · STAY CLOSE", title: "Turn notifications on", copy: "Open the Bunny Hood X profile and turn on post notifications properly.", target: "profile" },
];

type TaskTimer = { intervalId: number; claimId?: number };

const SEGMENTS: Array<{ label: string; result: PrizeType | "NONE" }> = [
  { label: "GTD", result: "GTD" },
  { label: "KEEP GOING", result: "NONE" },
  { label: "FCFS2", result: "FCFS2" },
  { label: "KEEP GOING", result: "NONE" },
  { label: "FCFS1", result: "FCFS1" },
  { label: "KEEP GOING", result: "NONE" },
  { label: "GTD", result: "GTD" },
  { label: "KEEP GOING", result: "NONE" },
  { label: "FCFS2", result: "FCFS2" },
  { label: "KEEP GOING", result: "NONE" },
  { label: "FCFS1", result: "FCFS1" },
  { label: "KEEP GOING", result: "NONE" },
];

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
  if (!response.ok) {
    throw new ApiRequestError(
      data.error || "The request could not be completed.",
      data.code,
      response.status,
    );
  }
  return data;
}

function xShareUrl(text: string, url: string) {
  const params = new URLSearchParams({ text, url });
  return `https://x.com/intent/post?${params.toString()}`;
}

function WalletForm({
  winId,
  currentWallet,
  onSaved,
}: {
  winId: string;
  currentWallet?: string | null;
  onSaved: (notice: string) => Promise<void>;
}) {
  const [wallet, setWallet] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      await requestJson<{ stored: boolean }>(`/api/spin/wins/${winId}/wallet`, {
        method: "POST",
        body: JSON.stringify({ wallet }),
      });
      setWallet("");
      await onSaved("Wallet saved securely in Bunny Hood records.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Wallet could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function removeWallet() {
    if (!currentWallet || !window.confirm("Remove this wallet from the win? You can submit another wallet while changes remain enabled.")) return;
    setBusy(true);
    setMessage("");
    try {
      await requestJson<{ stored: boolean }>(`/api/spin/wins/${winId}/wallet`, {
        method: "DELETE",
      });
      await onSaved("Wallet removed from the win. Its private anti-reuse record remains protected.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Wallet could not be removed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="win-wallet-form" onSubmit={submit}>
      <label htmlFor={`wallet-${winId}`}>{currentWallet ? "Replace wallet for this win" : "Submit a wallet for this win"}</label>
      <div>
        <input
          id={`wallet-${winId}`}
          value={wallet}
          onChange={(event) => setWallet(event.target.value)}
          placeholder="0x..."
          autoComplete="off"
          spellCheck={false}
          required
        />
        <button disabled={busy}>{busy ? "Saving…" : currentWallet ? "Update wallet" : "Save wallet"}</button>
      </div>
      {currentWallet && <button className="remove-wallet-button" type="button" disabled={busy} onClick={removeWallet}>{busy ? "Please wait…" : "Remove wallet"}</button>}
      <small>Every win must use a different wallet.</small>
      {message && <p className="spin-error">{message}</p>}
    </form>
  );
}

export function SpinWheelApp() {
  const [state, setState] = useState<WheelState | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [taskSeconds, setTaskSeconds] = useState<Partial<Record<TaskType, number>>>({});
  const [taskWorking, setTaskWorking] = useState<Partial<Record<TaskType, boolean>>>({});
  const [redeemCode, setRedeemCode] = useState("");
  const [redeeming, setRedeeming] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const [batchSpinning, setBatchSpinning] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [result, setResult] = useState<SpinResult | null>(null);
  const [batchResult, setBatchResult] = useState<SpinBatchResponse["summary"] & { processed: number; consumed: number } | null>(null);
  const [incomingReferral] = useState(() => {
    if (typeof window === "undefined") return "";
    const value = new URLSearchParams(window.location.search).get("ref")?.trim().toLowerCase() ?? "";
    return /^[a-z0-9_]{3,24}$/.test(value) ? value : "";
  });
  const [origin] = useState(() => typeof window === "undefined" ? "https://www.bunnyhood.xyz" : window.location.origin);
  const [referralCode, setReferralCode] = useState("");
  const [savingReferral, setSavingReferral] = useState(false);
  const [postUrl, setPostUrl] = useState("");
  const [postTaskBusy, setPostTaskBusy] = useState(false);
  const [shopBusy, setShopBusy] = useState<ShopSpotType | null>(null);
  const [shopCelebration, setShopCelebration] = useState<{ spotType: ShopSpotType; pointsSpent: number } | null>(null);
  const [bunnyBusy, setBunnyBusy] = useState<"feed" | ShopSpotType | null>(null);
  const [bunnyAnimating, setBunnyAnimating] = useState(false);
  const [bunnyCelebration, setBunnyCelebration] = useState<ShopSpotType | null>(null);
  const revealTimer = useRef<number | null>(null);
  const bunnyAnimationTimer = useRef<number | null>(null);
  const pendingOutcome = useRef<SpinOutcome | null>(null);
  const skipRequested = useRef(false);
  const taskTimers = useRef<Partial<Record<TaskType, TaskTimer>>>({});

  const loadState = useCallback(async () => {
    try {
      const next = await requestJson<WheelState>("/api/spin/state");
      setState(next);
      if (next.referral?.code) setReferralCode(next.referral.code);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Spin data could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleWalletSaved = useCallback(async (notice: string) => {
    setMessage(notice);
    await loadState();
  }, [loadState]);

  useEffect(() => {
    const timers = taskTimers.current;
    const initialLoad = window.setTimeout(() => void loadState(), 0);
    return () => {
      window.clearTimeout(initialLoad);
      if (revealTimer.current) window.clearTimeout(revealTimer.current);
      if (bunnyAnimationTimer.current) window.clearTimeout(bunnyAnimationTimer.current);
      for (const timer of Object.values(timers)) {
        if (!timer) continue;
        window.clearInterval(timer.intervalId);
        if (timer.claimId) window.clearTimeout(timer.claimId);
      }
    };
  }, [loadState]);

  useEffect(() => {
    if (!message) return;
    const messageTimer = window.setTimeout(() => setMessage(""), 5_000);
    return () => window.clearTimeout(messageTimer);
  }, [message]);

  useEffect(() => {
    if (!state?.bunny?.nextFeedAt) return;
    const delay = Math.max(500, new Date(state.bunny.nextFeedAt).getTime() - Date.now() + 500);
    const utcResetTimer = window.setTimeout(() => void loadState(), delay);
    return () => window.clearTimeout(utcResetTimer);
  }, [loadState, state?.bunny?.nextFeedAt]);

  const claimed = useMemo(() => new Set(state?.claimedTasks ?? []), [state?.claimedTasks]);
  const visibleTasks = useMemo(
    () => TASKS.filter((task) => !((task.id === "follow" || task.id === "notifications") && claimed.has(task.id))),
    [claimed],
  );
  const referralLink = state?.referral?.code
    ? `${origin}/SpinTheWheel?ref=${encodeURIComponent(state.referral.code)}`
    : `${origin}/SpinTheWheel`;
  const referralShare = xShareUrl(
    "Join me in Bunny Hood. Connect X, complete the campaign, and spin with my invite link.",
    referralLink,
  );
  const connectHref = incomingReferral
    ? `/api/spin/auth/x/start?ref=${encodeURIComponent(incomingReferral)}`
    : "/api/spin/auth/x/start";

  const clearTaskTimer = useCallback((task: TaskType) => {
    const timer = taskTimers.current[task];
    if (timer) {
      window.clearInterval(timer.intervalId);
      if (timer.claimId) window.clearTimeout(timer.claimId);
      delete taskTimers.current[task];
    }
    setTaskSeconds((current) => {
      const next = { ...current };
      delete next[task];
      return next;
    });
  }, []);

  const claimStartedTask = useCallback(async (task: TaskType) => {
    clearTaskTimer(task);
    setTaskWorking((current) => ({ ...current, [task]: true }));
    try {
      for (let attempt = 0; attempt < 6; attempt += 1) {
        try {
          await requestJson("/api/spin/tasks/claim", {
            method: "POST",
            body: JSON.stringify({ task }),
          });
          break;
        } catch (error) {
          if (error instanceof ApiRequestError && error.code === "TASK_TIMER_ACTIVE" && attempt < 5) {
            await new Promise<void>((resolve) => window.setTimeout(resolve, 500));
            continue;
          }
          throw error;
        }
      }
      const action = TASKS.find((item) => item.id === task)?.action ?? "Task";
      setMessage(`${action} completed. +1 spin and +1 point were added automatically.`);
      await loadState();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The task reward could not be recovered.");
    } finally {
      setTaskWorking((current) => ({ ...current, [task]: false }));
    }
  }, [clearTaskTimer, loadState]);

  const scheduleTaskRecovery = useCallback((task: TaskType, readyAt: string, serverWaitMs?: number) => {
    if (taskTimers.current[task]) return;
    const parsedReadyTime = new Date(readyAt).getTime();
    const fallbackWaitMs = Number.isFinite(parsedReadyTime)
      ? Math.max(0, parsedReadyTime - Date.now())
      : 5_000;
    const waitMs = Number.isFinite(serverWaitMs) && Number(serverWaitMs) >= 0
      ? Number(serverWaitMs)
      : fallbackWaitMs;
    const localReadyTime = Date.now() + waitMs;
    const updateCountdown = () => {
      const seconds = Math.max(0, Math.ceil((localReadyTime - Date.now()) / 1000));
      setTaskSeconds((current) => ({ ...current, [task]: seconds }));
    };
    const intervalId = window.setInterval(updateCountdown, 250);
    const claimId = window.setTimeout(
      () => void claimStartedTask(task),
      waitMs + 500,
    );
    taskTimers.current[task] = { intervalId, claimId };
    window.setTimeout(updateCountdown, 0);
  }, [claimStartedTask]);

  useEffect(() => {
    for (const start of state?.taskStarts ?? []) {
      if (!claimed.has(start.taskType)) scheduleTaskRecovery(start.taskType, start.readyAt, start.waitMs);
    }
  }, [claimed, scheduleTaskRecovery, state?.taskStarts]);

  async function startTask(task: TaskType) {
    if (!state?.campaign || claimed.has(task) || taskTimers.current[task]) return;
    setTaskWorking((current) => ({ ...current, [task]: true }));
    setMessage("");
    const taskDefinition = TASKS.find((item) => item.id === task);
    const taskUrl = taskDefinition?.target === "profile" ? PROJECT_X_URL : state.campaign.tweetUrl;
    window.open(taskUrl, "_blank", "noopener,noreferrer");
    try {
      const started = await requestJson<{ completed: boolean; alreadyClaimed: boolean; spinsAwarded: number; readyAt: string; waitMs: number }>("/api/spin/tasks/start", {
        method: "POST",
        body: JSON.stringify({ task }),
      });
      if (started.alreadyClaimed) {
        setMessage(task === "follow" || task === "notifications"
          ? "This one-time task is already completed for your account."
          : "This task was already completed for the current round.");
        await loadState();
      } else {
        scheduleTaskRecovery(task, started.readyAt, started.waitMs);
        setMessage("Complete the action properly on X. Your reward will be added automatically.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The task could not be completed.");
      await loadState();
    } finally {
      setTaskWorking((current) => ({ ...current, [task]: false }));
    }
  }

  async function redeem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRedeeming(true);
    setMessage("");
    try {
      const reply = await requestJson<{ awardedSpins: number }>("/api/spin/redeem", {
        method: "POST",
        body: JSON.stringify({ code: redeemCode }),
      });
      setMessage(`${reply.awardedSpins} spins added to your profile.`);
      setRedeemCode("");
      await loadState();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Code could not be redeemed.");
    } finally {
      setRedeeming(false);
    }
  }

  async function submitPostTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPostTaskBusy(true);
    setMessage("");
    try {
      const reply = await requestJson<{ alreadyCompleted: boolean; pointsAwarded: number }>("/api/spin/post-task", {
        method: "POST",
        body: JSON.stringify({ postUrl }),
      });
      setPostUrl("");
      setMessage(reply.alreadyCompleted ? "This round's create-post reward is already secured." : `Post verified. +${reply.pointsAwarded} points added.`);
      await loadState();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The X post could not be verified.");
    } finally {
      setPostTaskBusy(false);
    }
  }

  async function purchaseSpot(spotType: ShopSpotType, pointsPrice: number) {
    if (!window.confirm(`Use ${pointsPrice} points to secure this campaign's ${spotType} spot?`)) return;
    setShopBusy(spotType);
    setMessage("");
    try {
      const reply = await requestJson<{ spotType: ShopSpotType; pointsSpent: number }>("/api/spin/shop/purchase", {
        method: "POST",
        body: JSON.stringify({ spotType, idempotencyKey: crypto.randomUUID() }),
      });
      setShopCelebration({ spotType: reply.spotType, pointsSpent: reply.pointsSpent });
      await loadState();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The spot could not be secured.");
      await loadState();
    } finally {
      setShopBusy(null);
    }
  }

  async function feedBunny() {
    if (!state?.bunny || !state.bunny.canFeed || state.user!.points < state.bunny.carrotCost || bunnyBusy) return;
    setBunnyBusy("feed");
    setBunnyAnimating(true);
    setMessage("");
    try {
      const reply = await requestJson<{ bunny: BunnyUiState; pointsSpent: number; startedNewCycleAfterDeath: boolean }>("/api/spin/bunny/feed", {
        method: "POST",
        body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }),
      });
      setMessage(reply.startedNewCycleAfterDeath
        ? "Your previous Bunny died from hunger. This carrot started a fresh evolution cycle at day 1."
        : reply.bunny.gtdEligible
          ? "Carrot delivered. A rare evolution exchange is now unlocked below."
          : reply.bunny.fcfsEligible
            ? "Carrot delivered. FCFS selling is unlocked—you can sell now or keep evolving."
            : `Carrot delivered. Day ${reply.bunny.streakDays} of the evolution is complete.`);
      await loadState();
      if (bunnyAnimationTimer.current) window.clearTimeout(bunnyAnimationTimer.current);
      bunnyAnimationTimer.current = window.setTimeout(() => setBunnyAnimating(false), 1_900);
    } catch (error) {
      setBunnyAnimating(false);
      setMessage(error instanceof Error ? error.message : "The Bunny could not be fed.");
      await loadState();
    } finally {
      setBunnyBusy(null);
    }
  }

  async function tradeBunny(rewardType: ShopSpotType) {
    const eligible = rewardType === "GTD" ? state?.bunny?.gtdEligible : state?.bunny?.fcfsEligible;
    if (!eligible || bunnyBusy) return;
    if (!window.confirm(`Sell this evolved Bunny for ${rewardType}? This begins a new Bunny cycle.`)) return;
    setBunnyBusy(rewardType);
    setMessage("");
    try {
      const reply = await requestJson<{ rewardType: ShopSpotType }>("/api/spin/bunny/trade", {
        method: "POST",
        body: JSON.stringify({ rewardType, idempotencyKey: crypto.randomUUID() }),
      });
      setBunnyCelebration(reply.rewardType);
      await loadState();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The evolved Bunny could not be traded.");
      await loadState();
    } finally {
      setBunnyBusy(null);
    }
  }

  async function saveReferralCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingReferral(true);
    setMessage("");
    try {
      await requestJson("/api/spin/referral/code", {
        method: "POST",
        body: JSON.stringify({ code: referralCode }),
      });
      setMessage("Your custom invite code is live. New shares now use it.");
      await loadState();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Invite code could not be saved.");
    } finally {
      setSavingReferral(false);
    }
  }

  async function copyReferralLink() {
    try {
      await navigator.clipboard.writeText(referralLink);
      setMessage("Referral link copied.");
    } catch {
      setMessage("Copy this referral link from the field and share it with your community.");
    }
  }

  const finishSingleSpin = useCallback(async (outcome: SpinOutcome) => {
    pendingOutcome.current = null;
    skipRequested.current = false;
    revealTimer.current = null;
    setResult(outcome.result);
    setSpinning(false);
    await loadState();
  }, [loadState]);

  async function spinOne() {
    if (!state?.wheelAvailable || !state.user || spinning || batchSpinning || state.user.spinsAvailable < 1) return;
    setSpinning(true);
    setResult(null);
    setBatchResult(null);
    setMessage("");
    skipRequested.current = false;
    try {
      const reply = await requestJson<SpinBatchResponse>("/api/spin/play", {
        method: "POST",
        body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), count: 1 }),
      });
      const outcome = reply.results[0];
      pendingOutcome.current = outcome;
      if (skipRequested.current) {
        await finishSingleSpin(outcome);
        return;
      }
      const visualResult = outcome.result === "REFUND" ? "NONE" : outcome.result;
      const candidates = SEGMENTS.map((segment, index) => ({ segment, index }))
        .filter((item) => item.segment.result === visualResult);
      const chosen = candidates[Math.floor(Math.random() * candidates.length)] ?? { index: 1 };
      const centerAngle = chosen.index * 30 + 15;
      const normalized = ((rotation % 360) + 360) % 360;
      const target = rotation + 5 * 360 + ((360 - centerAngle - normalized + 360) % 360);
      setRotation(target);
      revealTimer.current = window.setTimeout(() => void finishSingleSpin(outcome), 4_400);
    } catch (error) {
      setSpinning(false);
      setMessage(error instanceof Error ? error.message : "The wheel could not spin.");
    }
  }

  function skipAnimation() {
    if (!pendingOutcome.current) {
      skipRequested.current = true;
      return;
    }
    if (revealTimer.current) window.clearTimeout(revealTimer.current);
    const outcome = pendingOutcome.current;
    void finishSingleSpin(outcome);
  }

  async function spinAll() {
    if (!state?.wheelAvailable || !state.user || spinning || batchSpinning || state.user.spinsAvailable < 1) return;
    setBatchSpinning(true);
    setResult(null);
    setBatchResult(null);
    setMessage("");
    const targetAttempts = state.user.spinsAvailable;
    let attemptsLeft = targetAttempts;
    const combined = { none: 0, refunded: 0, GTD: 0, FCFS1: 0, FCFS2: 0 };
    let consumed = 0;
    let processed = 0;
    try {
      while (attemptsLeft > 0) {
        const reply = await requestJson<SpinBatchResponse>("/api/spin/play", {
          method: "POST",
          body: JSON.stringify({
            idempotencyKey: crypto.randomUUID(),
            count: Math.min(100, attemptsLeft),
          }),
        });
        combined.none += reply.summary.none;
        combined.refunded += reply.summary.refunded;
        combined.GTD += reply.summary.GTD;
        combined.FCFS1 += reply.summary.FCFS1;
        combined.FCFS2 += reply.summary.FCFS2;
        consumed += reply.consumedSpins;
        processed += reply.processed;
        attemptsLeft -= reply.processed;
        if (reply.processed < 1) break;
      }
      setBatchResult({ ...combined, processed, consumed });
      await loadState();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Your spins could not be processed.");
      await loadState();
    } finally {
      setBatchSpinning(false);
    }
  }

  async function logout() {
    try {
      await requestJson("/api/spin/auth/logout", { method: "POST", body: "{}" });
      await loadState();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Sign out failed.");
    }
  }

  const winShareHref = (prizeType: PrizeType) => xShareUrl(
    `I won ${prizeType} on the Bunny Hood wheel. Join the Hood with my invite link.`,
    referralLink,
  );

  return (
    <>
      <section className="spin-hero">
        <div className="spin-grid" />
        <div className="spin-hero-copy">
          <p className="section-kicker"><span className="live-dot" /> CAMPAIGN REWARDS</p>
          <div className="spin-hero-title">
            <div className="spin-hero-logo"><Image src="/assets/bunny-hood-logo.png" alt="Bunny Hood" width={2048} height={1732} sizes="(max-width: 690px) 126px, 235px" priority /></div>
            <h1>SPIN<br /><em>THE HOOD.</em></h1>
          </div>
          <p>Connect X, complete each campaign task, redeem the live code, and Spin the Wheel.</p>
          <div className="community-proof" aria-label="Bunny Hood connected community">
            <div><strong>{state?.community.connectedUsers ?? 0}</strong><span>UNIQUE X USERS CONNECTED</span></div>
          </div>
        </div>
      </section>

      <section className="spin-console">
        {loading && <div className="spin-loading">Loading the Hood…</div>}
        {!loading && state?.storageSafetyPaused && (
          <section className="storage-safety-pause">
            <span>HOOD DATA SAFETY PAUSE</span>
            <h2>Next spin batch<br /><em>coming soon.</em></h2>
            <p>The wheel, tasks, codes, referrals, X connections, and wallet actions are temporarily paused to protect every stored point, spin, referral, role, and wallet.</p>
            <a href="https://x.com/BunnysHood" target="_blank" rel="noreferrer">Stay connected on X</a>
          </section>
        )}
        {!loading && !state?.storageSafetyPaused && !state?.authenticated && (
          <div className="connect-panel">
            <div>
              <p className="section-kicker">ONE ACCOUNT · SAVED FOREVER</p>
              <h2>Connect your<br /><em>X profile.</em></h2>
              <p>Your X ID is the permanent account key. Returning users recover points, spins, referrals, wins, and pending wallet submissions.</p>
              {incomingReferral && <div className="incoming-referral">INVITE CODE · {incomingReferral}</div>}
            </div>
            <a className="x-connect-button" href={connectHref}><span>Connect X</span><b>X</b></a>
          </div>
        )}

        {!loading && !state?.storageSafetyPaused && state?.authenticated && state.user && (
          <>
            <div className="profile-bar">
              <div><span>CONNECTED AS</span><strong>@{state.user.xUsername}</strong></div>
              <div><span>SPINS LEFT</span><strong>{state.user.spinsAvailable}</strong></div>
              <div><span>LIFETIME EARNED</span><strong>{state.user.spinsEarned}</strong></div>
              <div><span>POINTS BALANCE</span><strong>{state.user.points}</strong></div>
              <div><span>WINS</span><strong>{state.user.totalWins}/9</strong></div>
              <div><span>CONNECTED USERS</span><strong>{state.community.connectedUsers}</strong></div>
              <button type="button" onClick={logout}>Disconnect</button>
            </div>

            <div className="role-cap-strip" aria-label="Wins by role">
              <span>GTD <strong>{state.user.roleWins.GTD}/3</strong></span>
              <span>FCFS1 <strong>{state.user.roleWins.FCFS1}/3</strong></span>
              <span>FCFS2 <strong>{state.user.roleWins.FCFS2}/3</strong></span>
              <small>Each role is capped at three wins. A capped-role hit returns the spin.</small>
            </div>

            {state.campaign && (
              <section className="daily-campaign">
                <header>
                  <div><p className="section-kicker">LIVE CAMPAIGN · ROUND {String(state.campaign.roundNumber).padStart(2, "0")}</p><h2>{state.campaign.title}</h2></div>
                  <a href={state.campaign.tweetUrl} target="_blank" rel="noreferrer">Open post <span aria-hidden="true">X</span></a>
                </header>
                <div className="spin-task-list">
                  {visibleTasks.map((task) => (
                    <article className={claimed.has(task.id) ? "claimed" : ""} key={task.id}>
                      <div><span>{task.eyebrow}</span><h3>{task.title}</h3><p>{task.copy}</p></div>
                      <div className="spin-task-actions">
                        <button
                          type="button"
                          disabled={claimed.has(task.id) || taskWorking[task.id] || taskSeconds[task.id] !== undefined}
                          onClick={() => startTask(task.id)}
                        >
                          {claimed.has(task.id)
                            ? `${task.action} completed`
                            : taskSeconds[task.id] !== undefined
                              ? `${task.action} · ${taskSeconds[task.id]}s`
                              : task.action}
                        </button>
                      </div>
                    </article>
                  ))}
                  <article className={`post-point-task ${state.postTask?.completed ? "claimed" : ""}`}>
                    <div><span>06 · CREATE</span><h3>Post for the Hood</h3><p>Create a public X post from @{state.user.xUsername}{state.campaign.postTaskRequiresTag ? ", tag @BunnysHood," : ""} and earn 3 points for this round.</p></div>
                    {state.postTask?.completed ? <div className="spin-task-actions"><a href={state.postTask.postUrl} target="_blank" rel="noreferrer">Verified · +3 points</a></div> : <div className="post-task-controls"><a className="create-post-button" href={xShareUrl(state.campaign.shopPostText, "")} target="_blank" rel="noreferrer">Create post on X</a><form onSubmit={submitPostTask}><label htmlFor="spin-post-url">Paste your published post URL</label><div><input id="spin-post-url" type="url" value={postUrl} onChange={(event) => setPostUrl(event.target.value)} placeholder="https://x.com/you/status/..." required /><button disabled={postTaskBusy}>{postTaskBusy ? "Verifying…" : "Verify +3"}</button></div></form></div>}
                  </article>
                </div>
              </section>
            )}

            {state.bunny && <FeedTheBunny bunny={state.bunny} points={state.user.points} roleWins={state.user.roleWins} busy={bunnyBusy} animating={bunnyAnimating} onFeed={feedBunny} onTrade={tradeBunny} />}

            {state.bunny && (
              <section className="hood-shop" id="hood-shop">
                <div className="shop-noise" aria-hidden="true" />
                <header><div><p className="section-kicker">{state.campaign ? `POINTS MARKET · ROUND ${String(state.campaign.roundNumber).padStart(2, "0")}` : "DAILY POINTS MARKET"}</p><h2>THE HOOD<br /><em>SHOP.</em></h2></div><div className="shop-balance"><span>AVAILABLE BALANCE</span><strong>{state.user.points}</strong><small>{state.user.pointsEarned} earned · {state.user.pointsSpent} spent</small></div></header>
                <div className="shop-products">
                  <article className={`shop-product shop-carrot ${state.bunny.diedFromHunger ? "bunny-starved" : ""}`}>
                    <div className="shop-product-index">01 · DAILY</div>
                    <div><span>FEED THE BUNNYHOOD</span><h3>CARROT</h3><p>Buy today&apos;s carrot and feed your Bunny instantly. One carrot is available per connected user each UTC day.</p></div>
                    <div className="shop-price"><strong>{state.bunny.carrotCost}</strong><span>POINTS</span></div>
                    <div className="shop-stock"><span>DAILY STATUS</span><strong>{state.bunny.fedToday ? "FED" : "READY"}</strong></div>
                    <button type="button" disabled={!state.bunny.canFeed || state.user.points < state.bunny.carrotCost || bunnyBusy !== null} onClick={feedBunny}>{bunnyBusy === "feed" ? "FEEDING…" : state.bunny.fedToday ? "FED TODAY · RETURNS 00:00 UTC" : state.user.points < state.bunny.carrotCost ? `NEED ${state.bunny.carrotCost - state.user.points} MORE POINT${state.bunny.carrotCost - state.user.points === 1 ? "" : "S"}` : "BUY CARROT & FEED NOW"}</button>
                  </article>
                  {(state.shop ?? []).map((item) => {
                    const roleFull = item.spotType === "GTD" ? state.user!.roleWins.GTD >= 3 : state.user!.roleWins.FCFS1 >= 3;
                    const disabled = item.purchasedByUser || item.remaining < 1 || state.user!.points < item.pointsPrice || roleFull || Boolean(shopBusy);
                    const status = item.purchasedByUser ? "SECURED" : item.remaining < 1 ? "SOLD OUT" : roleFull ? "ROLE LIMIT REACHED" : state.user!.points < item.pointsPrice ? `NEED ${item.pointsPrice - state.user!.points} MORE` : "CLAIM WITH POINTS";
                    return <article className={`shop-product shop-${item.spotType.toLowerCase()}`} key={item.spotType}><div className="shop-product-index">{item.spotType === "GTD" ? "02" : "03"}</div><div><span>{item.spotType === "GTD" ? "GUARANTEED WHITELIST" : "FIRST COME · FIRST SERVED"}</span><h3>{item.spotType}</h3><p>{item.spotType === "GTD" ? "Lock a guaranteed whitelist position from this campaign pool." : "Secure an FCFS access position using points you earned in the Hood."}</p></div><div className="shop-price"><strong>{item.pointsPrice}</strong><span>POINTS</span></div><div className="shop-stock"><span>UP FOR GRABS</span><strong>{item.remaining} <small>/ {item.totalCount}</small></strong></div><button type="button" disabled={disabled} onClick={() => purchaseSpot(item.spotType, item.pointsPrice)}>{shopBusy === item.spotType ? "SECURING…" : status}</button></article>;
                  })}
                </div>
              </section>
            )}

            <section className="redeem-panel">
              {state.campaign ? (
                <>
                  <div className="redeem-bar-copy">
                    <p className="section-kicker">CAMPAIGN CODE DROP</p>
                    <h2>Unlock<br /><em>10–20 spins.</em></h2>
                    <p>Each campaign code can be redeemed once per connected X account. Every new campaign opens a fresh redemption.</p>
                  </div>
                  <div className="redeem-bar-action">
                    {state.codeRedemption ? (
                      <div className="redeemed-code"><span>CODE REDEEMED</span><strong>+{state.codeRedemption.awardedSpins} SPINS</strong></div>
                    ) : (
                      <form onSubmit={redeem}>
                        <label htmlFor="spin-code">Enter current code</label>
                        <div><input id="spin-code" value={redeemCode} onChange={(event) => setRedeemCode(event.target.value)} placeholder="BUNNY-XXXX" required /><button disabled={redeeming}>{redeeming ? "Checking…" : "Redeem"}</button></div>
                      </form>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div className="redeem-bar-copy">
                    <p className="section-kicker">BETWEEN DAILY ROUNDS</p>
                    <h2>Saved spins<br /><em>stay ready.</em></h2>
                    <p>{state.wheelAvailable
                      ? "Daily tasks and code redemption are paused, but saved and referral spins can still use the latest prize pool."
                      : "Referral tools are live. The first prize pool must be started in the admin panel before any spin can be used."}</p>
                  </div>
                  <div className="redeem-bar-action">
                    <div className="redeemed-code">
                      <span>{state.wheelAvailable ? "WHEEL AVAILABLE" : "PRIZE POOL NOT READY"}</span>
                      <strong>{state.wheelAvailable ? `${state.user.spinsAvailable} SAVED SPINS` : "NO SPINS WILL BE USED"}</strong>
                    </div>
                  </div>
                </>
              )}
            </section>

            <section className="wheel-panel">
              <div className="wheel-pointer" aria-hidden="true" />
              <div className="prize-wheel" style={{ "--spin-rotation": `${rotation}deg` } as CSSProperties}>
                {SEGMENTS.map((segment, index) => (
                  <span key={`${segment.label}-${index}`} style={{ "--segment-angle": `${index * 30 + 15}deg` } as CSSProperties}>{segment.label}</span>
                ))}
                <i className="wheel-core">BH</i>
              </div>
              <div className="wheel-actions">
                <button type="button" onClick={spinOne} disabled={!state.wheelAvailable || spinning || batchSpinning || state.user.spinsAvailable < 1}>{!state.wheelAvailable ? "Prize pool not ready" : spinning ? "Spinning…" : state.user.spinsAvailable < 1 ? "Earn a spin first" : "Spin one"}</button>
                <button type="button" onClick={spinAll} disabled={!state.wheelAvailable || spinning || batchSpinning || state.user.spinsAvailable < 1}>{!state.wheelAvailable ? "Prize pool not ready" : batchSpinning ? "Processing…" : `Spin all · ${state.user.spinsAvailable}`}</button>
              </div>
              {spinning && <button className="skip-spin-button" type="button" onClick={skipAnimation}>Skip animation</button>}
              {result && (
                <div className={`spin-result ${result === "NONE" || result === "REFUND" ? "none" : "winner"}`} role="status">
                  <span>{result === "NONE" ? "KEEP GOING" : result === "REFUND" ? "SPIN RETURNED" : "WINNER"}</span>
                  <strong>{result === "NONE" ? "No prize this spin." : result === "REFUND" ? "Your role cap protected this spin." : `You won ${result}.`}</strong>
                  <p>{result === "NONE" ? "Your next spin could be the one." : result === "REFUND" ? "Nothing was deducted. You can spin it again." : state.walletSubmissionsAllowed ? "Submit a fresh EVM wallet in your profile below." : "Your win is saved. Wallet submission will open when Bunny Hood enables it."}</p>
                  {result !== "NONE" && result !== "REFUND" && <a href={winShareHref(result)} target="_blank" rel="noreferrer">Share win on X</a>}
                </div>
              )}
              {batchResult && (
                <div className="batch-result" role="status">
                  <strong>{batchResult.processed} attempts processed</strong>
                  <span>{batchResult.GTD} GTD · {batchResult.FCFS1} FCFS1 · {batchResult.FCFS2} FCFS2</span>
                  <small>{batchResult.consumed} spins used · {batchResult.refunded} returned</small>
                  {(batchResult.GTD + batchResult.FCFS1 + batchResult.FCFS2) > 0 && <a href={xShareUrl("I just won on the Bunny Hood wheel. Join with my invite link.", referralLink)} target="_blank" rel="noreferrer">Share results on X</a>}
                </div>
              )}
            </section>

            <section className="spin-profile" id="spin-profile">
              <header><div><p className="section-kicker">YOUR HOOD PROFILE</p><h2>Wins &amp;<br /><em>wallets.</em></h2></div><p>You can win each role up to three times, for nine total wins. Each win requires a different wallet. {!state.walletSubmissionsAllowed ? "Wallet submissions are temporarily paused; every win remains saved." : state.walletChangesAllowed ? "Wallet submissions, replacements, and removals are currently enabled." : "New wallet submissions are enabled, while saved wallets are locked."}</p></header>
              {!state.wins?.length && <div className="empty-wins">No wins yet. Complete the campaign, redeem the code, invite the Hood, and keep spinning.</div>}
              <div className="wins-list">
                {state.wins?.map((win, index) => (
                  <article key={win.id}>
                    <div className="win-number">{String(state.wins!.length - index).padStart(2, "0")}</div>
                    <div><span>{new Date(win.wonAt).toLocaleString()} · {win.source === "shop" ? "POINTS SHOP" : win.source === "bunny" ? "BUNNY TRADE" : "WHEEL"}</span><h3>{win.bunnyRewardType ?? win.shopSpotType ?? win.prizeType}</h3><a className="win-share-link" href={winShareHref(win.prizeType)} target="_blank" rel="noreferrer">Share on X</a></div>
                    {win.wallet ? (
                      <div className="wallet-entry">
                        <div className="locked-wallet"><span>{state.walletSubmissionsAllowed && state.walletChangesAllowed ? "CURRENT WALLET" : "LOCKED WALLET"}</span><strong>{win.wallet.slice(0, 8)}…{win.wallet.slice(-6)}</strong><small>{!state.walletSubmissionsAllowed ? "Wallet submissions paused by admin" : state.walletChangesAllowed ? "Admin currently allows changes" : "Changes disabled by admin"}</small></div>
                        {state.walletSubmissionsAllowed && state.walletChangesAllowed && <WalletForm winId={win.id} currentWallet={win.wallet} onSaved={handleWalletSaved} />}
                      </div>
                    ) : state.walletSubmissionsAllowed
                      ? <WalletForm winId={win.id} onSaved={handleWalletSaved} />
                      : <div className="wallet-paused"><span>WALLET SUBMISSION PAUSED</span><p>Your prize is saved. Return here after Bunny Hood enables wallet submissions.</p></div>}
                  </article>
                ))}
              </div>
            </section>

            <section className="referral-panel">
              <div>
                <p className="section-kicker">INVITE THE HOOD</p>
                <h2>Earn 3 spins<br /><em>per referral.</em></h2>
                <p>A referral succeeds once a new X account connects through your link. Each X account can credit only one inviter.</p>
                <div className="referral-stats">
                  <div><span>SUCCESSFUL</span><strong>{state.referral?.successfulReferrals ?? 0}</strong></div>
                  <div><span>SPINS EARNED</span><strong>{state.referral?.spinsEarned ?? 0}</strong></div>
                </div>
              </div>
              <div className="referral-controls">
                <form onSubmit={saveReferralCode}>
                  <label htmlFor="referral-code">Custom username-style invite code</label>
                  <div><input id="referral-code" value={referralCode} onChange={(event) => setReferralCode(event.target.value.toLowerCase())} minLength={3} maxLength={24} pattern="[a-z0-9_]+" required /><button disabled={savingReferral}>{savingReferral ? "Saving…" : "Save code"}</button></div>
                </form>
                <label htmlFor="referral-link">Your permanent referral link</label>
                <div className="referral-link-row"><input id="referral-link" value={referralLink} readOnly /><button type="button" onClick={copyReferralLink}>Copy</button></div>
                <a className="share-x-button" href={referralShare} target="_blank" rel="noreferrer">Share referral link on X</a>
              </div>
            </section>
          </>
        )}
        {message && <div className="spin-message" role="status">{message}</div>}
      </section>
      {shopCelebration && <div className="shop-celebration" role="dialog" aria-modal="true" aria-label={`${shopCelebration.spotType} secured`}><div className="shop-confetti" aria-hidden="true">{Array.from({ length: 18 }, (_, index) => <i key={index} style={{ "--confetti": index } as CSSProperties} />)}</div><div className="shop-celebration-ring"><span>BH</span></div><p>ACCESS ACQUIRED</p><h2>{shopCelebration.spotType}<br /><em>SECURED.</em></h2><strong>{shopCelebration.pointsSpent} POINTS USED</strong><small>Your permanent win is saved. Add its receiving wallet in your Hood profile.</small><button type="button" onClick={() => { setShopCelebration(null); document.getElementById("spin-profile")?.scrollIntoView({ behavior: "smooth" }); }}>Add receiving wallet</button></div>}
      {bunnyCelebration && <div className="shop-celebration bunny-trade-celebration" role="dialog" aria-modal="true" aria-label={`${bunnyCelebration} Bunny sale complete`}><div className="shop-confetti" aria-hidden="true">{Array.from({ length: 18 }, (_, index) => <i key={index} style={{ "--confetti": index } as CSSProperties} />)}</div><div className="shop-celebration-ring"><span>BH</span></div><p>EVOLUTION SOLD</p><h2>{bunnyCelebration}<br /><em>IS YOURS.</em></h2><strong>NEW BUNNY CYCLE UNLOCKED</strong><small>Your permanent win is saved. Add its receiving wallet in your Hood profile.</small><button type="button" onClick={() => { setBunnyCelebration(null); document.getElementById("spin-profile")?.scrollIntoView({ behavior: "smooth" }); }}>Add receiving wallet</button></div>}
    </>
  );
}
