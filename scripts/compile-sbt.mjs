import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import solc from "solc";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = join(root, "contracts", "BunnyHoodRabbitHoleSBT.sol");
const artifactPath = join(root, "contracts", "artifacts", "BunnyHoodRabbitHoleSBT.json");
const source = readFileSync(sourcePath, "utf8");
const input = {
  language: "Solidity",
  sources: { "BunnyHoodRabbitHoleSBT.sol": { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: "paris",
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"] } },
  },
};
const output = JSON.parse(solc.compile(JSON.stringify(input)));
for (const issue of output.errors ?? []) {
  const line = `${issue.severity.toUpperCase()}: ${issue.formattedMessage}`;
  if (issue.severity === "error") console.error(line);
  else console.warn(line);
}
if ((output.errors ?? []).some((issue) => issue.severity === "error")) process.exit(1);
const contract = output.contracts?.["BunnyHoodRabbitHoleSBT.sol"]?.BunnyHoodRabbitHoleSBT;
if (!contract?.evm?.bytecode?.object) throw new Error("SBT compiler output is missing bytecode.");
const artifact = {
  contractName: "BunnyHoodRabbitHoleSBT",
  compilerVersion: solc.version(),
  abi: contract.abi,
  bytecode: `0x${contract.evm.bytecode.object}`,
  deployedBytecode: `0x${contract.evm.deployedBytecode.object}`,
};
mkdirSync(dirname(artifactPath), { recursive: true });
writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(`Compiled ${artifact.contractName} with ${artifact.compilerVersion}.`);
