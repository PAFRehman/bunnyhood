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
      env: { ...process.env, RABBIT_HOLE_PAUSED: isPublic ? "false" : "true" },
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
  assert(html.includes("Verify your X identity"), "The simplified X verification step is missing.");
  assert(html.includes("Enter your wallet address"), "The simplified wallet step is missing.");
  assert(html.includes("Mint your SBT onchain"), "The simplified mint step is missing.");
  assert(!html.includes("PRIVATE ACCESS · SOULBOUND DROP"), "The retired private-drop copy remains.");
  assert(!html.includes("100 identities. One permanent box each."), "The retired 100-identity intro copy remains.");
  assert(!html.toLowerCase().includes("auction"), "Retired auction copy remains on the Rabbit Hole page.");

  const legacy = await fetch(`http://127.0.0.1:${port}/auction/legacy`, { redirect: "manual" });
  assert(legacy.status === 308, `Legacy auction redirect returned ${legacy.status}.`);
  assert(legacy.headers.get("location") === "/RabbitHole", "Legacy auction redirect has the wrong target.");

  const typoAlias = await fetch(`http://127.0.0.1:${port}/RabitHole`, { redirect: "manual" });
  assert(typoAlias.status === 308, `Rabbit Hole typo alias returned ${typoAlias.status}.`);
  assert(typoAlias.headers.get("location") === "/RabbitHole", "Rabbit Hole typo alias has the wrong target.");

  const waitlist = await fetch(`http://127.0.0.1:${port}/waitlist`, { redirect: "manual" });
  const waitlistHtml = await waitlist.text();
  assert(waitlist.status === 200, `Public waitlist returned ${waitlist.status}.`);
  assert(waitlistHtml.includes("GET") && waitlistHtml.includes("IN LINE"), "Waitlist hero copy is missing.");
  assert(waitlistHtml.includes("Follow + turn notifications on."), "Waitlist follow task is missing.");
  assert(waitlistHtml.includes("Like, repost + comment."), "Waitlist engagement task is missing.");
  assert(waitlistHtml.includes("NO X LOGIN"), "Waitlist no-X-login disclosure is missing.");
  assert(!waitlistHtml.includes("ELIGIBILITY ADMIN"), "A private admin link leaked onto the public waitlist.");

  const waitlistAdmin = await fetch(`http://127.0.0.1:${port}/admin/waitlist`, { redirect: "manual" });
  assert(waitlistAdmin.status === 307, `Waitlist admin gate returned ${waitlistAdmin.status}.`);
  assert(
    waitlistAdmin.headers.get("location") === "/admin/spin?next=/admin/waitlist",
    "Waitlist ledger did not redirect through the admin gate.",
  );

  const checker = await fetch(`http://127.0.0.1:${port}/Checker`, { redirect: "manual" });
  const checkerHtml = await checker.text();
  assert(checker.status === 200, `Public Checker returned ${checker.status}.`);
  assert(checkerHtml.includes("CHECK YOUR") && checkerHtml.includes("ELIGIBILITY"), "Checker hero copy is missing.");
  assert(checkerHtml.includes("CHECK ELIGIBILITY"), "Checker wallet form is missing.");
  assert(checkerHtml.includes("Every valid wallet is eligible for the Public round."), "Universal Public eligibility is missing.");
  assert(!checkerHtml.includes("WALLET INDEX · LIVE"), "The removed live-index label remains public.");
  assert(!checkerHtml.includes("/admin/checker"), "The hidden Checker admin URL leaked onto the public page.");

  const checkerAdmin = await fetch(`http://127.0.0.1:${port}/admin/checker`, { redirect: "manual" });
  assert(checkerAdmin.status === 307, `Checker admin gate returned ${checkerAdmin.status}.`);
  assert(
    checkerAdmin.headers.get("location") === "/admin/spin?next=/admin/checker",
    "Checker wallet manager did not redirect through the admin gate.",
  );
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

console.log("Rabbit Hole, waitlist, and Checker routing and admin gate smoke checks passed.");
