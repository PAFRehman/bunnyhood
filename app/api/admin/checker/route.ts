import {
  deleteCheckerWallet,
  getCheckerStats,
  listCheckerWallets,
  parseCheckerImport,
  upsertCheckerWallets,
} from "@/lib/checker/data";
import { recordAdminAction } from "@/lib/spin/audit";
import { requireSpinAdmin } from "@/lib/spin/admin";
import { assertSameOrigin, json, readJson, routeError } from "@/lib/spin/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    requireSpinAdmin(request);
    const search = new URL(request.url).searchParams.get("search") ?? "";
    const [stats, rows] = await Promise.all([
      getCheckerStats(),
      listCheckerWallets(search),
    ]);
    return json({ stats, rows });
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(request: Request) {
  try {
    requireSpinAdmin(request);
    assertSameOrigin(request);
    const body = await readJson<{ gtdWallets?: string; fcfsWallets?: string }>(request, 512 * 1024);
    const entries = parseCheckerImport(body.gtdWallets ?? "", body.fcfsWallets ?? "");
    const stats = await upsertCheckerWallets(entries);
    await recordAdminAction("checker_wallets_imported", {
      imported: entries.length,
      gtdImported: entries.filter((entry) => entry.eligibilityType === "GTD").length,
      fcfsImported: entries.filter((entry) => entry.eligibilityType === "FCFS").length,
      total: stats.total,
    });
    return json({ ok: true, imported: entries.length, stats });
  } catch (error) {
    return routeError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    requireSpinAdmin(request);
    assertSameOrigin(request);
    const body = await readJson<{ walletAddress?: string }>(request, 2_048);
    const walletAddress = await deleteCheckerWallet(body.walletAddress ?? "");
    await recordAdminAction("checker_wallet_removed", { walletAddress });
    return json({ ok: true });
  } catch (error) {
    return routeError(error);
  }
}
