import { getWheelState } from "@/lib/spin/wheel";
import { flushSheetOutbox } from "@/lib/spin/sheets";
import { json } from "@/lib/spin/http";
import { safeEqual } from "@/lib/spin/security";
import { getDb } from "@/lib/spin/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim() ?? "";
  const authorization = request.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(authorization, `Bearer ${secret}`)) {
    return json({ error: "Unauthorized" }, 401);
  }
  await getWheelState(null);
  await flushSheetOutbox(20);
  const sql = getDb();
  await Promise.all([
    sql`delete from spin_sessions where expires_at < now()`,
    sql`delete from spin_rate_limits where window_started_at < now() - interval '2 days'`,
    sql`delete from spin_batches where created_at < now() - interval '45 days'`,
    sql`delete from spin_sheet_outbox where delivered_at < now() - interval '30 days'`,
  ]);
  return json({ ok: true });
}
