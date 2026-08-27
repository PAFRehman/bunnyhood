import { recordAdminAction } from "@/lib/spin/audit";
import { requireSpinAdmin } from "@/lib/spin/admin";
import { assertSameOrigin, json, readJson, routeError } from "@/lib/spin/http";
import {
  getEligibilityStats,
  listEligibility,
  parseEligibilityImport,
  replaceEligibility,
} from "@/lib/rabbit-hole/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    requireSpinAdmin(request);
    const search = new URL(request.url).searchParams.get("search") ?? "";
    const [stats, rows] = await Promise.all([getEligibilityStats(), listEligibility(search)]);
    return json({ stats, rows });
  } catch (error) {
    return routeError(error);
  }
}
export async function POST(request: Request) {
  try {
    requireSpinAdmin(request);
    assertSameOrigin(request);
    const body = await readJson<{ data?: string }>(request, 64 * 1024);
    const entries = parseEligibilityImport(body.data ?? "");
    const stats = await replaceEligibility(entries);
    await recordAdminAction("rabbit_hole_eligibility_replaced", {
      imported: entries.length,
      total: stats.total,
    });
    return json({ ok: true, stats });
  } catch (error) {
    return routeError(error);
  }
}
