// What an archive trade must NOT do to the journal's own numbers.
//
// Logging a back catalogue adds dozens of closed trades with no plan, no grade
// and no invalidation. Every metric that reads a missing plan as a *neglected*
// one then quietly reports on trades taken before there was anything to
// neglect: eighty rows nagging "Review →" forever, and a process score
// averaging in a score for a process that was never recorded. Both are wrong in
// the same direction — they make the trader look worse at a discipline they had
// not started practising yet — and both are invisible unless pinned here.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { averageProcessScore, calculateRuleAdherenceRate, calculateWinRate, tradeNeedsReview, tradeProcessScore, type MetricTrade } from "@/lib/metrics";

function archived(overrides: Partial<MetricTrade> = {}): MetricTrade {
  return {
    tradeDateTime: new Date("2026-01-14T05:00:00Z"),
    status: "CLOSED",
    followedPlan: null,
    entryGrade: "NA",
    invalidation: null,
    netPnl: 12,
    reconstructed: true,
    ...overrides,
  };
}

describe("archive trades and the review nudge", () => {
  it("never nags a trade that was never journaled", () => {
    assert.equal(tradeNeedsReview(archived()), false);
  });

  it("still nags a closed trade you logged and left unreviewed", () => {
    // The regression that matters in the other direction: the flag must not
    // become a way for real trades to slip past the nudge.
    assert.equal(tradeNeedsReview(archived({ reconstructed: false })), true);
    assert.equal(tradeNeedsReview({ status: "CLOSED", followedPlan: "NA" }), true);
  });
});

describe("archive trades and the process score", () => {
  it("scores null, not zero", () => {
    assert.equal(tradeProcessScore(archived()), null);
  });

  it("does not drag the average down", () => {
    const real = archived({ reconstructed: false, followedPlan: "YES", invalidation: "below the low", entryGrade: "A" });
    const alone = averageProcessScore([real]);
    const withArchive = averageProcessScore([real, archived(), archived(), archived()]);
    assert.equal(alone, withArchive, "an archived trade must not move the process average");
    // And with nothing but archived trades there is simply no score to report,
    // rather than a confident 20/100.
    assert.equal(averageProcessScore([archived(), archived()]), null);
  });

  it("leaves plan adherence alone, as it already did", () => {
    // calculateRuleAdherenceRate already ignores an unanswered plan. Pinned so
    // a later "count NA as a miss" change cannot silently indict the archive.
    assert.equal(calculateRuleAdherenceRate([archived(), archived()]), null);
  });
});

describe("archive trades and the money", () => {
  it("count in P&L and win rate, which is the whole point of logging them", () => {
    const trades = [archived({ netPnl: 12 }), archived({ netPnl: -4 })];
    assert.equal(calculateWinRate(trades), 0.5);
  });
});
