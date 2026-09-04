import "server-only";

import { getDb, inTransaction, type SpinDb } from "@/lib/spin/db";
import { HttpError } from "@/lib/spin/http";
import {
  parseCheckerImportDraft,
  type CheckerEligibility,
  type CheckerImportDraft,
} from "./import";
import { ensureCheckerSchema } from "./schema";

export type {
  CheckerEligibility,
  CheckerImport,
  CheckerImportDraft,
} from "./import";

type CheckerWalletRow = {
  wallet_address: string;
  eligibility_type: CheckerEligibility;
  imported_at: Date | string;
  updated_at: Date | string;
};

const MAX_IMPORT_WALLETS = 10_000;
const WRITE_BATCH_SIZE = 250;
const EVM_WALLET = /^0x[0-9a-f]{40}$/;

type CheckerImportStage =
  | "start"
  | "inspect"
  | "write"
  | "stats";

export type CheckerImportPreview =
  Omit<CheckerImportDraft, "entries"> & {
    alreadyExists: number;
    unchanged: number;
    statusChanges: number;
    newWallets: number;
  };

export function normalizeCheckerWallet(value: string) {
  return value.trim().toLowerCase();
}

export function requireCheckerWallet(value: string) {
  const wallet = normalizeCheckerWallet(value);

  if (!EVM_WALLET.test(wallet)) {
    throw new HttpError(
      400,
      "Enter a valid EVM wallet address.",
      "BAD_CHECKER_WALLET",
    );
  }

  return wallet;
}

export function parseCheckerImport(
  gtdValue: string,
  fcfsValue: string,
) {
  const draft = parseCheckerImportDraft(
    gtdValue,
    fcfsValue,
  );

  if (!draft.entries.length) {
    throw new HttpError(
      400,
      "No valid EVM wallets were found. Paste a wallet column and try again.",
      "EMPTY_CHECKER_IMPORT",
    );
  }

  if (draft.entries.length > MAX_IMPORT_WALLETS) {
    throw new HttpError(
      400,
      `Import at most ${MAX_IMPORT_WALLETS.toLocaleString("en-US")} wallets at once.`,
      "CHECKER_IMPORT_TOO_LARGE",
    );
  }

  return draft;
}

async function inspectCheckerImportWithSql(
  sql: SpinDb,
  draft: CheckerImportDraft,
) {
  const existing =
    new Map<string, CheckerEligibility>();

  for (
    let offset = 0;
    offset < draft.entries.length;
    offset += 500
  ) {
    const batch = draft.entries.slice(
      offset,
      offset + 500,
    );

    const parameters = batch.map(
      (entry) => entry.walletAddress,
    );

    const placeholders = parameters
      .map((_, index) => `$${index + 1}`)
      .join(",");

    const rows = await sql.unsafe<
      Pick<
        CheckerWalletRow,
        "wallet_address" | "eligibility_type"
      >[]
    >(
      `select wallet_address, eligibility_type
       from checker_wallets
       where wallet_address in (${placeholders})`,
      parameters,
    );

    for (const row of rows) {
      existing.set(
        row.wallet_address,
        row.eligibility_type,
      );
    }
  }

  const entriesToWrite = draft.entries.filter(
    (entry) =>
      existing.get(entry.walletAddress) !==
      entry.eligibilityType,
  );

  const alreadyExists = existing.size;

  const statusChanges = draft.entries.filter(
    (entry) => {
      const current = existing.get(
        entry.walletAddress,
      );

      return (
        current !== undefined &&
        current !== entry.eligibilityType
      );
    },
  ).length;

  const preview: CheckerImportPreview = {
    gtd: draft.gtd,
    fcfs: draft.fcfs,
    validUnique: draft.validUnique,
    fixedPrefixes: draft.fixedPrefixes,
    duplicatesRemoved: draft.duplicatesRemoved,
    ignoredRows: draft.ignoredRows,
    crossListConflicts: draft.crossListConflicts,
    alreadyExists,
    unchanged: alreadyExists - statusChanges,
    statusChanges,
    newWallets:
      draft.validUnique - alreadyExists,
  };

  return {
    preview,
    entriesToWrite,
  };
}

export async function previewCheckerWallets(
  draft: CheckerImportDraft,
) {
  await ensureCheckerSchema();

  return (
    await inspectCheckerImportWithSql(
      getDb(),
      draft,
    )
  ).preview;
}

async function checkerStatsWithSql(sql: SpinDb) {
  const rows = await sql<{
    total: number;
    gtd: number;
    fcfs: number;
  }[]>`
    select
      count(distinct wallet_address)::integer as total,
      count(*) filter (
        where eligibility_type = 'GTD'
      )::integer as gtd,
      count(*) filter (
        where eligibility_type = 'FCFS'
      )::integer as fcfs
    from checker_wallets
  `;

  return (
    rows[0] ?? {
      total: 0,
      gtd: 0,
      fcfs: 0,
    }
  );
}

