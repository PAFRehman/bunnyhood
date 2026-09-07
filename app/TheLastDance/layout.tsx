import type { Metadata } from "next";
import "./last-dance.css";

export const metadata: Metadata = {
  title: "The Last Dance — Bunny Hood",
  description: "Complete The Last Dance and secure your BunnyHood GTD entry on Robinhood Chain.",
};

export default function LastDanceLayout({ children }: { children: React.ReactNode }) {
  return children;
}
