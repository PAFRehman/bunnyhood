import { renderLastDancePassCard } from "@/app/TheLastDance/pass-card";
import { getLastDancePublicPass } from "@/lib/last-dance/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type RouteContext = { params: Promise<{ entryId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const pass = await getLastDancePublicPass((await context.params).entryId);
  if (!pass) {
    return new Response("Pass not found.", {
      status: 404,
      headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
    });
  }
  const response = renderLastDancePassCard(pass);
  const download = new URL(request.url).searchParams.get("download") === "1";
  response.headers.set("cache-control", "public, max-age=60, s-maxage=300, stale-while-revalidate=86400");
  response.headers.set("content-disposition", `${download ? "attachment" : "inline"}; filename="bunnyhood-last-dance-${pass.xUsername}.png"`);
  response.headers.set("x-content-type-options", "nosniff");
  return response;
}
