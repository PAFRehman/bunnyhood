import { requireSpinAdmin } from "@/lib/spin/admin";
import { getAdminOverview } from "@/lib/spin/admin-data";
import { json, routeError } from "@/lib/spin/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    requireSpinAdmin(request);
    return json(await getAdminOverview());
  } catch (error) {
    return routeError(error);
  }
}
