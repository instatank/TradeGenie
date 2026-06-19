import { describe, expect, it } from "vitest";
import {
  analyticsLeaks,
  averageExitEfficiency,
  averageProcessScore,
  calculateExpectancy,
  calculateExpectancyR,
  calculateNetPnl,
  calculateProfitFactor,
  calculateRMultiple,
  calculateRuleAdherenceRate,
  calculateTotalR,
  calculateWinRate,
  exitEfficiency,
  expectancyBreakdown,
  fundingSummary,
  getTradePnl,
  type MetricTrade,
  sessionForDate,
  summarizeWeeklyStats,
  tradeProcessScore,
} from "@/lib/metrics";

// Minimal trade factory — only the fields a given test cares about, the rest
// default to a closed long so metrics that filter on status/direction work.
function trade(overrides: Partial<MetricTrade> = {}): MetricTrade {
  return {
    tradeDateTime: new Date("2026-06-15T12:00:00Z"),
    status: "CLOSED",
    direction: "LONG",
    ...overrides,
  };
}

describe("calculateNetPnl", () => {
  it("returns null when nothing is provided", () => {
    expect(calculateNetPnl(null, null, null)).toBeNull();
    expect(calculateNetPnl(undefined, undefined, undefined)).toBeNull();
  });

  it("subtracts fees and adds funding", () => {
    expect(calculateNetPnl(100, 5, 2)).toBe(97); // 100 - 5 + 2
  });

  it("treats missing components as zero once any value is present", () => {
    expect(calculateNetPnl(100, null, null)).toBe(100);
    expect(calculateNetPnl(null, 5, null)).toBe(-5);
    expect(calculateNetPnl(null, null, 3)).toBe(3);
  });
});

describe("calculateRMultiple", () => {
  it("computes a winning long", () => {
    // risk = |100-90| = 10, reward = 120-100 = 20 -> 2R
    expect(calculateRMultiple({ entryPrice: 100, stopPrice: 90, exitPrice: 120, direction: "LONG" })).toBe(2);
  });

  it("computes a losing long", () => {
    // risk = 10, reward = 95-100 = -5 -> -0.5R
    expect(calculateRMultiple({ entryPrice: 100, stopPrice: 90, exitPrice: 95, direction: "LONG" })).toBe(-0.5);
  });

  it("computes a winning short", () => {
    // risk = |100-110| = 10, reward = 100-80 = 20 -> 2R
    expect(calculateRMultiple({ entryPrice: 100, stopPrice: 110, exitPrice: 80, direction: "SHORT" })).toBe(2);
  });

  it("computes a losing short", () => {
    // risk = 10, reward = 100-105 = -5 -> -0.5R
    expect(calculateRMultiple({ entryPrice: 100, stopPrice: 110, exitPrice: 105, direction: "SHORT" })).toBe(-0.5);
  });

  it("returns null when stop equals entry (zero risk)", () => {
    expect(calculateRMultiple({ entryPrice: 100, stopPrice: 100, exitPrice: 120, direction: "LONG" })).toBeNull();
  });

  it("returns null for UNKNOWN or missing direction", () => {
    expect(calculateRMultiple({ entryPrice: 100, stopPrice: 90, exitPrice: 120, direction: "UNKNOWN" })).toBeNull();
    expect(calculateRMultiple({ entryPrice: 100, stopPrice: 90, exitPrice: 120, direction: null })).toBeNull();
  });

  it("returns null when any price is missing", () => {
    expect(calculateRMultiple({ entryPrice: 100, stopPrice: null, exitPrice: 120, direction: "LONG" })).toBeNull();
    expect(calculateRMultiple({ entryPrice: null, stopPrice: 90, exitPrice: 120, direction: "LONG" })).toBeNull();
    expect(calculateRMultiple({ entryPrice: 100, stopPrice: 90, exitPrice: null, direction: "LONG" })).toBeNull();
  });
});

