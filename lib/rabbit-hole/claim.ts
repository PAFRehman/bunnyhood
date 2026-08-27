import "server-only";

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
import { getAppUrl } from "@/lib/spin/config";
import { inTransaction } from "@/lib/spin/db";
import { HttpError } from "@/lib/spin/http";
import { RABBIT_HOLE_SBT_ABI } from "./abi";
import { snapshotXProfileImage } from "./art";
import { getRabbitHoleChainClients, getRabbitHolePublicClient } from "./chain";
import { getRabbitHoleNetwork } from "./config";
import {
  bindAuthenticatedEligibility,
  ELIGIBILITY_COLUMNS,
  getEligibilityById,
  type EligibilityRow,
} from "./data";
import { ensureRabbitHoleSchema } from "./schema";

const STALE_PROCESSING_MS = 2 * 60_000;

export function rabbitHoleClaimKey(xUserId: string): Hex {
  return keccak256(stringToHex(`bunnyhood:rabbit-hole:${xUserId}`));
}

function metadataUrl(eligibilityId: string) {
  return `${getAppUrl()}/api/rabbit-hole/metadata/${eligibilityId}`;
}

function safeFailureMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown minting error";
  if (/insufficient funds/i.test(message)) return "The Bunny Hood mint wallet needs more gas.";
  if (/AlreadyOwnsSoulboundToken/i.test(message)) return "That wallet already owns a Rabbit Hole SBT.";
  if (/NotMinter/i.test(message)) return "The configured wallet is not authorized to mint this SBT.";
  if (/revert|execution reverted/i.test(message)) return "The SBT contract rejected this mint.";
  return "The onchain mint could not be completed. Try again or ask the admin to check the chain configuration.";
}

async function markFailed(row: EligibilityRow, errorCode: string, errorMessage: string) {
  await inTransaction(async (transaction) => {
    await transaction`
      update rabbit_hole_eligibility
      set status = 'failed', failure_reason = ${errorMessage}, updated_at = now()
      where id = ${row.id}::uuid and status <> 'claimed'
    `;
    if (row.active_attempt_id) {
      await transaction`
        update rabbit_hole_claim_attempts
        set status = 'failed', error_code = ${errorCode}, error_message = ${errorMessage},
            completed_at = now(), updated_at = now()
        where id = ${row.active_attempt_id}::uuid and status <> 'confirmed'
      `;
    }
  });
  return await getEligibilityById(row.id) ?? row;
}

async function finalizeClaim(
  row: EligibilityRow,
  tokenId: bigint,
  recipient: Address,
  transactionHash?: Hex | null,
  reconciled = false,
) {
  const network = getRabbitHoleNetwork();
  if (!network.contractAddress) throw new HttpError(503, "The Rabbit Hole SBT contract is not configured.", "SBT_NOT_CONFIGURED");
  const contractAddress = network.contractAddress;
  const wallet = recipient.toLowerCase();
  await inTransaction(async (transaction) => {
    await transaction`
      update rabbit_hole_eligibility
      set status = 'claimed',
          wallet_address = ${wallet},
          transaction_hash = coalesce(${transactionHash?.toLowerCase() ?? null}, transaction_hash),
          token_id = ${tokenId.toString()}::numeric,
          contract_address = ${contractAddress.toLowerCase()},
          chain_id = ${network.chainId},
          metadata_url = coalesce(metadata_url, ${metadataUrl(row.id)}),
          failure_reason = null,
          claimed_at = coalesce(claimed_at, now()),
          updated_at = now()
      where id = ${row.id}::uuid
    `;
    if (row.active_attempt_id) {
      await transaction`
        update rabbit_hole_claim_attempts
        set status = ${reconciled ? "reconciled" : "confirmed"},
            transaction_hash = coalesce(${transactionHash?.toLowerCase() ?? null}, transaction_hash),
            token_id = ${tokenId.toString()}::numeric,
            completed_at = now(), updated_at = now()
        where id = ${row.active_attempt_id}::uuid
      `;
    }
  });
  const updated = await getEligibilityById(row.id);
  if (!updated) throw new HttpError(500, "The confirmed SBT record could not be loaded.", "CLAIM_RECORD_MISSING");
  return updated;
}

