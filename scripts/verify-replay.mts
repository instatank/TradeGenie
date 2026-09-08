// Does the replay actually work in a browser?
//
// `next build` proves the page compiles and `npm run smoke` proves it returns
// 200. Neither can tell you whether a canvas got drawn, whether pressing Play
// advances anything, or whether the excursion numbers are RIGHT — and "right"
// is the only property that matters for a panel whose job is to tell you how
// much risk you took.
//
// So this drives a real headless Chromium against the built app, over a candle
// fixture whose extremes are known by construction. Every number the panel
// prints is checked against a value computed here by hand, not against
// whatever the code happened to produce.
//
// It uses the globally-installed Playwright rather than adding a dependency to
// this project, and TRADEGENIE_CANDLE_FIXTURE rather than the network, because
// this container has no egress to any exchange.

import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

const PORT = 3457;
const BASE = `http://127.0.0.1:${PORT}`;
const require = createRequire(import.meta.url);

// --- the world we are asserting against -----------------------------------
// The seeded LINK trade: SHORT 1.2 @ 21.40, stop 21.90, exit 20.60 in three
// legs at one instant. Held three hours.
const ENTRY = 21.4;
const STOP = 21.9;
const EXIT = 20.6;

/** Deliberate extremes, all outside the base band so they ARE the extremes. */
const SPIKE_HIGH = 21.75; // worst it went against a short, while open
const SPIKE_LOW = 20.35; // best it offered, while open
const AFTER_LOW = 20.2; // best it got after the exit
const BASE_LOW = 20.9;
const BASE_HIGH = 21.5;

const expected = {
  // Heat: (21.75 − 21.40) / (21.90 − 21.40) = 0.70 of the risk.
  heatR: (SPIKE_HIGH - ENTRY) / (STOP - ENTRY),
  // Best: (21.40 − 20.35) / 0.50 = 2.10R.
  mfeR: (ENTRY - SPIKE_LOW) / (STOP - ENTRY),
  // Stop never touched; closest approach as a share of the stop.
  stopClosestPct: ((STOP - SPIKE_HIGH) / STOP) * 100,
  // Drift: (20.60 − 20.20) / 0.50 = 0.80R.
  driftR: (EXIT - AFTER_LOW) / (STOP - ENTRY),
};

