import {
  deleteCheckerWallet,
  getCheckerStats,
  listCheckerWallets,
  parseCheckerImport,
  previewCheckerWallets,
  upsertCheckerWallets,
} from "@/lib/checker/data";
import { recordAdminAction } from "@/lib/spin/audit";
import { requireSpinAdmin } from "@/lib/spin/admin";
import { assertSameOrigin, HttpError, json, readJson, routeError } from "@/lib/spin/http";
import { after } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function auditCheckerAction(action: string, metadata: Record<string, unknown>) {
  after(async () => {
    try {
      await recordAdminAction(action, metadata);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown audit error";
      console.error("Checker admin audit could not be recorded.", message);
    }
  });
}

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
    const body = await readJson<{
      operation?: "preview" | "import";
      gtdWallets?: string;
      fcfsWallets?: string;
    }>(request, 2 * 1024 * 1024);
    if (body.operation !== "preview" && body.operation !== "import") {
      throw new HttpError(400, "Choose preview or import.", "BAD_CHECKER_OPERATION");
    }
    const draft = parseCheckerImport(body.gtdWallets ?? "", body.fcfsWallets ?? "");

    if (body.operation === "preview") {
      return json({ ok: true, preview: await previewCheckerWallets(draft) });
    }

    const result = await upsertCheckerWallets(draft);
    auditCheckerAction("checker_wallets_imported", {
      saved: result.saved,
      newWallets: result.preview.newWallets,
      alreadyExists: result.preview.alreadyExists,
      statusChanges: result.preview.statusChanges,
      gtdDetected: result.preview.gtd,
      fcfsDetected: result.preview.fcfs,
      total: result.stats.total,
    });
    return json({ ok: true, ...result });
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
    auditCheckerAction("checker_wallet_removed", { walletAddress });
    return json({ ok: true });
  } catch (error) {
    return routeError(error);
  }
}
