import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_COOKIE } from "@/lib/spin/config";
import { verifyAdminTicket } from "@/lib/spin/security";
import { RabbitHoleApp } from "./rabbit-hole-app";

export const dynamic = "force-dynamic";

export default async function RabbitHolePage() {
  const cookieStore = await cookies();
  if (!verifyAdminTicket(cookieStore.get(ADMIN_COOKIE)?.value)) {
    redirect("/admin/spin");
  }
  return <RabbitHoleApp />;
}
