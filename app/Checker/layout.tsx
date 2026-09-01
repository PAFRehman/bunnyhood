import type { Metadata } from "next";
import "./checker.css";

export const metadata: Metadata = {
  title: "Wallet Checker — Bunny Hood",
  description: "Check whether your wallet has a BunnyHood GTD or FCFS spot.",
};

export default function CheckerLayout({ children }: { children: React.ReactNode }) {
  return children;
}
