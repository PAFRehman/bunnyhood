"use client";

import Image from "next/image";
import { useEffect, useRef, type CSSProperties } from "react";
import { DirectionIcon } from "../site-shell";
import styles from "./whitepaper.module.css";

const mvpCapabilities = [
  ["01", "NFT identity", "ERC-721 identity with token-specific traits, metadata and live ownership verification."],
  ["02", "Agent personality", "Three test archetypes begin the system: Quant, Trader and Contrarian."],
  ["03", "Memory engine", "FastAPI and LangGraph connect each agent to persistent SQLite memory."],
  ["04", "Onchain awareness", "Read-only tools retrieve NFT identity, current ownership and balances."],
  ["05", "Market intelligence", "Alpha Vantage provides live context across crypto, stocks, FX and selected indicators."],
  ["06", "Source-aware answers", "Every response separates blockchain facts, metadata, retrieval, memory and AI analysis."],
] as const;

const productCapabilities = [
  ["Identity", "A distinct personality, traits and an evolving profile for every Bunny."],
  ["Memory", "Useful owner preferences and interaction context persist over time."],
  ["Intelligence", "Agents interpret live external financial data instead of relying on static knowledge."],
  ["Awareness", "Verified ownership, balances and supported blockchain state remain grounded onchain."],
  ["Agent wallet", "ERC-6551 gives each NFT a token-bound account able to own assets and interact with contracts."],
  ["Evolution", "Behavior, history, reputation and achievements become part of a persistent identity."],
] as const;

const architecture = [
  ["01", "ERC-721", "Identity"],
  ["02", "Agent", "Personality"],
  ["03", "LangGraph", "Intelligence"],
  ["04", "Memory + data", "Context"],
  ["05", "ERC-6551", "Account"],
  ["06", "Permissioned", "Action"],
] as const;

const roadmap = [
  {
    phase: "PHASE I",
    title: "MVP",
    status: "BUILDING NOW",
    copy: "ERC-721 collection on Robinhood Chain Testnet, AI identities, memory, ownership verification, market-data tools and a wallet-connected agent interface.",
  },
  {
    phase: "PHASE II",
    title: "Agent wallets",
    status: "NEXT LAYER",
    copy: "Integrate ERC-6551 so every NFT can have its own token-bound account and hold assets on Robinhood Chain.",
  },
  {
    phase: "PHASE III",
    title: "Controlled autonomy",
    status: "PERMISSIONED",
    copy: "Add programmable permissions, session-based authorization and human approval gates. Agents can propose actions and execute only what an owner explicitly allows.",
  },
  {
    phase: "PHASE IV",
    title: "Agent economy",
    status: "LONG TERM",
    copy: "Evolving reputation, agent-to-agent interaction, persistent onchain history and broader asset or DeFi integrations where technically and legally appropriate.",
  },
] as const;