export async function getCheckerStats() {
  await ensureCheckerSchema();
  return checkerStatsWithSql(getDb());
}

export async function findCheckerEligibility(
  walletValue: string,
) {
  const wallet =
    requireCheckerWallet(walletValue);

  await ensureCheckerSchema();

  const rows = await getDb()<
    Pick<
      CheckerWalletRow,
      "eligibility_type"
    >[]
  >`
    select eligibility_type
    from checker_wallets
    where wallet_address = ${wallet}
    order by
      case eligibility_type
        when 'GTD' then 0
        else 1
      end
    limit 1
  `;

  return rows[0]?.eligibility_type ?? null;
}

export async function listCheckerWallets(
  search = "",
) {
  await ensureCheckerSchema();

  const trimmed = search
    .trim()
    .slice(0, 80)
    .toLowerCase();

  const pattern = `%${trimmed}%`;

  const rows =
    await getDb()<CheckerWalletRow[]>`
      select
        wallet_address,
        eligibility_type,
        imported_at,
        updated_at
      from checker_wallets
      where
        ${trimmed} = ''
        or wallet_address like ${pattern}
      order by
        updated_at desc,
        wallet_address asc
      limit 500
    `;

  return rows.map((row) => ({
    walletAddress: row.wallet_address,
    eligibilityType: row.eligibility_type,
    importedAt: new Date(
      row.imported_at,
    ).toISOString(),
    updatedAt: new Date(
      row.updated_at,
    ).toISOString(),
  }));
}

export async function upsertCheckerWallets(
  draft: CheckerImportDraft,
) {
  await ensureCheckerSchema();

  const progress: {
    stage: CheckerImportStage;
    failedBatch: number;
  } = {
    stage: "start",
    failedBatch: 0,
  };

  try {
    return await inTransaction(async (sql) => {
      progress.stage = "inspect";

      const { preview, entriesToWrite } =
        await inspectCheckerImportWithSql(
          sql,
          draft,
        );

      for (
        let offset = 0;
        offset < entriesToWrite.length;
        offset += WRITE_BATCH_SIZE
      ) {
        progress.stage = "write";
        progress.failedBatch =
          Math.floor(
            offset / WRITE_BATCH_SIZE,
          ) + 1;

        const batch = entriesToWrite.slice(
          offset,
          offset + WRITE_BATCH_SIZE,
        );

        const parameters: string[] = [];

        const values = batch.map(
          (entry, index) => {
            parameters.push(
              entry.walletAddress,
              entry.eligibilityType,
            );

            const parameter = index * 2;

            return `($${parameter + 1}, $${parameter + 2}, now(), now())`;
          },
        );

        await sql.unsafe(
          `insert into checker_wallets (
            wallet_address,
            eligibility_type,
            imported_at,
            updated_at
          )
          values ${values.join(",")}
          on conflict (
            wallet_address,
            eligibility_type
          )
          do update set
            imported_at = now(),
            updated_at = now()`,
          parameters,
        );
      }

      progress.stage = "stats";

      return {
        preview,
        saved: entriesToWrite.length,
        stats:
          await checkerStatsWithSql(sql),
      };
    });
  } catch (error) {
    const databaseCode =
      typeof error === "object" &&
      error !== null &&
      "code" in error
        ? String(error.code).slice(0, 32)
        : "UNKNOWN";

    console.error(
      "Checker wallet bulk import failed.",
      {
        stage: progress.stage,
        batch:
          progress.failedBatch || undefined,
        databaseCode,
      },
    );

    const stageLabel =
      progress.stage === "write"
        ? "saving the wallet batch"
        : progress.stage === "inspect"
          ? "checking existing wallets"
          : progress.stage === "stats"
            ? "refreshing wallet totals"
            : "starting the database transaction";

    throw new HttpError(
      503,
      `The import failed while ${stageLabel}. No partial changes were kept. Please try again.`,
      `CHECKER_IMPORT_${progress.stage.toUpperCase()}_FAILED`,
    );
  }
}

export async function deleteCheckerWallet(
  walletValue: string,
) {
  const wallet =
    requireCheckerWallet(walletValue);

  await ensureCheckerSchema();

  const rows = await getDb()<
    Pick<
      CheckerWalletRow,
      "wallet_address"
    >[]
  >`
    delete from checker_wallets
    where wallet_address = ${wallet}
    returning wallet_address
  `;

  if (!rows.length) {
    throw new HttpError(
      404,
      "That wallet is not in the checker.",
      "CHECKER_WALLET_NOT_FOUND",
    );
  }

  return wallet;
}
