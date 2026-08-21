import { createHash } from "node:crypto";
import type { SpinDb } from "./db";
import { getDb, inTransaction } from "./db";
import { getSheetConfig } from "./config";

const SHEET_DESTINATION_STATE_KEY = "__bunny_hood_sheet_destination__";
const MAX_SHEET_BATCH_SIZE = 20;
const SINGLE_DELIVERY_TIMEOUT_MS = 12_000;
const BATCH_DELIVERY_TIMEOUT_MS = 22_000;

type OutboxRow = {
  id: number;
  revision: number;
  event_type: string;
  payload: Record<string, unknown>;
};

type SheetDeliveryResult = {
  delivered: number;
  errors: string[];
};

type SheetDeliveryOutcome = {
  id: number;
  revision: number;
  ok: boolean;
  error: string | null;
};

function safeWebhookError(value: unknown) {
  const code = String(value ?? "").trim().toUpperCase();
  return /^[A-Z0-9_]{3,64}$/.test(code) ? code : "WEBHOOK_REJECTED";
}

async function ensureSheetDestination(endpoint: string, token: string) {
  const fingerprint = createHash("sha256")
    .update(endpoint)
    .update("\0")
    .update(token)
    .digest("hex");

  return inTransaction(async (sql) => {
    await sql`select pg_advisory_xact_lock(hashtext('bunny-hood-sheet-destination'))`;
    const current = await sql<{ fingerprint: string | null }[]>`
      select payload->>'fingerprint' as fingerprint
      from spin_sheet_outbox
      where dedupe_key = ${SHEET_DESTINATION_STATE_KEY}
      limit 1
      for update
    `;
    if (current[0]?.fingerprint === fingerprint) return false;

    await sql`
      update spin_sheet_outbox
      set delivered_at = null,
          next_attempt_at = now(),
          locked_until = null,
          last_error = null,
          updated_at = now()
      where dedupe_key <> ${SHEET_DESTINATION_STATE_KEY}
    `;
    await sql`
      insert into spin_sheet_outbox (
        event_type, dedupe_key, payload, delivered_at, next_attempt_at
      ) values (
        'spin_user', ${SHEET_DESTINATION_STATE_KEY},
        ${JSON.stringify({ fingerprint })}::jsonb, now(), now()
      )
      on conflict (dedupe_key) do update set
        payload = excluded.payload,
        revision = spin_sheet_outbox.revision + 1,
        attempts = 0,
        next_attempt_at = now(),
        locked_until = null,
        delivered_at = now(),
        last_error = null,
        updated_at = now()
    `;
    return true;
  });
}

export async function queueSheetSync(
  sql: SpinDb,
  eventType: "spin_user" | "spin_win" | "spin_referral",
  dedupeKey: string,
  payload: Record<string, unknown>,
) {
  await sql`
    insert into spin_sheet_outbox (event_type, dedupe_key, payload)
    values (${eventType}, ${dedupeKey}, ${JSON.stringify(payload)}::jsonb)
    on conflict (dedupe_key) do update set
      payload = excluded.payload,
      revision = spin_sheet_outbox.revision + 1,
      attempts = 0,
      delivered_at = null,
      next_attempt_at = now(),
      locked_until = null,
      last_error = null,
      updated_at = now()
  `;
}

type BackfillCount = { total: number; queued: number };

