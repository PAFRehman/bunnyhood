import { json } from "@/lib/spin/http";
import { runSpinMaintenance } from "@/lib/spin/maintenance";
import { safeEqual } from "@/lib/spin/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim() ?? "";
  const authorization = request.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(authorization, `Bearer ${secret}`)) {
    return json({ error: "Unauthorized" }, 401);
  }
  const result = await runSpinMaintenance();
  return json({ ok: true, result });
}
