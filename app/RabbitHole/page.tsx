import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_COOKIE } from "@/lib/spin/config";
import { verifyAdminTicket } from "@/lib/spin/security";
import { isRabbitHolePublic } from "@/lib/rabbit-hole/config";
import { RabbitHoleApp } from "./rabbit-hole-app";

export const dynamic = "force-dynamic";

export default async function RabbitHolePage() {
  if (!isRabbitHolePublic()) {
    const cookieStore = await cookies();
    if (!verifyAdminTicket(cookieStore.get(ADMIN_COOKIE)?.value)) {
      redirect("/admin/spin?next=/RabbitHole");
    }
  }
  return <RabbitHoleApp />;
}
