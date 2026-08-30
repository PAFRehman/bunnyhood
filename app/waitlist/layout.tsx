import type { Metadata } from "next";
import "./waitlist.css";

export const metadata: Metadata = {
  title: "Upcoming Products Waitlist — Bunny Hood",
  description: "Complete the BunnyHood launch tasks, join with your wallet, and climb the upcoming-products waitlist with referrals.",
};

export default function WaitlistLayout({ children }: { children: React.ReactNode }) {
  return children;
}
