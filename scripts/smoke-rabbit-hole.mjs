import { once } from "node:events";
import { spawn } from "node:child_process";
import { join } from "node:path";

const root = process.cwd();
const nextBin = join(root, "node_modules", "next", "dist", "bin", "next");
const port = 32_417;

async function startServer(isPublic) {
  const child = spawn(
    process.execPath,
    [nextBin, "start", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      cwd: root,
      env: { ...process.env, RABBIT_HOLE_PUBLIC: isPublic ? "true" : "false" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Next.js did not start.\n${output}`)), 15_000);
    const consume = (chunk) => {
      output += chunk.toString();
      if (output.includes("Ready")) {
        clearTimeout(timeout);
        resolve();
      }
    };
    child.stdout.on("data", consume);
    child.stderr.on("data", consume);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Next.js exited with ${code}.\n${output}`));
    });
  });
  return child;
}

async function stopServer(child) {
  child.kill("SIGTERM");
  await Promise.race([
    once(child, "exit"),
    new Promise((resolve) => setTimeout(resolve, 3_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

let server = await startServer(true);
try {
  const page = await fetch(`http://127.0.0.1:${port}/RabbitHole`, { redirect: "manual" });
  const html = await page.text();
  assert(page.status === 200, `Public Rabbit Hole returned ${page.status}.`);
  assert(html.includes("ENTER THE RABBIT HOLE"), "Rabbit Hole intro copy is missing from the rendered HTML.");
  assert(html.includes("rabbit-hole-box-original.png"), "The supplied Rabbit Hole master artwork is missing.");
  assert(html.includes("pinned to IPFS"), "The IPFS-backed claim sequence is missing.");
  assert(!html.toLowerCase().includes("auction"), "Retired auction copy remains on the Rabbit Hole page.");

  const legacy = await fetch(`http://127.0.0.1:${port}/auction/legacy`, { redirect: "manual" });
  assert(legacy.status === 308, `Legacy auction redirect returned ${legacy.status}.`);
  assert(legacy.headers.get("location") === "/RabbitHole", "Legacy auction redirect has the wrong target.");
} finally {
  await stopServer(server);
}

server = await startServer(false);
try {
  const page = await fetch(`http://127.0.0.1:${port}/RabbitHole`, { redirect: "manual" });
  assert(page.status === 307, `Private Rabbit Hole gate returned ${page.status}.`);
  assert(
    page.headers.get("location") === "/admin/spin?next=/RabbitHole",
    "Private Rabbit Hole did not redirect through the admin gate.",
  );

  const adminPage = await fetch(`http://127.0.0.1:${port}/admin/rabbit-hole`, { redirect: "manual" });
  assert(adminPage.status === 307, `Rabbit Hole admin gate returned ${adminPage.status}.`);
  assert(
    adminPage.headers.get("location") === "/admin/spin?next=/admin/rabbit-hole",
    "Rabbit Hole eligibility manager did not redirect through the admin gate.",
  );

  const status = await fetch(`http://127.0.0.1:${port}/api/rabbit-hole/status?username=alice`);
  assert(status.status === 401, `Private eligibility API returned ${status.status} without an admin session.`);
} finally {
  await stopServer(server);
}

console.log("Rabbit Hole routing, intro, retirement redirect, and admin gate smoke checks passed.");
