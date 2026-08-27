import { requireRabbitHoleAccess } from "@/lib/rabbit-hole/access";
import { reconcileRabbitHoleClaim } from "@/lib/rabbit-hole/claim";
import { getRabbitHoleNetwork, isRabbitHolePublic } from "@/lib/rabbit-hole/config";
import { bindAuthenticatedEligibility, getEligibilityStats, publicEligibility } from "@/lib/rabbit-hole/data";
import { getSessionUser } from "@/lib/spin/auth";
import { json, routeError } from "@/lib/spin/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request) {
  try {
    requireRabbitHoleAccess(request);
    const [user, stats] = await Promise.all([
      getSessionUser(request, false),
      getEligibilityStats(),
    ]);
    const network = getRabbitHoleNetwork();
    if (!user) {
      return json({
        authenticated: false,
        eligibility: null,
        stats,
        access: isRabbitHolePublic() ? "public" : "admin_preview",
        network: {
          name: network.name,
          chainId: network.chainId,
          explorerUrl: network.explorerUrl,
          contractAddress: network.contractAddress,
          contractConfigured: Boolean(network.contractAddress),
        },
      });
    }
    let eligibility = await bindAuthenticatedEligibility(user);
    if (eligibility?.status === "minting") eligibility = await reconcileRabbitHoleClaim(eligibility);
    return json({
      authenticated: true,
      user: {
        xUserId: user.xUserId,
        xUsername: user.xUsername,
        xName: user.xName,
        xProfileImageUrl: user.xProfileImageUrl,
      },
      eligibility: publicEligibility(eligibility),
      stats,
      access: isRabbitHolePublic() ? "public" : "admin_preview",
      network: {
        name: network.name,
        chainId: network.chainId,
        explorerUrl: network.explorerUrl,
        contractAddress: network.contractAddress,
        contractConfigured: Boolean(network.contractAddress),
      },
    });
  } catch (error) {
    return routeError(error);
  }
}
