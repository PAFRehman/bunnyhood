import { renderSpinSocialCard } from "@/app/SpinTheWheel/social-card";

export const runtime = "nodejs";

const REFERRAL_CODE = /^[a-z0-9_]{3,24}$/;

export async function GET(request: Request) {
  const candidate = new URL(request.url).searchParams.get("ref")?.trim().toLowerCase() ?? "";
  const referralCode = REFERRAL_CODE.test(candidate) ? candidate : "";
  const response = renderSpinSocialCard(referralCode);

  response.headers.set("cache-control", "public, max-age=86400, s-maxage=31536000, immutable");
  response.headers.set("content-disposition", "inline; filename=\"bunny-hood-spin.png\"");
  response.headers.set("x-content-type-options", "nosniff");

  return response;
}
