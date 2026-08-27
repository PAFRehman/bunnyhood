import { renderRabbitHoleSbtSvg } from "@/lib/rabbit-hole/art";
import { getEligibilityById } from "@/lib/rabbit-hole/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ claimId: string }> },
) {
  const { claimId } = await params;
  const row = await getEligibilityById(claimId);
  if (!row || (row.status !== "minting" && row.status !== "claimed")) {
    return new Response("SBT artwork not found.", { status: 404 });
  }
  const svg = renderRabbitHoleSbtSvg({
    username: row.x_username,
    displayName: row.x_name,
    pfpContentType: row.pfp_content_type,
    pfpBase64: row.pfp_base64,
    tokenId: row.token_id,
  });
  return new Response(svg, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": row.status === "claimed"
        ? "public, max-age=86400, stale-while-revalidate=604800"
        : "public, max-age=10",
      "access-control-allow-origin": "*",
      "cross-origin-resource-policy": "cross-origin",
      "x-content-type-options": "nosniff",
    },
  });
}
