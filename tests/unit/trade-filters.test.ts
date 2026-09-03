// lib/trade-filters.ts is THE trade filter — one predicate behind both /trades
// and /analytics. These tests hold the three promises that make sharing it
// safe: an empty spec filters nothing, each dimension narrows what it says it
// narrows, and dimensions AND together.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import type { TradeInBaseCurrency } from "@/lib/data";
import type { OptionCatalog } from "@/lib/options";
import {
  applyTradeFilters,
  hasActiveFilters,
  parseTradeFilters,
  MISTAKE_ANY,
  MISTAKE_NONE,
} from "@/lib/trade-filters";

const labels: Record<string, string> = { FVG: "Fair value gap", CALM: "Calm", A_PLUS: "A+" };
const options = {
  label: (_g: string, v: string | null | undefined) => (v ? labels[v] ?? v : ""),
  labeler: () => (v: string) => labels[v] ?? v,
} as unknown as OptionCatalog;

function trade(over: Partial<TradeInBaseCurrency> = {}): TradeInBaseCurrency {
  return {
    id: "t1",
    createdAt: new Date("2026-08-27T02:05:00Z"),
    updatedAt: new Date("2026-08-27T02:05:00Z"),
    tradeDateTime: new Date("2026-08-27T02:05:00Z"),
    marketType: "CRYPTO_PERP",
    instrument: "BTC",
    direction: "LONG",
    status: "CLOSED",
    setupName: null,
    entryThesis: null,
    invalidation: null,
    concern: null,
    emotionalState: "CALM",
    riskPosture: null,
    confidenceScore: null,
    entryGrade: "NA",
    exitReason: null,
    followedPlan: null,
    lesson: null,
    notes: null,
    entryPrice: null,
    stopPrice: null,
    targetPrice: null,
    exitPrice: null,
    quantity: null,
    leverage: null,
    realizedPnl: null,
    fees: null,
    funding: null,
    netPnl: null,
    rMultiple: null,
    tags: [],
    mistakeTags: [],
    ...over,
  } as unknown as TradeInBaseCurrency;
}

const mistake = (id: string) => ({
  id: `link-${id}`,
  tradeId: "x",
  mistakeTagId: id,
  mistakeTag: { id, name: "CHASED_BREAKOUT", label: "Chased breakout", description: null },
});

const world = [
  trade({ id: "long-win", direction: "LONG", netPnl: 400 }),
  trade({ id: "short-loss", direction: "SHORT", netPnl: -150, emotionalState: "FOMO" }),
  trade({ id: "open", status: "OPEN", netPnl: null }),
  trade({ id: "graded", setupGrade: "A_PLUS", netPnl: 90, mistakeTags: [mistake("m1")] }),
  trade({ id: "archive", reconstructed: true, netPnl: 25 }),
  trade({ id: "old", tradeDateTime: new Date("2025-01-15T10:00:00Z"), netPnl: 10 }),
  trade({ id: "mech", mechanisms: ["FVG"], timeframes: ["15M"], netPnl: 5 }),
] as TradeInBaseCurrency[];

const run = (params: Record<string, string | undefined>) =>
  applyTradeFilters(world, parseTradeFilters(params), options, params).map((t) => t.id);

describe("applyTradeFilters", () => {
  it("an empty spec returns everything — a filter's neutral state is not 'nothing'", () => {
    assert.equal(run({}).length, world.length);
    assert.equal(hasActiveFilters(parseTradeFilters({})), false);
  });

  it("narrows by each dimension it claims to", () => {
    assert.deepEqual(run({ direction: "SHORT" }), ["short-loss"]);
    assert.deepEqual(run({ status: "OPEN" }), ["open"]);
    assert.deepEqual(run({ setupGrade: "A_PLUS" }), ["graded"]);
    assert.deepEqual(run({ emotionalState: "FOMO" }), ["short-loss"]);
    assert.deepEqual(run({ mechanism: "FVG" }), ["mech"]);
    assert.deepEqual(run({ timeframe: "15M" }), ["mech"]);
  });

  it("splits closed trades into winners and losers, and the two partition exactly", () => {
    const wins = run({ outcome: "wins" });
    const losses = run({ outcome: "losses" });
    assert.ok(wins.includes("long-win"));
    assert.deepEqual(losses, ["short-loss"]);
    // No trade is both, and an open trade is neither — "no result yet" is not
    // a loss, which is the whole reason this is not a P&L sign test.
    assert.equal(wins.filter((id) => losses.includes(id)).length, 0);
    assert.ok(!wins.includes("open") && !losses.includes("open"));
  });

  it("answers 'any mistake' and 'no mistake at all', not just a tag id", () => {
    assert.deepEqual(run({ mistakeTagId: MISTAKE_ANY }), ["graded"]);
    assert.ok(!run({ mistakeTagId: MISTAKE_NONE }).includes("graded"));
    assert.deepEqual(run({ mistakeTagId: "m1" }), ["graded"]);
    assert.deepEqual(run({ mistakeTagId: "nope" }), []);
  });

  it("separates journaled trades from the rebuilt archive", () => {
    assert.deepEqual(run({ journaled: "archive" }), ["archive"]);
    assert.ok(!run({ journaled: "journaled" }).includes("archive"));
  });

  it("includes a trade taken ON the 'to' date, not just before midnight of it", () => {
    // The classic off-by-one: a "to" of today must include today.
    assert.deepEqual(run({ from: "2025-01-15", to: "2025-01-15" }), ["old"]);
  });

  it("ANDs dimensions together rather than widening", () => {
    assert.deepEqual(run({ direction: "SHORT", outcome: "losses" }), ["short-loss"]);
    assert.deepEqual(run({ direction: "SHORT", outcome: "wins" }), []);
  });

  it("runs free text through the one search grammar, not a second matcher", () => {
    assert.equal(run({ q: "btc" }).length, world.length);
    assert.deepEqual(run({ q: "zzznothing" }), []);
  });

  it("treats a value no trade carries as matching nothing, not as 'ignore me'", () => {
    // Only reachable by hand-editing the URL. Silently ignoring it would show
    // the unfiltered page and read as if the filter had been applied.
    assert.deepEqual(run({ direction: "SIDEWAYS" }), []);
  });
});

describe("hasActiveFilters", () => {
  it("is true for a real filter and false for an empty query string", () => {
    assert.equal(hasActiveFilters(parseTradeFilters({ direction: "LONG" })), true);
    assert.equal(hasActiveFilters(parseTradeFilters({ q: "   " })), false);
  });
});

describe("the analytics page filters at exactly one boundary", () => {
  // The page's whole design is that every stat, table and chart is a pure
  // function of one array. If a helper is ever handed the UNFILTERED array,
  // that section silently ignores the trader's filters while the rest of the
  // page honours them — the worst possible failure here, because the page
  // still renders and the number just quietly lies.
  it("never passes the unfiltered array to a metric", () => {
    const source = readFileSync("app/analytics/page.tsx", "utf8");
    const offenders = [...source.matchAll(/(\w+)\(\s*allTrades\b/g)]
      .map((match) => match[1])
      .filter((fn) => fn !== "applyTradeFilters");
    assert.deepEqual(offenders, [], `these read the unfiltered trades: ${offenders.join(", ")}`);
  });

  it("uses allTrades only to fetch and to say how many were filtered out", () => {
    const source = readFileSync("app/analytics/page.tsx", "utf8");
    assert.ok(source.includes("applyTradeFilters(allTrades"), "the boundary must be the filter call itself");
    assert.ok(source.includes("allTrades.length"), "the page must still report the size of the whole journal");
  });
});
