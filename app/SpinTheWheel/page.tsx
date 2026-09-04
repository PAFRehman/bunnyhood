import type { Metadata } from "next";
import { SiteFooter, SiteNav } from "../site-shell";
import { spinSocialImageAlt, spinSocialImageSize } from "./social-card";
import { SpinWheelApp } from "./spin-wheel-app";

const SITE_URL = "https://www.bunnyhood.xyz";
const REFERRAL_CODE = /^[a-z0-9_]{3,24}$/;

type SpinPageProps = {
  searchParams: Promise<{ ref?: string | string[] }>;
};

function validReferralCode(value: string | string[] | undefined) {
  const candidate = (Array.isArray(value) ? value[0] : value)?.trim().toLowerCase() ?? "";
  return REFERRAL_CODE.test(candidate) ? candidate : "";
}

export async function generateMetadata({ searchParams }: SpinPageProps): Promise<Metadata> {
  const referralCode = validReferralCode((await searchParams).ref);
  const pageUrl = new URL("/SpinTheWheel", SITE_URL);
  const cardUrl = new URL("/api/spin/share-card", SITE_URL);
  cardUrl.searchParams.set("v", "2");

  if (referralCode) {
    pageUrl.searchParams.set("ref", referralCode);
    pageUrl.searchParams.set("card", "v2");
    cardUrl.searchParams.set("ref", referralCode);
  }

  const description = referralCode
    ? `Join Bunny Hood with invite code ${referralCode}, complete tasks, earn points, and spin for GTD or FCFS access.`
    : "Complete tasks, earn points, and spin for Bunny Hood GTD and FCFS access.";
  const image = {
    url: cardUrl.toString(),
    width: spinSocialImageSize.width,
    height: spinSocialImageSize.height,
    alt: referralCode ? `${spinSocialImageAlt}. Invite code ${referralCode}.` : spinSocialImageAlt,
  };

  return {
    metadataBase: new URL(SITE_URL),
    title: "Spin the Wheel — Bunny Hood",
    description,
    alternates: { canonical: pageUrl.toString() },
    openGraph: {
      title: "Spin the Wheel — Bunny Hood",
      description,
      url: pageUrl.toString(),
      siteName: "Bunny Hood",
      type: "website",
      images: [image],
    },
    twitter: {
      card: "summary_large_image",
      site: "@BunnysHood",
      creator: "@BunnysHood",
      title: "Spin the Wheel — Bunny Hood",
      description,
      images: [image],
    },
  };
}

export default function SpinTheWheelPage() {
  return (
    <main className="spin-page">
      <SiteNav />
      <SpinWheelApp />
      <SiteFooter />
    </main>
  );
}
