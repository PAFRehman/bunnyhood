import { randomUUID } from "node:crypto";
import {
  getAddress,
  isAddress,
  keccak256,
  stringToHex,
  type Address,
  type Hex,
} from "viem";
import type { SpinUser } from "@/lib/spin/auth";
import { getDb, inTransaction } from "@/lib/spin/db";
import { HttpError } from "@/lib/spin/http";
import { enforceRateLimit } from "@/lib/spin/rate-limit";
import { assertPublicStorageWritable } from "@/lib/spin/storage-safety";
import { broadcastRabbitClaim, readOnchainRabbitClaim, waitForRabbitClaim } from "./chain";
import { getRabbitHoleNetwork, rabbitHoleMetadataUri } from "./config";
import {
  bindRabbitHoleUser,
  getRabbitHoleClaimByUser,
  publicRabbitHoleClaim,
  type RabbitHoleClaimRow,
} from "./data";
import { ensureRabbitHoleSchema } from "./schema";

function claimKeyForXUser(xUserId: string) {
  return keccak256(stringToHex(`bunnyhood:rabbit-hole:v1:${xUserId}`));
}

async function refreshClaim(claimId: string) {
  const sql = getDb();
  const rows = await sql<RabbitHoleClaimRow[]>`
    select id, allowlist_id, user_id, x_user_id, x_username, x_name,
      x_profile_image_url, wallet_address, claim_key, status, chain_id,
      contract_address, metadata_uri, transaction_hash, token_id::text,
      mint_attempts, last_error_code, submitted_at, confirmed_at,
      created_at, updated_at
    from rabbit_hole_claims where id = ${claimId}::uuid limit 1
  `;
  if (!rows[0]) throw new HttpError(404, "Rabbit Hole claim was not found.", "CLAIM_NOT_FOUND");
  return rows[0];
}

async function confirmClaim(
  claim: RabbitHoleClaimRow,
  tokenId: bigint,
  transactionHash: Hex | null,
) {
  const sql = getDb();
  await sql`
    update rabbit_hole_claims
    set status = 'CONFIRMED',
        token_id = ${tokenId.toString()}::numeric,
        transaction_hash = coalesce(${transactionHash}::char(66), transaction_hash),
        submitted_at = coalesce(submitted_at, now()),
        confirmed_at = coalesce(confirmed_at, now()),
        last_error_code = null,
        updated_at = now()
    where id = ${claim.id}::uuid
  `;
  return refreshClaim(claim.id);
}

async function reconcileRabbitClaim(claim: RabbitHoleClaimRow) {
  if (claim.status === "CONFIRMED") return claim;
  const network = getRabbitHoleNetwork();
  if (!network.configured || !network.contractAddress) return claim;
  if (claim.chain_id !== network.chainId
    || getAddress(claim.contract_address) !== getAddress(network.contractAddress)) {
    return claim;
  }
  const onchain = await readOnchainRabbitClaim(claim.claim_key);
  if (!onchain) return claim;
  if (onchain.owner !== getAddress(claim.wallet_address)) {
    const sql = getDb();
    await sql`
      update rabbit_hole_claims
      set status = 'FAILED', last_error_code = 'ONCHAIN_OWNER_MISMATCH', updated_at = now()
      where id = ${claim.id}::uuid
    `;
    throw new HttpError(
      409,
      "This claim key is already attached to a different wallet.",
      "ONCHAIN_OWNER_MISMATCH",
    );
  }
  return confirmClaim(claim, onchain.tokenId, onchain.transactionHash ?? claim.transaction_hash);
}

