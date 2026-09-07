import type { Metadata } from "next";
import "./last-dance-admin.css";

export const metadata: Metadata = {
  title: "Last Dance Admin — Bunny Hood",
  robots: { index: false, follow: false },
};

export default function LastDanceAdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
