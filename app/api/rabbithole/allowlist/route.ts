import { requireSpinAdmin } from "@/lib/spin/admin";
import { assertSameOrigin, HttpError, json, readJson, routeError } from "@/lib/spin/http";
import { anonymousRequestKey, enforceRateLimit } from "@/lib/spin/rate-limit";
import {
  getRabbitHoleAllowlist,
  importRabbitHoleAllowlist,
} from "@/lib/rabbithole/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    requireSpinAdmin(request);
    const search = new URL(request.url).searchParams.get("search") || "";
    return json({ rows: await getRabbitHoleAllowlist(search) });
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    requireSpinAdmin(request);
    await enforceRateLimit(anonymousRequestKey(request, "rabbit-hole-allowlist"), 12, 60);
    const body = await readJson<{
      usernames?: unknown;
      mode?: unknown;
    }>(request, 32_768);
    if (!Array.isArray(body.usernames)
      || body.usernames.some((value) => typeof value !== "string")) {
      throw new HttpError(400, "Send a list of X usernames.", "BAD_ALLOWLIST");
    }
    const mode = body.mode === "replace" ? "replace" : "merge";
    const result = await importRabbitHoleAllowlist(body.usernames as string[], mode);
    return json({ ...result, rows: await getRabbitHoleAllowlist() });
  } catch (error) {
    return routeError(error);
  }
}
