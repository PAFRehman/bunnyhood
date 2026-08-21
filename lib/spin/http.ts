export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code = "REQUEST_FAILED",
  ) {
    super(message);
  }
}

export function json(data: unknown, status = 200, extraHeaders?: HeadersInit) {
  const headers = new Headers(extraHeaders);
  headers.set("cache-control", "no-store, max-age=0");
  headers.set("cross-origin-resource-policy", "same-origin");
  headers.set("referrer-policy", "no-referrer");
  headers.set("x-content-type-options", "nosniff");
  return Response.json(data, { status, headers });
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const expected = new URL(request.url).origin;
  const fetchSite = request.headers.get("sec-fetch-site");
  if (!origin || origin !== expected) {
    throw new HttpError(403, "Cross-site requests are not accepted.", "BAD_ORIGIN");
  }
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    throw new HttpError(403, "Cross-site requests are not accepted.", "BAD_ORIGIN");
  }
}

export async function readJson<T>(request: Request, maxBytes = 8_192): Promise<T> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) {
    throw new HttpError(415, "Send a JSON request.", "BAD_CONTENT_TYPE");
  }
  const length = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(length) && length > maxBytes) {
    throw new HttpError(413, "Request is too large.", "TOO_LARGE");
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > maxBytes) {
    throw new HttpError(413, "Request is too large.", "TOO_LARGE");
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new HttpError(400, "Send valid JSON.", "BAD_JSON");
  }
}

export function routeError(error: unknown) {
  if (error instanceof HttpError) {
    return json({ error: error.message, code: error.code }, error.status);
  }
  console.error("Spin Wheel request failed.", error instanceof Error ? error.message : "Unknown error");
  return json({ error: "The request could not be completed.", code: "SERVER_ERROR" }, 500);
}

export function getCookie(request: Request, name: string) {
  const cookie = request.headers.get("cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

export function secureCookie(
  name: string,
  value: string,
  options: { maxAge: number; httpOnly?: boolean; sameSite?: "Lax" | "Strict" } = { maxAge: 0 },
) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    `Max-Age=${Math.max(0, Math.floor(options.maxAge))}`,
    `SameSite=${options.sameSite ?? "Lax"}`,
  ];
  if (options.httpOnly !== false) parts.push("HttpOnly");
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}

