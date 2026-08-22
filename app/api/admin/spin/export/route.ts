import { requireSpinAdmin } from "@/lib/spin/admin";
import { recordAdminAction } from "@/lib/spin/audit";
import { streamBunnyHoodWorkbook } from "@/lib/spin/excel";
import { routeError } from "@/lib/spin/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    requireSpinAdmin(request);
    await recordAdminAction("excel_export", { mode: "streamed" });
    const workbook = streamBunnyHoodWorkbook();
    void workbook.completed.catch((error) => console.error("Bunny Hood Excel export failed", error));
    const day = new Date().toISOString().slice(0, 10);
    return new Response(workbook.body, {
      status: 200,
      headers: {
        "cache-control": "private, no-store, max-age=0",
        "content-disposition": `attachment; filename="bunnyhood-records-${day}.xlsx"`,
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "cross-origin-resource-policy": "same-origin",
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return routeError(error);
  }
}