export async function reconcileRabbitHoleClaim(row: EligibilityRow) {
  if (row.status === "claimed") return row;
  const network = getRabbitHoleNetwork();
  if (!network.contractAddress || !row.x_user_id) return row;
  const { publicClient } = getRabbitHolePublicClient();
  const claimKey = (row.claim_key || rabbitHoleClaimKey(row.x_user_id)) as Hex;

  try {
    const tokenId = await publicClient.readContract({
      address: network.contractAddress,
      abi: RABBIT_HOLE_SBT_ABI,
      functionName: "tokenOfClaim",
      args: [claimKey],
    });
    if (tokenId > 0n) {
      const recipient = await publicClient.readContract({
        address: network.contractAddress,
        abi: RABBIT_HOLE_SBT_ABI,
        functionName: "ownerOf",
        args: [tokenId],
      });
      return await finalizeClaim(
        row,
        tokenId,
        recipient,
        row.transaction_hash as Hex | null,
        true,
      ) ?? row;
    }
  } catch (error) {
    console.error("Rabbit Hole onchain reconciliation failed.", error instanceof Error ? error.message : error);
    return row;
  }

  if (row.transaction_hash) {
    try {
      const receipt = await publicClient.getTransactionReceipt({ hash: row.transaction_hash as Hex });
      if (receipt.status === "reverted") {
        return await markFailed(row, "TX_REVERTED", "The onchain mint transaction reverted.") ?? row;
      }
    } catch {
      return row;
    }
  }

  if (
    row.status === "minting"
    && row.claim_started_at
    && Date.now() - new Date(row.claim_started_at).getTime() > STALE_PROCESSING_MS
    && !row.transaction_hash
  ) {
    return await markFailed(row, "STALE_MINT", "The mint did not reach the network and can be retried.") ?? row;
  }
  return row;
}

