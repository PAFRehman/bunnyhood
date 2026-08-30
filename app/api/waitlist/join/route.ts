import { assertSameOrigin, json, readJson, routeError } from "@/lib/spin/http";
import { enforceRateLimit } from "@/lib/spin/rate-limit";
import { sha256 } from "@/lib/spin/security";
import { assertPublicStorageWritable } from "@/lib/spin/storage-safety";
import { joinWaitlist } from "@/lib/waitlist/data";
import { requireWaitlistSession } from "@/lib/waitlist/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await assertPublicStorageWritable();
    const session = await requireWaitlistSession(request, true);
    await enforceRateLimit(sha256(`waitlist-join:${session.id}`), 4, 5 * 60);
    const body = await readJson<{ wallet?: string }>(request, 2_048);
    const entry = await joinWaitlist(session.id, body.wallet ?? "", session.incomingReferralCode);
    return json({ ok: true, entry });
  } catch (error) {
    return routeError(error);
  }
}
