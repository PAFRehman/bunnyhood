import type { Metadata } from "next";
import "../../SpinTheWheel/spin-wheel.css";

export const metadata: Metadata = {
  title: "Spin Admin — Bunny Hood",
  robots: { index: false, follow: false },
};

export default function SpinAdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}

