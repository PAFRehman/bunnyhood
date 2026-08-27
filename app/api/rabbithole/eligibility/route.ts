import { requireSpinAdmin } from "@/lib/spin/admin";
import { HttpError, json, routeError } from "@/lib/spin/http";
import { findRabbitHoleEligibility } from "@/lib/rabbithole/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    requireSpinAdmin(request);
    const username = new URL(request.url).searchParams.get("username") || "";
    if (!username) throw new HttpError(400, "Enter an X username.", "MISSING_X_USERNAME");
    const record = await findRabbitHoleEligibility(username);
    return json({
      found: Boolean(record),
      eligible: Boolean(record?.eligible),
      record,
    });
  } catch (error) {
    return routeError(error);
  }
}
