import { isAddress, type Address } from "viem";
import { getAuctionSnapshot } from "@/lib/auction/server";
import { parseAuctionNetwork } from "@/lib/auction/config";
import { requireSpinAdmin } from "@/lib/spin/admin";
import { HttpError, json } from "@/lib/spin/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function parseAfterBlock(value: string | null) {
  if (!value) return null;
  if (!/^\d+$/.test(value)) throw new HttpError(400, "Invalid bid cursor.", "BAD_CURSOR");
  return BigInt(value);
}

export async function GET(request: Request) {
  try {
    requireSpinAdmin(request);
    const url = new URL(request.url);
    const accountValue = url.searchParams.get("account");
    if (accountValue && !isAddress(accountValue)) {
      throw new HttpError(400, "Invalid wallet address.", "BAD_WALLET");
    }
    const snapshot = await getAuctionSnapshot({
      networkKey: parseAuctionNetwork(url.searchParams.get("network")),
      afterBlock: parseAfterBlock(url.searchParams.get("afterBlock")),
      account: accountValue ? accountValue as Address : null,
    });
    return json(snapshot);
  } catch (error) {
    if (error instanceof HttpError) {
      return json({ error: error.message, code: error.code }, error.status);
    }
    console.error("Auction snapshot failed.", error);
    return json({
      error: "The auction network could not be reached. Check its RPC and contract settings.",
      code: "AUCTION_NETWORK_ERROR",
    }, 502);
  }
}