export async function queueFullSheetBackfill() {
  return inTransaction(async (sql) => {
    const users = await sql<BackfillCount[]>`
      with source_rows as (
        select
          'user:' || users.id::text as dedupe_key,
          jsonb_build_object(
            'userId', users.id,
            'xUserId', users.x_user_id,
            'xUsername', users.x_username,
            'xName', users.x_name,
            'spinsAvailable', users.spins_available,
            'spinsUsed', users.spins_used,
            'points', users.points,
            'totalWins', users.total_wins,
            'referralCode', coalesce(users.referral_code, ''),
            'referralCount', users.referral_count,
            'referralSpinsEarned', users.referral_spins_earned,
            'updatedAt', users.updated_at
          ) as payload
        from spin_users users
      ), queued_rows as (
        insert into spin_sheet_outbox (event_type, dedupe_key, payload)
        select 'spin_user', source_rows.dedupe_key, source_rows.payload
        from source_rows
        on conflict (dedupe_key) do update set
          event_type = excluded.event_type,
          payload = excluded.payload,
          revision = spin_sheet_outbox.revision + 1,
          attempts = 0,
          delivered_at = null,
          next_attempt_at = now(),
          locked_until = null,
          last_error = null,
          updated_at = now()
        where spin_sheet_outbox.payload is distinct from excluded.payload
          or spin_sheet_outbox.event_type is distinct from excluded.event_type
          or spin_sheet_outbox.last_error like 'INVALID_SPIN_%'
        returning id
      )
      select
        (select count(*)::int from source_rows) as total,
        (select count(*)::int from queued_rows) as queued
    `;

    const referrals = await sql<BackfillCount[]>`
      with source_rows as (
        select
          'referral:' || referrals.id::text as dedupe_key,
          jsonb_build_object(
            'referralId', referrals.id,
            'referrerUserId', referrals.referrer_user_id,
            'referrerXUserId', referrers.x_user_id,
            'referrerUsername', referrers.x_username,
            'referredUserId', referrals.referred_user_id,
            'referredXUserId', referred.x_user_id,
            'referredUsername', referred.x_username,
            'referralCode', referrals.referral_code,
            'awardedSpins', referrals.awarded_spins,
            'createdAt', referrals.created_at
          ) as payload
        from spin_referrals referrals
        join spin_users referrers on referrers.id = referrals.referrer_user_id
        join spin_users referred on referred.id = referrals.referred_user_id
      ), queued_rows as (
        insert into spin_sheet_outbox (event_type, dedupe_key, payload)
        select 'spin_referral', source_rows.dedupe_key, source_rows.payload
        from source_rows
        on conflict (dedupe_key) do update set
          event_type = excluded.event_type,
          payload = excluded.payload,
          revision = spin_sheet_outbox.revision + 1,
          attempts = 0,
          delivered_at = null,
          next_attempt_at = now(),
          locked_until = null,
          last_error = null,
          updated_at = now()
        where spin_sheet_outbox.payload is distinct from excluded.payload
          or spin_sheet_outbox.event_type is distinct from excluded.event_type
          or spin_sheet_outbox.last_error like 'INVALID_SPIN_%'
        returning id
      )
      select
        (select count(*)::int from source_rows) as total,
        (select count(*)::int from queued_rows) as queued
    `;

    const wins = await sql<BackfillCount[]>`
      with source_rows as (
        select
          'win:' || wins.id::text as dedupe_key,
          jsonb_build_object(
            'winId', wins.id,
            'userId', wins.user_id,
            'xUserId', users.x_user_id,
            'xUsername', users.x_username,
            'xName', users.x_name,
            'prizeType', wins.prize_type,
            'wonAt', wins.won_at,
            'wallet', coalesce(wins.wallet_address, ''),
            'walletSubmittedAt', coalesce(wins.wallet_submitted_at::text, ''),
            'walletChangeAllowed', coalesce(settings.allow_wallet_changes, true)
          ) as payload
        from spin_wins wins
        join spin_users users on users.id = wins.user_id
        left join spin_settings settings on settings.id = 1
      ), queued_rows as (
        insert into spin_sheet_outbox (event_type, dedupe_key, payload)
        select 'spin_win', source_rows.dedupe_key, source_rows.payload
        from source_rows
        on conflict (dedupe_key) do update set
          event_type = excluded.event_type,
          payload = excluded.payload,
          revision = spin_sheet_outbox.revision + 1,
          attempts = 0,
          delivered_at = null,
          next_attempt_at = now(),
          locked_until = null,
          last_error = null,
          updated_at = now()
        where spin_sheet_outbox.payload is distinct from excluded.payload
          or spin_sheet_outbox.event_type is distinct from excluded.event_type
          or spin_sheet_outbox.last_error like 'INVALID_SPIN_%'
        returning id
      )
      select
        (select count(*)::int from source_rows) as total,
        (select count(*)::int from queued_rows) as queued
    `;

    const discarded = await sql<{ id: number }[]>`
      delete from spin_sheet_outbox outbox
      where outbox.dedupe_key <> ${SHEET_DESTINATION_STATE_KEY}
        and (
          (
            outbox.event_type = 'spin_user'
            and not exists (
              select 1 from spin_users users
              where outbox.dedupe_key = 'user:' || users.id::text
            )
          )
          or (
            outbox.event_type = 'spin_referral'
            and not exists (
              select 1 from spin_referrals referrals
              where outbox.dedupe_key = 'referral:' || referrals.id::text
            )
          )
          or (
            outbox.event_type = 'spin_win'
            and not exists (
              select 1 from spin_wins wins
              where outbox.dedupe_key = 'win:' || wins.id::text
            )
          )
        )
      returning id
    `;

    await sql`
      update spin_sheet_outbox
      set next_attempt_at = now(), locked_until = null, updated_at = now()
      where delivered_at is null and dedupe_key <> ${SHEET_DESTINATION_STATE_KEY}
    `;

    const userCount = users[0] ?? { total: 0, queued: 0 };
    const referralCount = referrals[0] ?? { total: 0, queued: 0 };
    const winCount = wins[0] ?? { total: 0, queued: 0 };
    return {
      users: { total: Number(userCount.total), queued: Number(userCount.queued) },
      referrals: { total: Number(referralCount.total), queued: Number(referralCount.queued) },
      wins: { total: Number(winCount.total), queued: Number(winCount.queued) },
      totalRecords: Number(userCount.total) + Number(referralCount.total) + Number(winCount.total),
      repairedRows: Number(userCount.queued) + Number(referralCount.queued) + Number(winCount.queued),
      discardedLegacyRows: discarded.length,
    };
  });
}

