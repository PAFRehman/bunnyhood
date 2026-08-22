import { requireSessionUser } from "@/lib/spin/auth";
import { assertSameOrigin, json, readJson, routeError } from "@/lib/spin/http";
import { enforceRateLimit } from "@/lib/spin/rate-limit";
import { customizeReferralCode } from "@/lib/spin/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireSessionUser(request, true);
    await enforceRateLimit(`referral-code:${user.id}`, 6, 60 * 60);
    const body = await readJson<{ code?: string }>(request, 2_048);
    const result = await customizeReferralCode(user.id, body.code ?? "");
    return json(result);
  } catch (error) {
    return routeError(error);
  }
}
