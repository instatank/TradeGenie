// The candle feed: symbol mapping, two wire formats, and the fill check the
// whole replay feature is gated on.
//
// Like the CoinDCX fixtures, the rows below stand in for a schema — Binance and
// Bybit both return positional arrays of strings with no field names to check
// against, so a test that drifted from the real shape would be testing nothing.
// The two providers are also NOT the same shape (Binance is a bare array oldest
// first; Bybit nests under result.list newest first), and that asymmetry is
// exactly the kind of thing that works in dev and silently draws a backwards
// chart in production.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PROVIDERS,
  checkFills,
  providerSymbol,
  sortCandles,
  summarizeFillChecks,
  type Candle,
} from "@/lib/candles";

const binance = PROVIDERS.find((provider) => provider.id === "binance")!;
const bybit = PROVIDERS.find((provider) => provider.id === "bybit")!;

// One 1m kline as Binance USD-M futures returns it: openTime in MILLISECONDS,
// every price a string, twelve positional columns of which we use six.
const BINANCE_ROW = [
  1735689600000, "104.80", "105.20", "104.55", "105.01", "1234.5",
  1735689659999, "129000.0", 450, "600.0", "62000.0", "0",
];

// The same minute as Bybit v5 returns it: nested, seven columns, strings all
// the way including the timestamp.
const BYBIT_BODY = {
  retCode: 0,
  result: {
    symbol: "SOLUSDT",
    category: "linear",
    list: [
      ["1735689660000", "105.01", "105.30", "104.90", "105.20", "800", "84000"],
      ["1735689600000", "104.80", "105.20", "104.55", "105.01", "1234.5", "129000"],
    ],
  },
};

describe("providerSymbol", () => {
  it("turns a journal symbol into the provider's perpetual", () => {
    assert.equal(providerSymbol("SOL"), "SOLUSDT");
    assert.equal(providerSymbol("BTC"), "BTCUSDT");
  });

  it("survives everything the quick log lets you type by hand", () => {
    // The symbol field is freehand (recent-symbol chips plus a text box), so
    // these all have to land on one lookup rather than four.
    for (const typed of ["sol", " SOL ", "SOL/USDT", "SOL-PERP", "B-SOL_USDT"]) {
      assert.equal(providerSymbol(typed), "SOLUSDT", `failed on ${typed}`);
    }
  });

  it("returns empty rather than a bogus symbol when there is nothing to map", () => {
    assert.equal(providerSymbol("   "), "");
  });
});

describe("binance parsing", () => {
  it("reads a real kline row and converts the timestamp to seconds", () => {
    const [candle] = binance.parse([BINANCE_ROW]);
    // Seconds, not milliseconds — lightweight-charts takes seconds, and getting
    // this wrong puts every candle in the year 56,000 with no visible error.
    assert.equal(candle.time, 1735689600);
    assert.deepEqual(
      { o: candle.open, h: candle.high, l: candle.low, c: candle.close },
      { o: 104.8, h: 105.2, l: 104.55, c: 105.01 },
    );
    assert.equal(candle.volume, 1234.5);
  });

  it("drops a malformed row instead of poisoning the chart with NaN", () => {
    const parsed = binance.parse([BINANCE_ROW, ["nonsense"], [1735689660000, "x", "y", "z", "w", "v"]]);
    assert.equal(parsed.length, 1);
    assert.ok(parsed.every((candle) => Number.isFinite(candle.close)));
  });

  it("returns nothing for a body that isn't an array (an error object, say)", () => {
    assert.deepEqual(binance.parse({ code: -1121, msg: "Invalid symbol." }), []);
  });
});

describe("bybit parsing", () => {
  it("reads its nested, all-string rows", () => {
    const parsed = bybit.parse(BYBIT_BODY);
    assert.equal(parsed.length, 2);
    assert.ok(parsed.every((candle) => Number.isFinite(candle.open)));
  });

  it("agrees with binance on the same minute", () => {
    // Both feeds describe one market. If the parsers disagree about the same
    // minute, one of them is reading the wrong column.
    const fromBinance = binance.parse([BINANCE_ROW])[0];
    const fromBybit = bybit.parse(BYBIT_BODY).find((candle) => candle.time === fromBinance.time)!;
    assert.deepEqual(
      { t: fromBybit.time, o: fromBybit.open, h: fromBybit.high, l: fromBybit.low, c: fromBybit.close },
      { t: fromBinance.time, o: fromBinance.open, h: fromBinance.high, l: fromBinance.low, c: fromBinance.close },
    );
  });

  it("maps every interval the journal offers, or says it cannot", () => {
    assert.equal(bybit.intervalFor("1m"), "1");
    assert.equal(bybit.intervalFor("4h"), "240");
    assert.equal(bybit.intervalFor("1d"), "D");
  });

  it("returns nothing for an error body rather than throwing", () => {
    assert.deepEqual(bybit.parse({ retCode: 10001, retMsg: "params error" }), []);
    assert.deepEqual(bybit.parse(null), []);
  });
});

