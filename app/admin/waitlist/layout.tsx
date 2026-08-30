import type { Metadata } from "next";
import "./waitlist-admin.css";

export const metadata: Metadata = {
  title: "Waitlist Admin — Bunny Hood",
  robots: { index: false, follow: false },
};

export default function WaitlistAdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
