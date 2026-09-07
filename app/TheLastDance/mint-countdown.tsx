"use client";

import { useEffect, useState } from "react";

export function LastDanceMintCountdown({ target }: { target: string | null }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!target) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [target]);

  if (!target) {
    return <div className="ld-mint-countdown pending"><span>OPENSEA MINT</span><strong>TIME ANNOUNCING SOON</strong></div>;
  }
  const distance = new Date(target).getTime() - now;
  if (distance <= 0) {
    return <div className="ld-mint-countdown live"><span><i /> OPENSEA MINT</span><strong>MINT IS LIVE</strong></div>;
  }
  const days = Math.floor(distance / 86_400_000);
  const hours = Math.floor((distance % 86_400_000) / 3_600_000);
  const minutes = Math.floor((distance % 3_600_000) / 60_000);
  const seconds = Math.floor((distance % 60_000) / 1_000);
  return (
    <div className="ld-mint-countdown">
      <span>OPENSEA MINT OPENS IN</span>
      <div><b>{String(days).padStart(2, "0")}<small>DAYS</small></b><b>{String(hours).padStart(2, "0")}<small>HRS</small></b><b>{String(minutes).padStart(2, "0")}<small>MIN</small></b><b>{String(seconds).padStart(2, "0")}<small>SEC</small></b></div>
    </div>
  );
}
