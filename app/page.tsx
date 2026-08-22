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

      <section className="roadmap" id="roadmap">
        <div className="roadmap-orbit" aria-hidden="true" />
        <header className="roadmap-heading">
          <div><p className="section-kicker">BUILDING THE HOOD</p><h2>One Hood.<br /><em>More utility.</em></h2></div>
          <div className="roadmap-intro"><strong>3999 AI AGENTS · ROBINHOOD CHAIN</strong><p>BunnyHood is aiming to become the first AI Agent NFT collection on Robinhood Chain. We will not reveal much about the agent layer yet, but it is being built as one of our core features.</p></div>
        </header>
        <div className="roadmap-list">
          <article className="roadmap-item featured">
            <span>01</span><div><p>CORE LAYER</p><h3>AI Agent<br />collection.</h3></div>
            <div className="roadmap-copy"><p>3999 AI agents on Robinhood. The agent layer is being built quietly as a core BunnyHood feature.</p><blockquote>Built in the Hood. Revealed when ready.</blockquote></div>
          </article>
          <article className="roadmap-item">
            <span>02</span><div><p>HOLDER CHOICE</p><h3>30 Days<br />Burn Window.</h3></div>
            <div className="roadmap-copy"><p>Mint a BunnyHood for X amount and you will have 30 days to decide whether you want to stay in the Hood. During that window, holders will be able to burn their NFT and claim the refund. If someone leaves, their NFT gets burned: 3,999 → 3,998 → 3,997. Paper hands can exit while supply contracts and scarcity increases for those who stay.</p><blockquote>Skin in the game without locking you in.</blockquote></div>
          </article>
          <article className="roadmap-item">
            <span>03</span><div><p>CREATE &amp; EARN</p><h3>Creator<br />Campaigns.</h3></div>
            <div className="roadmap-copy"><p>A good portion of royalties will be allocated toward monthly creator campaigns for holders. Create memes, threads, videos, art, or anything that pushes the Hood forward. At the end of each month, the best creators will be rewarded.</p><blockquote>Create value for the Hood → earn from the Hood.</blockquote></div>
          </article>
          <article className="roadmap-item">
            <span>04</span><div><p>HOLDER NETWORK</p><h3>BunnyHood<br />DAO.</h3></div>
            <div className="roadmap-copy"><p>Holding a BunnyHood gives access to a holder-gated community built around opportunities across the ecosystem. Through collaborations, holders can get chances to win WL spots, allocations, giveaways, merch, and other ecosystem opportunities.</p><blockquote>Being inside the Hood should have value beyond the NFT itself.</blockquote></div>
          </article>
          <article className="roadmap-item">
            <span>05</span><div><p>PRODUCT LAYER</p><h3>Staking<br />&amp; Σ:</h3></div>
            <div className="roadmap-copy"><p>Stake your BunnyHood to earn points and unlock more ecosystem benefits: AI Agent utility, increased chances for ecosystem spots, holder rewards, and future opportunities. Projects using our planned staking product will need to provide incentives for BunnyHood holders and stakers. Staking is only one of several products planned, and those points are planned to become convertible into Σ:</p><blockquote>What is Σ: ? You will find out.</blockquote></div>
          </article>
        </div>
        <div className="roadmap-close"><strong>More, more and more soon.</strong></div>
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
