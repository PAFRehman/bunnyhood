export const AUCTION_ABI = [
  {
    type: "function",
    name: "getAuction",
    inputs: [],
    outputs: [{
      type: "tuple",
      components: [
        { name: "auctionId", type: "uint256" },
        { name: "seller", type: "address" },
        { name: "startTime", type: "uint64" },
        { name: "endTime", type: "uint64" },
        { name: "minimumBid", type: "uint256" },
        { name: "minBidIncrementBps", type: "uint256" },
        { name: "highestBidder", type: "address" },
        { name: "highestBid", type: "uint256" },
        { name: "state", type: "uint8" },
        { name: "totalBidsCount", type: "uint256" },
      ],
    }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getReservation",
    inputs: [{ name: "reservationId", type: "uint256" }],
    outputs: [{
      type: "tuple",
      components: [
        { name: "reservationId", type: "uint256" },
        { name: "winner", type: "address" },
        { name: "winningBid", type: "uint256" },
        { name: "finalized", type: "bool" },
        { name: "fulfilled", type: "bool" },
      ],
    }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getRefundableBalance",
    inputs: [{ name: "bidder", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getMinimumNextBid",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "pendingSellerProceeds",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "totalRefundable",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "authorizedMinter",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "isAuctionActive",
    inputs: [],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "isAuctionEnded",
    inputs: [],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "placeBid",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "claimRefund",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "finalizeAuction",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "claimSellerProceeds",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "event",
    name: "BidPlaced",
    inputs: [
      { name: "auctionId", type: "uint256", indexed: true },
      { name: "bidder", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
] as const;

export const ERC20_ABI = [
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "allowance",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "approve",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
  },
] as const;

export const USDG_DECIMALS = 6;
