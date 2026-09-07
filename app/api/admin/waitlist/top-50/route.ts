import { buildWaitlistTopReferrersWorkbook } from "@/lib/waitlist/export";
import { requireSpinAdmin } from "@/lib/spin/admin";
import { HttpError, routeError } from "@/lib/spin/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    requireSpinAdmin(request);
    const workbook = await buildWaitlistTopReferrersWorkbook();
    const day = new Date().toISOString().slice(0, 10);
    return new Response(workbook.bytes, {
      status: 200,
      headers: {
        "cache-control": "private, no-store, max-age=0",
        "content-disposition": `attachment; filename="bunnyhood-waitlist-top-50-wallets-${day}.xlsx"`,
        "content-length": String(workbook.bytes.byteLength),
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "cross-origin-resource-policy": "same-origin",
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof HttpError) return routeError(error);
    console.error("Waitlist Top 50 wallet export failed.", error instanceof Error ? error.message : "Unknown error");
    return routeError(new HttpError(
      500,
      "The Top 50 wallet sheet could not be created. Try again.",
      "WAITLIST_TOP_50_EXPORT_FAILED",
    ));
  }
}
