"use client";

import { useEffect, useState } from "react";
import { nfts } from "./site-data";
import { DirectionIcon, SiteFooter, SiteNav } from "./site-shell";

export default function Home() {
  const [selectedNft, setSelectedNft] = useState<(typeof nfts)[number] | null>(null);

  useEffect(() => {
    if (!selectedNft) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedNft(null);
    };

    document.body.classList.add("modal-open");
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      document.body.classList.remove("modal-open");
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [selectedNft]);

  return (
    <main>
      <div className="page-intro" aria-hidden="true"><span>BH</span><i /><b>ENTER THE HOOD</b></div>
      <SiteNav home />

      <section className="hero" id="top">
        <div className="hero-grid" aria-hidden="true" />
        <div className="floating-ear ear-one" aria-hidden="true" />
        <div className="floating-ear ear-two" aria-hidden="true" />
        <div className="hero-copy">
          <div className="eyebrow"><span className="live-dot" />3999 BUNNYS · ROBINHOOD CHAIN</div>
          <h1>BUNNY<span>HOOD</span></h1>
          <p>A new crew is hopping onchain. Connect your X profile, complete the daily tasks, and spin for Bunny Hood rewards.</p>
          <div className="hero-actions">
            <a className="button button-primary" href="/SpinTheWheel">Spin the Wheel <DirectionIcon down /></a>
            <a className="button button-quiet" href="#collection">Meet the Bunnys</a>
          </div>
        </div>
        <div className="hero-art-wrap">
          <div className="hero-orbit orbit-one" aria-hidden="true" />
          <div className="hero-orbit orbit-two" aria-hidden="true" />
          <figure className="hero-art">
            <img src="/assets/bunny-hood-hero.webp" alt="Bunny Hood mascot at a Robinhood event" />
            <figcaption><span>GENESIS SIGNAL</span><strong>01 / 3999</strong></figcaption>
          </figure>
          <div className="float-card float-card-top" aria-hidden="true"><span>STATUS</span><b>EARLY</b></div>
          <div className="float-card float-card-bottom" aria-hidden="true"><span>NETWORK</span><b>ROBINHOOD</b></div>
        </div>
        <div className="scroll-cue" aria-hidden="true"><span>SCROLL TO ENTER</span><i /></div>
      </section>

      <section className="collection" id="collection">
        <div className="section-heading">
          <div><p className="section-kicker">THE FIRST TEN</p><h2>Meet the <em>Hood.</em></h2></div>
          <p>Ten founding faces from the Bunny Hood collection. Click any Bunny to open the complete artwork.</p>
        </div>
        <div className="marquee-shell">
          <div className="marquee-track">
            {[...nfts, ...nfts].map((nft, index) => (
              <button className="nft-card" key={`${nft.id}-${index}`} type="button" onClick={() => setSelectedNft(nft)} aria-label={`Open ${nft.name}`}>
                <img src={nft.image} alt={nft.name} />
                <span className="nft-wash" aria-hidden="true" />
                <span className="nft-number">{String(nft.id).padStart(2, "0")}</span>
                <span className="nft-name">{nft.name}</span>
                <span className="nft-open">EXPAND <DirectionIcon /></span>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="access-placeholder">
        <p>DAILY HOOD REWARDS</p>
        <h2>Earn spins.<br />Enter the wheel.</h2>
        <a className="button button-primary" href="/SpinTheWheel">Spin the Wheel <DirectionIcon /></a>
      </section>

      <SiteFooter home />

      {selectedNft && (
        <div className="art-modal" role="dialog" aria-modal="true" aria-label={selectedNft.name} onMouseDown={(event) => { if (event.currentTarget === event.target) setSelectedNft(null); }}>
          <button className="modal-close" type="button" onClick={() => setSelectedNft(null)} aria-label="Close artwork">CLOSE ×</button>
          <div className="modal-art">
            <img src={selectedNft.image} alt={selectedNft.name} />
            <div><span>FOUNDING BUNNY</span><strong>{selectedNft.name}</strong></div>
          </div>
        </div>
      )}
    </main>
  );
}
