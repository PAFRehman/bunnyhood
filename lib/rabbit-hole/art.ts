import "server-only";

import { join } from "node:path";
import sharp from "sharp";
import { HttpError } from "@/lib/spin/http";

const MAX_PFP_BYTES = 1_000_000;
const ALLOWED_PFP_HOSTS = new Set(["pbs.twimg.com", "abs.twimg.com"]);
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MASTER_ART_PATH = join(process.cwd(), "public", "assets", "rabbit-hole-box-original.png");

// The inset black face in the supplied 1254 x 1254 master artwork. The PFP is
// sheared into this panel so it follows the original box perspective and never
// covers the frame, BH side, question-mark lid, glow, or shadow.
export const RABBIT_HOLE_ART_SIZE = 1_254;
export const RABBIT_HOLE_PANEL = {
  x: 257,
  y: 478,
  width: 330,
  height: 431,
  shearY: 104 / 330,
} as const;

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

function validProfileBuffer(contentType: string | null, base64: string | null) {
  if (!contentType || !ALLOWED_IMAGE_TYPES.has(contentType)) return null;
  if (!base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return null;
  const bytes = Buffer.from(base64, "base64");
  return bytes.byteLength > 0 && bytes.byteLength <= MAX_PFP_BYTES ? bytes : null;
}

export async function renderRabbitHoleSbtPng(input: {
  pfpContentType: string | null;
  pfpBase64: string | null;
}) {
  const source = validProfileBuffer(input.pfpContentType, input.pfpBase64);
  if (!source) throw new HttpError(422, "The saved X profile picture is unavailable.", "PFP_SNAPSHOT_MISSING");

  // Normalize every supported input to a small, metadata-free PNG before it is
  // embedded in the SVG compositor. `cover` keeps the face centered and avoids
  // letterboxing or an artificial background on the front panel.
  const profile = await sharp(source, { failOn: "error" })
    .rotate()
    .resize(900, 900, { fit: "cover", position: "attention" })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();

  const panel = RABBIT_HOLE_PANEL;
  const shearOffset = -(panel.x * panel.shearY);
  const right = panel.x + panel.width;
  const bottom = panel.y + panel.height;
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${RABBIT_HOLE_ART_SIZE}" height="${RABBIT_HOLE_ART_SIZE}" viewBox="0 0 ${RABBIT_HOLE_ART_SIZE} ${RABBIT_HOLE_ART_SIZE}">
      <defs>
        <clipPath id="rabbit-hole-front" clipPathUnits="userSpaceOnUse">
          <polygon points="${panel.x},${panel.y} ${right},${panel.y + 104} ${right},${bottom + 104} ${panel.x},${bottom}" />
        </clipPath>
      </defs>
      <g clip-path="url(#rabbit-hole-front)">
        <image href="data:image/png;base64,${profile.toString("base64")}" x="${panel.x}" y="${panel.y}" width="${panel.width}" height="${panel.height}" preserveAspectRatio="xMidYMid slice" transform="matrix(1 ${panel.shearY} 0 1 0 ${shearOffset})" />
      </g>
    </svg>`;

  return sharp(MASTER_ART_PATH, { failOn: "error" })
    .composite([{ input: Buffer.from(svg), blend: "over" }])
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}
