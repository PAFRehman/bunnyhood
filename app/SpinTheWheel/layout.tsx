import type { Metadata } from "next";
import "./spin-wheel.css";

export const metadata: Metadata = {
  title: "Spin the Wheel — Bunny Hood",
  description: "Complete five-second Bunny Hood tasks, redeem the daily code, and spin for GTD and FCFS spots.",
};

export default function SpinLayout({ children }: { children: React.ReactNode }) {
  return children;
}
