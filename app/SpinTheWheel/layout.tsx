import type { Metadata } from "next";
import "./spin-wheel.css";

export const metadata: Metadata = {
  title: "Spin the Wheel — Bunny Hood",
  description: "Complete Bunny Hood campaign tasks, redeem the daily code, and Spin the Wheel for GTD and FCFS spots.",
};

export default function SpinLayout({ children }: { children: React.ReactNode }) {
  return children;
}
