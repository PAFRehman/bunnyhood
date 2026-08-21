import { requireSpinAdmin } from "@/lib/spin/admin";
import { assertSameOrigin, json, routeError } from "@/lib/spin/http";
import { flushSheetOutbox, queueFullSheetBackfill } from "@/lib/spin/sheets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    requireSpinAdmin(request);
    const backfill = await queueFullSheetBackfill();
    return json({ backfill, ...await flushSheetOutbox(20) });
  } catch (error) {
    return routeError(error);
  }
}
