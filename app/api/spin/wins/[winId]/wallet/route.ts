import { requireSessionUser } from "@/lib/spin/auth";
import { assertSameOrigin, json, readJson, routeError } from "@/lib/spin/http";
import { flushSheetOutboxForKey } from "@/lib/spin/sheets";
import { removeWinWallet, submitWinWallet } from "@/lib/spin/wheel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

async function syncWalletRow(winId: string) {
  try {
    return await flushSheetOutboxForKey(`win:${winId}`);
  } catch (error) {
    console.error(
      "Immediate wallet Sheet sync will be retried from the outbox.",
      error instanceof Error ? error.message : "Unknown error",
    );
    return { configured: true, attempted: 0, delivered: 0, errors: ["RETRY_QUEUED"] };
  }
}

async function walletResponse(result: Record<string, unknown>, winId: string) {
  const sheetSync = await syncWalletRow(winId);
  return json({
    ...result,
    sheetSynced: sheetSync.delivered === 1,
    sheetSyncPending: sheetSync.delivered !== 1,
    sheetSyncError: sheetSync.errors[0] ?? null,
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ winId: string }> },
) {
  try {
    assertSameOrigin(request);
    const user = await requireSessionUser(request, true);
    const { winId } = await context.params;
    const body = await readJson<{ wallet?: string }>(request);
    const result = await submitWinWallet(user, winId, body.wallet ?? "");
    return walletResponse(result, winId);
  } catch (error) {
    return routeError(error);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ winId: string }> },
) {
  try {
    assertSameOrigin(request);
    const user = await requireSessionUser(request, true);
    const { winId } = await context.params;
    const result = await removeWinWallet(user, winId);
    return walletResponse(result, winId);
  } catch (error) {
    return routeError(error);
  }
}
