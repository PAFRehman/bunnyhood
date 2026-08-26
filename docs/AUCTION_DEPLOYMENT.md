# Bunny Hood reserved-auction deployment

The site integrates the contract and behavior from
[`ZahidforAI/onchain_auction`](https://github.com/ZahidforAI/onchain_auction) at the private `/auction` route.

## Access model

- `/auction` uses the same eight-hour, HTTP-only admin session as `/admin/spin`.
- An unauthenticated visitor is redirected to `/admin/spin`.
- `/api/admin/auction/snapshot` independently verifies the admin cookie.
- RPC provider URLs stay server-only. Never prefix them with `NEXT_PUBLIC_`.
- Wallet transactions are signed only inside the connected browser wallet. The site never receives a private key.

## Mainnet configuration

Add these to Vercel → Project → Settings → Environment Variables → Production:

```text
AUCTION_MAINNET_ADDRESS=0x5991A2dF15A8F6A256D3Ec51E99254Cd3fb576A9
USDG_MAINNET_ADDRESS=0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168
AUCTION_MAINNET_DEPLOYMENT_BLOCK=THE_CONTRACT_CREATION_BLOCK
ROBINHOOD_MAINNET_RPC_URL=YOUR_PRIVATE_ARCHIVE_RPC_URL
```

The contract and USDG defaults come from the supplied upstream repository. Confirm both addresses independently before using real funds. The page also checks that bytecode exists at the configured auction address.

## Testnet configuration

Testnet must use a separately deployed auction and a test token. Never place the mainnet contract or mainnet token address in the testnet variables.

1. Clone the upstream contract repository.
2. Install Foundry and initialize its submodules.
3. Deploy a mock 6-decimal token on Robinhood Chain Testnet, or use an official test token explicitly supported by the project.
4. Fund the deployer with testnet ETH.
5. Deploy `BunnyHoodReservedAuction` with the test token, seller, and owner.
6. Record the contract-creation block from the testnet explorer.
7. Add these Vercel values:

```text
AUCTION_TESTNET_ADDRESS=THE_TESTNET_AUCTION_CONTRACT
USDG_TESTNET_ADDRESS=THE_TESTNET_6_DECIMAL_TOKEN
AUCTION_TESTNET_DEPLOYMENT_BLOCK=THE_CONTRACT_CREATION_BLOCK
ROBINHOOD_TESTNET_RPC_URL=YOUR_PRIVATE_TESTNET_RPC_URL
```

The upstream deployment script reads `PRIVATE_KEY`, `SELLER_ADDRESS`, `USDG_ADDRESS`, `MINIMUM_BID`, `MIN_INCREMENT_BPS`, and `START_AUCTION`. Keep `START_AUCTION=false` until every address and auction parameter has been reviewed. Private keys belong only in a local shell or secure deployment vault—never in Vercel, GitHub, browser code, or this repository.

## Bid history and live updates

- The first request loads indexed `BidPlaced` events from the network explorer.
- If the explorer is unavailable, the server reads RPC logs beginning at `AUCTION_*_DEPLOYMENT_BLOCK`.
- Subsequent requests read only the latest overlapping block window and deduplicate by transaction hash plus log index.
- The admin UI refreshes every four seconds while the tab is visible.
- Set the exact deployment block for complete, efficient RPC fallback history.

## Production release checklist

1. Run `npm test`.
2. Add all network variables to Vercel Production.
3. Redeploy after changing environment variables.
4. Sign in at `/admin/spin`, then open `/auction`.
5. Confirm the selected chain, auction address, USDG address, seller, minimum bid, and contract state.
6. Test approve, bid, outbid refund, finalization, and seller withdrawal on testnet first.
7. Only then enable real-fund mainnet use.
