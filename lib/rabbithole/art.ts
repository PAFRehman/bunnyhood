import { readFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import type { RabbitHoleClaimRow } from "./data";

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function highResolutionProfileUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:"
    || (url.hostname !== "pbs.twimg.com" && !url.hostname.endsWith(".twimg.com"))) {
    throw new Error("Untrusted X profile image host.");
  }
  url.pathname = url.pathname.replace(/_normal(?=\.[a-zA-Z0-9]+$)/, "_400x400");
  return url;
}

async function profileImage(claim: RabbitHoleClaimRow) {
  if (claim.x_profile_image_url) {
    try {
      const url = highResolutionProfileUrl(claim.x_profile_image_url);
      const response = await fetch(url, {
        cache: "force-cache",
        redirect: "error",
        signal: AbortSignal.timeout(8_000),
        headers: { accept: "image/avif,image/webp,image/png,image/jpeg" },
      });
      const contentType = response.headers.get("content-type") || "";
      const announcedBytes = Number(response.headers.get("content-length") || "0");
      if (!response.ok || !contentType.startsWith("image/") || announcedBytes > 5_000_000) {
        throw new Error("X profile image response was invalid.");
      }
      const data = Buffer.from(await response.arrayBuffer());
      if (data.byteLength > 5_000_000) throw new Error("X profile image was too large.");
      return data;
    } catch (error) {
      console.warn("Rabbit Hole profile image fallback used.", error);
    }
  }
  return readFile(join(process.cwd(), "public", "assets", "bunny-hood-mark.webp"));
}

export async function renderRabbitHoleImage(claim: RabbitHoleClaimRow) {
  const [box, profile] = await Promise.all([
    readFile(join(process.cwd(), "public", "assets", "rabbit-hole-box.png")),
    profileImage(claim),
  ]);
  const profilePng = await sharp(profile)
    .rotate()
    .resize(430, 540, { fit: "cover", position: "attention" })
    .modulate({ saturation: 0.88, brightness: 0.88 })
    .png()
    .toBuffer();
  const username = escapeXml(`@${claim.x_username}`);
  const overlay = Buffer.from(`
    <svg width="1280" height="1280" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <clipPath id="rabbit-panel">
          <polygon points="245,470 594,614 594,944 245,792" />
        </clipPath>
        <linearGradient id="rabbit-tint" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#bfff00" stop-opacity="0.08" />
          <stop offset="1" stop-color="#050800" stop-opacity="0.34" />
        </linearGradient>
        <filter id="rabbit-glow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="7" result="blur" />
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <g clip-path="url(#rabbit-panel)">
        <image href="data:image/png;base64,${profilePng.toString("base64")}" x="226" y="423" width="405" height="557" preserveAspectRatio="xMidYMid slice" />
        <rect x="220" y="420" width="420" height="570" fill="url(#rabbit-tint)" />
      </g>
      <polygon points="245,470 594,614 594,944 245,792" fill="none" stroke="#c7ff00" stroke-width="5" opacity="0.82" filter="url(#rabbit-glow)" />
      <text x="288" y="758" fill="#d4ff37" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="800" letter-spacing="1" transform="rotate(22 288 758)">${username}</text>
    </svg>
  `);
  return sharp(box)
    .resize(1280, 1280, { fit: "fill" })
    .composite([{ input: overlay, top: 0, left: 0 }])
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}
