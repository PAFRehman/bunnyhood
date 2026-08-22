import { randomUUID } from "node:crypto";
import { getXConfig } from "./config";
import { inTransaction } from "./db";
import { HttpError } from "./http";
import { ensureProductionSchema } from "./schema";
import { seal } from "./security";
import {
  applyNewUserReferral,
  ensureReferralCode,
  type SpinUserRow,
} from "./users";

type XTokenReply = {
  token_type: string;
  expires_in: number;
  access_token: string;
  scope: string;
  refresh_token?: string;
};

type XMeReply = {
  data?: {
    id: string;
    name: string;
    username: string;
    created_at?: string;
    profile_image_url?: string;
  };
  errors?: Array<{ detail?: string; title?: string }>;
};

function basicAuthorization(clientId: string, clientSecret: string) {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

async function tokenRequest(body: URLSearchParams) {
  const { clientId, clientSecret } = getXConfig();
  const response = await fetch("https://api.x.com/2/oauth2/token", {
    method: "POST",
    headers: {
      authorization: basicAuthorization(clientId, clientSecret),
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({})) as Partial<XTokenReply> & { error_description?: string };
  if (!response.ok || !data.access_token || !data.expires_in) {
    throw new HttpError(502, data.error_description || "X authorization could not be completed.", "X_AUTH_FAILED");
  }
  return data as XTokenReply;
}

export async function exchangeAuthorizationCode(code: string, verifier: string) {
  const { clientId, redirectUri } = getXConfig();
  return tokenRequest(new URLSearchParams({
    code,
    grant_type: "authorization_code",
    client_id: clientId,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  }));
}

export async function fetchXMe(accessToken: string) {
  const response = await fetch(
    "https://api.x.com/2/users/me?user.fields=created_at,profile_image_url",
    { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" },
  );
  const data = await response.json().catch(() => ({})) as XMeReply;
  if (!response.ok || !data.data) {
    throw new HttpError(502, data.errors?.[0]?.detail || "X profile could not be loaded.", "X_PROFILE_FAILED");
  }
  return data.data;
}

export async function upsertXUser(
  profile: XMeReply["data"] & {},
  token: XTokenReply,
  incomingReferralCode?: string | null,
) {
  await ensureProductionSchema();
  return inTransaction(async (sql) => {
    await sql`select pg_advisory_xact_lock(hashtext(${`x-user:${profile.id}`}))`;
    const existing = await sql<{ id: string }[]>`
      select id from spin_users where x_user_id = ${profile.id} limit 1 for update
    `;
    const isNew = !existing[0];
    const encryptedAccessToken = seal({ token: token.access_token });
    const encryptedRefreshToken = token.refresh_token ? seal({ token: token.refresh_token }) : null;
    const tokenExpiresAt = new Date(Date.now() + token.expires_in * 1000).toISOString();

    const rows = isNew ? await sql<SpinUserRow[]>`
      insert into spin_users (
        id, x_user_id, x_username, x_name, x_profile_image_url,
        x_account_created_at, x_access_token_enc, x_refresh_token_enc, x_token_expires_at
      ) values (
        ${randomUUID()}, ${profile.id}, ${profile.username}, ${profile.name},
        ${profile.profile_image_url ?? null}, ${profile.created_at ?? null}::timestamptz,
        ${encryptedAccessToken}, ${encryptedRefreshToken}, ${tokenExpiresAt}::timestamptz
      )
      returning id, x_user_id, x_username, x_name, spins_earned, spins_available, spins_used, points, total_wins,
        referral_code, referral_count, referral_spins_earned
    ` : await sql<SpinUserRow[]>`
      update spin_users
      set x_username = ${profile.username},
          x_name = ${profile.name},
          x_profile_image_url = ${profile.profile_image_url ?? null},
          x_account_created_at = coalesce(x_account_created_at, ${profile.created_at ?? null}::timestamptz),
          x_access_token_enc = ${encryptedAccessToken},
          x_refresh_token_enc = coalesce(${encryptedRefreshToken}, x_refresh_token_enc),
          x_token_expires_at = ${tokenExpiresAt}::timestamptz,
          last_seen_at = now(),
          updated_at = now()
      where id = ${existing[0].id}::uuid
      returning id, x_user_id, x_username, x_name, spins_earned, spins_available, spins_used, points, total_wins,
        referral_code, referral_count, referral_spins_earned
    `;

    const user = rows[0];
    const referralCode = await ensureReferralCode(sql, user);
    user.referral_code = referralCode;
    const referralApplied = isNew
      ? await applyNewUserReferral(sql, user, incomingReferralCode)
      : false;
    return { userId: user.id, isNew, referralApplied };
  });
}
