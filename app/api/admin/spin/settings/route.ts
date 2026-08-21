import { requireSpinAdmin } from "@/lib/spin/admin";
import { assertSameOrigin, HttpError, json, readJson, routeError } from "@/lib/spin/http";
import { setWalletChangesAllowed, setWalletSubmissionsAllowed } from "@/lib/spin/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    requireSpinAdmin(request);
    const body = await readJson<{
      allowWalletChanges?: unknown;
      allowWalletSubmissions?: unknown;
    }>(request);
    if (typeof body.allowWalletChanges === "boolean" && body.allowWalletSubmissions === undefined) {
      return json({ settings: await setWalletChangesAllowed(body.allowWalletChanges) });
    }
    if (typeof body.allowWalletSubmissions === "boolean" && body.allowWalletChanges === undefined) {
      return json({ settings: await setWalletSubmissionsAllowed(body.allowWalletSubmissions) });
    }
    throw new HttpError(400, "Choose one wallet permission to update.", "BAD_WALLET_SETTING");
  } catch (error) {
    return routeError(error);
  }
}