async function claimOutboxRows(limit: number) {
  return inTransaction(async (sql) => {
    const rows = await sql<OutboxRow[]>`
      select id, revision, event_type, payload
      from spin_sheet_outbox
      where delivered_at is null
        and dedupe_key <> ${SHEET_DESTINATION_STATE_KEY}
        and next_attempt_at <= now()
        and (locked_until is null or locked_until < now())
      order by id
      limit ${limit}
      for update skip locked
    `;
    if (rows.length) {
      await sql`
        update spin_sheet_outbox
        set locked_until = now() + interval '2 minutes', updated_at = now()
        where id in ${sql(rows.map((row) => row.id))}
      `;
    }
    return rows;
  });
}

async function claimOutboxRowByKey(dedupeKey: string) {
  return inTransaction(async (sql) => {
    const rows = await sql<OutboxRow[]>`
      select id, revision, event_type, payload
      from spin_sheet_outbox
      where dedupe_key = ${dedupeKey}
        and delivered_at is null
        and (locked_until is null or locked_until < now())
      limit 1
      for update skip locked
    `;
    if (rows[0]) {
      await sql`
        update spin_sheet_outbox
        set next_attempt_at = now(),
            locked_until = now() + interval '2 minutes',
            updated_at = now()
        where id = ${rows[0].id}
      `;
    }
    return rows[0] ?? null;
  });
}

