"use client";

import Image from "next/image";
import { type CSSProperties, useEffect, useMemo, useState } from "react";

export type BunnyUiState = {
  carrotCost: number;
  cycleNumber: number;
  streakDays: number;
  longestStreak: number;
  totalCarrots: number;
  totalTrades: number;
  targetDays: number;
  daysUntilEvolution: number;
  evolutionLevel: number;
  evolutionName: string;
  progressPercent: number;
  fedToday: boolean;
  canFeed: boolean;
  tradeReady: boolean;
  fcfsEligible: boolean;
  gtdEligible: boolean;
  canSellForPoints: boolean;
  pointSaleValue: number;
  diedFromHunger: boolean;
  deathOnBreak: boolean;
  deathCount: number;
  lastFedDay: string | null;
  nextFeedAt: string;
};

type BunnyAction = "feed" | "GTD" | "FCFS" | "POINTS" | null;

function countdownUntil(iso: string) {
  const remaining = Math.max(0, new Date(iso).getTime() - Date.now());
  const hours = Math.floor(remaining / 3_600_000);
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1_000);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function FeedTheBunny({
  bunny,
  points,
  busy,
  animating,
  onFeed,
}: {
  bunny: BunnyUiState;
  points: number;
  busy: BunnyAction;
  animating: boolean;
  onFeed: () => void;
}) {
  const [countdown, setCountdown] = useState(() => countdownUntil(bunny.nextFeedAt));
  useEffect(() => {
    const update = () => setCountdown(countdownUntil(bunny.nextFeedAt));
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [bunny.nextFeedAt]);

  const feedLabel = useMemo(() => {
    if (busy === "feed") return "FEEDING…";
    if (bunny.fedToday) return `FED TODAY · ${countdown}`;
    if (points < bunny.carrotCost) return `NEED ${bunny.carrotCost - points} MORE POINT${bunny.carrotCost - points === 1 ? "" : "S"}`;
    return `BUY & FEED CARROT · ${bunny.carrotCost} POINTS`;
  }, [busy, bunny, countdown, points]);

  return (
    <section className={`feed-the-bunny bunny-level-${bunny.evolutionLevel} ${animating ? "is-feeding" : ""} ${bunny.diedFromHunger ? "bunny-starved" : ""}`} id="feed-the-bunny">
      <div className="bunny-orbit bunny-orbit-one" aria-hidden="true" />
      <div className="bunny-orbit bunny-orbit-two" aria-hidden="true" />
      <header>
        <div><p className="section-kicker">DAILY POINTS RITUAL · 00:00 UTC</p><h2>FEED THE<br /><em>BUNNYHOOD.</em></h2><p>Feed your Bunny. Evolve it and sell it for FCFS or GTD.</p></div>
        <div className="bunny-cycle"><span>BUNNY CYCLE</span><strong>#{String(bunny.cycleNumber).padStart(2, "0")}</strong><small>{bunny.totalTrades} evolution{bunny.totalTrades === 1 ? "" : "s"} traded</small></div>
      </header>

      <div className="bunny-lab">
        <div className="bunny-habitat" aria-label={`${bunny.evolutionName}, evolution level ${bunny.evolutionLevel} of 4`}>
          <div className="bunny-energy" aria-hidden="true">{Array.from({ length: 12 }, (_, index) => <i key={index} style={{ "--spark": index } as CSSProperties} />)}</div>
          <div className="bunny-portrait">
            <Image src="/assets/bunny-hood-hero.webp" alt="Bunny Hood mascot" fill sizes="(max-width: 690px) 88vw, 520px" />
            <div className="bunny-feed-bite" aria-hidden="true"><i /><i /><i /></div>
            <div className="bunny-death-mask" aria-hidden="true"><i className="bunny-death-eye bunny-death-eye-left">×</i><i className="bunny-death-eye bunny-death-eye-right">×</i><strong>STARVED</strong><span>NO CARROTS</span></div>
            <div className="bunny-scan" aria-hidden="true" />
            <div className="bunny-crown" aria-hidden="true"><i /><i /><i /></div>
          </div>
          <div className="flying-carrot" aria-hidden="true"><i /><b /><b /><b /></div>
          <div className="bunny-feed-burst" aria-hidden="true"><strong>CRUNCH!</strong><span>+1 EVOLUTION DAY</span>{Array.from({ length: 9 }, (_, index) => <i key={index} style={{ "--crumb": index } as CSSProperties} />)}</div>
          <div className="bunny-stage-stamp"><span>STAGE {bunny.evolutionLevel}/4</span><strong>{bunny.evolutionName}</strong></div>
        </div>

        <div className="bunny-control-deck">
          {bunny.diedFromHunger && <div className="bunny-hunger-alert" role="alert"><strong>Your Bunny died from hunger.</strong><span>A full UTC feed day was missed, so this evolution reset. Feed a carrot to start again.</span></div>}
          <div className="bunny-streak-head"><div><span>CURRENT STREAK</span><strong>{bunny.streakDays}<small> DAYS</small></strong></div><div><span>BEST STREAK</span><strong>{bunny.longestStreak}<small> DAYS</small></strong></div></div>
          <div className="bunny-progress" aria-label={`${bunny.progressPercent}% evolved`}><i style={{ width: `${bunny.progressPercent}%` }} /></div>
          <div className="bunny-progress-copy"><span>EVOLUTION DAY {bunny.streakDays}</span><strong>{bunny.fcfsEligible || bunny.gtdEligible ? "ROLE EXCHANGE READY" : "KEEP EVOLVING"}</strong></div>
          <div className="bunny-milestones" aria-hidden="true">{[0, 1, 2, 3, 4].map((stage) => <i className={stage <= bunny.evolutionLevel ? "active" : ""} key={stage}><span>{stage}</span></i>)}</div>

          <button className="feed-carrot-button" type="button" disabled={!bunny.canFeed || points < bunny.carrotCost || busy !== null} onClick={onFeed}>{feedLabel}<span aria-hidden="true">🥕</span></button>
          <div className="bunny-feed-meta"><span>NEXT DAILY FEED</span><strong>{bunny.fedToday ? countdown : "AVAILABLE NOW"}</strong><small>{bunny.totalCarrots} total carrots fed{bunny.fcfsEligible ? " · keep evolving or sell below" : ""}</small></div>
          <a className="bunny-shop-prompt" href="#bunny-exchange">{bunny.canSellForPoints || bunny.fcfsEligible || bunny.gtdEligible ? "OPEN BUNNY EXCHANGE IN THE HOOD SHOP" : "KEEP EVOLVING"}</a>
        </div>
      </div>
    </section>
  );
}