describe("getTradePnl", () => {
  it("prefers the stored netPnl", () => {
    expect(getTradePnl(trade({ netPnl: 42, realizedPnl: 999 }))).toBe(42);
  });

  it("falls back to computing from realized/fees/funding", () => {
    expect(getTradePnl(trade({ netPnl: null, realizedPnl: 100, fees: 10, funding: 5 }))).toBe(95);
  });

  it("returns null when there is nothing to compute", () => {
    expect(getTradePnl(trade({ netPnl: null, realizedPnl: null, fees: null, funding: null }))).toBeNull();
  });
});

describe("calculateWinRate", () => {
  it("returns null with no closed trades that have P&L", () => {
    expect(calculateWinRate([])).toBeNull();
    expect(calculateWinRate([trade({ status: "OPEN", netPnl: 100 })])).toBeNull();
    expect(calculateWinRate([trade({ netPnl: null })])).toBeNull();
  });

  it("counts only positive-P&L closed trades as wins", () => {
    const trades = [
      trade({ netPnl: 10 }),
      trade({ netPnl: -5 }),
      trade({ netPnl: 20 }),
      trade({ netPnl: 0 }), // breakeven is NOT a win
    ];
    expect(calculateWinRate(trades)).toBe(0.5); // 2 of 4
  });
});

describe("calculateProfitFactor", () => {
  it("returns gains/losses", () => {
    const trades = [trade({ netPnl: 30 }), trade({ netPnl: 10 }), trade({ netPnl: -20 })];
    expect(calculateProfitFactor(trades)).toBe(2); // 40 / 20
  });

  it("returns gross gains when there are no losses", () => {
    expect(calculateProfitFactor([trade({ netPnl: 30 }), trade({ netPnl: 10 })])).toBe(40);
  });

  it("returns null when there is no P&L at all", () => {
    expect(calculateProfitFactor([trade({ netPnl: null, realizedPnl: null })])).toBeNull();
  });
});

describe("calculateExpectancy / calculateTotalR / calculateExpectancyR", () => {
  it("averages P&L per trade", () => {
    expect(calculateExpectancy([trade({ netPnl: 30 }), trade({ netPnl: -10 })])).toBe(10);
  });

  it("sums and averages R-multiples, ignoring nulls", () => {
    const trades = [trade({ rMultiple: 2 }), trade({ rMultiple: -1 }), trade({ rMultiple: null })];
    expect(calculateTotalR(trades)).toBe(1);
    expect(calculateExpectancyR(trades)).toBe(0.5); // (2 + -1) / 2
  });

  it("returns null when no values exist", () => {
    expect(calculateExpectancy([trade({ netPnl: null, realizedPnl: null })])).toBeNull();
    expect(calculateTotalR([trade({ rMultiple: null })])).toBeNull();
  });
});

describe("calculateRuleAdherenceRate", () => {
  it("scores YES=1, PARTIAL=0.5, NO=0 and ignores NA/null", () => {
    const trades = [
      trade({ followedPlan: "YES" }),
      trade({ followedPlan: "PARTIAL" }),
      trade({ followedPlan: "NO" }),
      trade({ followedPlan: "NA" }),
      trade({ followedPlan: null }),
    ];
    // (1 + 0.5 + 0) / 3 reviewed = 0.5
    expect(calculateRuleAdherenceRate(trades)).toBe(0.5);
  });

  it("returns null when nothing is reviewed", () => {
    expect(calculateRuleAdherenceRate([trade({ followedPlan: "NA" })])).toBeNull();
  });
});

describe("tradeProcessScore", () => {
  it("returns null for an un-reviewed open trade", () => {
    expect(tradeProcessScore(trade({ status: "OPEN", followedPlan: null }))).toBeNull();
  });

  it("awards the full 100 for a clean A-grade trade", () => {
    const score = tradeProcessScore(
      trade({ followedPlan: "YES", invalidation: "below 90", mistakeTags: [], entryGrade: "A" }),
    );
    expect(score).toBe(100); // 40 + 20 + 20 + 20
  });

  it("lets a losing A-grade trade outscore a winning trade full of mistakes", () => {
    const goodProcessLoss = tradeProcessScore(
      trade({ netPnl: -50, followedPlan: "YES", invalidation: "x", mistakeTags: [], entryGrade: "A" }),
    );
    const badProcessWin = tradeProcessScore(
      trade({
        netPnl: 500,
        followedPlan: "NO",
        invalidation: null,
        entryGrade: "C",
        mistakeTags: [{ mistakeTag: { name: "FOMO_ENTRY", label: "FOMO entry" } }],
      }),
    );
    expect(goodProcessLoss).toBeGreaterThan(badProcessWin ?? 0);
  });

  it("penalises a trade that has mistakes tagged", () => {
    const withMistake = tradeProcessScore(
      trade({ followedPlan: "YES", invalidation: "x", entryGrade: "A", mistakeTags: [{ mistakeTag: { name: "OVERSIZED", label: "Oversized" } }] }),
    );
    expect(withMistake).toBe(80); // loses the 20 for clean (no mistakes)
  });
});

