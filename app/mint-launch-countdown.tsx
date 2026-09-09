"use client";

import { useEffect, useState } from "react";
import { LAST_DANCE_GTD_MINT_OPENS_AT, LAST_DANCE_OPENSEA_URL } from "@/lib/last-dance/mint";

function CountdownUnit({ value, label }: { value: number | null; label: string }) {
  return (
    <span className="mint-launch-unit">
      <strong key={`${label}-${value}`}>{value === null ? "--" : String(value).padStart(2, "0")}</strong>
      <small>{label}</small>
    </span>
  );
}

export function MintLaunchCountdown() {
  const [now, setNow] = useState<number | null>(null);
  const target = Date.parse(LAST_DANCE_GTD_MINT_OPENS_AT);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const timer = window.setInterval(tick, 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const distance = now === null ? null : Math.max(0, target - now);
  const live = distance !== null && distance <= 0;
  const days = distance === null ? null : Math.floor(distance / 86_400_000);
  const hours = distance === null ? null : Math.floor((distance % 86_400_000) / 3_600_000);
  const minutes = distance === null ? null : Math.floor((distance % 3_600_000) / 60_000);
  const seconds = distance === null ? null : Math.floor((distance % 60_000) / 1_000);

  return (
    <section className={`mint-launch${live ? " is-live" : ""}`} id="mint" aria-live="polite">
      <i className="mint-launch-scan" aria-hidden="true" />
      <header className="mint-launch-head">
        <span><i /> OFFICIAL OPENSEA MINT</span>
        <time dateTime={LAST_DANCE_GTD_MINT_OPENS_AT}>{live ? "LIVE NOW" : "SEP 9 · 15:30 UTC"}</time>
      </header>

      {live ? (
        <div className="mint-launch-live"><strong>MINT IS LIVE</strong><small>THE HOOD IS OPEN</small></div>
      ) : (
        <div className="mint-launch-grid" role="timer" aria-label="Countdown to the BunnyHood OpenSea mint">
          <CountdownUnit value={days} label="DAYS" />
          <CountdownUnit value={hours} label="HOURS" />
          <CountdownUnit value={minutes} label="MIN" />
          <CountdownUnit value={seconds} label="SEC" />
        </div>
      )}

      <a className="mint-launch-cta" href={LAST_DANCE_OPENSEA_URL} target="_blank" rel="noreferrer">
        <span><small>VERIFIED COLLECTION</small><strong>{live ? "MINT ON OPENSEA" : "OPEN MINT PAGE"}</strong></span>
        <b aria-hidden="true">↗</b>
      </a>
    </section>
  );
}
