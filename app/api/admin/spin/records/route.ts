import { requireSpinAdmin } from "@/lib/spin/admin";
import { getAdminRecords } from "@/lib/spin/admin-data";
import { json, routeError } from "@/lib/spin/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    requireSpinAdmin(request);
    const url = new URL(request.url);
    const records = await getAdminRecords({
      view: url.searchParams.get("view") ?? "users",
      page: Number(url.searchParams.get("page") ?? 1),
      pageSize: Number(url.searchParams.get("pageSize") ?? 25),
      search: url.searchParams.get("search") ?? "",
    });
    return json(records);
  } catch (error) {
    return routeError(error);
  }
}
