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
  // A route whose whole job is to call hosts that are unreachable from CI. It
  // is here precisely because of that: the candle feed is never load-bearing,
  // so the probe must still render a readable report when every provider fails,
  // and a 200 with zero providers reachable is the proof of it.
  "/api/candle-probe",
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
    for (const [route, needle, what] of [...CONTENT_CHECKS, ...(await dynamicContentChecks(storePath))]) {
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
  // The slippage aggregate. It lives inside the advanced fold, so it is in the
  // DOM regardless of the <details> being shut — what is NOT guaranteed is that
  // any trade in the seeded world is measurable at all, which is the whole
  // point of the check. "+48.8" is the median over the one measurable trade;
  // the greyed row proves a single reading still refuses to sound confident.
  ["/analytics", "Slippage on your fills", "the per-symbol slippage table"],
  ["/analytics", "+48.8", "a real measured median rather than the empty state"],
  ["/analytics", "more to read this", "the thin-sample badge, so one fill never reads as a verdict"],
  // The way back from the aggregate to the rows it came from. The owner went
  // looking for "which trades have this?" and the only answer was opening every
  // trade in the journal, so these two are the fix and must not silently rot.
  ["/analytics", "behind these numbers", "the list naming the measurable trades"],
  ["/analytics", "measurable", "the coverage line saying how many trades were checked"],
  // Both halves of the setup grade: the badge only renders on a trade that
  // carries one, and the control only inside an expanded row's review — two
  // conditional renders `next build` never reaches.
  ["/trades", "Setup graded", "the setup-grade badge on a graded trade"],
  ["/trades", "Grade the setup", "the setup-grade control in the inline review"],
  // Proves the grade filter runs on the SERVER: a grade nothing carries must
  // empty the list rather than render it unchanged.
  ["/trades?setupGrade=ZZZNOGRADE", "No trades match this view", "the setup-grade filter actually narrowing the list"],
  // The analytics drill-down. `next build` cannot reach any of this: the panel,
  // the chips and the scope banner are all conditional on a filter being on.
  ["/analytics", "Filter &amp; drill down", "the analytics filter panel"],
  ["/analytics?direction=LONG", "Direction: Long", "an active-filter chip naming the filter in English"],
  ["/analytics?direction=LONG", "describes only these", "the scope banner saying the numbers cover the filtered set only"],
  ["/analytics?direction=LONG", "Clear all filters", "the escape hatch back to the whole journal"],
  // Proves the filter runs on the SERVER: a filter nothing matches must empty
  // the page, not render the unfiltered numbers under a filtered heading.
  ["/analytics?instrument=ZZZNOSYMBOL", "No closed trades match these filters", "the analytics filter actually narrowing the page"],
  ["/analytics?sort=netPnl&dir=desc", '<option value="netPnl" selected', "the page-wide sort read back from the URL"],
  // Comparison and per-table sorts — all conditional on a URL param.
  ["/analytics?direction=LONG&vs=rest", "Everything else", "the comparison panel against the complement"],
  ["/analytics?direction=LONG&vs=rest", "Stop comparing", "the way back out of a comparison"],
  ["/analytics?direction=LONG&vs=rest", "Profit factor", "the profit-factor row"],
  ["/analytics?direction=LONG&vs=rest", "P&amp;L per trade", "the renamed per-trade P&L row"],
  ["/analytics?direction=LONG&vs=rest", "Average loss", "the average win/loss split"],
  // The honesty layer: comparing a slice against a set that contains it must
  // say so. This is the whole reason "everything else" is the default.
  ["/analytics?direction=LONG&vs=all", "These two sets overlap", "the overlap warning when the baseline contains the filtered set"],
  ["/analytics?s_setup=netPnl&d_setup=desc", "Reset them", "the escape hatch from per-table sorts"],
  ["/analytics", "Sort every table by", "the page-wide sort control"],
  ["/trades", "Setup, mood, mechanism", "the free-text filter box"],
  // Proves the box filters on the SERVER, not just in the browser: a query
  // nothing can match must empty the list, not render it unchanged.
  ["/trades?q=zzznotatrade", "Nothing matches", "the free-text filter actually narrowing the list"],
  // Backup and restore. The status panel renders inside its own <Suspense>, so
  // a crash in it would leave the rest of /settings at a perfectly good 200 —
  // a status check alone could not tell "backups are off" from "the panel that
  // reports on backups is broken". The smoke env has no BACKUP_GITHUB_*, which
  // is the "off until configured" state this asserts.
  ["/settings", "Automatic offsite backup: off", "the offsite backup status panel"],
  // The setup diagnosis: naming each variable, and the buttons that must be
  // present in the OFF state too — that is the one moment someone needs them.
  ["/settings", "BACKUP_GITHUB_REPO", "the per-variable setup diagnosis"],
  ["/settings", "Check connection", "the connection test, reachable while backup is still off"],
  ["/settings", "Restore from a backup", "the restore control"],
  ["/settings", "Put back what", "the non-destructive restore mode, which must be the default"],
  // Attribute order is React's, not ours — asserted against the real render.
  ["/settings", 'checked="" value="fill-gaps"', "fill-gaps selected by default rather than the destructive rollback"],
  // The lifecycle screen. Both halves are conditional renders `next build`
  // cannot reach: the empty-catalog copy only appears while nothing is on
  // trial, and the usage list only exists at all for the owner role.
  ["/settings", "Optional features", "the feature lifecycle panel"],
  ["/settings", "Nothing is on trial right now", "the empty-catalog state, which is the correct state today"],
  ["/settings", "what you actually use", "the read-only usage list"],
];

