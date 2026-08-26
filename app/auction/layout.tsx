import type { Metadata } from "next";
import "./auction.css";

export const metadata: Metadata = {
  title: "Reserved Auction Admin — Bunny Hood",
  description: "Private Bunny Hood on-chain auction control room.",
  robots: { index: false, follow: false, nocache: true },
};

export default function AuctionLayout({ children }: { children: React.ReactNode }) {
  return children;
}
