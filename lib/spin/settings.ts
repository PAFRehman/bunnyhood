import type { SpinDb } from "./db";
import { getDb, inTransaction } from "./db";
import { HttpError } from "./http";

export type SpinSettings = {
  allowWalletChanges: boolean;
  allowWalletSubmissions: boolean;
  postTaskText: string;
  postTaskRequiresTag: boolean;
  bunnyStreakDays: number;
  bunnyDeathOnBreak: boolean;
  bunnyGtdEnabled: boolean;
  bunnyGtdRequirementMode: BunnyGtdRequirementMode;
  bunnyGtdStreakDays: number;
  bunnyGtdPointsRequired: number;
};

export type BunnyGtdRequirementMode = "days" | "points" | "both";

type SettingsRow = {
  allow_wallet_changes: boolean;
  allow_wallet_submissions: boolean;
  post_task_text: string;
  post_task_requires_tag: boolean;
  bunny_streak_days: number;
  bunny_death_on_break: boolean;
  bunny_gtd_enabled: boolean;
  bunny_gtd_requirement_mode: BunnyGtdRequirementMode;
  bunny_gtd_streak_days: number;
  bunny_gtd_points_required: number | string;
};

const DEFAULT_POST_TASK_TEXT = "I am earning my way into the Bunny Hood. Join the movement with @BunnysHood";

function publicSettings(row: SettingsRow | undefined): SpinSettings {
  return {
    allowWalletChanges: row?.allow_wallet_changes ?? true,
    allowWalletSubmissions: row?.allow_wallet_submissions ?? true,
    postTaskText: row?.post_task_text ?? DEFAULT_POST_TASK_TEXT,
    postTaskRequiresTag: row?.post_task_requires_tag ?? true,
    bunnyStreakDays: Number(row?.bunny_streak_days ?? 7),
    bunnyDeathOnBreak: row?.bunny_death_on_break ?? false,
    bunnyGtdEnabled: row?.bunny_gtd_enabled ?? false,
    bunnyGtdRequirementMode: row?.bunny_gtd_requirement_mode ?? "both",
    bunnyGtdStreakDays: Number(row?.bunny_gtd_streak_days ?? 30),
    bunnyGtdPointsRequired: Number(row?.bunny_gtd_points_required ?? 100),
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
      post_task_requires_tag, bunny_streak_days, bunny_death_on_break,
      bunny_gtd_enabled, bunny_gtd_requirement_mode, bunny_gtd_streak_days,
      bunny_gtd_points_required
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
      post_task_requires_tag, bunny_streak_days, bunny_death_on_break,
      bunny_gtd_enabled, bunny_gtd_requirement_mode, bunny_gtd_streak_days,
      bunny_gtd_points_required
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
      post_task_requires_tag, bunny_streak_days, bunny_death_on_break,
      bunny_gtd_enabled, bunny_gtd_requirement_mode, bunny_gtd_streak_days,
      bunny_gtd_points_required
  `;
  return publicSettings(rows[0]);
}

export async function setEngagementSettings(
  input: {
    postTaskText: string;
    postTaskRequiresTag: boolean;
    bunnyStreakDays: number;
    bunnyDeathOnBreak: boolean;
    bunnyGtdEnabled: boolean;
    bunnyGtdRequirementMode: string;
    bunnyGtdStreakDays: number;
    bunnyGtdPointsRequired: number;
  },
): Promise<SpinSettings> {
  const bunnyStreakDays = Number(input.bunnyStreakDays);
  if (!Number.isInteger(bunnyStreakDays) || bunnyStreakDays < 1 || bunnyStreakDays > 365) {
    throw new HttpError(400, "Evolution streak must be a whole number from 1 to 365 days.", "BAD_BUNNY_STREAK");
  }
  if (!(["days", "points", "both"] as string[]).includes(input.bunnyGtdRequirementMode)) {
    throw new HttpError(400, "Choose whether private GTD uses days, points, or both.", "BAD_BUNNY_GTD_MODE");
  }
  const bunnyGtdRequirementMode = input.bunnyGtdRequirementMode as BunnyGtdRequirementMode;
  const bunnyGtdStreakDays = Number(input.bunnyGtdStreakDays);
  if (!Number.isInteger(bunnyGtdStreakDays) || bunnyGtdStreakDays < 1 || bunnyGtdStreakDays > 365) {
    throw new HttpError(400, "Private GTD evolution must be a whole number from 1 to 365 days.", "BAD_BUNNY_GTD_STREAK");
  }
  const bunnyGtdPointsRequired = Number(input.bunnyGtdPointsRequired);
  if (!Number.isSafeInteger(bunnyGtdPointsRequired) || bunnyGtdPointsRequired < 0 || bunnyGtdPointsRequired > 1_000_000_000) {
    throw new HttpError(400, "Private GTD points must be a whole number from 0 to 1 billion.", "BAD_BUNNY_GTD_POINTS");
  }
  if (
    input.bunnyGtdEnabled
    && bunnyGtdPointsRequired < 1
    && (bunnyGtdRequirementMode === "points" || bunnyGtdRequirementMode === "both")
  ) {
    throw new HttpError(400, "Set at least 1 available point when private GTD uses points.", "BAD_BUNNY_GTD_POINTS");
  }
  const postTaskText = normalizePostText(input.postTaskText, input.postTaskRequiresTag);
  return inTransaction(async (sql) => {
    await sql`select pg_advisory_xact_lock(hashtext('bunny-hood-active-campaign'))`;
    const rows = await sql<SettingsRow[]>`
      insert into spin_settings (
        id, post_task_text, post_task_requires_tag, bunny_streak_days,
        bunny_death_on_break, bunny_gtd_enabled, bunny_gtd_requirement_mode,
        bunny_gtd_streak_days, bunny_gtd_points_required, updated_at
      ) values (
        1, ${postTaskText}, ${input.postTaskRequiresTag}, ${bunnyStreakDays},
        ${input.bunnyDeathOnBreak}, ${input.bunnyGtdEnabled}, ${bunnyGtdRequirementMode},
        ${bunnyGtdStreakDays}, ${bunnyGtdPointsRequired}, now()
      )
      on conflict (id) do update set
        post_task_text = excluded.post_task_text,
        post_task_requires_tag = excluded.post_task_requires_tag,
        bunny_streak_days = excluded.bunny_streak_days,
        bunny_death_on_break = excluded.bunny_death_on_break,
        bunny_gtd_enabled = excluded.bunny_gtd_enabled,
        bunny_gtd_requirement_mode = excluded.bunny_gtd_requirement_mode,
        bunny_gtd_streak_days = excluded.bunny_gtd_streak_days,
        bunny_gtd_points_required = excluded.bunny_gtd_points_required,
        updated_at = now()
      returning allow_wallet_changes, allow_wallet_submissions, post_task_text,
        post_task_requires_tag, bunny_streak_days, bunny_death_on_break,
        bunny_gtd_enabled, bunny_gtd_requirement_mode, bunny_gtd_streak_days,
        bunny_gtd_points_required
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
