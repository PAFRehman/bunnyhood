import { createHash, timingSafeEqual } from "node:crypto";
import {
  getCheckerStats,
  parseCheckerImport,
  upsertCheckerWallets,
} from "@/lib/checker/data";
import { getDb } from "@/lib/spin/db";
import { HttpError, json, readJson, routeError } from "@/lib/spin/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EXPECTED_TOKEN_HASH = "3274715d0ac5868e1e1be79886fc27692381f81fb7af3ff0000ff21f2af37f0b";
const EXPECTED_WALLET_SET_HASH = "ec2e95c4710df175148e505e2f6f8fddf05bec02f65092d610dba9091d97a757";
const EXPECTED_WALLET_COUNT = 2_315;
const IMPORT_MARKER = "019_checker_gtd_seed_2026_09_04";

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function hasValidToken(request: Request) {
  const supplied = sha256(request.headers.get("x-bunnyhood-import-token") ?? "");
  return timingSafeEqual(
    Buffer.from(supplied, "hex"),
    Buffer.from(EXPECTED_TOKEN_HASH, "hex"),
  );
}

export async function POST(request: Request) {
  try {
    if (!hasValidToken(request)) {
      throw new HttpError(404, "Not found.", "NOT_FOUND");
    }

    const body = await readJson<{ gtdWallets?: string }>(
      request,
      2 * 1024 * 1024,
    );
    const draft = parseCheckerImport(body.gtdWallets ?? "", "");

    const canonicalWallets = draft.entries
      .map((entry) => entry.walletAddress)
      .sort()
      .join("\n");

    if (
      draft.validUnique !== EXPECTED_WALLET_COUNT
      || draft.gtd !== EXPECTED_WALLET_COUNT
      || sha256(canonicalWallets) !== EXPECTED_WALLET_SET_HASH
    ) {
      throw new HttpError(
        400,
        "The supplied GTD wallet set does not match the approved import.",
        "CHECKER_SEED_MISMATCH",
      );
    }

    const applied = await getDb()<{ applied: boolean }[]>`
      select exists(
        select 1
        from spin_schema_migrations
        where migration_id = ${IMPORT_MARKER}
      ) as applied
    `;

    if (applied[0]?.applied) {
      return json({
        ok: true,
        alreadyApplied: true,
        stats: await getCheckerStats(),
      });
    }

    const result = await upsertCheckerWallets(draft);
    await getDb()`
      insert into spin_schema_migrations (migration_id)
      values (${IMPORT_MARKER})
      on conflict (migration_id) do nothing
    `;

    return json({
      ok: true,
      alreadyApplied: false,
      supplied: EXPECTED_WALLET_COUNT,
      saved: result.saved,
      preview: result.preview,
      stats: result.stats,
    });
  } catch (error) {
    return routeError(error);
  }
}
