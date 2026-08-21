import type { SpinDb } from "./db";
import { getDb } from "./db";
import { HttpError } from "./http";
import { requireStrongSecret } from "./config";
import { hmacHex } from "./security";

export function anonymousRequestKey(request: Request, action: string) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const vercelIp = request.headers.get("x-real-ip")?.trim();
  const ip = forwarded || vercelIp || "unknown";
  return hmacHex(requireStrongSecret("RATE_LIMIT_SECRET"), `${action}:${ip}`);
}

export async function enforceRateLimit(
  bucketKey: string,
  limit: number,
  windowSeconds: number,
  sql: SpinDb = getDb(),
) {
  const rows = await sql<{ hits: number }[]>`
    insert into spin_rate_limits (bucket_key, window_started_at, hits)
    values (${bucketKey}, now(), 1)
    on conflict (bucket_key) do update set
      window_started_at = case
        when spin_rate_limits.window_started_at < now() - (${windowSeconds} * interval '1 second') then now()
        else spin_rate_limits.window_started_at
      end,
      hits = case
        when spin_rate_limits.window_started_at < now() - (${windowSeconds} * interval '1 second') then 1
        else spin_rate_limits.hits + 1
      end
    returning hits
  `;
  if (Number(rows[0]?.hits ?? 0) > limit) {
    throw new HttpError(429, "Too many attempts. Wait a moment and try again.", "RATE_LIMITED");
  }
}

