import { SiteFooter, SiteNav } from "../site-shell";
import { SpinWheelApp } from "./spin-wheel-app";

export default function SpinTheWheelPage() {
  return (
    <main className="spin-page">
      <SiteNav />
      <SpinWheelApp />
      <SiteFooter />
    </main>
  );
}

