import "server-only";

import { once } from "node:events";
import { PassThrough, Readable } from "node:stream";
import { getDb } from "@/lib/spin/db";
import { ensureLastDanceSchema } from "./schema";

const CURSOR_ROWS = 2_000;

function csvCell(value: unknown) {
  const original = String(value ?? "");
  const safe = /^[=+\-@]/.test(original) ? `'${original}` : original;
  return `"${safe.replace(/"/g, '""')}"`;
}

function csvLine(values: unknown[]) {
  return `${values.map(csvCell).join(",")}\r\n`;
}

async function write(output: PassThrough, value: string) {
  if (!output.write(value)) await once(output, "drain");
}

async function produceLastDanceCsv(output: PassThrough) {
  await ensureLastDanceSchema();
  await write(output, "\uFEFF");
  await write(output, csvLine([
    "Position",
    "X Username",
    "X User ID",
    "Wallet Address",
    "NFT Count",
    "Transaction Count",
    "X Post URL",
    "Engagement Completed At",
    "Post Verified At",
    "Entered At",
  ]));

  const sql = getDb();
  const cursor = sql<{
    x_username: string;
    x_user_id: string;
    wallet_address: string;
    nft_count: number;
    transaction_count: number;
    post_url: string | null;
    engagement_completed_at: Date | string | null;
    post_verified_at: Date | string | null;
    entered_at: Date | string;
  }[]>`
    select entries.x_username, entries.x_user_id, entries.wallet_address,
      entries.nft_count, entries.transaction_count, entries.entered_at,
      posts.post_url, posts.verified_at as post_verified_at,
      engagements.completed_at as engagement_completed_at
    from last_dance_entries entries
    left join last_dance_posts posts on posts.user_id = entries.user_id
    left join last_dance_engagements engagements on engagements.user_id = entries.user_id
    order by entries.entered_at asc, entries.id asc
  `.cursor(CURSOR_ROWS);

  let position = 0;
  for await (const rows of cursor) {
    for (const row of rows) {
      position += 1;
      await write(output, csvLine([
        position,
        row.x_username,
        row.x_user_id,
        row.wallet_address,
        row.nft_count,
        row.transaction_count,
        row.post_url,
        row.engagement_completed_at ? new Date(row.engagement_completed_at).toISOString() : "",
        row.post_verified_at ? new Date(row.post_verified_at).toISOString() : "",
        new Date(row.entered_at).toISOString(),
      ]));
    }
  }
  output.end();
}

export function streamLastDanceEntriesCsv() {
  const output = new PassThrough();
  const body = Readable.toWeb(output) as ReadableStream<Uint8Array>;
  const completed = produceLastDanceCsv(output).catch((error) => {
    output.destroy(error instanceof Error ? error : new Error("Last Dance CSV export failed."));
    throw error;
  });
  return { body, completed };
}