async function main() {
  const scratch = mkdtempSync(path.join(tmpdir(), "tradegenie-replay-"));
  const storePath = path.join(scratch, "store.json");
  const fixturePath = path.join(scratch, "candles.json");

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    TRADEGENIE_LOCAL_STORE: storePath,
    TRADEGENIE_CANDLE_FIXTURE: fixturePath,
    PORT: String(PORT),
  };
  delete env.FIREBASE_PROJECT_ID;
  delete env.FIREBASE_CLIENT_EMAIL;
  delete env.FIREBASE_PRIVATE_KEY;
  delete env.SITE_PASSWORD;

  await run("npx", ["tsx", "scripts/seed.ts"], env);

  const store = JSON.parse(await readFile(storePath, "utf8")) as Record<string, Array<Record<string, string>>>;
  const linked = store.trades.find((trade) => trade.id === "seed-trade-linked");
  if (!linked) throw new Error("the seed no longer creates the exchange-linked trade this verifies");
  const handLogged = store.trades.find((trade) => trade.status === "CLOSED" && !trade.exchangeKey);
  if (!handLogged) throw new Error("the seed no longer creates a hand-logged closed trade");

  const fills = store.exchangeFills.filter((fill) => fill.instrument === "LINK");
  const openedAt = new Date(fills[0].executedAt).getTime();
  const closedAt = Math.max(...fills.map((fill) => new Date(fill.executedAt).getTime()));

  // The hand-logged trade needs candles as well, or its panel refuses for the
  // wrong reason (no feed) and the refusal we actually want to prove — that a
  // closed trade with no exit time will not guess — never gets exercised.
  const handSymbol = `${handLogged.instrument}USDT`;
  writeFileSync(
    fixturePath,
    JSON.stringify({
      LINKUSDT: buildCandles(openedAt, closedAt),
      [handSymbol]: buildCandles(
        new Date(handLogged.tradeDateTime).getTime(),
        new Date(handLogged.tradeDateTime).getTime() + 6 * 3600_000,
      ),
    }),
  );

  const server = spawn("./node_modules/.bin/next", ["start", "-p", String(PORT)], {
    env, stdio: "pipe", detached: true,
  });
  let log = "";
  server.stdout.on("data", (chunk) => (log += chunk));
  server.stderr.on("data", (chunk) => (log += chunk));

  const failures: string[] = [];
  const check = (ok: boolean, what: string, detail = "") => {
    console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}${detail && !ok ? ` — ${detail}` : ""}`);
    if (!ok) failures.push(`${what}${detail ? ` (${detail})` : ""}`);
  };

  try {
    await waitForServer();
    const { chromium } = require("playwright") as typeof import("playwright");
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
    const consoleErrors: string[] = [];
    page.on("pageerror", (error) => consoleErrors.push(error.message));

    // --- the exchange-linked trade: the full path -------------------------
    await page.goto(`${BASE}/trades/${linked.id}`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "How it played out" }).waitFor({ timeout: 15000 });
    const body = await page.locator("body").innerText();

    check(body.includes("How it played out"), "the panel renders at all");
    // Four fills, but the three-leg exit is ONE order: two marks, not four.
    check(body.includes("2 marks from your fills"), "the 3-leg exit folds into one mark, and came from real fills", excerpt(body, "from your fills"));

    check(body.includes(`${expected.heatR.toFixed(2)}R`), `heat reads ${expected.heatR.toFixed(2)}R`, excerpt(body, "Heat taken"));
    check(body.includes("70% of the way to your stop"), "heat is explained in plain English", excerpt(body, "way to your stop"));
    check(body.includes(`${expected.mfeR.toFixed(2)}R`), `best-offered reads ${expected.mfeR.toFixed(2)}R`, excerpt(body, "Best it offered"));
    check(body.includes("Never reached"), "the stop is reported as never reached");
    check(body.includes(`${expected.stopClosestPct.toFixed(2)}%`), `closest approach reads ${expected.stopClosestPct.toFixed(2)}%`, excerpt(body, "closest was"));
    check(body.includes(`+${expected.driftR.toFixed(2)}R`), `post-exit drift reads +${expected.driftR.toFixed(2)}R`, excerpt(body, "After you left"));
    // innerText honours CSS text-transform and these labels are uppercased.
    check(/AFTER YOU LEFT \(3H\)/i.test(body), "the aftermath window is the full 3h, not the chart's padding", excerpt(body, "OU LEFT"));

    // --- the chart itself --------------------------------------------------
    const canvases = await page.locator("canvas").count();
    check(canvases > 0, "lightweight-charts drew a canvas", `found ${canvases}`);

    const cursorBefore = await page.locator("input[type=range]").inputValue();
    await page.getByRole("button", { name: /^Play$/ }).click();
    await page.waitForTimeout(1200);
    const cursorAfter = await page.locator("input[type=range]").inputValue();
    check(Number(cursorAfter) > Number(cursorBefore), "pressing Play advances the replay", `${cursorBefore} → ${cursorAfter}`);

    // 1× must mean ONE CANDLE PER SECOND. The first cut ran ~4-5 a second and
    // the scale had no slow end, which is what the owner hit. A rate is a claim
    // about behaviour over time, so it gets timed rather than asserted.
    await page.getByRole("button", { name: /Pause/ }).click();
    await page.getByRole("button", { name: /^1×$/ }).click();
    const rateStart = Number(await page.locator("input[type=range]").inputValue());
    const clockStart = Date.now();
    await page.getByRole("button", { name: /^Play$/ }).click();
    await page.waitForTimeout(4000);
    await page.getByRole("button", { name: /Pause/ }).click();
    const advanced = Number(await page.locator("input[type=range]").inputValue()) - rateStart;
    const seconds = (Date.now() - clockStart) / 1000;
    const rate = advanced / seconds;
    // Generous band: setInterval drifts and a headless page is not a metronome.
    check(rate > 0.6 && rate < 1.6, `1× runs at about one candle per second`, `measured ${rate.toFixed(2)}/s over ${seconds.toFixed(1)}s`);

    // And the slow end actually exists and is slower.
    await page.getByRole("button", { name: /^0\.25×$/ }).click();
    const slowStart = Number(await page.locator("input[type=range]").inputValue());
    const slowClock = Date.now();
    await page.getByRole("button", { name: /^Play$/ }).click();
    await page.waitForTimeout(4000);
    await page.getByRole("button", { name: /Pause/ }).click();
    const slowRate = (Number(await page.locator("input[type=range]").inputValue()) - slowStart) / ((Date.now() - slowClock) / 1000);
    check(slowRate < rate * 0.6, "0.25× is genuinely slower than 1×", `${slowRate.toFixed(2)}/s vs ${rate.toFixed(2)}/s`);

    await page.getByRole("button", { name: /^4×$/ }).click();
    await page.getByRole("button", { name: /^Play$/ }).click();
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: /Pause/ }).click();
    await page.waitForTimeout(300);
    const paused = await page.locator("input[type=range]").inputValue();
    await page.waitForTimeout(900);
    check((await page.locator("input[type=range]").inputValue()) === paused, "Pause actually stops it");

    // Scrubbing must not submit the page's form — the trade page is one big
    // form with one Save, and a replay control that saved the trade would be
    // the worst possible bug here.
    const urlBefore = page.url();
    await page.locator("input[type=range]").fill("40");
    await page.waitForTimeout(300);
    check(page.url() === urlBefore, "scrubbing does not navigate or submit the trade form");
    check((await page.locator("input[type=range]").inputValue()) === "40", "scrubbing moves the cursor");

    await page.getByRole("button", { name: /^4×$/ }).click();
    check((await page.getByRole("button", { name: /^4×$/ }).getAttribute("aria-pressed")) === "true", "speed selection sticks");
    check(await page.getByRole("button", { name: /^0\.5×$/ }).isVisible(), "the scale has a slow end at all");

    // Uppercased by CSS, and innerText honours text-transform — the same trap
    // that caught the aftermath-window check above.
    check(/HEAT TAKEN \(MAE\)/i.test(body) && /BEST IT OFFERED \(MFE\)/i.test(body),
      "the panel names MAE and MFE, the words the trade page already uses", excerpt(body, "EAT TAKEN"));

    check(consoleErrors.length === 0, "no uncaught errors in the browser", consoleErrors.join(" | "));

    // --- the hand-logged closed trade: the honest refusal -------------------
    await page.goto(`${BASE}/trades/${handLogged.id}`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "How it played out" }).waitFor({ timeout: 15000 });
    const handBody = await page.locator("body").innerText();
    check(
      handBody.includes("no exit time recorded"),
      "a closed trade with no exit time refuses to guess the heat",
      excerpt(handBody, "How it played out"),
    );

    await browser.close();
  } catch (error) {
    console.error(`\nServer output:\n${log.slice(-3000)}`);
    throw error;
  } finally {
    stopServer(server);
    rmSync(scratch, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} check(s) failed:\n${failures.map((f) => `  - ${f}`).join("\n")}`);
    process.exit(1);
  }
  console.log("\nReplay verified in a real browser.");
}

