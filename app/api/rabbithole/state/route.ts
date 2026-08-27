import { requireSpinAdmin } from "@/lib/spin/admin";
import { getSessionUser } from "@/lib/spin/auth";
import { json, routeError } from "@/lib/spin/http";
import { reconcileRabbitHoleClaimForUser } from "@/lib/rabbithole/claims";
import { getPublicRabbitHoleNetwork } from "@/lib/rabbithole/config";
import {
  bindRabbitHoleUser,
  getRabbitHoleAllowlist,
  getRabbitHoleTotals,
  publicRabbitHoleClaim,
} from "@/lib/rabbithole/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request) {
  try {
    requireSpinAdmin(request);
    const user = await getSessionUser(request, false, false);
    const [totals, allowlist, eligibility, claim] = await Promise.all([
      getRabbitHoleTotals(),
      getRabbitHoleAllowlist(),
      user ? bindRabbitHoleUser(user) : Promise.resolve(null),
      user ? reconcileRabbitHoleClaimForUser(user.id) : Promise.resolve(null),
    ]);
    return json({
      network: getPublicRabbitHoleNetwork(),
      totals,
      allowlist,
      authenticated: Boolean(user),
      user: user ? {
        id: user.id,
        xUserId: user.xUserId,
        xUsername: user.xUsername,
        xName: user.xName,
        xProfileImageUrl: user.xProfileImageUrl,
      } : null,
      eligibility,
      claim: publicRabbitHoleClaim(claim),
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return routeError(error);
  }
}
