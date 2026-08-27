import { findEligibilityByUsername, getEligibilityStats, publicEligibility } from "@/lib/rabbit-hole/data";
import { getRabbitHoleNetwork, isRabbitHolePublic, isValidXUsername } from "@/lib/rabbit-hole/config";
import { requireRabbitHoleAccess } from "@/lib/rabbit-hole/access";
import { HttpError, json, routeError } from "@/lib/spin/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    requireRabbitHoleAccess(request);
    const username = new URL(request.url).searchParams.get("username") ?? "";
    if (!isValidXUsername(username)) {
      throw new HttpError(400, "Enter a valid X username.", "BAD_USERNAME");
    }
    const [eligibility, stats] = await Promise.all([
      findEligibilityByUsername(username),
      getEligibilityStats(),
    ]);
    const network = getRabbitHoleNetwork();
    return json({
      ...publicEligibility(eligibility),
      stats: { total: stats.total, claimed: stats.claimed },
      access: isRabbitHolePublic() ? "public" : "admin_preview",
      network: {
        name: network.name,
        chainId: network.chainId,
        explorerUrl: network.explorerUrl,
        contractConfigured: Boolean(network.contractAddress),
      },
    });
  } catch (error) {
    return routeError(error);
  }
}