/**
 * 1m candles across the whole fetched window, with the extremes placed by hand.
 *
 * The base band sits strictly inside every spike, so each asserted number has
 * exactly one candle that can produce it — otherwise a passing test would only
 * prove the code found *an* extreme, not the right one.
 */
function buildCandles(openedAt: number, closedAt: number): Array<Record<string, number>> {
  const minute = 60_000;
  const from = openedAt - 4 * 60 * minute;
  const to = closedAt + 5 * 60 * minute;
  const candles: Array<Record<string, number>> = [];

  const spikeHighAt = Math.floor((openedAt + 40 * minute) / minute) * minute;
  const spikeLowAt = Math.floor((openedAt + 100 * minute) / minute) * minute;
  const afterLowAt = Math.floor((closedAt + 60 * minute) / minute) * minute;

  for (let stamp = Math.floor(from / minute) * minute; stamp <= to; stamp += minute) {
    let low = BASE_LOW;
    let high = BASE_HIGH;
    if (stamp === spikeHighAt) high = SPIKE_HIGH;
    if (stamp === spikeLowAt) low = SPIKE_LOW;
    if (stamp === afterLowAt) low = AFTER_LOW;
    candles.push({ time: stamp / 1000, open: low, high, low, close: high, volume: 10 });
  }
  return candles;
}

function excerpt(body: string, near: string): string {
  const index = body.indexOf(near);
  return index < 0 ? `"${near}" not found` : body.slice(index, index + 160).replace(/\s+/g, " ");
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: "ignore" });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))));
  });
}

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await fetch(`${BASE}/login`);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error("the server never came up");
}

function stopServer(server: ChildProcess) {
  if (server.pid) {
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      server.kill("SIGTERM");
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
