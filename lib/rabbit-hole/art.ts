import "server-only";

import { HttpError } from "@/lib/spin/http";

const MAX_PFP_BYTES = 1_000_000;
const ALLOWED_PFP_HOSTS = new Set(["pbs.twimg.com", "abs.twimg.com"]);
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export type ProfileSnapshot = {
  contentType: "image/jpeg" | "image/png" | "image/webp";
  base64: string;
};

function upgradedXImageUrl(value: string) {
  const url = new URL(value);
  if (!ALLOWED_PFP_HOSTS.has(url.hostname.toLowerCase()) || url.protocol !== "https:") {
    throw new HttpError(422, "X returned an unsupported profile image URL.", "BAD_PROFILE_IMAGE");
  }
  url.pathname = url.pathname.replace(/_normal(?=\.[a-z0-9]+$)/i, "_400x400");
  return url;
}

export async function snapshotXProfileImage(value: string | null): Promise<ProfileSnapshot> {
  if (!value) throw new HttpError(422, "Your X profile needs a profile picture before claiming.", "PFP_REQUIRED");
  const url = upgradedXImageUrl(value);
  const response = await fetch(url, {
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
    headers: { accept: "image/jpeg,image/png,image/webp" },
  });
  if (!response.ok) {
    throw new HttpError(502, "Your X profile picture could not be prepared. Try again.", "PFP_FETCH_FAILED");
  }
  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
    throw new HttpError(422, "Your X profile picture format is not supported.", "PFP_FORMAT_UNSUPPORTED");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.byteLength || bytes.byteLength > MAX_PFP_BYTES) {
    throw new HttpError(422, "Your X profile picture is too large to print on the box.", "PFP_TOO_LARGE");
  }
  return {
    contentType: contentType as ProfileSnapshot["contentType"],
    base64: Buffer.from(bytes).toString("base64"),
  };
}

export function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function renderRabbitHoleSbtSvg(input: {
  username: string;
  displayName: string | null;
  pfpContentType: string | null;
  pfpBase64: string | null;
  tokenId: string | null;
}) {
  const username = escapeXml(input.username);
  const displayName = escapeXml(input.displayName || `@${input.username}`);
  const token = escapeXml(input.tokenId || "SOULBOUND");
  const validBase64 = input.pfpBase64 && /^[A-Za-z0-9+/]+={0,2}$/.test(input.pfpBase64)
    ? input.pfpBase64
    : null;
  const validType = input.pfpContentType && ALLOWED_IMAGE_TYPES.has(input.pfpContentType)
    ? input.pfpContentType
    : null;
  const pfp = validBase64 && validType
    ? `<image href="data:${validType};base64,${validBase64}" x="235" y="365" width="470" height="470" preserveAspectRatio="xMidYMid slice" clip-path="url(#frontClip)"/>`
    : `<rect x="235" y="365" width="470" height="470" fill="#15220d" clip-path="url(#frontClip)"/><text x="470" y="620" text-anchor="middle" fill="#caff00" font-size="120" font-weight="900" clip-path="url(#frontClip)">BH</text>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200" viewBox="0 0 1200 1200" role="img" aria-label="Bunny Hood Rabbit Hole SBT for @${username}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#070a06"/><stop offset="1" stop-color="#16250e"/></linearGradient>
    <linearGradient id="top" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#e4ff74"/><stop offset="1" stop-color="#a8d900"/></linearGradient>
    <linearGradient id="side" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#87ad00"/><stop offset="1" stop-color="#426100"/></linearGradient>
    <linearGradient id="front" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#d8ff3f"/><stop offset="1" stop-color="#8bb500"/></linearGradient>
    <clipPath id="frontClip"><polygon points="205,350 720,350 720,865 205,805"/></clipPath>
    <pattern id="grid" width="52" height="52" patternUnits="userSpaceOnUse"><path d="M52 0H0V52" fill="none" stroke="#caff00" stroke-opacity=".055"/></pattern>
  </defs>
  <rect width="1200" height="1200" fill="url(#bg)"/>
  <rect width="1200" height="1200" fill="url(#grid)"/>
  <circle cx="600" cy="540" r="500" fill="none" stroke="#caff00" stroke-opacity=".08" stroke-width="2"/>
  <circle cx="600" cy="540" r="430" fill="none" stroke="#caff00" stroke-opacity=".05" stroke-width="28"/>
  <polygon points="205,350 480,175 995,255 720,350" fill="url(#top)" stroke="#ecff9b" stroke-width="5"/>
  <polygon points="720,350 995,255 995,770 720,865" fill="url(#side)" stroke="#aada12" stroke-width="5"/>
  <polygon points="205,350 720,350 720,865 205,805" fill="url(#front)" stroke="#dfff58" stroke-width="5"/>
  ${pfp}
  <polygon points="205,730 720,790 720,865 205,805" fill="#10180c" fill-opacity=".76"/>
  <text x="244" y="783" fill="#f4f1e8" font-family="Arial,Helvetica,sans-serif" font-size="30" font-weight="900">@${username}</text>
  <text x="244" y="818" fill="#caff00" font-family="Arial,Helvetica,sans-serif" font-size="16" font-weight="700" letter-spacing="4">PERMANENTLY SOULBOUND</text>
  <text x="862" y="570" text-anchor="middle" fill="#0a0d08" font-family="Arial,Helvetica,sans-serif" font-size="128" font-weight="950" transform="rotate(-18 862 570)">BH</text>
  <text x="615" y="295" text-anchor="middle" fill="#0a0d08" font-family="Arial,Helvetica,sans-serif" font-size="140" font-weight="950" transform="rotate(8 615 295)">?</text>
  <text x="90" y="1035" fill="#caff00" font-family="Arial,Helvetica,sans-serif" font-size="18" font-weight="900" letter-spacing="6">BUNNY HOOD · RABBIT HOLE</text>
  <text x="90" y="1085" fill="#f4f1e8" font-family="Arial,Helvetica,sans-serif" font-size="44" font-weight="900">${displayName}</text>
  <text x="1110" y="1085" text-anchor="end" fill="#78836f" font-family="Arial,Helvetica,sans-serif" font-size="20" font-weight="800">SBT #${token}</text>
</svg>`;
}
