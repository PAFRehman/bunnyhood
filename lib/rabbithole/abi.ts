export const RABBIT_HOLE_SBT_ABI = [
  {
    type: "event",
    name: "RabbitClaimed",
    inputs: [
      { name: "claimKey", type: "bytes32", indexed: true },
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "recipient", type: "address", indexed: true },
      { name: "tokenUri", type: "string", indexed: false },
    ],
  },
  {
    type: "function",
    name: "claimTokenId",
    stateMutability: "view",
    inputs: [{ name: "claimKey", type: "bytes32" }],
    outputs: [{ name: "tokenId", type: "uint256" }],
  },
  {
    type: "function",
    name: "minter",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "mintClaim",
    stateMutability: "nonpayable",
    inputs: [
      { name: "recipient", type: "address" },
      { name: "claimKey", type: "bytes32" },
      { name: "tokenUri", type: "string" },
    ],
    outputs: [{ name: "tokenId", type: "uint256" }],
  },
] as const;
