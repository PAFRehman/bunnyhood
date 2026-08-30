import { SiteFooter, SiteNav } from "../site-shell";
import { WaitlistApp } from "./waitlist-app";

export default function WaitlistPage() {
  return (
    <main className="waitlist-page">
      <SiteNav />
      <WaitlistApp />
      <SiteFooter />
    </main>
  );
}
