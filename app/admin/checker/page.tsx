import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_COOKIE } from "@/lib/spin/config";
import { verifyAdminTicket } from "@/lib/spin/security";
import { CheckerAdminApp } from "./checker-admin-app";

export const dynamic = "force-dynamic";

export default async function CheckerAdminPage() {
  const cookieStore = await cookies();
  if (!verifyAdminTicket(cookieStore.get(ADMIN_COOKIE)?.value)) {
    redirect("/admin/spin?next=/admin/checker");
  }
  return <CheckerAdminApp />;
}