async function prepareClaim(user: SpinUser, wallet: Address) {
  const network = getRabbitHoleNetwork();
  if (!network.configured || !network.contractAddress || !network.minterPrivateKey) {
    throw new HttpError(
      503,
      "Rabbit Hole onchain minting is not configured yet.",
      "RABBITHOLE_NOT_CONFIGURED",
    );
  }
  const eligibility = await bindRabbitHoleUser(user);
  if (!eligibility?.eligible) {
    throw new HttpError(403, "This X account is not eligible for a Rabbit Hole box.", "NOT_ELIGIBLE");
  }

  const claimKey = claimKeyForXUser(user.xUserId);
  const metadataUri = rabbitHoleMetadataUri(claimKey);
  return inTransaction(async (sql) => {
    await sql`select pg_advisory_xact_lock(hashtext(${`rabbit-hole-claim:${user.xUserId}`}))`;
    const allowlist = await sql<{ id: string; eligible: boolean; x_user_id: string | null }[]>`
      select id, eligible, x_user_id
      from rabbit_hole_allowlist
      where id = ${eligibility.id}::uuid
      limit 1
      for update
    `;
    if (!allowlist[0]?.eligible || allowlist[0].x_user_id !== user.xUserId) {
      throw new HttpError(403, "This X account is not eligible for a Rabbit Hole box.", "NOT_ELIGIBLE");
    }

    const existing = await sql<RabbitHoleClaimRow[]>`
      select id, allowlist_id, user_id, x_user_id, x_username, x_name,
        x_profile_image_url, wallet_address, claim_key, status, chain_id,
        contract_address, metadata_uri, transaction_hash, token_id::text,
        mint_attempts, last_error_code, submitted_at, confirmed_at,
        created_at, updated_at
      from rabbit_hole_claims
      where allowlist_id = ${eligibility.id}::uuid or user_id = ${user.id}::uuid
      limit 1
      for update
    `;
    if (existing[0]) {
      if (getAddress(existing[0].wallet_address) !== wallet) {
        throw new HttpError(
          409,
          "This claim is already locked to its first submitted wallet.",
          "CLAIM_WALLET_LOCKED",
        );
      }
      if (existing[0].status === "FAILED"
        && !existing[0].transaction_hash
        && !existing[0].token_id) {
        const refreshed = await sql<RabbitHoleClaimRow[]>`
          update rabbit_hole_claims
          set chain_id = ${network.chainId},
              contract_address = ${network.contractAddress},
              metadata_uri = ${metadataUri},
              x_username = ${user.xUsername},
              x_name = ${user.xName},
              x_profile_image_url = ${user.xProfileImageUrl},
              updated_at = now()
          where id = ${existing[0].id}::uuid
          returning id, allowlist_id, user_id, x_user_id, x_username, x_name,
            x_profile_image_url, wallet_address, claim_key, status, chain_id,
            contract_address, metadata_uri, transaction_hash, token_id::text,
            mint_attempts, last_error_code, submitted_at, confirmed_at,
            created_at, updated_at
        `;
        return refreshed[0];
      }
      return existing[0];
    }

    const walletInUse = await sql<{ id: string }[]>`
      select id from rabbit_hole_claims
      where lower(wallet_address) = ${wallet.toLowerCase()}
      limit 1
    `;
    if (walletInUse[0]) {
      throw new HttpError(409, "That wallet already has a Rabbit Hole claim.", "WALLET_ALREADY_USED");
    }

    const inserted = await sql<RabbitHoleClaimRow[]>`
      insert into rabbit_hole_claims (
        id, allowlist_id, user_id, x_user_id, x_username, x_name,
        x_profile_image_url, wallet_address, claim_key, status,
        chain_id, contract_address, metadata_uri
      ) values (
        ${randomUUID()}, ${eligibility.id}::uuid, ${user.id}::uuid,
        ${user.xUserId}, ${user.xUsername}, ${user.xName}, ${user.xProfileImageUrl},
        ${wallet}, ${claimKey}, 'PENDING', ${network.chainId},
        ${network.contractAddress}, ${metadataUri}
      )
      returning id, allowlist_id, user_id, x_user_id, x_username, x_name,
        x_profile_image_url, wallet_address, claim_key, status, chain_id,
        contract_address, metadata_uri, transaction_hash, token_id::text,
        mint_attempts, last_error_code, submitted_at, confirmed_at,
        created_at, updated_at
    `;
    return inserted[0];
  });
}

function errorCode(error: unknown) {
  if (error instanceof HttpError) return error.code;
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("insufficient funds")) return "MINTER_NEEDS_GAS";
  if (message.includes("supplycomplete")) return "SBT_SUPPLY_COMPLETE";
  if (message.includes("invalidclaim")) return "CLAIM_ALREADY_MINTED";
  return "ONCHAIN_MINT_FAILED";
}

