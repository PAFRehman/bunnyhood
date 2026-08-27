import type { Metadata } from "next";
import "./rabbit-hole.css";

export const metadata: Metadata = {
  title: "Rabbit Hole — Bunny Hood",
  description: "Private Bunny Hood Rabbit Hole eligibility and soulbound box claims.",
  robots: { index: false, follow: false, nocache: true },
};

export default function RabbitHoleLayout({ children }: { children: React.ReactNode }) {
  return children;
}
