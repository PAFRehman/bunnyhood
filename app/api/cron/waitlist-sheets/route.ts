import { json, routeError } from "@/lib/spin/http";
import { safeEqual } from "@/lib/spin/security";
import { flushWaitlistSheetOutbox } from "@/lib/waitlist/sheets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim() ?? "";
  const authorization = request.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(authorization, `Bearer ${secret}`)) {
    return json({ error: "Unauthorized" }, 401);
  }
  try {
    return json({ ok: true, result: await flushWaitlistSheetOutbox(100) });
  } catch (error) {
    return routeError(error);
  }
}
