import { recordAdminAction } from "@/lib/spin/audit";
import { requireSpinAdmin } from "@/lib/spin/admin";
import { assertSameOrigin, HttpError, json, readJson, routeError } from "@/lib/spin/http";
import { waitlistSheetsConfigured } from "@/lib/waitlist/config";
import { getWaitlistAdminData } from "@/lib/waitlist/data";
import { flushWaitlistSheetOutbox } from "@/lib/waitlist/sheets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request) {
  try {
    requireSpinAdmin(request);
    const search = new URL(request.url).searchParams.get("search") ?? "";
    return json({
      ...await getWaitlistAdminData(search),
      sheetsConfigured: waitlistSheetsConfigured(),
    });
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(request: Request) {
  try {
    requireSpinAdmin(request);
    assertSameOrigin(request);
    const body = await readJson<{ action?: string }>(request, 1_024);
    if (body.action !== "sync_sheets") {
      throw new HttpError(400, "Choose a valid waitlist admin action.", "BAD_ADMIN_ACTION");
    }
    const result = await flushWaitlistSheetOutbox(100);
    await recordAdminAction("waitlist_sheets_sync", result);
    return json({ ok: true, result });
  } catch (error) {
    return routeError(error);
  }
}
