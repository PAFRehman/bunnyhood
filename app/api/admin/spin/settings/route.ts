import { requireSpinAdmin } from "@/lib/spin/admin";
import { recordAdminAction } from "@/lib/spin/audit";
import { assertSameOrigin, HttpError, json, readJson, routeError } from "@/lib/spin/http";
import { ensureProductionSchema } from "@/lib/spin/schema";
import { setWalletChangesAllowed, setWalletSubmissionsAllowed } from "@/lib/spin/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    requireSpinAdmin(request);
    await ensureProductionSchema();
    const body = await readJson<{
      allowWalletChanges?: unknown;
      allowWalletSubmissions?: unknown;
    }>(request);
    if (typeof body.allowWalletChanges === "boolean" && body.allowWalletSubmissions === undefined) {
      const settings = await setWalletChangesAllowed(body.allowWalletChanges);
      await recordAdminAction("wallet_changes_permission", { allowed: body.allowWalletChanges });
      return json({ settings });
    }
    if (typeof body.allowWalletSubmissions === "boolean" && body.allowWalletChanges === undefined) {
      const settings = await setWalletSubmissionsAllowed(body.allowWalletSubmissions);
      await recordAdminAction("wallet_submissions_permission", { allowed: body.allowWalletSubmissions });
      return json({ settings });
    }
    throw new HttpError(400, "Choose one wallet permission to update.", "BAD_WALLET_SETTING");
  } catch (error) {
    return routeError(error);
  }
}
