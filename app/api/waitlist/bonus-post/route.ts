import { assertSameOrigin, json, readJson, routeError } from "@/lib/spin/http";
import { enforceRateLimit } from "@/lib/spin/rate-limit";
import { sha256 } from "@/lib/spin/security";
import { assertPublicStorageWritable } from "@/lib/spin/storage-safety";
import { submitWaitlistBonusPost } from "@/lib/waitlist/data";
import { requireWaitlistSession } from "@/lib/waitlist/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await assertPublicStorageWritable();
    const session = await requireWaitlistSession(request, true);
    await enforceRateLimit(sha256(`waitlist-bonus:${session.id}`), 5, 5 * 60);
    const body = await readJson<{ postUrl?: string }>(request, 2_048);
    const entry = await submitWaitlistBonusPost(session.id, body.postUrl ?? "");
    return json({ ok: true, entry });
  } catch (error) {
    return routeError(error);
  }
}