async function recordDeliveryOutcomes(outcomes: SheetDeliveryOutcome[]) {
  if (!outcomes.length) return 0;

  return inTransaction(async (sql) => {
    let delivered = 0;

    for (const outcome of outcomes) {
      if (outcome.ok) {
        const updated = await sql<{ id: string }[]>`
          update spin_sheet_outbox
          set delivered_at = now(),
              attempts = 0,
              next_attempt_at = now(),
              locked_until = null,
              last_error = null,
              updated_at = now()
          where id = ${outcome.id}::bigint
            and revision = ${outcome.revision}
          returning id::text as id
        `;

        delivered += updated.length;
      } else {
        await sql`
          update spin_sheet_outbox
          set delivered_at = null,
              attempts = attempts + 1,
              next_attempt_at = now() + interval '30 seconds',
              locked_until = null,
              last_error = ${outcome.error ?? "DELIVERY_FAILED"},
              updated_at = now()
          where id = ${outcome.id}::bigint
            and revision = ${outcome.revision}
        `;
      }
    }

    return delivered;
  });
}

function transientSheetError(code: string) {
  return code === "TIMEOUT"
    || code === "NETWORK_ERROR"
    || code === "DELIVERY_FAILED"
    || code === "BUSY_RETRY"
    || code.startsWith("HTTP_5");
}

async function deliverSingleRow(
  row: OutboxRow,
  endpoint: string,
  token: string,
): Promise<SheetDeliveryResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SINGLE_DELIVERY_TIMEOUT_MS);
  let failureCode = "DELIVERY_FAILED";
  let outcome: SheetDeliveryOutcome;
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...row.payload,
        source: "bunny-hood-spin-v1",
        eventType: row.event_type,
        webhookToken: token,
        deliveryKey: `${row.id}:${row.revision}`,
      }),
      redirect: "follow",
      cache: "no-store",
      signal: controller.signal,
    });
    const rawResponse = await response.text();
    let result: { ok?: boolean; code?: string } = {};
    try {
      result = JSON.parse(rawResponse) as typeof result;
    } catch {
      failureCode = response.ok ? "NON_JSON_RESPONSE" : `HTTP_${response.status}`;
      throw new Error("Sheet webhook returned an invalid response.");
    }
    if (!response.ok) {
      failureCode = `HTTP_${response.status}`;
      throw new Error("Sheet webhook request failed.");
    }
    if (!result.ok) {
      failureCode = safeWebhookError(result.code);
      throw new Error("Sheet webhook rejected the update.");
    }
    outcome = { id: row.id, revision: row.revision, ok: true, error: null };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") failureCode = "TIMEOUT";
    else if (failureCode === "DELIVERY_FAILED") failureCode = "NETWORK_ERROR";
    outcome = { id: row.id, revision: row.revision, ok: false, error: failureCode };
  } finally {
    clearTimeout(timeout);
  }
  const acknowledged = await recordDeliveryOutcomes([outcome]);
  if (outcome.ok && acknowledged !== 1) {
    return { delivered: 0, errors: ["ACK_NOT_SAVED"] };
  }
  return outcome.ok
    ? { delivered: 1, errors: [] }
    : { delivered: 0, errors: [outcome.error ?? "DELIVERY_FAILED"] };
}

