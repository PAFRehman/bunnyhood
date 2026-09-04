import type { Metadata } from "next";
import "./spin-wheel.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://www.bunnyhood.xyz"),
  title: "Spin the Wheel — Bunny Hood",
  description: "Complete Bunny Hood campaign tasks, redeem the daily code, and Spin the Wheel for GTD and FCFS spots.",
  alternates: { canonical: "/SpinTheWheel" },
  openGraph: {
    title: "Spin the Wheel — Bunny Hood",
    description: "Complete tasks, earn points, and spin for Bunny Hood GTD and FCFS access.",
    url: "/SpinTheWheel",
    siteName: "Bunny Hood",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Spin the Wheel — Bunny Hood",
    description: "Complete tasks, earn points, and spin for Bunny Hood GTD and FCFS access.",
  },
};

export default function SpinLayout({ children }: { children: React.ReactNode }) {
  return children;
}
