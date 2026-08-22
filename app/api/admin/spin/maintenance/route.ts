import { requireSpinAdmin } from "@/lib/spin/admin";
import { recordAdminAction } from "@/lib/spin/audit";
import { assertSameOrigin, json, routeError } from "@/lib/spin/http";
import { runSpinMaintenance } from "@/lib/spin/maintenance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    requireSpinAdmin(request);
    const result = await runSpinMaintenance();
    await recordAdminAction("manual_storage_maintenance", result);
    return json({ ok: true, result });
  } catch (error) {
    return routeError(error);
  }
}
