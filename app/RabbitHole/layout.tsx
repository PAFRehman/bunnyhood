import type { Metadata } from "next";
import "./rabbit-hole.css";

export const metadata: Metadata = {
  title: "Enter the Rabbit Hole — Bunny Hood",
  description: "Check your Bunny Hood box eligibility and claim a permanent onchain SBT.",
};

export default function RabbitHoleLayout({ children }: { children: React.ReactNode }) {
  return children;
}
