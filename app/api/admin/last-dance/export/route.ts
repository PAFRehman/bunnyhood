import { streamLastDanceEntriesCsv } from "@/lib/last-dance/export";
import { requireSpinAdmin } from "@/lib/spin/admin";
import { recordAdminAction } from "@/lib/spin/audit";
import { routeError } from "@/lib/spin/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    requireSpinAdmin(request);
    try {
      await recordAdminAction("last_dance_csv_export");
    } catch (error) {
      console.error("Last Dance export audit failed", error);
    }

    const csv = streamLastDanceEntriesCsv();
    void csv.completed.catch((error) => console.error("Last Dance CSV export failed", error));
    const day = new Date().toISOString().slice(0, 10);
    return new Response(csv.body, {
      headers: {
        "cache-control": "private, no-store, max-age=0",
        "content-disposition": `attachment; filename="bunnyhood-last-dance-${day}.csv"`,
        "content-type": "text/csv; charset=utf-8",
        "cross-origin-resource-policy": "same-origin",
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return routeError(error);
  }
}
