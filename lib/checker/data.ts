import "server-only";

import { getDb, inTransaction, type SpinDb } from "@/lib/spin/db";
import { HttpError } from "@/lib/spin/http";
import { ensureCheckerSchema } from "./schema";

export type CheckerEligibility = "GTD" | "FCFS";

type CheckerWalletRow = {
  wallet_address: string;
  eligibility_type: CheckerEligibility;
  imported_at: Date | string;
  updated_at: Date | string;
};

export type CheckerImport = {
  walletAddress: string;
  eligibilityType: CheckerEligibility;
};

const MAX_IMPORT_WALLETS = 10_000;
const EVM_WALLET = /^0x[0-9a-f]{40}$/;

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

function parseWalletList(
  value: string,
  eligibilityType: CheckerEligibility,
) {
  const withoutComments = value
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");

  const wallets = new Set<string>();

  for (const rawValue of withoutComments.split(/[\s,;]+/)) {
    const token = rawValue.trim().replace(/^['"]|['"]$/g, "");

    if (
      !token ||
      /^(?:wallet|wallet_address|address)$/i.test(token)
    ) {
      continue;
    }

    const wallet = normalizeCheckerWallet(token);

    if (!EVM_WALLET.test(wallet)) {
      throw new HttpError(
        400,
        `${token.slice(0, 22)}${token.length > 22 ? "…" : ""} is not a valid EVM wallet.`,
        "BAD_CHECKER_IMPORT",
      );
    }

    wallets.add(wallet);
  }

  return [...wallets].map((walletAddress) => ({
    walletAddress,
    eligibilityType,
  }));
}

export function parseCheckerImport(
  gtdValue: string,
  fcfsValue: string,
) {
  const gtd = parseWalletList(gtdValue, "GTD");
  const fcfs = parseWalletList(fcfsValue, "FCFS");

  // The same wallet is allowed in both lists.
  const entries = [...gtd, ...fcfs];

  if (!entries.length) {
    throw new HttpError(
      400,
      "Paste at least one GTD or FCFS wallet.",
      "EMPTY_CHECKER_IMPORT",
    );
  }

  if (entries.length > MAX_IMPORT_WALLETS) {
    throw new HttpError(
      400,
      `Import at most ${MAX_IMPORT_WALLETS.toLocaleString("en-US")} wallets at once.`,
      "CHECKER_IMPORT_TOO_LARGE",
    );
  }

  return entries;
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

  return rows[0] ?? {
    total: 0,
    gtd: 0,
    fcfs: 0,
  };
}

export async function getCheckerStats() {
  await ensureCheckerSchema();
  return checkerStatsWithSql(getDb());
}

export async function findCheckerEligibility(
  walletValue: string,
) {
  const wallet = requireCheckerWallet(walletValue);

  await ensureCheckerSchema();

  const rows = await getDb()<
    Pick<CheckerWalletRow, "eligibility_type">[]
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

  const rows = await getDb()<CheckerWalletRow[]>`
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
    importedAt: new Date(row.imported_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  }));
}

export async function upsertCheckerWallets(
  entries: CheckerImport[],
) {
  await ensureCheckerSchema();

  return inTransaction(async (sql) => {
    await sql`
      select pg_advisory_xact_lock(
        hashtext('bunny-hood-checker-import')
      )
    `;

    for (
      let offset = 0;
      offset < entries.length;
      offset += 500
    ) {
      const batch = entries.slice(
        offset,
        offset + 500,
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

    return checkerStatsWithSql(sql);
  });
}

export async function deleteCheckerWallet(
  walletValue: string,
) {
  const wallet = requireCheckerWallet(walletValue);

  await ensureCheckerSchema();

  const rows = await getDb()<
    Pick<CheckerWalletRow, "wallet_address">[]
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
