# Bunny Hood Rabbit Hole deployment

`/RabbitHole` is admin-gated until its server-page guard is intentionally removed. Eligibility imports, X verification, wallet locking, claim status, transaction hashes, and token IDs are stored permanently in Neon. Migration `009_rabbit_hole_claims` applies automatically on the first Rabbit Hole request.

## Token behavior

`BunnyHoodRabbitHoleSBT` is an ERC-721 with ERC-5192 soulbound signaling and a hard supply cap of 100. Transfers, approvals, sales, and burns revert at contract level. Only the dedicated minter can mint. The owner can rotate the minter but cannot transfer a token.

## 1. Install and verify

```bash
npm ci
npm run contract:check
```

## 2. Deploy to Robinhood testnet first

Use a throwaway deployer for testnet. Keep all keys local and outside Git/GitHub.

```bash
export RABBITHOLE_NETWORK=testnet
export RABBITHOLE_RPC_URL=https://robinhood-testnet.g.alchemy.com/v2/YOUR_KEY
export RABBITHOLE_DEPLOYER_PRIVATE_KEY=0xLOCAL_DEPLOYER_KEY
export RABBITHOLE_OWNER_ADDRESS=0xOFFLINE_OWNER_ADDRESS
export RABBITHOLE_MINTER_ADDRESS=0xDEDICATED_MINTER_ADDRESS
npm run contract:deploy
```

The command prints the contract address, deployment block, and transaction URL. Verify the source on the testnet Blockscout explorer before adding Vercel settings.

## 3. Configure Vercel

```text
RABBITHOLE_NETWORK=testnet
RABBITHOLE_CONTRACT_ADDRESS=0xDEPLOYED_CONTRACT
RABBITHOLE_DEPLOYMENT_BLOCK=DEPLOYMENT_BLOCK
RABBITHOLE_RPC_URL=PRIVATE_ROBINHOOD_TESTNET_RPC
RABBITHOLE_MINTER_PRIVATE_KEY=0xDEDICATED_MINTER_KEY
```

The minter must match `minter()` on the deployed contract and needs enough testnet ETH for claims. Never prefix a Rabbit Hole secret with `NEXT_PUBLIC_`.

## 4. Load eligibility

Sign in at `/admin/spin`, open `/RabbitHole`, then paste up to 100 X usernames. Merge retains current eligibility. Replace disables omitted eligibility rows but never deletes confirmed claim records.

When an imported username already exists in `spin_users`, its X ID and profile image are linked immediately. Otherwise the first successful X OAuth verification pins that username to the immutable X user ID.

## 5. Mainnet

After testnet minting, metadata, explorer links, and non-transferability are verified, deploy a new contract with:

```text
RABBITHOLE_NETWORK=mainnet
```

Then replace the five Vercel Rabbit Hole variables with the mainnet contract, deployment block, private mainnet RPC, and a dedicated low-balance mainnet minter. Never reuse the deployer as the long-lived application minter.

## Metadata limitation

The contract stores an immutable Bunny Hood metadata URL. The personalized PNG is generated from the claimant's frozen X profile record and the Bunny Hood box asset. The current image service is hosted by `bunnyhood.xyz`; pin the final PNG/JSON to IPFS or Arweave before mainnet if fully decentralized media permanence is required.
