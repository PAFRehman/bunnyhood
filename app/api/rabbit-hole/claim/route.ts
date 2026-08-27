import { requireRabbitHoleAccess } from "@/lib/rabbit-hole/access";
import { mintRabbitHoleSbt } from "@/lib/rabbit-hole/claim";
import { publicEligibility } from "@/lib/rabbit-hole/data";
import { requireSessionUser } from "@/lib/spin/auth";
import { assertSameOrigin, json, readJson, routeError } from "@/lib/spin/http";
import { anonymousRequestKey, enforceRateLimit } from "@/lib/spin/rate-limit";
import { assertPublicStorageWritable } from "@/lib/spin/storage-safety";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    requireRabbitHoleAccess(request);
    assertSameOrigin(request);
    await assertPublicStorageWritable();
    const user = await requireSessionUser(request, true);
    await enforceRateLimit(anonymousRequestKey(request, `rabbit-hole-claim:${user.id}`), 4, 5 * 60);
    const body = await readJson<{ wallet?: string }>(request, 2_048);
    const eligibility = await mintRabbitHoleSbt(user, body.wallet ?? "");
    return json({ eligibility: publicEligibility(eligibility) });
  } catch (error) {
    return routeError(error);
  }
}
