import { getAppUrl } from "@/lib/spin/config";
import { getRabbitHoleClaimByKey } from "@/lib/rabbithole/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ claimKey: string }> },
) {
  const { claimKey } = await context.params;
  const claim = await getRabbitHoleClaimByKey(claimKey);
  if (!claim) {
    return Response.json({ error: "Rabbit Hole token not found." }, { status: 404 });
  }
  const tokenLabel = claim.token_id ? `#${claim.token_id}` : claim.claim_key.slice(2, 10).toUpperCase();
  return Response.json({
    name: `Bunny Hood Rabbit Hole ${tokenLabel}`,
    description: "A unique, permanently soulbound Bunny Hood Rabbit Hole box claimed through a verified X identity.",
    image: `${getAppUrl()}/api/rabbithole/image/${claim.claim_key}`,
    external_url: `${getAppUrl()}/RabbitHole`,
    attributes: [
      { trait_type: "X Identity", value: `@${claim.x_username}` },
      { trait_type: "Claim Type", value: "Rabbit Hole" },
      { trait_type: "Transferability", value: "Soulbound" },
      { trait_type: "Chain ID", value: String(claim.chain_id) },
    ],
  }, {
    headers: {
      "cache-control": claim.status === "CONFIRMED"
        ? "public, max-age=86400, s-maxage=31536000, immutable"
        : "public, max-age=30, s-maxage=30",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}
