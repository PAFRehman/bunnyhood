import { findCheckerEligibility } from "@/lib/checker/data";
import { ensureCheckerSchema } from "@/lib/checker/schema";
import { assertSameOrigin, json, readJson, routeError } from "@/lib/spin/http";
import { anonymousRequestKey, enforceRateLimit } from "@/lib/spin/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await ensureCheckerSchema();
    await enforceRateLimit(anonymousRequestKey(request, "wallet-checker"), 20, 60);
    const body = await readJson<{ walletAddress?: string }>(request, 2_048);
    const eligibility = await findCheckerEligibility(body.walletAddress ?? "");
    return json({
      result: {
        eligible: true as const,
        status: eligibility ?? "PUBLIC" as const,
      },
    });
  } catch (error) {
    return routeError(error);
  }
}