async function fetchBody(route: string): Promise<string> {
  try {
    const response = await fetch(`${BASE}${route}`, { redirect: "manual", signal: AbortSignal.timeout(20_000) });
    return await response.text();
  } catch (error) {
    return `<!-- fetch failed: ${error instanceof Error ? error.message : String(error)} -->`;
  }
}

/**
 * Content checks against a route whose id comes from the seed.
 *
 * The asset workspace is the most conditional page in the app — a timeline of
 * four different row kinds, a stats panel with a thin-sample branch, a fold for
 * older entries — and it is a dynamic segment, so `next build` only proves it
 * compiles. Until the seed grew an asset, a 200 was the only thing ever
 * asserted about it, and even that resolved to no route at all.
 */
async function dynamicContentChecks(storePath: string): Promise<[string, string, string][]> {
  const { readFile } = await import("node:fs/promises");
  const store = JSON.parse(await readFile(storePath, "utf8")) as Record<string, { id: string; symbol?: string }[]>;
  // SOL is the seeded asset with a full thread; BTC is the sparse one.
  const sol = store.assets?.find((asset) => asset.symbol === "SOL")?.id;
  const arb = store.assets?.find((asset) => asset.symbol === "ARB")?.id;
  if (!sol) return [];

  // The replay panel is a conditional render behind a <Suspense> and a live
  // network call, so `next build` cannot reach it at all. With no egress here
  // the candle fetch fails, which is exactly the case worth gating: the panel
  // must still render, and say why it is empty, rather than blanking or taking
  // the trade page down with it. The full-content assertions live in
  // `npm run verify:replay`, which drives a real browser over a candle fixture.
  const replayChecks: [string, string, string][] = [
    ["/trades/seed-trade-linked", "How it played out", "the replay panel on an exchange-linked trade"],
    ["/trades/seed-trade-linked", "No candles for LINKUSDT", "a plain reason when the candle feed is unreachable"],
  ];

  // Slippage needs FOUR things to line up at once — a trade linked to a
  // position, a bracket row in the ledger, a written-down reference price and a
  // closed exit — so it is a conditional render four levels deep that `next
  // build` cannot come near. The seed builds exactly that case, and the numbers
  // asserted here are worked by hand: the LINK short's target was 20.50 and it
  // covered at 20.60, i.e. 0.10 worse = 48.8 bps = 20% of the 0.50 it risked.
  // A wrong sign or a mean-instead-of-median would move these.
  const slippageChecks: [string, string, string][] = [
    ["/trades/seed-trade-linked", "What your fills cost you", "the slippage panel on an exchange-linked trade"],
    ["/trades/seed-trade-linked", "+48.8 bps", "the measured exit slippage, not a refusal"],
    ["/trades/seed-trade-linked", "Share of your planned risk", "slippage expressed against risk, which is the number that matters"],
    ["/trades/seed-trade-linked", "+23.3 bps", "entry slippage, which only renders when a planned entry was written down"],
    ["/trades/seed-trade-linked", "Entry you wanted", "the planned-entry field a sync can never overwrite"],
    // The order-based reading: the exchange's own record of the price ASKED
    // for. Four conditions deep (linked trade, held order, a reference price on
    // it, and a fill) so `next build` cannot come near it.
    ["/trades/seed-trade-linked", "order records", "the reading taken from the exchange's own orders"],
    ["/trades/seed-trade-linked", "Measured against what you wrote down", "the journal-based reading kept underneath it"],
    // Both paths agree on this trade by construction. The string only exists if
    // the order path produced a number, and it is the SAME number the typed
    // target produces — a drift between the two turns this red.
    ["/trades/seed-trade-linked", "+48.8 bps", "order and journal agreeing on the same fill"],
  ];
  const route = `/assets/${sol}`;
  const checks: [string, string, string][] = [
    [route, "The story so far", "the merged timeline"],
    [route, "Quick note", "a free note reaching the asset page through its #sol tag"],
    [route, "bias changed", "a bias-change marker row in the timeline"],
    [route, "Open the day this was written", "the free note's link back to its own day"],
    // A needle must not span an interpolated value: React emits `What
    // <!-- -->SOL<!-- --> has done for you`, so any assertion crossing a {}
    // boundary fails against a page that rendered perfectly. This has bitten
    // this repo before.
    [route, "has done for you", "the per-asset performance panel"],
    [route, "Net P&amp;L on ", "the net P&L figure, which needs converted trades to be right"],
    [route, "Notes written", "attention and return side by side in the same panel"],
    [route, " before these read as", "the thin-sample caveat rather than a confident verdict"],
    // The paste control degrades to a real file input; both halves must render.
    [route, "paste", "the paste-to-attach hint on the note composer"],
    [route, 'type="file"', "the plain file input the paste control is built on"],
    ...replayChecks,
    ...slippageChecks,
  ];

  // ARB's only trade is the USDT-margined archive position, so its panel is
  // right ONLY if the read path converted it: summed raw it reads 4, and the
  // answer is 399. That is the ~100x skew two margin accounts caused before
  // getTradesWithMistakes became the one conversion boundary, and this is the
  // check that fails if a later edit swaps it back for listRecords("trades").
  if (arb) checks.push([`/assets/${arb}`, "+₹399", "a per-asset P&L that is only correct because the trades were converted"]);

  return checks;
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
