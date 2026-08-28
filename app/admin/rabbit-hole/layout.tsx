import type { Metadata } from "next";
import "../../SpinTheWheel/spin-wheel.css";

export const metadata: Metadata = {
  title: "Rabbit Hole Admin — Bunny Hood",
  robots: { index: false, follow: false },
};

export default function RabbitHoleAdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
