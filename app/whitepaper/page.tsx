import type { Metadata } from "next";
import { SiteFooter, SiteNav } from "../site-shell";
import { WhitepaperExperience } from "./whitepaper-experience";

export const metadata: Metadata = {
  title: "Whitepaper — Bunny Hood",
  description: "Persistent AI agents as onchain NFT identities on Robinhood Chain.",
  openGraph: {
    title: "Bunny Hood Whitepaper",
    description: "NFT that does more than represent an image. It represents an agent.",
    type: "article",
  },
};

export default function WhitepaperPage() {
  return (
    <main>
      <SiteNav />
      <WhitepaperExperience />
      <SiteFooter />
    </main>
  );
}
