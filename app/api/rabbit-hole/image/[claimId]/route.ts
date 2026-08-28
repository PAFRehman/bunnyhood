import { renderRabbitHoleSbtPng } from "@/lib/rabbit-hole/art";
import { getEligibilityById } from "@/lib/rabbit-hole/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ claimId: string }> },
) {
  const { claimId } = await params;
  const row = await getEligibilityById(claimId);
  if (!row || (row.status !== "minting" && row.status !== "claimed")) {
    return new Response("SBT artwork not found.", { status: 404 });
  }
  const png = await renderRabbitHoleSbtPng({
    pfpContentType: row.pfp_content_type,
    pfpBase64: row.pfp_base64,
  });
  const download = new URL(request.url).searchParams.get("download") === "1";
  const disposition = `${download ? "attachment" : "inline"}; filename="bunny-hood-rabbit-hole-${row.x_username}.png"`;
  return new Response(new Uint8Array(png), {
    headers: {
      "content-type": "image/png",
      "content-length": String(png.byteLength),
      "content-disposition": disposition,
      "cache-control": row.status === "claimed"
        ? "public, max-age=31536000, immutable"
        : "public, max-age=10",
      "access-control-allow-origin": "*",
      "cross-origin-resource-policy": "cross-origin",
      "x-content-type-options": "nosniff",
    },
  });
}