describe("averageProcessScore", () => {
  it("averages only scorable trades", () => {
    const trades = [
      trade({ followedPlan: "YES", invalidation: "x", mistakeTags: [], entryGrade: "A" }), // 100
      trade({ status: "OPEN", followedPlan: null }), // null -> ignored
      trade({ followedPlan: "NO", invalidation: null, entryGrade: "NA", mistakeTags: [{ mistakeTag: { name: "X", label: "X" } }] }), // 0
    ];
    expect(averageProcessScore(trades)).toBe(50);
  });
});

describe("exitEfficiency", () => {
  it("measures captured / favorable for a long", () => {
    // favorable = mfe - entry = 120-100 = 20, captured = exit - entry = 110-100 = 10 -> 0.5
    expect(exitEfficiency(trade({ entryPrice: 100, exitPrice: 110, mfePrice: 120, direction: "LONG" }))).toBe(0.5);
  });

  it("measures captured / favorable for a short", () => {
    // favorable = entry - mfe = 100-80 = 20, captured = entry - exit = 100-90 = 10 -> 0.5
    expect(exitEfficiency(trade({ entryPrice: 100, exitPrice: 90, mfePrice: 80, direction: "SHORT" }))).toBe(0.5);
  });

  it("returns null when there was no favorable excursion", () => {
    expect(exitEfficiency(trade({ entryPrice: 100, exitPrice: 95, mfePrice: 100, direction: "LONG" }))).toBeNull();
  });

  it("returns null when data is missing", () => {
    expect(exitEfficiency(trade({ entryPrice: 100, exitPrice: 110, mfePrice: null, direction: "LONG" }))).toBeNull();
    expect(averageExitEfficiency([trade({ mfePrice: null })])).toBeNull();
  });
});

describe("sessionForDate (UTC buckets)", () => {
  it("buckets on the documented boundaries", () => {
    expect(sessionForDate(new Date("2026-06-15T07:59:00Z"))).toBe("ASIA");
    expect(sessionForDate(new Date("2026-06-15T08:00:00Z"))).toBe("EU");
    expect(sessionForDate(new Date("2026-06-15T12:59:00Z"))).toBe("EU");
    expect(sessionForDate(new Date("2026-06-15T13:00:00Z"))).toBe("US");
    expect(sessionForDate(new Date("2026-06-15T20:59:00Z"))).toBe("US");
    expect(sessionForDate(new Date("2026-06-15T21:00:00Z"))).toBe("LATE");
    expect(sessionForDate(new Date("2026-06-15T23:59:00Z"))).toBe("LATE");
  });
});

describe("fundingSummary", () => {
  it("sums funding, tallies funding paid, and computes drag vs gross profit", () => {
    const trades = [
      trade({ realizedPnl: 100, funding: -10 }), // paid 10 funding, gross +100
      trade({ realizedPnl: -50, funding: 5 }), // received funding, no gross profit
    ];
    const summary = fundingSummary(trades);
    expect(summary.totalFunding).toBe(-5); // -10 + 5
    expect(summary.fundingPaid).toBe(10);
    expect(summary.grossProfit).toBe(100);
    expect(summary.dragPct).toBe(0.1); // 10 / 100
  });

  it("returns null drag when there is no gross profit to bleed", () => {
    expect(fundingSummary([trade({ realizedPnl: -50, funding: -10 })]).dragPct).toBeNull();
  });
});

