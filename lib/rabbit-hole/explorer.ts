import "server-only";

import { isAddress } from "viem";
import { HttpError } from "@/lib/spin/http";

const EXPLORERS = new Map<number, string>([
  [4663, "https://robinhoodchain.blockscout.com"],
  [46630, "https://explorer.testnet.chain.robinhood.com"],
]);

type ExplorerMetadataInput = {
  chainId: number;
  contractAddress: string;
  tokenId: string;
};

export async function requestExplorerMetadataRefresh(input: ExplorerMetadataInput) {
  const explorer = EXPLORERS.get(input.chainId);
  if (!explorer || !isAddress(input.contractAddress) || !/^[1-9][0-9]*$/.test(input.tokenId)) {
    throw new HttpError(422, "This claim does not have valid explorer metadata.", "BAD_EXPLORER_METADATA");
  }

  const endpoint = new URL(
    `/api/v2/tokens/${input.contractAddress}/instances/${input.tokenId}/refetch-metadata`,
    explorer,
  );
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "PATCH",
      body: "{}",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
      headers: { accept: "application/json", "content-type": "application/json" },
    });
  } catch (error) {
    console.error("Blockscout metadata refresh failed.", error instanceof Error ? error.message : error);
    throw new HttpError(502, "Blockscout could not be reached. Try refreshing again shortly.", "EXPLORER_UNAVAILABLE");
  }

  if (response.status === 429) {
    throw new HttpError(429, "Blockscout is rate-limiting metadata refreshes. Try again later.", "EXPLORER_RATE_LIMITED");
  }
  if (!response.ok) {
    console.error("Blockscout rejected a metadata refresh.", response.status, response.statusText);
    throw new HttpError(502, "Blockscout did not accept the metadata refresh.", "EXPLORER_REFRESH_REJECTED");
  }
}