describe("sortCandles", () => {
  it("puts a newest-first feed back in chart order", () => {
    // Bybit returns newest first. A chart fed in that order draws time
    // backwards, which looks like a plausible chart of a different market.
    const sorted = sortCandles(bybit.parse(BYBIT_BODY));
    assert.deepEqual(
      sorted.map((candle) => candle.time),
      [1735689600, 1735689660],
    );
  });

  it("drops the duplicate a page boundary produces", () => {
    const one = binance.parse([BINANCE_ROW]);
    assert.equal(sortCandles([...one, ...one]).length, 1);
  });
});

// --- the check the feature is gated on ------------------------------------

const CANDLES: Candle[] = [
  { time: 1735689600, open: 104.8, high: 105.2, low: 104.55, close: 105.01, volume: 1 },
  { time: 1735689660, open: 105.01, high: 105.3, low: 104.9, close: 105.2, volume: 1 },
];

const at = (seconds: number) => new Date(seconds * 1000);

describe("checkFills", () => {
  it("accepts a fill that sits inside its own minute's range", () => {
    // 30 seconds into the first candle, at a price within its high/low.
    const [check] = checkFills([{ timestamp: at(1735689630), price: 105.0, side: "BUY" }], CANDLES, "1m");
    assert.equal(check.inside, true);
    assert.equal(check.deviation, 0);
    assert.equal(check.candle?.time, 1735689600);
  });

  it("buckets a fill to the candle that contains it, not the nearest open", () => {
    // 59s in still belongs to the first candle; 60s in belongs to the second.
    assert.equal(
      checkFills([{ timestamp: at(1735689659), price: 105, side: "BUY" }], CANDLES, "1m")[0].candle?.time,
      1735689600,
    );
    assert.equal(
      checkFills([{ timestamp: at(1735689660), price: 105, side: "BUY" }], CANDLES, "1m")[0].candle?.time,
      1735689660,
    );
  });

  it("measures a miss as a fraction of the fill price, in both directions", () => {
    // This is the number that decides whether MAE/MFE can be computed from this
    // feed at all, so it has to be a proportion — "0.02% out" is a judgement a
    // trader can make; "0.021 out" is not.
    const above = checkFills([{ timestamp: at(1735689630), price: 105.3, side: "SELL" }], CANDLES, "1m")[0];
    assert.equal(above.inside, false);
    assert.ok(Math.abs((above.deviation ?? 0) - (105.3 - 105.2) / 105.3) < 1e-12);

    const below = checkFills([{ timestamp: at(1735689630), price: 104.35, side: "BUY" }], CANDLES, "1m")[0];
    assert.equal(below.inside, false);
    assert.ok(Math.abs((below.deviation ?? 0) - (104.55 - 104.35) / 104.35) < 1e-12);
  });

  it("reports a missing candle as unknown, never as a match", () => {
    // A gap in the feed must not read as agreement — that would be the one
    // failure mode that makes a bad feed look like a good one.
    const [check] = checkFills([{ timestamp: at(1735600000), price: 105, side: "BUY" }], CANDLES, "1m");
    assert.equal(check.candle, null);
    assert.equal(check.inside, false);
    assert.equal(check.deviation, null);
  });
});

describe("summarizeFillChecks", () => {
  it("counts only the fills it could actually compare", () => {
    const checks = checkFills(
      [
        { timestamp: at(1735689630), price: 105.0, side: "BUY" },
        { timestamp: at(1735600000), price: 105.0, side: "BUY" },
      ],
      CANDLES,
      "1m",
    );
    assert.match(summarizeFillChecks(checks), /1\/1 fills fell inside/);
  });

  it("says plainly when nothing could be compared", () => {
    const checks = checkFills([{ timestamp: at(1735600000), price: 105, side: "BUY" }], CANDLES, "1m");
    assert.match(summarizeFillChecks(checks), /No fills could be compared/);
  });

  it("leads with the worst miss when the books disagree", () => {
    const checks = checkFills([{ timestamp: at(1735689630), price: 106, side: "SELL" }], CANDLES, "1m");
    assert.match(summarizeFillChecks(checks), /Worst miss: 0\.755%/);
  });
});
