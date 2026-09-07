import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getLastDanceSettings } from "@/lib/last-dance/data";
import { ADMIN_COOKIE } from "@/lib/spin/config";
import { verifyAdminTicket } from "@/lib/spin/security";
import { SiteFooter, SiteNav } from "../site-shell";
import { LastDanceApp } from "./last-dance-app";

export const dynamic = "force-dynamic";

export default async function TheLastDancePage() {
  const settings = await getLastDanceSettings();
  if (!settings.publicEnabled) {
    const cookieStore = await cookies();
    if (!verifyAdminTicket(cookieStore.get(ADMIN_COOKIE)?.value)) {
      redirect("/admin/spin?next=/TheLastDance");
    }
  }

  return (
    <main className="last-dance-page">
      <div className="page-intro" aria-hidden="true"><span>BH</span><i /><b>ENTER THE HOOD</b></div>
      <SiteNav />
      <LastDanceApp />
      <SiteFooter />
    </main>
  );
}
