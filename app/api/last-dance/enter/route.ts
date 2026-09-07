import { requireSessionUser } from "@/lib/spin/auth";
import { assertSameOrigin, json, readJson, routeError } from "@/lib/spin/http";
import { enforceRateLimit } from "@/lib/spin/rate-limit";
import { assertPublicStorageWritable } from "@/lib/spin/storage-safety";
import {
  enterLastDance,
  LastDanceRequirementsError,
  requireLastDanceAccess,
} from "@/lib/last-dance/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const access = await requireLastDanceAccess(request);
    await assertPublicStorageWritable();
    const user = await requireSessionUser(request, true);
    await enforceRateLimit(`last-dance-enter:${user.id}`, 6, 15 * 60);
    const body = await readJson<{ walletAddress?: string }>(request, 2_048);
    return json({ ok: true, entry: await enterLastDance(user, body.walletAddress ?? "", access.isAdmin) });
  } catch (error) {
    if (error instanceof LastDanceRequirementsError) {
      return json({
        error: error.message,
        code: "LAST_DANCE_REQUIREMENTS_MISSING",
        missing: error.missing,
      }, 409);
    }
    return routeError(error);
  }
}
