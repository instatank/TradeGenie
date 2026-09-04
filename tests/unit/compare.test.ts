// Comparing two slices of the journal. The maths is deliberately borrowed from
// the analytics tables (bucketStatsFor), so what these tests actually guard is
// the honesty layer: which comparison is the fair one, and whether the page
// admits when it isn't.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyticsViewQuery, buildComparison, parseComparison, COMPARE_ALL, COMPARE_REST } from "@/lib/compare";
import type { MetricTrade } from "@/lib/metrics";
import type { SavedView } from "@/lib/types";

const trade = (id: string, netPnl: number | null, over: Partial<MetricTrade> = {}): MetricTrade =>
  ({
    id,
    tradeDateTime: new Date("2026-08-27T02:00:00Z"),
    status: "CLOSED",
    direction: "LONG",
    netPnl,
    entryPrice: 100,
    stopPrice: 99,
    exitPrice: netPnl != null && netPnl >= 0 ? 102 : 98,
    rMultiple: netPnl != null && netPnl >= 0 ? 2 : -1,
    ...over,
  }) as MetricTrade;

const view = (name: string, path: string): SavedView =>
  ({ id: name, createdAt: new Date(), updatedAt: new Date(), name, path });

describe("parseComparison", () => {
  const views = [view("FVG longs", "/analytics?mechanism=FVG"), view("List view", "/trades?direction=LONG")];

  it("reads the two built-in targets", () => {
    assert.deepEqual(parseComparison(COMPARE_REST, views), { kind: "rest" });
    assert.deepEqual(parseComparison(COMPARE_ALL, views), { kind: "all" });
  });

  it("is off unless asked for", () => {
    assert.equal(parseComparison(undefined, views), null);
    assert.equal(parseComparison("  ", views), null);
  });

  it("names a target that matches a saved view, and still works for one that doesn't", () => {
    // Matching on the QUERY, not the name, is what keeps a comparison URL
    // working after the view behind it is renamed.
    assert.deepEqual(parseComparison("mechanism=FVG", views), {
      kind: "filter",
      query: "mechanism=FVG",
      label: "FVG longs",
    });
    const unnamed = parseComparison("direction=SHORT", views);
    assert.equal(unnamed?.kind === "filter" ? unnamed.label : null, "Comparison filter");
  });

  it("ignores saved views belonging to another page", () => {
    // /trades views filter a list; half their params (view, page, sort) mean
    // something different here, so offering them would compare the wrong thing.
    assert.equal(analyticsViewQuery(views[0]), "mechanism=FVG");
    assert.equal(analyticsViewQuery(views[1]), null);
  });
});

describe("buildComparison", () => {
  const a = [trade("a1", 300), trade("a2", 200), trade("a3", -100), trade("a4", 100), trade("a5", 100)];
  const b = [trade("b1", 50), trade("b2", -50), trade("b3", 10), trade("b4", 20), trade("b5", 30)];

  it("reports both sides plus the difference, per metric", () => {
    const result = buildComparison(a, b, { a: "Filtered", b: "Everything else" });
    const byLabel = Object.fromEntries(result.metrics.map((metric) => [metric.label, metric]));
    assert.equal(byLabel["Closed trades"].a, 5);
    assert.equal(byLabel["Net P&L"].a, 600);
    assert.equal(byLabel["Net P&L"].b, 60);
    assert.equal(byLabel["Win rate"].a, 4 / 5);
  });

  it("marks trade count as having no better direction", () => {
    // More trades is neither good nor bad; colouring it green would say it was.
    const result = buildComparison(a, b, { a: "A", b: "B" });
    assert.equal(result.metrics.find((metric) => metric.label === "Closed trades")?.higherIsBetter, null);
  });

  it("counts the overlap when one side contains the other", () => {
    // The trap this exists to catch: comparing a slice against the whole
    // journal compares it against a set that already includes it.
    const whole = [...a, ...b];
    const contained = buildComparison(a, whole, { a: "Filtered", b: "All trades" });
    assert.equal(contained.overlap, 5, "every trade in A is also in B");

    const complement = buildComparison(a, b, { a: "Filtered", b: "Everything else" });
    assert.equal(complement.overlap, 0, "a filter and its complement can never share a trade");
  });

  it("flags a sample too thin to conclude from", () => {
    const thin = buildComparison([trade("x", 100)], b, { a: "A", b: "B" });
    assert.equal(thin.thin, true);
    assert.equal(buildComparison(a, b, { a: "A", b: "B" }).thin, false);
  });

  it("survives an empty side rather than inventing a number for it", () => {
    const empty = buildComparison([], b, { a: "A", b: "B" });
    const byLabel = Object.fromEntries(empty.metrics.map((metric) => [metric.label, metric]));
    assert.equal(byLabel["Closed trades"].a, 0);
    assert.equal(byLabel["Win rate"].a, null, "no trades means no win rate, not a win rate of zero");
    assert.equal(empty.overlap, 0);
  });
});
