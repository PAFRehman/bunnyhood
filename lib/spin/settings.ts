import type { SpinDb } from "./db";
import { getDb } from "./db";

export type SpinSettings = {
  allowWalletChanges: boolean;
  allowWalletSubmissions: boolean;
};

export async function getSpinSettings(sql: SpinDb = getDb()): Promise<SpinSettings> {
  const rows = await sql<{ allow_wallet_changes: boolean; allow_wallet_submissions: boolean }[]>`
    select allow_wallet_changes, allow_wallet_submissions
    from spin_settings where id = 1 limit 1
  `;
  return {
    allowWalletChanges: rows[0]?.allow_wallet_changes ?? true,
    allowWalletSubmissions: rows[0]?.allow_wallet_submissions ?? true,
  };
}

export async function setWalletChangesAllowed(
  allowWalletChanges: boolean,
  sql: SpinDb = getDb(),
): Promise<SpinSettings> {
  const rows = await sql<{ allow_wallet_changes: boolean; allow_wallet_submissions: boolean }[]>`
    insert into spin_settings (id, allow_wallet_changes, updated_at)
    values (1, ${allowWalletChanges}, now())
    on conflict (id) do update set
      allow_wallet_changes = excluded.allow_wallet_changes,
      updated_at = now()
    returning allow_wallet_changes, allow_wallet_submissions
  `;
  return {
    allowWalletChanges: rows[0].allow_wallet_changes,
    allowWalletSubmissions: rows[0].allow_wallet_submissions,
  };
}

export async function setWalletSubmissionsAllowed(
  allowWalletSubmissions: boolean,
  sql: SpinDb = getDb(),
): Promise<SpinSettings> {
  const rows = await sql<{ allow_wallet_changes: boolean; allow_wallet_submissions: boolean }[]>`
    insert into spin_settings (id, allow_wallet_submissions, updated_at)
    values (1, ${allowWalletSubmissions}, now())
    on conflict (id) do update set
      allow_wallet_submissions = excluded.allow_wallet_submissions,
      updated_at = now()
    returning allow_wallet_changes, allow_wallet_submissions
  `;
  return {
    allowWalletChanges: rows[0].allow_wallet_changes,
    allowWalletSubmissions: rows[0].allow_wallet_submissions,
  };
}