describe("expectancyBreakdown", () => {
  it("splits wins/losses and reports sample size", () => {
    const trades = [trade({ netPnl: 30, rMultiple: 2 }), trade({ netPnl: -10, rMultiple: -1 }), trade({ netPnl: 20, rMultiple: 1 })];
    const b = expectancyBreakdown(trades);
    expect(b.sampleSize).toBe(3);
    expect(b.winRate).toBeCloseTo(2 / 3);
    expect(b.avgWin).toBe(25); // (30 + 20) / 2
    expect(b.avgLoss).toBe(10); // |−10|
    expect(b.expectancyCurrency).toBeCloseTo(40 / 3);
    expect(b.expectancyR).toBeCloseTo(2 / 3);
  });
});

describe("summarizeWeeklyStats", () => {
  it("aggregates only closed trades in the week", () => {
    const weekStart = new Date("2026-06-15T00:00:00Z");
    const weekEnd = new Date("2026-06-21T23:59:59Z");
    const trades = [
      trade({ netPnl: 100, rMultiple: 2, followedPlan: "YES", emotionalState: "CALM" }),
      trade({ netPnl: -40, rMultiple: -1, followedPlan: "NO", emotionalState: "TILTED", mistakeTags: [{ mistakeTag: { name: "FOMO_ENTRY", label: "FOMO entry" } }] }),
      trade({ status: "OPEN", netPnl: 999 }), // excluded
    ];
    const stats = summarizeWeeklyStats(trades, weekStart, weekEnd);
    expect(stats.totalTrades).toBe(2);
    expect(stats.totalPnl).toBe(60);
    expect(stats.totalR).toBe(1);
    expect(stats.winRate).toBe(0.5);
    expect(stats.mostCommonMistake).toBe("FOMO entry");
  });
});

describe("analyticsLeaks (plain-language coaching)", () => {
  it("flags a high-severity repeated mistake", () => {
    const fomo = { mistakeTag: { name: "FOMO_ENTRY", label: "FOMO entry" } };
    const trades = [
      trade({ netPnl: -10, mistakeTags: [fomo] }),
      trade({ netPnl: -10, mistakeTags: [fomo] }),
      trade({ netPnl: -10, mistakeTags: [fomo] }),
      trade({ netPnl: 10, mistakeTags: [] }),
    ];
    const leaks = analyticsLeaks(trades, [], []);
    const mistakeLeak = leaks.find((l) => l.title.includes("FOMO entry"));
    expect(mistakeLeak?.severity).toBe("high"); // 3 of 4 = 75% >= 40% threshold
  });

  it("flags high funding drag above 15%", () => {
    const trades = [trade({ realizedPnl: 100, funding: -20 })]; // 20% drag
    const leaks = analyticsLeaks(trades, [], []);
    expect(leaks.some((l) => l.title.toLowerCase().includes("funding") && l.severity === "high")).toBe(true);
  });

  it("returns the reassuring empty state when nothing is wrong", () => {
    const leaks = analyticsLeaks([trade({ netPnl: 50, followedPlan: "YES", invalidation: "x", entryGrade: "A", mistakeTags: [] })], [], []);
    expect(leaks).toHaveLength(1);
    expect(leaks[0].severity).toBe("good");
  });

  it("never returns more than 4 leaks", () => {
    const bad = { mistakeTag: { name: "FOMO_ENTRY", label: "FOMO entry" } };
    const trades = Array.from({ length: 5 }, () =>
      trade({ netPnl: -10, realizedPnl: 10, funding: -50, followedPlan: "NO", entryGrade: "C", mistakeTags: [bad] }),
    );
    const setups = [{ key: "s", label: "Bad setup", count: 5, winRate: 0, netPnl: -100, expectancyR: -1, avgProcessScore: 10 }];
    const conditions = [{ key: "c", label: "Chop", count: 5, winRate: 0, netPnl: -100, expectancyR: -1, avgProcessScore: 10 }];
    expect(analyticsLeaks(trades, setups, conditions).length).toBeLessThanOrEqual(4);
  });
});
