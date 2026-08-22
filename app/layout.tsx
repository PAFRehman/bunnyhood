import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bunny Hood — 3999 Bunnys on Robinhood Chain",
  description: "3999 AI Agent Bunnys building utility, rewards, and experiments on Robinhood Chain.",
  openGraph: {
    title: "Bunny Hood",
    description: "3999 AI Agent Bunnys on Robinhood Chain.",
    type: "website",
  },
  icons: {
    icon: "/assets/bunny-hood-mark.webp",
    shortcut: "/assets/bunny-hood-mark.webp",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