async function deliverRows(rows: OutboxRow[], endpoint: string, token: string): Promise<SheetDeliveryResult> {
  if (!rows.length) return { delivered: 0, errors: [] };
  if (rows.length === 1) return deliverSingleRow(rows[0], endpoint, token);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BATCH_DELIVERY_TIMEOUT_MS);
  let failureCode = "DELIVERY_FAILED";
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source: "bunny-hood-spin-v1",
        eventType: "batch",
        webhookToken: token,
        events: rows.map((row) => ({
          deliveryKey: `${row.id}:${row.revision}`,
          eventType: row.event_type,
          payload: row.payload,
        })),
      }),
      redirect: "follow",
      cache: "no-store",
      signal: controller.signal,
    });
    const rawResponse = await response.text();
    let result: {
      ok?: boolean;
      code?: string;
      results?: Array<{ deliveryKey?: string; ok?: boolean; code?: string }>;
    } = {};
    try {
      result = JSON.parse(rawResponse) as typeof result;
    } catch {
      failureCode = response.ok ? "NON_JSON_RESPONSE" : `HTTP_${response.status}`;
      throw new Error("Sheet webhook returned an invalid response.");
    }
    if (!response.ok) {
      failureCode = `HTTP_${response.status}`;
      throw new Error("Sheet webhook request failed.");
    }
    if (!result.ok) {
      failureCode = safeWebhookError(result.code);
      throw new Error("Sheet webhook rejected the batch.");
    }
    const resultByKey = new Map((result.results ?? []).map((item) => [String(item.deliveryKey ?? ""), item]));
    const outcomes = rows.map<SheetDeliveryOutcome>((row) => {
      const item = resultByKey.get(`${row.id}:${row.revision}`);
      if (item?.ok) return { id: row.id, revision: row.revision, ok: true, error: null };
      return {
        id: row.id,
        revision: row.revision,
        ok: false,
        error: item ? safeWebhookError(item.code) : "BATCH_RESULT_MISSING",
      };
    });
    const acknowledged = await recordDeliveryOutcomes(outcomes);
    const successful = outcomes.filter((outcome) => outcome.ok).length;
    const deliveryErrors = outcomes.flatMap((outcome) => outcome.error ? [outcome.error] : []);
    if (acknowledged !== successful) deliveryErrors.push("ACK_NOT_SAVED");
    return {
      delivered: acknowledged,
      errors: [...new Set(deliveryErrors)],
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") failureCode = "TIMEOUT";
    else if (failureCode === "DELIVERY_FAILED") failureCode = "NETWORK_ERROR";
    await recordDeliveryOutcomes(rows.map((row) => ({
      id: row.id,
      revision: row.revision,
      ok: false,
      error: failureCode,
    })));
    return { delivered: 0, errors: [failureCode] };
  } finally {
    clearTimeout(timeout);
  }
}

export async function flushSheetOutbox(limit = 12) {
  const config = getSheetConfig();
  if (!config) {
    return { configured: false, attempted: 0, delivered: 0, errors: ["NOT_CONFIGURED"], destinationReset: false };
  }
  const destinationReset = await ensureSheetDestination(config.url, config.token);
  const rows = await claimOutboxRows(Math.min(MAX_SHEET_BATCH_SIZE, Math.max(1, limit)));
  const result = await deliverRows(rows, config.url, config.token);
  return { configured: true, attempted: rows.length, delivered: result.delivered, errors: result.errors, destinationReset };
}

export async function flushSheetOutboxForKey(dedupeKey: string) {
  const config = getSheetConfig();
  if (!config) {
    return { configured: false, attempted: 0, delivered: 0, errors: ["NOT_CONFIGURED"], destinationReset: false };
  }
  const destinationReset = await ensureSheetDestination(config.url, config.token);
  let attempted = 0;
  let errors: string[] = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const row = await claimOutboxRowByKey(dedupeKey);
    if (!row) break;
    attempted += 1;
    const result = await deliverSingleRow(row, config.url, config.token);
    if (result.delivered === 1) {
      return {
        configured: true,
        attempted,
        delivered: 1,
        errors: [],
        destinationReset,
      };
    }
    errors = [...new Set([...errors, ...result.errors])];
    if (!result.errors.some(transientSheetError)) break;
  }
  return {
    configured: true,
    attempted,
    delivered: 0,
    errors,
    destinationReset,
  };
}

export async function getPendingSheetSyncCount() {
  const sql = getDb();
  const rows = await sql<{ pending: number }[]>`
    select count(*)::int as pending
    from spin_sheet_outbox
    where delivered_at is null
      and dedupe_key <> ${SHEET_DESTINATION_STATE_KEY}
  `;
  return Number(rows[0]?.pending ?? 0);
}
