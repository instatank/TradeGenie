// Can Vercel's scheduled call actually reach the sync?
//
// This exists because the failure it checks for is silent. middleware.ts guards
// every route with a cookie the cron runner does not have, so without an
// exemption the scheduled sync is redirected to /login, returns a 307 that the
// runner counts as success, and never syncs anything. Nothing errors. The only
// symptom is data that quietly stops arriving.
//
// So it is asserted rather than reasoned about: the app is started WITH
// SITE_PASSWORD set — the state production is actually in — and the cron route
// is called three ways.

import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const PORT = Number(process.env.CRON_CHECK_PORT ?? 0) || (await freePort());
const BASE = `http://127.0.0.1:${PORT}`;
const CRON_PATH = "/api/cron/sync-exchange";
const SECRET = "test-cron-secret";

async function main() {
  const scratch = mkdtempSync(path.join(tmpdir(), "tradegenie-cron-"));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    TRADEGENIE_LOCAL_STORE: path.join(scratch, "store.json"),
    PORT: String(PORT),
    // The whole point: the gate is ON, exactly as in production.
    SITE_PASSWORD: "smoke-password",
    CRON_SECRET: SECRET,
  };
  delete env.FIREBASE_PROJECT_ID;
  delete env.FIREBASE_CLIENT_EMAIL;
  delete env.FIREBASE_PRIVATE_KEY;
  // No exchange credentials: the route must still be REACHED. Whether it can
  // talk to CoinDCX is a different question from whether the gate let it in.
  delete env.COINDCX_API_KEY;
  delete env.COINDCX_API_SECRET;

  const server = spawn("./node_modules/.bin/next", ["start", "-p", String(PORT)], {
    env,
    stdio: "pipe",
    detached: true,
  });

  let failures = 0;
  try {
    await waitForServer();

    // 1. The real thing: a correct bearer token must get through the gate.
    const authorized = await fetch(`${BASE}${CRON_PATH}`, {
      headers: { Authorization: `Bearer ${SECRET}` },
      redirect: "manual",
    });
    failures += assert(
      authorized.status === 200,
      `cron with a valid CRON_SECRET reaches the route (got ${authorized.status}${redirectNote(authorized)})`,
    );

    // 2. A wrong token must NOT. Otherwise the exemption is just a hole.
    const wrong = await fetch(`${BASE}${CRON_PATH}`, {
      headers: { Authorization: "Bearer not-the-secret" },
      redirect: "manual",
    });
    failures += assert(
      wrong.status !== 200,
      `cron with a WRONG secret is refused (got ${wrong.status})`,
    );

    // 3. No token at all must not either.
    const bare = await fetch(`${BASE}${CRON_PATH}`, { redirect: "manual" });
    failures += assert(bare.status !== 200, `cron with no secret is refused (got ${bare.status})`);
  } finally {
    if (server.pid) process.kill(-server.pid, "SIGTERM");
    rmSync(scratch, { recursive: true, force: true });
  }

  if (failures) {
    console.error(`\n${failures} check(s) failed — the scheduled sync would not run.`);
    process.exit(1);
  }
  console.log("\nThe scheduled sync can reach the app, and nothing else can.");
}

function assert(condition: boolean, description: string): number {
  console.log(`  ${condition ? "ok  " : "FAIL"}  ${description}`);
  return condition ? 0 : 1;
}

function redirectNote(response: Response): string {
  const location = response.headers.get("location");
  return location ? `, redirected to ${location}` : "";
}

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await fetch(`${BASE}/login`, { redirect: "manual" });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error("server did not start");
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on("error", reject);
    probe.listen(0, () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

await main();
