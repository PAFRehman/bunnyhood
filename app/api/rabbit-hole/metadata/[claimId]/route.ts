import { getAppUrl } from "@/lib/spin/config";
import { getEligibilityById } from "@/lib/rabbit-hole/data";
import { json } from "@/lib/spin/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ claimId: string }> },
) {
  const { claimId } = await params;
  const row = await getEligibilityById(claimId);
  if (!row || (row.status !== "minting" && row.status !== "claimed")) {
    return json({ error: "SBT metadata not found." }, 404);
  }
  const origin = getAppUrl();
  return json({
    name: `Bunny Hood Rabbit Hole #${row.token_id ?? "Pending"}`,
    description: `A permanent, non-transferable Bunny Hood soulbound identity box for @${row.x_username}.`,
    image: `${origin}/api/rabbit-hole/image/${row.id}`,
    external_url: `${origin}/RabbitHole`,
    attributes: [
      { trait_type: "X Username", value: `@${row.x_username}` },
      { trait_type: "Identity", value: "Soulbound" },
      { trait_type: "Transferable", value: "No" },
      { trait_type: "Rabbit Hole", value: "Founding Box" },
      { trait_type: "Chain ID", value: row.chain_id === null ? "Pending" : String(row.chain_id) },
    ],
  }, 200, {
    "access-control-allow-origin": "*",
    "cross-origin-resource-policy": "cross-origin",
  });
}
