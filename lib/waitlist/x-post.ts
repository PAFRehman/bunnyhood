import "server-only";

import { HttpError } from "@/lib/spin/http";
import { parseWaitlistPostUrl } from "./config";

type XEmbedReply = {
  author_url?: string;
  html?: string;
  url?: string;
};

function usernameFromAuthorUrl(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!["x.com", "www.x.com", "twitter.com", "www.twitter.com"].includes(url.hostname.toLowerCase())) {
      return null;
    }
    const match = url.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/?$/);
    return match?.[1]?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

export async function verifyWaitlistPost(rawPostUrl: string, expectedReferralCode?: string) {
  const parsed = parseWaitlistPostUrl(rawPostUrl);
  const endpoint = new URL("https://publish.x.com/oembed");
  endpoint.searchParams.set("url", parsed.postUrl);
  endpoint.searchParams.set("omit_script", "1");
  endpoint.searchParams.set("dnt", "true");
  let response: Response;
  try {
    response = await fetch(endpoint, {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    throw new HttpError(502, "X could not verify that post. Try again in a moment.", "WAITLIST_X_VERIFY_UNAVAILABLE");
  }
  if (response.status === 404) {
    throw new HttpError(400, "That X post does not exist or is not public.", "WAITLIST_X_POST_NOT_PUBLIC");
  }
  const data = await response.json().catch(() => ({})) as XEmbedReply;
  if (!response.ok) {
    throw new HttpError(502, "X could not verify that post. Try again in a moment.", "WAITLIST_X_VERIFY_UNAVAILABLE");
  }
  const xUsername = usernameFromAuthorUrl(data.author_url);
  if (!xUsername) {
    throw new HttpError(400, "Use a public post from your own X account.", "WAITLIST_X_AUTHOR_MISSING");
  }
  if (expectedReferralCode) {
    const html = data.html?.toLowerCase() ?? "";
    if (!html.includes(expectedReferralCode.toLowerCase()) || !html.includes("@bunnyshood")) {
      throw new HttpError(
        400,
        "Use the CREATE POST button and keep both @BunnysHood and your referral code in the post.",
        "WAITLIST_X_POST_CONTENT_MISMATCH",
      );
    }
  }
  return {
    postId: parsed.postId,
    postUrl: `https://x.com/${xUsername}/status/${parsed.postId}`,
    xUsername,
  };
}
