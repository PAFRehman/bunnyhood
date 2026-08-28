import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_COOKIE } from "@/lib/spin/config";
import { verifyAdminTicket } from "@/lib/spin/security";
import { RabbitHoleAdminApp } from "./rabbit-hole-admin-app";

export const dynamic = "force-dynamic";

export default async function RabbitHoleAdminPage() {
  const cookieStore = await cookies();
  if (!verifyAdminTicket(cookieStore.get(ADMIN_COOKIE)?.value)) {
    redirect("/admin/spin?next=/admin/rabbit-hole");
  }
  return <RabbitHoleAdminApp />;
}
