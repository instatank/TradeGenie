// Folding fills into chart marks, and choosing how fine a chart to draw.
//
// The aggregation exists because of a real position the probe surfaced: 23
// fills, 22 of them the same second, same side, same price. That is one exit
// order filling against 22 counterparties, and drawing it as 22 arrows on one
// candle reads as a bug rather than as a big exit.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { aggregateFills, chooseInterval } from "@/lib/trade-replay";
import { visibleRange } from "@/components/TradeReplayChart";

const T0 = 1_735_689_600_000;
const at = (seconds: number) => new Date(T0 + seconds * 1000);

describe("aggregateFills", () => {
  it("folds one order's many legs into a single mark", () => {
    // The shape of the real HYPE position: 22 identical sells in one second.
    const legs = Array.from({ length: 22 }, () => ({
      timestamp: at(30),
      price: 87.6,
      quantity: 1,
      side: "SELL" as const,
    }));

    const [marker, ...rest] = aggregateFills(legs, "1m");
    assert.equal(rest.length, 0, "22 legs of one order must be one mark");
    assert.equal(marker.legs, 22);
    assert.equal(marker.quantity, 22);
    assert.equal(marker.price, 87.6);
  });

  it("volume-weights the price, so a big leg counts for more than a dust one", () => {
    const [marker] = aggregateFills(
      [
        { timestamp: at(10), price: 100, quantity: 9, side: "BUY" },
        { timestamp: at(20), price: 110, quantity: 1, side: "BUY" },
      ],
      "1m",
    );
    // (100·9 + 110·1) / 10 = 101, not the 105 a plain average would give.
    assert.equal(marker.price, 101);
    assert.equal(marker.quantity, 10);
  });

  it("keeps buys and sells apart inside the same minute", () => {
    // A flip inside one candle is two different events, and merging them would
    // invent a mark at a price neither side traded at.
    const markers = aggregateFills(
      [
        { timestamp: at(5), price: 100, quantity: 1, side: "BUY" },
        { timestamp: at(50), price: 102, quantity: 1, side: "SELL" },
      ],
      "1m",
    );
    assert.equal(markers.length, 2);
    assert.deepEqual(markers.map((marker) => marker.side).sort(), ["BUY", "SELL"]);
  });

  it("separates legs that fall in different candles", () => {
    const markers = aggregateFills(
      [
        { timestamp: at(30), price: 100, quantity: 1, side: "BUY" },
        { timestamp: at(90), price: 101, quantity: 1, side: "BUY" },
      ],
      "1m",
    );
    assert.equal(markers.length, 2);
  });

  it("merges those same legs when the chart is coarser", () => {
    // The bucket follows the interval being drawn, so a 5m chart of the same
    // two fills shows one mark. Bucketing at a fixed 1m would leave marks
    // between candles on every coarser chart.
    const markers = aggregateFills(
      [
        { timestamp: at(30), price: 100, quantity: 1, side: "BUY" },
        { timestamp: at(90), price: 102, quantity: 1, side: "BUY" },
      ],
      "5m",
    );
    assert.equal(markers.length, 1);
    assert.equal(markers[0].legs, 2);
    assert.equal(markers[0].price, 101);
  });

  it("survives zero-quantity legs rather than rendering NaN", () => {
    const [marker] = aggregateFills(
      [
        { timestamp: at(10), price: 100, quantity: 0, side: "BUY" },
        { timestamp: at(20), price: 104, quantity: 0, side: "BUY" },
      ],
      "1m",
    );
    assert.ok(Number.isFinite(marker.price), "a divide-by-zero would put NaN on the chart");
  });

  it("returns marks in time order", () => {
    const markers = aggregateFills(
      [
        { timestamp: at(300), price: 103, quantity: 1, side: "SELL" },
        { timestamp: at(10), price: 100, quantity: 1, side: "BUY" },
      ],
      "1m",
    );
    assert.deepEqual(markers.map((marker) => marker.side), ["BUY", "SELL"]);
  });
});

describe("chooseInterval", () => {
  const minutes = (n: number) => n * 60_000;
  const hours = (n: number) => n * 3_600_000;

  it("draws a short trade on 1m bars", () => {
    assert.equal(chooseInterval(minutes(45)), "1m");
    assert.equal(chooseInterval(hours(6)), "1m");
  });

  it("steps up rather than fetching thousands of bars for a long hold", () => {
    // Four days at 1m would be 5,760 candles — six pages of fetching to draw a
    // smear. The same window at 15m is readable and one request.
    assert.equal(chooseInterval(hours(24)), "5m");
    assert.equal(chooseInterval(hours(24 * 4)), "15m");
  });

  it("never returns an interval that would blow the fetch budget", () => {
    for (const windowMs of [minutes(5), hours(1), hours(12), hours(24 * 30), hours(24 * 400)]) {
      const interval = chooseInterval(windowMs);
      const bars = windowMs / { "1m": 60_000, "5m": 300_000, "15m": 900_000, "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000 }[interval];
      assert.ok(bars <= 700 || interval === "1d", `${windowMs}ms chose ${interval} → ${bars} bars`);
    }
  });
});

// --- the chart's viewport --------------------------------------------------

describe("visibleRange", () => {
  it("keeps a constant window width even at the very start", () => {
    // The bug this pins: clamping `from` at 0 collapses the window to whatever
    // is behind the cursor, and since playback starts ~15 bars in, the chart
    // opened showing 17 enormous candles instead of 93. Found by measuring the
    // rendered chart in a browser, not by reading the code.
    const early = visibleRange(14, 405);
    const later = visibleRange(300, 405);
    assert.equal(early.to - early.from, later.to - later.from, "the window must not narrow near the start");
    assert.ok(early.from < 0, "a negative logical index is legal and is what keeps the width constant");
  });

  it("never runs past the end of the data", () => {
    assert.equal(visibleRange(999, 405).to, 404 + 3);
  });

  it("stays valid for a chart with almost no candles", () => {
    const range = visibleRange(0, 2);
    assert.ok(range.to >= 1 && range.to > range.from);
  });
});
