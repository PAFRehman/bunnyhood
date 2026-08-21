import { requireSpinAdmin } from "@/lib/spin/admin";
import { json, routeError } from "@/lib/spin/http";
import { getAdminDashboard } from "@/lib/spin/wheel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    requireSpinAdmin(request);
    return json(await getAdminDashboard());
  } catch (error) {
    return routeError(error);
  }
}

