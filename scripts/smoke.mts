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
  "/calculator", "/weekly-review", "/import", "/login",
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

async function dynamicRoutes(storePath: string): Promise<string[]> {
  const { readFile } = await import("node:fs/promises");
  const store = JSON.parse(await readFile(storePath, "utf8")) as Record<string, { id: string }[]>;
  const first = (name: string) => store[name]?.[0]?.id;
  return [
    first("trades") && `/trades/${first("trades")}`,
    first("assets") && `/assets/${first("assets")}`,
    first("setups") && `/playbook/${first("setups")}/run`,
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
