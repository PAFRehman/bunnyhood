import "server-only";

import { getAppUrl } from "@/lib/spin/config";
import { HttpError } from "@/lib/spin/http";

const PIN_FILE_URL = "https://api.pinata.cloud/pinning/pinFileToIPFS";
const PIN_JSON_URL = "https://api.pinata.cloud/pinning/pinJSONToIPFS";
const DEFAULT_GATEWAY = "https://gateway.pinata.cloud";
const CID_PATTERN = /^[A-Za-z0-9]{32,120}$/;

type PinataResponse = { IpfsHash?: unknown };

function pinataJwt() {
  const value = process.env.PINATA_JWT?.trim() ?? "";
  if (!value) {
    throw new HttpError(503, "IPFS storage is not configured. Add PINATA_JWT before claiming.", "PINATA_NOT_CONFIGURED");
  }
  return value;
}

function pinataGateway() {
  const value = process.env.PINATA_GATEWAY_URL?.trim();
  if (!value) return DEFAULT_GATEWAY;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
      throw new Error("Unsafe gateway URL");
    }
    return url.toString().replace(/\/$/, "").replace(/\/ipfs$/, "");
  } catch {
    console.error("PINATA_GATEWAY_URL is invalid; using the public Pinata gateway.");
    return DEFAULT_GATEWAY;
  }
}

function readCid(value: unknown) {
  if (typeof value !== "string" || !CID_PATTERN.test(value)) {
    throw new HttpError(502, "Pinata returned an invalid IPFS content identifier.", "PINATA_BAD_RESPONSE");
  }
  return value;
}

async function pinataFetch(url: string, init: RequestInit) {
  const jwt = pinataJwt();
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${jwt}`);
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
      headers,
    });
  } catch (error) {
    console.error("Pinata request failed.", error instanceof Error ? error.message : error);
    throw new HttpError(502, "The box could not be saved to IPFS. Try again.", "PINATA_UNAVAILABLE");
  }
  if (!response.ok) {
    console.error("Pinata rejected an IPFS pin.", response.status, response.statusText);
    throw new HttpError(502, "The box could not be saved to IPFS. Check the Pinata configuration.", "PINATA_REJECTED");
  }
  return await response.json() as PinataResponse;
}

export function ipfsUri(cid: string) {
  return `ipfs://${readCid(cid)}`;
}

export function ipfsGatewayUrl(cid: string | null) {
  return cid && CID_PATTERN.test(cid) ? `${pinataGateway()}/ipfs/${cid}` : null;
}

export function publicIpfsGatewayUrl(cid: string) {
  return `${DEFAULT_GATEWAY}/ipfs/${readCid(cid)}`;
}

async function pinArtwork(png: Buffer, username: string) {
  const form = new FormData();
  form.set("file", new Blob([new Uint8Array(png)], { type: "image/png" }), `bunny-hood-rabbit-hole-${username}.png`);
  form.set("pinataMetadata", JSON.stringify({
    name: `Bunny Hood Rabbit Hole artwork · @${username}`,
    keyvalues: { collection: "Bunny Hood Rabbit Hole", x_username: username },
  }));
  form.set("pinataOptions", JSON.stringify({ cidVersion: 1 }));
  return readCid((await pinataFetch(PIN_FILE_URL, { method: "POST", body: form })).IpfsHash);
}

async function pinMetadata(input: {
  username: string;
  imageCid: string;
  chainId: number;
  contractAddress: string;
}) {
  const response = await pinataFetch(PIN_JSON_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      pinataOptions: { cidVersion: 1 },
      pinataMetadata: {
        name: `Bunny Hood Rabbit Hole metadata · @${input.username}`,
        keyvalues: { collection: "Bunny Hood Rabbit Hole", x_username: input.username },
      },
      pinataContent: {
        name: `Bunny Hood Rabbit Hole · @${input.username}`,
        description: `A permanent, non-transferable Bunny Hood soulbound identity box for @${input.username}.`,
        // Block explorers reliably ingest ordinary HTTPS metadata fields. The
        // immutable IPFS URI remains alongside it as the canonical source.
        image: publicIpfsGatewayUrl(input.imageCid),
        image_ipfs: ipfsUri(input.imageCid),
        external_url: `${getAppUrl()}/RabbitHole`,
        attributes: [
          { trait_type: "X Username", value: `@${input.username}` },
          { trait_type: "Identity", value: "Soulbound" },
          { trait_type: "Transferable", value: "No" },
          { trait_type: "Collection", value: "Bunny Hood Rabbit Hole" },
          { trait_type: "Chain ID", value: String(input.chainId) },
          { trait_type: "Contract", value: input.contractAddress.toLowerCase() },
        ],
      },
    }),
  });
  return readCid(response.IpfsHash);
}

export async function pinRabbitHoleSbt(input: {
  png: Buffer;
  username: string;
  chainId: number;
  contractAddress: string;
}) {
  const imageCid = await pinArtwork(input.png, input.username);
  const metadataCid = await pinMetadata({
    username: input.username,
    imageCid,
    chainId: input.chainId,
    contractAddress: input.contractAddress,
  });
  return {
    imageCid,
    metadataCid,
    imageUri: ipfsUri(imageCid),
    imageGatewayUrl: publicIpfsGatewayUrl(imageCid),
    metadataUri: ipfsUri(metadataCid),
    metadataGatewayUrl: publicIpfsGatewayUrl(metadataCid),
  };
}
