import { getRabbitHoleClaimByKey } from "@/lib/rabbithole/data";
import { renderRabbitHoleImage } from "@/lib/rabbithole/art";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(
  _request: Request,
  context: { params: Promise<{ claimKey: string }> },
) {
  const { claimKey } = await context.params;
  const claim = await getRabbitHoleClaimByKey(claimKey);
  if (!claim) return new Response("Rabbit Hole token not found.", { status: 404 });
  try {
    const image = await renderRabbitHoleImage(claim);
    return new Response(new Uint8Array(image), {
      headers: {
        "cache-control": claim.status === "CONFIRMED"
          ? "public, max-age=86400, s-maxage=31536000, immutable"
          : "public, max-age=30, s-maxage=30",
        "content-type": "image/png",
        "content-length": String(image.byteLength),
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Rabbit Hole image generation failed.", error);
    return new Response("Rabbit Hole image is temporarily unavailable.", { status: 503 });
  }
}
