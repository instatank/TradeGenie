// What the market did while you were in the trade.
//
// The dangerous output of this module is not a crash, it is a plausible number.
// An understated MAE says a stop was comfortable when it was nearly hit, and
// nothing about the value itself looks wrong. So most of what follows tests the
// refusals — the cases where the honest answer is "I can't tell you" — and the
// direction of the error where the maths has to round one way.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calculateExcursion, type ExcursionInput } from "@/lib/excursion";
import type { Candle } from "@/lib/candles";

const MINUTE = 60;
const T0 = 1_735_689_600; // a clean minute boundary

/** Candles at 1m from T0, given as [low, high] pairs — the only two values any
 *  of this maths reads. */
function series(bars: Array<[number, number]>): Candle[] {
  return bars.map(([low, high], index) => ({
    time: T0 + index * MINUTE,
    open: low,
    high,
    low,
    close: high,
    volume: 1,
  }));
}

const at = (minute: number) => new Date((T0 + minute * MINUTE) * 1000);

/** A long entered at 100 in the first candle and closed at 104 in the last. */
const LONG: ExcursionInput = {
  direction: "LONG",
  entryAt: at(0),
  entryPrice: 100,
  exitAt: at(4),
  exitPrice: 104,
  stopPrice: 96,
};

describe("calculateExcursion — the heat", () => {
  it("finds the worst and best price while the position was open", () => {
    const candles = series([
      [99, 101],
      [97, 100], // the low of the trade
      [98, 103],
      [99, 106], // the high of the trade
      [103, 105],
    ]);
    const result = calculateExcursion(LONG, candles, "1m");
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.mae.price, 97);
    assert.equal(result.mfe.price, 106);
    // Risk is |100 − 96| = 4, so 3 points of heat is 0.75R.
    assert.equal(result.mae.moveR, 0.75);
    assert.equal(result.mfe.moveR, 1.5);
    assert.equal(result.mae.at.getTime(), at(1).getTime());
  });

  it("says how far the heat got toward the stop — the point of the whole thing", () => {
    const candles = series([[99, 101], [96.4, 100], [99, 105], [103, 105], [103, 105]]);
    const result = calculateExcursion(LONG, candles, "1m");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    // 3.6 of a 4-point risk: 90% of the way to being stopped out.
    assert.ok(Math.abs((result.heatToStop ?? 0) - 0.9) < 1e-9);
  });

  it("mirrors everything for a short", () => {
    const short: ExcursionInput = {
      direction: "SHORT", entryAt: at(0), entryPrice: 100, exitAt: at(2), exitPrice: 97, stopPrice: 104,
    };
    const result = calculateExcursion(short, series([[99, 101], [95, 102], [96, 98]]), "1m");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    // Adverse for a short is UP: the 102 high. Favourable is the 95 low.
    assert.equal(result.mae.price, 102);
    assert.equal(result.mfe.price, 95);
  });

  it("never reports negative heat when the feed's low sits above your fill", () => {
    // NOT a hypothetical. The candles are a proxy for the venue that filled you
    // (lib/candles.ts), and the deeper book wicks less — so a fill can land just
    // outside its own candle. Here the entry is 100 and the feed's lowest low is
    // 100.5, which the naive `entry − low` reads as NEGATIVE heat: a "worst
    // case" that renders as a gain, on the one number that exists to warn you.
    const candles = series([[100.5, 102], [101, 104], [103, 105], [104, 106], [104, 106]]);
    const result = calculateExcursion(LONG, candles, "1m");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.heatToStop, 0, "heat must floor at zero, never go negative");
  });

  it("reports percentages when there is no stop, rather than refusing", () => {
    const noStop = { ...LONG, stopPrice: null };
    const result = calculateExcursion(noStop, series([[95, 101], [99, 104], [99, 104], [99, 104], [99, 104]]), "1m");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.mae.moveR, null);
    assert.equal(result.heatToStop, null);
    assert.ok(Math.abs(result.mae.movePct - 0.05) < 1e-9);
    assert.deepEqual(result.stopCheck, { kind: "NO_STOP" });
  });
});

