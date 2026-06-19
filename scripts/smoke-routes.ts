// Headless route smoke (Tier 4 of EVALUATION_PLAN.md). Boots the real built Next
// server and requests every primary page, asserting none crash (no 5xx). This is
// the "is the whole thing broken?" check that unit/integration tests miss — a
// server-component render error, a bad import, a top-level throw. No browser is
// needed, so it runs both locally and in CI.
//
// Usage: `npm run build` first, then `npm run smoke`. CI chains them.

import { spawn } from "node:child_process";

const PORT = Number(process.env.SMOKE_PORT ?? 4321);
const BASE = `http://127.0.0.1:${PORT}`;

// Static + dynamic-listing routes that render with an empty store. Parameterized
// detail routes (/trades/[id], /assets/[id]) are intentionally excluded.
const ROUTES = [
  "/", "/inbox", "/trades", "/trades/new", "/assets", "/daily", "/calendar",
  "/playbook", "/analytics", "/lessons", "/import", "/weekly-review", "/settings",
  "/search", "/api/export",
];

async function waitForServer(timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(BASE, { signal: AbortSignal.timeout(2_000) });
      if (res.status < 500) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Server did not become ready on ${BASE} within ${timeoutMs}ms`);
}

async function main() {
  // Force the dev/local store so the smoke never depends on Firebase credentials.
  const env = { ...process.env };
  delete env.FIREBASE_PROJECT_ID;
  delete env.FIREBASE_CLIENT_EMAIL;
  delete env.FIREBASE_PRIVATE_KEY;
  delete env.GOOGLE_APPLICATION_CREDENTIALS;

  const server = spawn("npx", ["next", "start", "-p", String(PORT)], {
    env,
    stdio: ["ignore", "inherit", "inherit"],
  });

  let failed = 0;
  try {
    await waitForServer();
    console.log(`\nRoute smoke against ${BASE}\n${"=".repeat(50)}`);
    for (const route of ROUTES) {
      let status = 0;
      try {
        const res = await fetch(`${BASE}${route}`, { redirect: "manual", signal: AbortSignal.timeout(15_000) });
        status = res.status;
      } catch (error) {
        console.log(`✗ ${route}  (request failed: ${(error as Error).message})`);
        failed++;
        continue;
      }
      const ok = status < 500;
      console.log(`${ok ? "✓" : "✗"} ${route}  -> ${status}`);
      if (!ok) failed++;
    }
  } finally {
    server.kill("SIGTERM");
  }

  console.log("=".repeat(50));
  if (failed) {
    console.error(`SMOKE FAILED: ${failed} route(s) returned a server error.`);
    process.exit(1);
  }
  console.log("SMOKE PASSED: all routes render.");
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
