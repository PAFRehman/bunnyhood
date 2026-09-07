"use client";

import { useEffect, useState } from "react";

function CountdownUnit({ value, label }: { value: number; label: string }) {
  const formatted = String(value).padStart(2, "0");
  return (
    <span className="ld-countdown-unit">
      <strong key={`${label}-${formatted}`}>{formatted}</strong>
      <small>{label}</small>
    </span>
  );
}

export function LastDanceMintCountdown({ target }: { target: string | null }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!target) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [target]);

  const targetTime = target ? Date.parse(target) : Number.NaN;
  if (!Number.isFinite(targetTime)) {
    return (
      <div className="ld-mint-countdown pending" role="status">
        <i className="ld-countdown-beam" aria-hidden="true" />
        <div className="ld-countdown-head"><span><i /> OFFICIAL OPENSEA MINT</span><em>GTD WINDOW</em></div>
        <div className="ld-countdown-status"><strong>TIME ANNOUNCING SOON</strong><small>STAY LOCKED IN</small></div>
        <p className="ld-countdown-foot"><span>THE LAST DANCE</span><b>ROBINHOOD CHAIN · 4663</b></p>
      </div>
    );
  }
  const distance = targetTime - now;
  if (distance <= 0) {
    return (
      <div className="ld-mint-countdown live" role="status">
        <i className="ld-countdown-beam" aria-hidden="true" />
        <div className="ld-countdown-head"><span><i /> OFFICIAL OPENSEA MINT</span><em>LIVE NOW</em></div>
        <div className="ld-countdown-status"><strong>MINT IS LIVE</strong><small>THE FLOOR IS OPEN</small></div>
        <p className="ld-countdown-foot"><span>THE LAST DANCE</span><b>ROBINHOOD CHAIN · 4663</b></p>
      </div>
    );
  }
  const days = Math.floor(distance / 86_400_000);
  const hours = Math.floor((distance % 86_400_000) / 3_600_000);
  const minutes = Math.floor((distance % 3_600_000) / 60_000);
  const seconds = Math.floor((distance % 60_000) / 1_000);
  return (
    <div
      className="ld-mint-countdown"
      role="timer"
      aria-label={`OpenSea mint opens in ${days} days, ${hours} hours, ${minutes} minutes, and ${seconds} seconds`}
    >
      <i className="ld-countdown-beam" aria-hidden="true" />
      <div className="ld-countdown-head"><span><i /> OFFICIAL OPENSEA MINT</span><em>GTD WINDOW</em></div>
      <div className="ld-countdown-grid" aria-hidden="true">
        <CountdownUnit value={days} label="DAYS" />
        <CountdownUnit value={hours} label="HRS" />
        <CountdownUnit value={minutes} label="MIN" />
        <CountdownUnit value={seconds} label="SEC" />
      </div>
      <p className="ld-countdown-foot"><span>THE LAST DANCE</span><b>ROBINHOOD CHAIN · 4663</b></p>
    </div>
  );
}
