// The /trades free-text box. Its whole promise is "type the one thing you
// remember" — a setup name, a mood, a mechanism, a mistake, a word from the
// thesis, a #tag — so these tests hold that each of those reaches a trade, and
// that the box shares the grammar (and the trade text) with global search
// rather than growing a second, quietly different one.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { filterTradesByQuery, tradeSearchDoc } from "@/lib/search";
import type { TradeInBaseCurrency } from "@/lib/data";
import type { OptionCatalog } from "@/lib/options";

// A catalog that labels a value by title-casing it — enough to prove the box
// searches the LABEL a trader sees ("Fair value gap"), not the stored value.
const labels: Record<string, string> = {
  FVG: "Fair value gap",
  ANXIOUS: "Anxious",
  M15: "15m",
  LOW_LIQUIDITY: "Low liquidity",
};
const options = {
  label: (_group: string, value: string | null | undefined) => (value ? labels[value] ?? value : ""),
  labeler: () => (value: string) => labels[value] ?? value,
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

const world = [
  trade({ id: "setup", instrument: "SOL", setupName: "London reversal" }),
  trade({ id: "mood", instrument: "ETH", emotionalState: "ANXIOUS" }),
  trade({ id: "mech", instrument: "XRP", mechanisms: ["FVG"], timeframes: ["M15"] }),
  trade({ id: "tagged", instrument: "DOGE", tags: ["fomo"] }),
  trade({ id: "tagged-longer", instrument: "ADA", tags: ["fomophobia"] }),
  trade({
    id: "words",
    instrument: "BNB",
    entryThesis: "swept the Asia low then reclaimed it",
    lesson: "wait for the retest",
  }),
  trade({
    id: "mistake",
    instrument: "LINK",
    mistakeTags: [
      {
        id: "l1",
        tradeId: "mistake",
        mistakeTagId: "m1",
        mistakeTag: { id: "m1", name: "CHASED_BREAKOUT", label: "Chased breakout", description: null },
      },
    ],
  }),
] as TradeInBaseCurrency[];

const ids = (query: string) => filterTradesByQuery(world, query, options).map((t) => t.id);

describe("filterTradesByQuery", () => {
  it("an empty query filters nothing — a filter's neutral state is everything", () => {
    assert.equal(filterTradesByQuery(world, "", options).length, world.length);
    assert.equal(filterTradesByQuery(world, "   ", options).length, world.length);
  });

  it("finds a trade by its setup name", () => {
    assert.deepEqual(ids("london"), ["setup"]);
  });

  it("finds a trade by mood, through the label the trader sees", () => {
    assert.deepEqual(ids("anxious"), ["mood"]);
  });

  it("finds a trade by mechanism and by timeframe label", () => {
    assert.deepEqual(ids("fair value"), ["mech"]);
    assert.deepEqual(ids("15m"), ["mech"]);
  });

  it("finds a trade by a mistake label", () => {
    assert.deepEqual(ids("chased"), ["mistake"]);
  });

  it("finds a trade by any word written on it, in any order", () => {
    assert.deepEqual(ids("reclaimed swept"), ["words"]);
    assert.deepEqual(ids("retest"), ["words"]);
  });

  it("finds a trade by symbol, direction and status — they are typeable words", () => {
    assert.deepEqual(ids("doge"), ["tagged"]);
    assert.equal(ids("long").length, world.length);
    assert.equal(ids("closed").length, world.length);
  });

  it("is case-insensitive", () => {
    assert.deepEqual(ids("LONDON ReVeRsAl"), ["setup"]);
  });

  it("matches a #tag by exact membership, never as a prefix", () => {
    // The same promise search makes: #fomo must not drag in #fomophobia.
    assert.deepEqual(ids("#fomo"), ["tagged"]);
  });

  it("mixes tags and words, AND-ing everything", () => {
    assert.deepEqual(ids("#fomo doge"), ["tagged"]);
    assert.deepEqual(ids("#fomo london"), []);
  });

  it("keeps the trade objects themselves, so the caller's own fields survive", () => {
    const [only] = filterTradesByQuery(world, "london", options);
    assert.equal(only.instrument, "SOL");
  });
});

describe("tradeSearchDoc", () => {
  it("is the one definition of a trade's searchable text — the search index uses it too", () => {
    const doc = tradeSearchDoc(world[0], options);
    assert.equal(doc.kind, "trade");
    assert.equal(doc.href, "/trades/setup");
    assert.ok(doc.fields.some((field) => field.label === "Setup" && field.text === "London reversal"));
  });

  it("drops empty fields rather than shipping blank labels into snippets", () => {
    assert.ok(!tradeSearchDoc(world[0], options).fields.some((field) => field.label === "Thesis"));
  });
});
