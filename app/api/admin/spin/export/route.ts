import { requireSpinAdmin } from "@/lib/spin/admin";
import { recordAdminAction } from "@/lib/spin/audit";
import { buildBunnyHoodWorkbook } from "@/lib/spin/excel";
import { HttpError, routeError } from "@/lib/spin/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  try {
    requireSpinAdmin(request);
    const workbook = await buildBunnyHoodWorkbook();
    try {
      await recordAdminAction("excel_export", {
        mode: "validated-memory-workbook",
        bytes: workbook.bytes.byteLength,
        records: workbook.recordCount,
      });
    } catch (auditError) {
      console.error("Bunny Hood Excel audit log failed.", auditError instanceof Error ? auditError.message : "Unknown error");
    }
    const day = new Date().toISOString().slice(0, 10);
    return new Response(workbook.bytes, {
      status: 200,
      headers: {
        "cache-control": "private, no-store, max-age=0",
        "content-disposition": `attachment; filename="bunnyhood-records-${day}.xlsx"`,
        "content-length": String(workbook.bytes.byteLength),
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "cross-origin-resource-policy": "same-origin",
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof HttpError) return routeError(error);
    console.error("Bunny Hood Excel export failed.", error instanceof Error ? error.message : "Unknown error");
    return routeError(new HttpError(
      500,
      "The Excel file could not be created. Choose a CSV export now and try Excel again after the next deployment.",
      "EXCEL_EXPORT_FAILED",
    ));
  }
}