describe("calculateExcursion — the refusals", () => {
  // These are the tests that matter most. A partial window produces a number
  // that looks exactly like a real one and understates the risk taken.
  it("refuses when the feed starts after the trade opened", () => {
    const late = series([[97, 101], [98, 103]]).map((candle) => ({ ...candle, time: candle.time + 2 * MINUTE }));
    const result = calculateExcursion(LONG, late, "1m");
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /starts after/);
  });

  it("refuses when the feed ends before the trade closed", () => {
    const result = calculateExcursion(LONG, series([[99, 101], [97, 100]]), "1m");
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /ends before/);
  });

  it("refuses with no candles at all, and with no usable entry price", () => {
    assert.equal(calculateExcursion(LONG, [], "1m").ok, false);
    assert.equal(calculateExcursion({ ...LONG, entryPrice: 0 }, series([[99, 101]]), "1m").ok, false);
  });

  it("includes the whole entry candle, erring wide rather than narrow", () => {
    // The entry candle's low is BELOW the entry, and part of that minute
    // happened before the fill. We cannot know which part, so it counts — the
    // error runs toward overstating heat, never understating it.
    const result = calculateExcursion(LONG, series([[90, 101], [99, 104], [99, 104], [99, 104], [99, 104]]), "1m");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.mae.price, 90);
  });
});

describe("calculateExcursion — the stop check", () => {
  it("says when price actually reached the stop", () => {
    const result = calculateExcursion(LONG, series([[99, 101], [95, 100], [99, 105], [103, 105], [103, 105]]), "1m");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.stopCheck.kind, "REACHED");
  });

  it("says when it never did — the case that reveals a stop that was moved", () => {
    // Closed at a loss, but this feed never printed a price at the stop. Either
    // the venue wicked where this book didn't, or the "stop" was a decision.
    const result = calculateExcursion(LONG, series([[97, 101], [96.5, 100], [99, 104], [99, 104], [99, 104]]), "1m");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.stopCheck.kind, "NOT_REACHED");
    if (result.stopCheck.kind !== "NOT_REACHED") return;
    // Came within 0.5 of a 96 stop.
    assert.ok(Math.abs(result.stopCheck.closestBy - 0.5 / 96) < 1e-9);
  });
});

describe("calculateExcursion — what happened after you left", () => {
  const withAftermath = [
    ...series([[99, 101], [98, 103], [99, 104], [103, 105], [103, 104]]),
    ...series([[104, 110], [106, 112], [100, 107]]).map((c) => ({ ...c, time: c.time + 5 * MINUTE })),
  ];

  it("measures how far it ran after the exit, in R", () => {
    const result = calculateExcursion(LONG, withAftermath, "1m");
    assert.equal(result.ok, true);
    if (!result.ok || !result.drift) return assert.fail("expected drift");
    // Exited at 104, ran to 112. Eight points on a 4-point risk = 2R left behind.
    assert.equal(result.drift.bestPrice, 112);
    assert.equal(result.drift.continuationR, 2);
  });

  it("reports the downside too, so the number takes no side", () => {
    const result = calculateExcursion(LONG, withAftermath, "1m");
    assert.equal(result.ok, true);
    if (!result.ok || !result.drift) return assert.fail("expected drift");
    assert.equal(result.drift.worstPrice, 100);
  });

  it("goes negative when it never went further your way — a good exit", () => {
    const rolledOver = [
      ...series([[99, 101], [98, 103], [99, 104], [103, 105], [103, 104]]),
      ...series([[95, 102], [90, 96]]).map((c) => ({ ...c, time: c.time + 5 * MINUTE })),
    ];
    const result = calculateExcursion(LONG, rolledOver, "1m");
    assert.equal(result.ok, true);
    if (!result.ok || !result.drift) return assert.fail("expected drift");
    // Best after exiting at 104 was 102 — it never traded higher again.
    assert.ok(result.drift.continuationPct < 0, "a good exit must not read as a gain left behind");
  });

  it("has no aftermath for a trade that is still open", () => {
    const open = { ...LONG, exitAt: null, exitPrice: null };
    const result = calculateExcursion(open, series([[99, 101], [97, 100], [99, 106]]), "1m");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.drift, null);
    // Still measures the heat so far, which is the whole point on a live trade.
    assert.equal(result.mae.price, 97);
  });
});
