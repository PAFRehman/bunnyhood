import { compileRabbitHoleContract } from "./lib/rabbithole-contract.mjs";

const artifact = compileRabbitHoleContract();
const functions = new Set(artifact.abi.filter((item) => item.type === "function").map((item) => item.name));
for (const required of ["mintClaim", "claimTokenId", "locked", "setMinter", "totalSupply"]) {
  if (!functions.has(required)) throw new Error(`Rabbit Hole ABI is missing ${required}.`);
}
if (artifact.deployedBytecode.length < 1_000) throw new Error("Rabbit Hole deployed bytecode is unexpectedly small.");
console.log("Rabbit Hole SBT compiles and exposes the required soulbound claim interface.");
