import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const compile = spawnSync(process.execPath, [join(root, "scripts", "compile-sbt.mjs")], { stdio: "inherit" });
if (compile.status !== 0) process.exit(compile.status ?? 1);
const source = readFileSync(join(root, "contracts", "BunnyHoodRabbitHoleSBT.sol"), "utf8");
const artifact = JSON.parse(readFileSync(join(root, "contracts", "artifacts", "BunnyHoodRabbitHoleSBT.json"), "utf8"));
const requiredReverts = [
  /function approve\([^)]*\)[^{]*\{\s*revert Soulbound\(\);\s*\}/s,
  /function setApprovalForAll\([^)]*\)[^{]*\{\s*revert Soulbound\(\);\s*\}/s,
  /function transferFrom\([^)]*\)[^{]*\{\s*revert Soulbound\(\);\s*\}/s,
];
const safeTransferReverts = source.match(
  /function safeTransferFrom\([^)]*\)[^{]*\{\s*revert Soulbound\(\);\s*\}/gs,
) ?? [];
const failures = [];
if (!requiredReverts.every((pattern) => pattern.test(source))) failures.push("A transfer or approval path does not unconditionally revert Soulbound().");
if (safeTransferReverts.length !== 2) failures.push("Both ERC-721 safeTransferFrom overloads must unconditionally revert Soulbound().");
if (!/0xb45a3c0e/.test(source) || !/function locked\(/.test(source)) failures.push("EIP-5192 support is incomplete.");
if (/function burn\(/.test(source)) failures.push("A burn path was added to the permanent SBT.");
if (!artifact.bytecode?.startsWith("0x") || artifact.bytecode.length < 1000) failures.push("Compiled deployment bytecode is invalid.");
const abiNames = new Set(artifact.abi.filter((item) => item.type === "function").map((item) => item.name));
for (const name of ["mint", "ownerOf", "tokenURI", "tokenOfClaim", "locked", "transferFrom", "approve"]) {
  if (!abiNames.has(name)) failures.push(`Compiled ABI is missing ${name}().`);
}
if (failures.length) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}
console.log("SBT compilation and permanent soulbound invariants passed.");
