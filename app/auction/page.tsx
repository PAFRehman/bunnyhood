import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_COOKIE } from "@/lib/spin/config";
import { verifyAdminTicket } from "@/lib/spin/security";
import { getPublicAuctionNetworks } from "@/lib/auction/config";
import { AuctionApp } from "./auction-app";

export const dynamic = "force-dynamic";

export default async function AuctionPage() {
  const cookieStore = await cookies();
  if (!verifyAdminTicket(cookieStore.get(ADMIN_COOKIE)?.value)) {
    redirect("/admin/spin");
  }
  return <AuctionApp networks={getPublicAuctionNetworks()} />;
}
