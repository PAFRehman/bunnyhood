import type { SpinDb } from "./db";
import { getDb, inTransaction } from "./db";
import { HttpError } from "./http";

export type SpinSettings = {
  allowWalletChanges: boolean;
  allowWalletSubmissions: boolean;
  postTaskText: string;
  postTaskRequiresTag: boolean;
  bunnyStreakDays: number;
};

type SettingsRow = {
  allow_wallet_changes: boolean;
  allow_wallet_submissions: boolean;
  post_task_text: string;
  post_task_requires_tag: boolean;
  bunny_streak_days: number;
};

const DEFAULT_POST_TASK_TEXT = "I am earning my way into the Bunny Hood. Join the movement with @BunnysHood";

function publicSettings(row: SettingsRow | undefined): SpinSettings {
  return {
    allowWalletChanges: row?.allow_wallet_changes ?? true,
    allowWalletSubmissions: row?.allow_wallet_submissions ?? true,
    postTaskText: row?.post_task_text ?? DEFAULT_POST_TASK_TEXT,
    postTaskRequiresTag: row?.post_task_requires_tag ?? true,
    bunnyStreakDays: Number(row?.bunny_streak_days ?? 7),
  };
}

function normalizePostText(rawText: string, requiresTag: boolean) {
  const fallback = requiresTag ? DEFAULT_POST_TASK_TEXT : "I am earning my way into the Bunny Hood.";
  const base = rawText.trim() || fallback;
  if (requiresTag && !/(^|\s)@BunnysHood\b/i.test(base)) {
    const suffix = " @BunnysHood";
    return `${base.slice(0, 260 - suffix.length).trimEnd()}${suffix}`;
  }
  return base.slice(0, 260);
}

export async function getSpinSettings(sql: SpinDb = getDb()): Promise<SpinSettings> {
  const rows = await sql<SettingsRow[]>`
    select allow_wallet_changes, allow_wallet_submissions, post_task_text,
      post_task_requires_tag, bunny_streak_days
    from spin_settings where id = 1 limit 1
  `;
  return publicSettings(rows[0]);
}

export async function setWalletChangesAllowed(
  allowWalletChanges: boolean,
  sql: SpinDb = getDb(),
): Promise<SpinSettings> {
  const rows = await sql<SettingsRow[]>`
    insert into spin_settings (id, allow_wallet_changes, updated_at)
    values (1, ${allowWalletChanges}, now())
    on conflict (id) do update set
      allow_wallet_changes = excluded.allow_wallet_changes,
      updated_at = now()
    returning allow_wallet_changes, allow_wallet_submissions, post_task_text,
      post_task_requires_tag, bunny_streak_days
  `;
  return publicSettings(rows[0]);
}

export async function setWalletSubmissionsAllowed(
  allowWalletSubmissions: boolean,
  sql: SpinDb = getDb(),
): Promise<SpinSettings> {
  const rows = await sql<SettingsRow[]>`
    insert into spin_settings (id, allow_wallet_submissions, updated_at)
    values (1, ${allowWalletSubmissions}, now())
    on conflict (id) do update set
      allow_wallet_submissions = excluded.allow_wallet_submissions,
      updated_at = now()
    returning allow_wallet_changes, allow_wallet_submissions, post_task_text,
      post_task_requires_tag, bunny_streak_days
  `;
  return publicSettings(rows[0]);
}

export async function setEngagementSettings(
  input: { postTaskText: string; postTaskRequiresTag: boolean; bunnyStreakDays: number },
): Promise<SpinSettings> {
  const bunnyStreakDays = Number(input.bunnyStreakDays);
  if (!Number.isInteger(bunnyStreakDays) || bunnyStreakDays < 1 || bunnyStreakDays > 365) {
    throw new HttpError(400, "Evolution streak must be a whole number from 1 to 365 days.", "BAD_BUNNY_STREAK");
  }
  const postTaskText = normalizePostText(input.postTaskText, input.postTaskRequiresTag);
  return inTransaction(async (sql) => {
    await sql`select pg_advisory_xact_lock(hashtext('bunny-hood-active-campaign'))`;
    const rows = await sql<SettingsRow[]>`
      insert into spin_settings (
        id, post_task_text, post_task_requires_tag, bunny_streak_days, updated_at
      ) values (
        1, ${postTaskText}, ${input.postTaskRequiresTag}, ${bunnyStreakDays}, now()
      )
      on conflict (id) do update set
        post_task_text = excluded.post_task_text,
        post_task_requires_tag = excluded.post_task_requires_tag,
        bunny_streak_days = excluded.bunny_streak_days,
        updated_at = now()
      returning allow_wallet_changes, allow_wallet_submissions, post_task_text,
        post_task_requires_tag, bunny_streak_days
    `;
    await sql`
      update spin_campaign_rounds rounds
      set shop_post_text = ${postTaskText}
      from spin_campaigns campaigns
      where rounds.campaign_id = campaigns.id
        and rounds.active = true and campaigns.active = true
        and campaigns.campaign_version = 2
    `;
    return publicSettings(rows[0]);
  });
}
