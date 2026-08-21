import { requireSpinAdmin } from "@/lib/spin/admin";
import { assertSameOrigin, json, routeError } from "@/lib/spin/http";
import {
  flushSheetOutbox,
  getPendingSheetSyncCount,
  queueFullSheetBackfill,
} from "@/lib/spin/sheets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    requireSpinAdmin(request);
    const backfill = await queueFullSheetBackfill();
    const delivery = await flushSheetOutbox(20);
    const pendingAfter = await getPendingSheetSyncCount();
    return json({ backfill, ...delivery, pendingAfter });
  } catch (error) {
    return routeError(error);
  }
}
