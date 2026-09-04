// The setup grade — the trader's read on the OPPORTUNITY, as opposed to
// entryGrade, which is a mark on how they took it. These tests hold the two
// promises that make the field worth storing: the grades stay separate values
// (so a filter and an analytics row mean one thing), and the table reads in
// grade order rather than in order of how often each grade was taken.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calculateProfitFactor,
  isBucketSort,
  setupGradePerformance,
  sortBuckets,
  type BucketStats,
  type MetricTrade,
} from "@/lib/metrics";
import { optionGroups } from "@/lib/options";

const order = optionGroups.setupGrade.builtin.map((choice) => choice.value);
const labels = Object.fromEntries(optionGroups.setupGrade.builtin.map((choice) => [choice.value, choice.label]));
const labelFor = (value: string) => labels[value] ?? value;

function trade(over: Partial<MetricTrade> = {}): MetricTrade {
  return {
    tradeDateTime: new Date("2026-08-27T02:05:00Z"),
    status: "CLOSED",
    direction: "LONG",
    entryPrice: 100,
    stopPrice: 99,
    exitPrice: 102,
    netPnl: 100,
    rMultiple: 2,
    ...over,
  };
}

describe("setupGradePerformance", () => {
  it("groups closed trades by grade and keeps the vocabulary's order, not the volume order", () => {
    const rows = setupGradePerformance(
      [
        trade({ setupGrade: "B" }),
        trade({ setupGrade: "B" }),
        trade({ setupGrade: "B" }),
        trade({ setupGrade: "A_PLUS" }),
        trade({ setupGrade: "A" }),
      ],
      labelFor,
      order,
    );
    assert.deepEqual(rows.map((row) => row.key), ["A_PLUS", "A", "B"]);
    assert.deepEqual(rows.map((row) => row.label), ["A+", "A", "B"]);
    assert.deepEqual(rows.map((row) => row.count), [1, 1, 3]);
  });

  it("leaves ungraded trades out — 'ungraded' is not a grade", () => {
    // Otherwise the biggest row on the table would be the trades nobody graded,
    // for months, and it would say nothing about any setup.
    const rows = setupGradePerformance([trade({ setupGrade: "A" }), trade(), trade({ setupGrade: null })], labelFor, order);
    assert.deepEqual(rows.map((row) => row.key), ["A"]);
    assert.equal(rows[0].count, 1);
  });

  it("counts closed trades only, and sums to the trade count (unlike the multi-value tables)", () => {
    const rows = setupGradePerformance(
      [trade({ setupGrade: "A" }), trade({ setupGrade: "A", status: "OPEN" }), trade({ setupGrade: "B" })],
      labelFor,
      order,
    );
    assert.equal(rows.reduce((sum, row) => sum + row.count, 0), 2);
  });

  it("puts a grade the trader invented after the built-ins rather than dropping it", () => {
    const rows = setupGradePerformance(
      [trade({ setupGrade: "A_MINUS" }), trade({ setupGrade: "A_PLUS" })],
      (value) => labels[value] ?? value,
      order,
    );
    assert.deepEqual(rows.map((row) => row.key), ["A_PLUS", "A_MINUS"]);
  });
});

// Sorting the analytics tables. Direction is the part worth pinning: the
// comparator is written descending, so "asc" is what flips it — getting that
// backwards silently puts your worst bucket at the top of a "best first" sort,
// which is exactly the bug this caught in review.
describe("sortBuckets", () => {
  const row = (label: string, netPnl: number, count: number, winRate: number | null): BucketStats => ({
    key: label,
    label,
    count,
    winRate,
    netPnl,
    expectancyR: netPnl / 100,
    avgProcessScore: null,
  });
  const rows = [row("Alpha", -50, 3, 0.2), row("Beta", 400, 10, 0.8), row("Gamma", 120, 5, null)];

  it("puts the best bucket first when descending, and the worst first when ascending", () => {
    assert.deepEqual(sortBuckets(rows, "netPnl", "desc").map((r) => r.netPnl), [400, 120, -50]);
    assert.deepEqual(sortBuckets(rows, "netPnl", "asc").map((r) => r.netPnl), [-50, 120, 400]);
  });

  it("sinks rows with no number to the bottom in both directions", () => {
    // "No win rate" is not a win rate of zero. Sorting it as one would put the
    // emptiest rows at the top of an ascending sort and read as the worst.
    assert.equal(sortBuckets(rows, "winRate", "desc").at(-1)?.label, "Gamma");
    assert.equal(sortBuckets(rows, "winRate", "asc").at(-1)?.label, "Gamma");
  });

  it("sorts names alphabetically and leaves the natural order untouched", () => {
    assert.deepEqual(sortBuckets(rows, "label", "asc").map((r) => r.label), ["Alpha", "Beta", "Gamma"]);
    assert.deepEqual(sortBuckets(rows, "natural", "desc").map((r) => r.label), ["Alpha", "Beta", "Gamma"]);
  });

  it("does not mutate the rows it was given", () => {
    const before = rows.map((r) => r.label);
    sortBuckets(rows, "netPnl", "asc");
    assert.deepEqual(rows.map((r) => r.label), before);
  });

  it("only accepts sorts it knows", () => {
    assert.equal(isBucketSort("netPnl"), true);
    assert.equal(isBucketSort("nonsense"), false);
    assert.equal(isBucketSort(undefined), false);
  });
});

describe("calculateProfitFactor", () => {
  const t = (netPnl: number): MetricTrade =>
    ({ tradeDateTime: new Date(), status: "CLOSED", netPnl }) as MetricTrade;

  it("divides gross wins by gross losses", () => {
    assert.equal(calculateProfitFactor([t(300), t(100), t(-200)]), 2);
  });

  it("returns null when there are no losses, rather than the gains total", () => {
    // The bug this pins: it used to return `gains`, so a clean week rendered
    // "Profit factor 918" — a rupee amount in a ratio's slot.
    assert.equal(calculateProfitFactor([t(300), t(618)]), null);
  });

  it("returns null with nothing to measure", () => {
    assert.equal(calculateProfitFactor([]), null);
  });
});
