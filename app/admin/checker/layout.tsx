import type { Metadata } from "next";
import "./checker-admin.css";

export const metadata: Metadata = {
  title: "Checker Admin — Bunny Hood",
  robots: { index: false, follow: false },
};

export default function CheckerAdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
