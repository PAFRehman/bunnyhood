# Rabbit Hole SBT deployment

`/RabbitHole` replaces the retired auction system. It is admin-only while
`RABBIT_HOLE_PUBLIC=false`. The metadata and SVG artwork endpoints remain public
so wallets and explorers can display minted tokens.

## Contract guarantees

- `BunnyHoodRabbitHoleSBT` is an ERC-721-compatible EIP-5192 soulbound token.
- Every approval and transfer method always reverts with `Soulbound()`.
- There is no burn method and no owner recovery transfer.
- One X claim key can mint once, and one wallet can hold one Rabbit Hole SBT.
- Only the configured minter can mint; the owner can rotate that minter.

## Compile and review

```bash
npm ci
npm run contract:check
```

Review `contracts/BunnyHoodRabbitHoleSBT.sol` and the generated artifact before
deploying. Use testnet first.

## Deploy to Robinhood Chain Testnet

Set these only in a secure local shell or deployment vault:

```text
RABBIT_HOLE_NETWORK=testnet
RABBIT_HOLE_MINTER_PRIVATE_KEY=0x...
RABBIT_HOLE_OWNER_ADDRESS=0x...
ROBINHOOD_TESTNET_RPC_URL=https://...
```

Then run:

```bash
npm run contract:compile
npm run contract:deploy
```

Copy the printed contract address into Vercel as
`RABBIT_HOLE_TESTNET_CONTRACT_ADDRESS`. Keep `RABBIT_HOLE_PUBLIC=false` during
the admin test. Use a dedicated funded minter wallet; never use a personal main
wallet or expose the key with `NEXT_PUBLIC_`.

## Eligibility list

Open `/RabbitHole` through the existing admin login. The private eligibility
manager accepts up to 100 lines:

```text
username
another_user,123456789012345678
https://x.com/thirduser
```

Supplying numeric X user IDs pre-binds identities and is safest. If a row has
only a username, the first OAuth-authenticated account matching that exact handle
is permanently bound to the row. Confirmed and in-flight claims are never deleted
when the editable list is replaced.

## Mainnet and public launch

Deploy a separate mainnet contract with `RABBIT_HOLE_NETWORK=mainnet`, ideally
using a multisig as `RABBIT_HOLE_OWNER_ADDRESS`. Set the printed address in
`RABBIT_HOLE_MAINNET_CONTRACT_ADDRESS`, verify the contract and minter, run a
controlled claim, and only then change `RABBIT_HOLE_PUBLIC=true`.