export async function mintRabbitHoleSbt(user: SpinUser, walletInput: string) {
  await ensureRabbitHoleSchema();
  if (!isAddress(walletInput.trim())) {
    throw new HttpError(400, "Enter a valid EVM wallet address.", "BAD_WALLET");
  }
  const recipient = getAddress(walletInput.trim());
  let eligibility = await bindAuthenticatedEligibility(user);
  if (!eligibility) {
    throw new HttpError(403, "This X account is not eligible for the Rabbit Hole box.", "NOT_ELIGIBLE");
  }
  eligibility = await reconcileRabbitHoleClaim(eligibility);
  if (eligibility.status === "claimed") return eligibility;
  if (eligibility.status === "minting") return eligibility;
  if (!eligibility.x_user_id) {
    throw new HttpError(409, "Connect X again to bind this eligibility record.", "X_NOT_BOUND");
  }

  const { network, publicClient, walletClient, account } = getRabbitHoleChainClients();
  if (!network.contractAddress) {
    throw new HttpError(503, "The Rabbit Hole SBT contract has not been deployed for this network.", "SBT_NOT_CONFIGURED");
  }
  const contractAddress = network.contractAddress;
  const bytecode = await publicClient.getBytecode({ address: contractAddress });
  if (!bytecode || bytecode === "0x") {
    throw new HttpError(503, "No Rabbit Hole SBT contract was found at the configured address.", "SBT_CONTRACT_MISSING");
  }
  const configuredMinter = await publicClient.readContract({
    address: contractAddress,
    abi: RABBIT_HOLE_SBT_ABI,
    functionName: "minter",
  });
  if (configuredMinter.toLowerCase() !== account.address.toLowerCase()) {
    throw new HttpError(503, "The Rabbit Hole minter wallet is not authorized by the SBT contract.", "BAD_SBT_MINTER");
  }

  const claimKey = rabbitHoleClaimKey(eligibility.x_user_id);
  const existingClaimToken = await publicClient.readContract({
    address: contractAddress,
    abi: RABBIT_HOLE_SBT_ABI,
    functionName: "tokenOfClaim",
    args: [claimKey],
  });
  if (existingClaimToken > 0n) {
    const existingOwner = await publicClient.readContract({
      address: contractAddress,
      abi: RABBIT_HOLE_SBT_ABI,
      functionName: "ownerOf",
      args: [existingClaimToken],
    });
    return await finalizeClaim(eligibility, existingClaimToken, existingOwner, null, true);
  }
  const recipientToken = await publicClient.readContract({
    address: contractAddress,
    abi: RABBIT_HOLE_SBT_ABI,
    functionName: "tokenOfOwner",
    args: [recipient],
  });
  if (recipientToken > 0n) {
    throw new HttpError(409, "That wallet already owns a Rabbit Hole SBT.", "WALLET_ALREADY_HAS_SBT");
  }

  const profile = await snapshotXProfileImage(user.xProfileImageUrl);
  const attemptId = randomUUID();
  const uri = metadataUrl(eligibility.id);
  const eligibilityId = eligibility.id;

  try {
    const started = await inTransaction(async (transaction) => {
      await transaction`select pg_advisory_xact_lock(hashtext(${`rabbit-hole-claim:${eligibilityId}`}))`;
      const rows = await transaction.unsafe<EligibilityRow[]>(
        `select ${ELIGIBILITY_COLUMNS}
         from rabbit_hole_eligibility where id = $1::uuid limit 1 for update`,
        [eligibilityId],
      );
      const current = rows[0];
      if (!current) throw new HttpError(404, "Eligibility record not found.", "ELIGIBILITY_NOT_FOUND");
      if (current.status === "claimed" || current.status === "minting") return current;

      await transaction`
        insert into rabbit_hole_claim_attempts (id, eligibility_id, wallet_address)
        values (${attemptId}, ${current.id}::uuid, ${recipient.toLowerCase()})
      `;
      const updated = await transaction.unsafe<EligibilityRow[]>(
        `update rabbit_hole_eligibility
         set status = 'minting', wallet_address = $1, active_attempt_id = $2::uuid,
             claim_key = $3, contract_address = $4, chain_id = $5,
             metadata_url = $6, pfp_content_type = $7, pfp_base64 = $8,
             failure_reason = null, claim_started_at = now(), updated_at = now()
         where id = $9::uuid
         returning ${ELIGIBILITY_COLUMNS}`,
        [
          recipient.toLowerCase(),
          attemptId,
          claimKey.toLowerCase(),
          contractAddress.toLowerCase(),
          network.chainId,
          uri,
          profile.contentType,
          profile.base64,
          current.id,
        ],
      );
      return updated[0];
    });
    if (!started) throw new HttpError(500, "The claim could not be started.", "CLAIM_START_FAILED");
    eligibility = started;
    if (eligibility.status === "claimed" || eligibility.active_attempt_id !== attemptId) return eligibility;
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "23505") {
      throw new HttpError(409, "That wallet is already being used for another Rabbit Hole claim.", "WALLET_ALREADY_USED");
    }
    throw error;
  }

  let transactionHash: Hex | null = null;
  try {
    const simulation = await publicClient.simulateContract({
      account,
      address: contractAddress,
      abi: RABBIT_HOLE_SBT_ABI,
      functionName: "mint",
      args: [recipient, uri, claimKey],
    });
    const submittedHash = await walletClient.writeContract(simulation.request);
    transactionHash = submittedHash;
    await inTransaction(async (transaction) => {
      await transaction`
        update rabbit_hole_eligibility
        set transaction_hash = ${submittedHash.toLowerCase()}, updated_at = now()
        where id = ${eligibility.id}::uuid and active_attempt_id = ${attemptId}::uuid
      `;
      await transaction`
        update rabbit_hole_claim_attempts
        set status = 'submitted', transaction_hash = ${submittedHash.toLowerCase()},
            submitted_at = now(), updated_at = now()
        where id = ${attemptId}::uuid
      `;
    });

    const receipt = await publicClient.waitForTransactionReceipt({
      hash: submittedHash,
      confirmations: 1,
      timeout: 45_000,
    });
    if (receipt.status !== "success") {
      await markFailed(eligibility, "TX_REVERTED", "The onchain mint transaction reverted.");
      throw new HttpError(502, "The onchain mint transaction reverted.", "TX_REVERTED");
    }
    const tokenId = await publicClient.readContract({
      address: contractAddress,
      abi: RABBIT_HOLE_SBT_ABI,
      functionName: "tokenOfClaim",
      args: [claimKey],
    });
    if (tokenId === 0n) {
      throw new Error("Mint succeeded but tokenOfClaim returned zero.");
    }
    return await finalizeClaim(eligibility, tokenId, recipient, submittedHash);
  } catch (error) {
    if (transactionHash && /timed?\s*out|timeout/i.test(error instanceof Error ? error.message : "")) {
      return await getEligibilityById(eligibility.id);
    }
    const reconciled = await reconcileRabbitHoleClaim(await getEligibilityById(eligibility.id) ?? eligibility);
    if (reconciled.status === "claimed" || reconciled.status === "minting" && transactionHash) return reconciled;
    const failure = safeFailureMessage(error);
    await markFailed(reconciled, "MINT_FAILED", failure);
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, failure, "MINT_FAILED");
  }
}
