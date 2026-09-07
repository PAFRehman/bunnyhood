import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLastDancePublicPass } from "@/lib/last-dance/data";
import { SiteFooter, SiteNav } from "@/app/site-shell";
import { LastDanceMintCountdown } from "../../mint-countdown";
import { lastDancePassImageAlt, lastDancePassImageSize } from "../../pass-card";

const SITE_URL = "https://www.bunnyhood.xyz";
const OPENSEA_URL = "https://opensea.io/collection/bunnyhoodxyz";
type PassPageProps = { params: Promise<{ entryId: string }> };

export async function generateMetadata({ params }: PassPageProps): Promise<Metadata> {
  const pass = await getLastDancePublicPass((await params).entryId);
  if (!pass) return { title: "Pass not found — Bunny Hood", robots: { index: false, follow: false } };
  const pageUrl = new URL(`/TheLastDance/pass/${pass.id}`, SITE_URL);
  const imageUrl = new URL(`/api/last-dance/pass/${pass.id}`, SITE_URL);
  const title = `@${pass.xUsername} secured a Confirmed GTD Spot — Bunny Hood`;
  const description = "A confirmed GTD spot for The Last Dance on Robinhood Chain. The wallet will be added soon.";
  const image = { url: imageUrl.toString(), width: lastDancePassImageSize.width, height: lastDancePassImageSize.height, alt: lastDancePassImageAlt };
  return {
    metadataBase: new URL(SITE_URL),
    title,
    description,
    robots: { index: false, follow: false },
    alternates: { canonical: pageUrl.toString() },
    openGraph: { title, description, url: pageUrl.toString(), siteName: "Bunny Hood", type: "website", images: [image] },
    twitter: { card: "summary_large_image", site: "@BunnysHood", creator: `@${pass.xUsername}`, title, description, images: [image] },
  };
}

export default async function LastDancePassPage({ params }: PassPageProps) {
  const pass = await getLastDancePublicPass((await params).entryId);
  if (!pass) notFound();
  const shareUrl = `${SITE_URL}/TheLastDance/pass/${pass.id}`;
  const shareText = encodeURIComponent(`I secured a Confirmed GTD Spot in The Last Dance by @BunnysHood. My wallet will be added soon.\n\n${shareUrl}`);

  return (
    <main className="last-dance-page">
      <div className="page-intro" aria-hidden="true"><span>BH</span><i /><b>ENTER THE HOOD</b></div>
      <SiteNav />
      <section className="ld-share-page">
        <div className="ld-share-aurora ld-share-aurora-one" aria-hidden="true" />
        <div className="ld-share-aurora ld-share-aurora-two" aria-hidden="true" />
        <div className="ld-share-copy">
          <p>THE LAST DANCE · ROBINHOOD CHAIN</p>
          <h1>CONFIRMED<br /><em>GTD SPOT.</em></h1>
          <span>@{pass.xUsername} made the final floor. The receiving wallet is recorded and will be added soon.</span>
          <LastDanceMintCountdown target={pass.mintOpensAt} />
          <div className="ld-share-actions">
            <a href={`/api/last-dance/pass/${pass.id}?download=1`}>DOWNLOAD PASS <b>↓</b></a>
            <a href={`https://x.com/intent/post?text=${shareText}`} target="_blank" rel="noreferrer">SHARE ON X <b>↗</b></a>
            <a className="opensea" href={OPENSEA_URL} target="_blank" rel="noreferrer">GO TO OPENSEA MINT <b>↗</b></a>
          </div>
        </div>
        <div className="ld-share-pass" aria-label={`Confirmed GTD pass for @${pass.xUsername}`}>
          <header><span>BH // FINAL ACCESS</span><b>VERIFIED</b></header>
          <div className="ld-share-rabbit"><i /><i /><strong>BH</strong></div>
          <p>CONFIRMED FOR</p>
          <h2>@{pass.xUsername}</h2>
          <code>{pass.maskedWallet}</code>
          <div className="ld-share-proof"><span>NFT FOUND ✓</span><span>TX FOUND ✓</span><b>GTD</b></div>
          <small>YOUR WALLET WILL BE ADDED SOON.</small>
        </div>
      </section>
      <SiteFooter />
    </main>
  );
}