export async function claimRabbitHoleBox(user: SpinUser, rawWallet: string) {
  if (!isAddress(rawWallet)) {
    throw new HttpError(400, "Enter a valid EVM wallet address.", "BAD_WALLET");
  }
  const wallet = getAddress(rawWallet);
  await assertPublicStorageWritable();
  await ensureRabbitHoleSchema();
  await enforceRateLimit(`rabbit-hole-claim:${user.id}`, 5, 60 * 60);

  let claim = await prepareClaim(user, wallet);
  claim = await reconcileRabbitClaim(claim);
  if (claim.status === "CONFIRMED") return publicRabbitHoleClaim(claim);

  const lastUpdated = new Date(claim.updated_at).getTime();
  const retryDelay = claim.transaction_hash ? 10 * 60_000 : 2 * 60_000;
  if ((claim.status === "PENDING" || claim.status === "SUBMITTED")
    && claim.mint_attempts > 0
    && Date.now() - lastUpdated < retryDelay) {
    return publicRabbitHoleClaim(claim);
  }
  if (claim.mint_attempts >= 10) {
    throw new HttpError(409, "This claim needs an admin review before retrying.", "CLAIM_RETRY_LIMIT");
  }

  const sql = getDb();
  await sql`
    update rabbit_hole_claims
    set status = 'PENDING', mint_attempts = mint_attempts + 1,
        last_error_code = null, updated_at = now()
    where id = ${claim.id}::uuid
  `;

  let transactionHash: Hex | null = null;
  try {
    transactionHash = await broadcastRabbitClaim({
      recipient: wallet,
      claimKey: claim.claim_key,
      tokenUri: claim.metadata_uri,
    });
    await sql`
      update rabbit_hole_claims
      set status = 'SUBMITTED', transaction_hash = ${transactionHash},
          submitted_at = coalesce(submitted_at, now()), updated_at = now()
      where id = ${claim.id}::uuid
    `;
    const receiptStatus = await waitForRabbitClaim(transactionHash);
    claim = await refreshClaim(claim.id);
    if (receiptStatus === "pending") return publicRabbitHoleClaim(claim);
    if (receiptStatus === "reverted") {
      const recovered = await reconcileRabbitClaim(claim);
      if (recovered.status === "CONFIRMED") return publicRabbitHoleClaim(recovered);
      await sql`
        update rabbit_hole_claims
        set status = 'FAILED', last_error_code = 'ONCHAIN_MINT_REVERTED', updated_at = now()
        where id = ${claim.id}::uuid
      `;
      throw new HttpError(502, "The onchain mint reverted safely.", "ONCHAIN_MINT_REVERTED");
    }
    const confirmed = await reconcileRabbitClaim(claim);
    if (confirmed.status !== "CONFIRMED") {
      throw new HttpError(502, "The mint confirmed but its token record is still indexing.", "TOKEN_INDEXING");
    }
    return publicRabbitHoleClaim(confirmed);
  } catch (error) {
    claim = await refreshClaim(claim.id);
    try {
      const recovered = await reconcileRabbitClaim(claim);
      if (recovered.status === "CONFIRMED") return publicRabbitHoleClaim(recovered);
    } catch (recoveryError) {
      if (recoveryError instanceof HttpError) throw recoveryError;
    }
    const code = errorCode(error);
    if (!transactionHash) {
      await sql`
        update rabbit_hole_claims
        set status = 'FAILED', last_error_code = ${code}, updated_at = now()
        where id = ${claim.id}::uuid
      `;
    }
    if (error instanceof HttpError) throw error;
    console.error("Rabbit Hole mint failed.", code, error);
    throw new HttpError(
      code === "MINTER_NEEDS_GAS" ? 503 : 502,
      code === "MINTER_NEEDS_GAS"
        ? "The Rabbit Hole minter needs ETH for gas."
        : "The onchain mint could not be completed yet.",
      code,
    );
  }
}

export async function reconcileRabbitHoleClaimForUser(userId: string) {
  const claim = await getRabbitHoleClaimByUser(userId);
  if (!claim || claim.status === "CONFIRMED") return claim;
  try {
    return await reconcileRabbitClaim(claim);
  } catch (error) {
    console.warn("Rabbit Hole background reconciliation failed.", error);
    return claim;
  }
}