export function WhitepaperExperience() {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const reveals = Array.from(root.querySelectorAll<HTMLElement>("[data-reveal]"));
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        (entry.target as HTMLElement).dataset.visible = "true";
        observer.unobserve(entry.target);
      }
    }, { threshold: 0.14, rootMargin: "0px 0px -8%" });
    reveals.forEach((element) => observer.observe(element));

    const updateScroll = () => {
      const maximum = document.documentElement.scrollHeight - window.innerHeight;
      root.style.setProperty("--read-progress", String(maximum > 0 ? window.scrollY / maximum : 0));
    };
    const updatePointer = (event: PointerEvent) => {
      root.style.setProperty("--pointer-x", `${event.clientX}px`);
      root.style.setProperty("--pointer-y", `${event.clientY}px`);
    };

    updateScroll();
    window.addEventListener("scroll", updateScroll, { passive: true });
    window.addEventListener("pointermove", updatePointer, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", updateScroll);
      window.removeEventListener("pointermove", updatePointer);
    };
  }, []);

  return (
    <div className={styles.page} ref={rootRef}>
      <div className={styles.readProgress} aria-hidden="true"><i /></div>
      <div className={styles.pointerGlow} aria-hidden="true" />

      <section className={styles.hero} id="whitepaper-top">
        <div className={styles.heroGrid} aria-hidden="true" />
        <div className={styles.signalField} aria-hidden="true">
          {Array.from({ length: 18 }, (_, index) => <i key={index} />)}
        </div>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}><span /> BUNNYHOOD PRODUCT WHITEPAPER · 2026</p>
          <h1>
            <span className={styles.outline}>PERSISTENT</span>
            <span>AI AGENTS</span>
            <em>ONCHAIN.</em>
          </h1>
          <div className={styles.heroStatement}>
            <p>An NFT that does more than represent an image.</p>
            <strong>It represents an agent.</strong>
          </div>
          <a className={styles.heroCta} href="#executive-summary">
            Enter the paper <DirectionIcon down />
          </a>
        </div>

        <div className={styles.identityCore} aria-label="Bunny Hood agent identity visualization">
          <div className={styles.orbitOne}><i /><i /><i /></div>
          <div className={styles.orbitTwo}><i /><i /></div>
          <div className={styles.coreHalo} />
          <div className={styles.coreMark}>
            <Image src="/assets/bunny-hood-logo.png" alt="Bunny Hood" width={2048} height={1732} priority />
          </div>
          <span className={`${styles.coreLabel} ${styles.labelIdentity}`}>IDENTITY</span>
          <span className={`${styles.coreLabel} ${styles.labelMemory}`}>MEMORY</span>
          <span className={`${styles.coreLabel} ${styles.labelOwnership}`}>OWNERSHIP</span>
          <span className={`${styles.coreLabel} ${styles.labelAction}`}>ACTION</span>
        </div>
        <p className={styles.heroIndex} aria-hidden="true">WP / 01</p>
      </section>

      <section className={styles.summary} id="executive-summary">
        <div className={styles.sectionIndex} data-reveal><span>01</span><p>EXECUTIVE SUMMARY</p></div>
        <div className={styles.summaryLead} data-reveal>
          <h2>Ownership becomes<br /><em>agent ownership.</em></h2>
        </div>
        <div className={styles.summaryCopy} data-reveal>
          <p>BunnyHood is an NFT-native AI agent platform being built on Robinhood Chain. It begins with ERC-721, but each NFT is designed to become the persistent identity of an AI agent rather than artwork alone.</p>
          <p>Every token can carry its own traits, personality, memory and onchain identity, while the current owner is verified directly from the blockchain.</p>
        </div>
        <div className={styles.relationship} data-reveal>
          <article><span>01</span><strong>NFT ownership</strong></article><i />
          <article><span>02</span><strong>Agent ownership</strong></article><i />
          <article><span>03</span><strong>AI interaction</strong></article>
        </div>
        <blockquote className={styles.summaryQuote} data-reveal>
          The MVP proves the relationship. The final product turns it into a persistent economic identity through ERC-6551, permissioned actions and evolving reputation.
        </blockquote>
      </section>

      <section className={styles.mvp}>
        <header className={styles.sectionHeader} data-reveal>
          <div className={styles.sectionIndex}><span>02</span><p>WHAT WE ARE BUILDING NOW</p></div>
          <div><p className={styles.signal}><span /> LIVE DEVELOPMENT SIGNAL</p><h2>MVP on Robinhood<br /><em>Chain Testnet.</em></h2></div>
          <p>A small ERC-721 BunnyHood collection is connected directly to a live agent backend. Ownership is verified with <code>ownerOf(tokenId)</code>, grounding every conversation in the NFT&apos;s real current owner.</p>
        </header>
        <div className={styles.capabilityGrid}>
          {mvpCapabilities.map(([number, title, copy], index) => (
            <article key={title} data-reveal style={{ "--delay": `${index * 55}ms` } as CSSProperties}>
              <span>{number}</span><div><h3>{title}</h3><p>{copy}</p></div>
            </article>
          ))}
        </div>
        <div className={styles.safetyBoundary} data-reveal>
          <div><p>THE MVP BOUNDARY</p><h3>Intelligence first.<br />Execution later.</h3></div>
          <ul>
            <li><span>NO</span> private keys</li>
            <li><span>NO</span> transaction signing</li>
            <li><span>NO</span> autonomous financial execution</li>
          </ul>
        </div>
      </section>

      <section className={styles.product}>
        <div className={styles.productAura} aria-hidden="true" />
        <header className={styles.productHeader} data-reveal>
          <div className={styles.sectionIndex}><span>03</span><p>THE FINAL PRODUCT</p></div>
          <h2>From collectible<br />to <em>digital entity.</em></h2>
          <p>Ownership gives a user control of the agent identity. The agent develops a history through memory, interactions and eventually permissioned onchain activity.</p>
        </header>
        <div className={styles.productGrid}>
          {productCapabilities.map(([title, copy], index) => (
            <article key={title} data-reveal style={{ "--delay": `${index * 70}ms` } as CSSProperties}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <h3>{title}</h3>
              <p>{copy}</p>
              <i aria-hidden="true" />
            </article>
          ))}
        </div>
      </section>

      <section className={styles.architecture}>
        <header data-reveal>
          <div className={styles.sectionIndex}><span>04</span><p>PRODUCT ARCHITECTURE</p></div>
          <h2>Identity. Intelligence.<br /><em>Execution.</em></h2>
          <p>The blockchain remains the source of truth for ownership and state. The AI stays offchain for language, memory and live data. ERC-6551 arrives as the economic account layer, not a replacement for ERC-721.</p>
        </header>
        <div className={styles.architectureRail} data-reveal>
          {architecture.map(([number, title, label], index) => (
            <div className={styles.architectureStep} key={title}>
              <article><span>{number}</span><strong>{title}</strong><small>{label}</small></article>
              {index < architecture.length - 1 && <i aria-hidden="true"><b /></i>}
            </div>
          ))}
        </div>
        <div className={styles.permissionPanel} data-reveal>
          <span>HUMAN APPROVAL GATE</span>
          <p>Future agents can propose actions. Execution happens only where programmable permissions and the owner explicitly allow it.</p>
          <div className={styles.permissionSwitch}><i /><strong>OWNER CONTROLLED</strong></div>
        </div>
      </section>

      <section className={styles.roadmap}>
        <header data-reveal>
          <div className={styles.sectionIndex}><span>05</span><p>ROADMAP</p></div>
          <h2>Four phases.<br /><em>One persistent identity.</em></h2>
        </header>
        <div className={styles.roadmapTrack}>
          {roadmap.map((item, index) => (
            <article key={item.phase} data-reveal style={{ "--delay": `${index * 80}ms` } as CSSProperties}>
              <div className={styles.roadmapNode}><i /><span>{String(index + 1).padStart(2, "0")}</span></div>
              <div className={styles.roadmapMeta}><span>{item.phase}</span><b>{item.status}</b></div>
              <h3>{item.title}</h3>
              <p>{item.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.chainReason}>
        <div className={styles.chainOrb} aria-hidden="true"><i /><i /><i /></div>
        <div className={styles.sectionIndex} data-reveal><span>06</span><p>WHY ROBINHOOD CHAIN</p></div>
        <div className={styles.chainCopy} data-reveal>
          <p>BUILT FOR ONCHAIN FINANCIAL APPLICATIONS</p>
          <h2>The home of the<br /><em>agent economy.</em></h2>
          <div>
            <p>BunnyHood is designed specifically for Robinhood Chain because an EVM-compatible financial environment can support NFT ownership today and token-bound agent accounts tomorrow.</p>
            <p>The chain becomes the foundation for verifiable identity, economic accounts and carefully permissioned financial interactions.</p>
          </div>
        </div>
      </section>

      <section className={styles.vision}>
        <p className={styles.visionKicker} data-reveal>07 · VISION</p>
        <h2 data-reveal>NOT A STATIC IMAGE.<br /><em>A PERSISTENT AI-NATIVE ENTITY.</em></h2>
        <p className={styles.visionCopy} data-reveal>The MVP proves that an NFT can own an agent identity. The final product aims to prove something larger: an NFT can become an entity users can own, interact with, develop and eventually give controlled economic capabilities on Robinhood Chain.</p>
        <div className={styles.visionActions} data-reveal>
          <a href="/SpinTheWheel">Enter the Hood <DirectionIcon /></a>
          <a href="https://x.com/BunnysHood" target="_blank" rel="noreferrer">Follow the build <DirectionIcon /></a>
        </div>
        <div className={styles.visionMark} aria-hidden="true">BH</div>
      </section>
    </div>
  );
}
