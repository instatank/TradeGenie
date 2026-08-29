// Route smoke test: build output only proves the *static* routes render.
// 13 of this app's routes are dynamic, so a crash in /trades or /inbox — a bad
// enum, a null deref on a real record — sails past `next build` and lands in
// production. This starts the built app against a seeded throwaway store and
// asserts every route answers 200.
//
// Run after `npm run build`, before pushing. It is the last gate that actually
// exercises a render.

import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// A fixed port makes repeat runs flaky: the previous run's socket can still be
// in TIME_WAIT. Ask the OS for a free one unless told otherwise.
const PORT = Number(process.env.SMOKE_PORT ?? 0) || (await freePort());
const BASE = `http://127.0.0.1:${PORT}`;

// Every route a person can reach. Dynamic ones get a real id from the seed.
const STATIC_ROUTES = [
  "/", "/trades", "/trades/new", "/daily", "/inbox", "/lessons", "/notes",
  "/search", "/calendar", "/analytics", "/assets", "/playbook", "/settings",
  "/calculator", "/weekly-review", "/import", "/login", "/mechanisms",
];

async function main() {
  const scratch = mkdtempSync(path.join(tmpdir(), "tradegenie-smoke-"));
  const storePath = path.join(scratch, "store.json");
  const env: NodeJS.ProcessEnv = { ...process.env, TRADEGENIE_LOCAL_STORE: storePath, PORT: String(PORT) };
  delete env.FIREBASE_PROJECT_ID;
  delete env.FIREBASE_CLIENT_EMAIL;
  delete env.FIREBASE_PRIVATE_KEY;
  delete env.SITE_PASSWORD; // the gate would 307 every route to /login

  await run("npx", ["tsx", "scripts/seed.ts"], env);

  // detached so we can kill the whole process group: a plain SIGTERM to the
  // launcher leaves the actual Next server orphaned and the script never exits.
  const server = spawn("./node_modules/.bin/next", ["start", "-p", String(PORT)], {
    env,
    stdio: "pipe",
    detached: true,
  });
  let serverLog = "";
  server.stdout.on("data", (chunk) => (serverLog += chunk));
  server.stderr.on("data", (chunk) => (serverLog += chunk));

  const failures: string[] = [];
  try {
    await waitForServer();
    const routes = [...STATIC_ROUTES, ...(await dynamicRoutes(storePath))];
    for (const route of routes) {
      const status = await probe(route);
      const ok = status === 200;
      console.log(`  ${ok ? "ok  " : "FAIL"}  ${route.padEnd(28)} ${status}`);
      if (!ok) failures.push(`${route} -> ${status}`);
    }

    // A 200 only proves the page did not throw. Several of the most breakable
    // renders are CONDITIONAL — the reconcile diff, the unjournaled nudge —
    // and an empty store draws their empty states instead, so a crash in one
    // would sail through a status check. The seed creates the data that makes
    // them render; these assert they actually did.
    for (const [route, needle, what] of CONTENT_CHECKS) {
      const body = await fetchBody(route);
      const ok = body.includes(needle);
      console.log(`  ${ok ? "ok  " : "FAIL"}  ${route.padEnd(28)} renders ${what}`);
      if (!ok) failures.push(`${route} did not render ${what}`);
    }
  } catch (error) {
    console.error(`\nServer output:\n${serverLog.slice(-4000)}`);
    throw error;
  } finally {
    stopServer(server);
    rmSync(scratch, { recursive: true, force: true });
  }

  if (failures.length) {
    console.error(`\n${failures.length} route(s) failed:\n  ${failures.join("\n  ")}`);
    if (serverLog.trim()) console.error(`\nServer output:\n${serverLog.slice(-4000)}`);
    process.exit(1);
  }
  console.log("\nAll routes rendered.");
}

// [route, string that must appear, what it proves rendered]
//
// Only routes that render per-request can be checked this way. A statically
// prerendered page (most of this app, deliberately) is built BEFORE the seed
// runs, so `next start` serves HTML generated against whatever store existed at
// build time and a content assertion against it would be meaningless — which is
// exactly what happened on the first attempt at this, and is why /import is now
// force-dynamic rather than why this check was weakened.
const CONTENT_CHECKS: [string, string, string][] = [
  ["/import", "Use the exchange", "the reconcile diff + accept button"],
  ["/import", "Log this trade", "an unjournaled position card"],
  ["/import", "older position", "the missing-funding warning"],
  ["/import", "Accept selected", "the bulk-select accept control (seed keeps 2+ review items for this)"],
  ["/import", "Dismiss selected", "the bulk-select dismiss control"],
  ["/import", "Log as archive", "the per-position archive button"],
  ["/import", "Log all", "the bulk archive control"],
  ["/trades", "Rebuilt from exchange fills", "the archive badge on a trade that was never journaled"],
  ["/trades", "Setup, mood, mechanism", "the free-text filter box"],
  // Proves the box filters on the SERVER, not just in the browser: a query
  // nothing can match must empty the list, not render it unchanged.
  ["/trades?q=zzznotatrade", "Nothing matches", "the free-text filter actually narrowing the list"],
];

async function fetchBody(route: string): Promise<string> {
  try {
    const response = await fetch(`${BASE}${route}`, { redirect: "manual", signal: AbortSignal.timeout(20_000) });
    return await response.text();
  } catch (error) {
    return `<!-- fetch failed: ${error instanceof Error ? error.message : String(error)} -->`;
  }
}

async function dynamicRoutes(storePath: string): Promise<string[]> {
  const { readFile } = await import("node:fs/promises");
  const store = JSON.parse(await readFile(storePath, "utf8")) as Record<string, { id: string }[]>;
  const first = (name: string) => store[name]?.[0]?.id;
  return [
    first("trades") && `/trades/${first("trades")}`,
    first("assets") && `/assets/${first("assets")}`,
    first("setups") && `/playbook/${first("setups")}/run`,
    // A mechanism page keyed by an option value, not a record id — FVG is a
    // built-in, so it exists in every store.
    "/mechanisms/FVG",
  ].filter((route): route is string => Boolean(route));
}

async function probe(route: string): Promise<number | string> {
  try {
    const response = await fetch(`${BASE}${route}`, {
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
    });
    return response.status;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      await fetch(`${BASE}/login`, { redirect: "manual", signal: AbortSignal.timeout(2000) });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(`Server never came up on ${BASE}`);
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => (port ? resolve(port) : reject(new Error("could not find a free port"))));
    });
  });
}

function stopServer(server: ReturnType<typeof spawn>) {
  if (server.pid === undefined) return;
  try {
    process.kill(-server.pid, "SIGKILL"); // the whole group, not just the launcher
  } catch {
    server.kill("SIGKILL");
  }
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: "inherit" });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))));
  });
}

const OVERALL_TIMEOUT_MS = 180_000;
const guard = setTimeout(() => {
  console.error(`Smoke test exceeded ${OVERALL_TIMEOUT_MS / 1000}s — failing rather than hanging.`);
  process.exit(1);
}, OVERALL_TIMEOUT_MS);
guard.unref();

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
