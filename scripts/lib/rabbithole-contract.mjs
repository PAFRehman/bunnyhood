import { readFileSync } from "node:fs";
import { dirname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import solc from "solc";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "../..");
const contractPath = join(projectRoot, "contracts/src/BunnyHoodRabbitHoleSBT.sol");

function findImport(importPath) {
  const safePath = normalize(importPath).replace(/^(\.\.[/\\])+/, "");
  const candidates = [
    join(projectRoot, "node_modules", safePath),
    join(projectRoot, "contracts", safePath),
  ];
  for (const candidate of candidates) {
    try {
      return { contents: readFileSync(candidate, "utf8") };
    } catch {
      // Try the next explicit project-local path.
    }
  }
  return { error: `Import not found: ${importPath}` };
}

export function compileRabbitHoleContract() {
  const sourceName = "contracts/src/BunnyHoodRabbitHoleSBT.sol";
  const input = {
    language: "Solidity",
    sources: {
      [sourceName]: { content: readFileSync(contractPath, "utf8") },
    },
    settings: {
      optimizer: { enabled: true, runs: 500 },
      evmVersion: "cancun",
      outputSelection: {
        "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"] },
      },
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImport }));
  const errors = (output.errors || []).filter((entry) => entry.severity === "error");
  if (errors.length) {
    throw new Error(errors.map((entry) => entry.formattedMessage || entry.message).join("\n"));
  }
  const artifact = output.contracts?.[sourceName]?.BunnyHoodRabbitHoleSBT;
  if (!artifact?.evm?.bytecode?.object || !artifact?.abi) {
    throw new Error("Rabbit Hole contract artifact was not generated.");
  }
  return {
    abi: artifact.abi,
    bytecode: `0x${artifact.evm.bytecode.object}`,
    deployedBytecode: `0x${artifact.evm.deployedBytecode.object}`,
  };
}
