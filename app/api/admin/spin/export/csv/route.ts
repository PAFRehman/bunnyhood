import { requireSpinAdmin } from "@/lib/spin/admin";
import { recordAdminAction } from "@/lib/spin/audit";
import { parseCsvExportView, streamBunnyHoodCsv } from "@/lib/spin/csv";
import { routeError } from "@/lib/spin/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  try {
    requireSpinAdmin(request);
    const view = parseCsvExportView(new URL(request.url).searchParams.get("view"));
    await recordAdminAction("csv_export", { view });
    const csv = streamBunnyHoodCsv(view);
    void csv.completed.catch((error) => console.error("Bunny Hood CSV export failed", error));
    const day = new Date().toISOString().slice(0, 10);
    return new Response(csv.body, {
      status: 200,
      headers: {
        "cache-control": "private, no-store, max-age=0",
        "content-disposition": `attachment; filename="bunnyhood-${view}-${day}.csv"`,
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
