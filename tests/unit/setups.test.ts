// The model checklist and what skipping a step costs. Both are pure, both are
// consequential — the checklist decides what a trade can tick, and the gap
// analysis is what puts a sentence in front of the trader every morning. The
// subtle ones here are the silent-drop cases: a line that reads like a step but
// can't be tokenized, and a "verdict" that must not fire at a small sample.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checklistLines, checklistScore, setupSteps, stepResolver } from "@/lib/setups";
import { analyticsLeaks, checklistGaps, MIN_SAMPLE, type MetricTrade } from "@/lib/metrics";
import { practiceSuggestion } from "@/lib/coach";

const FIVE_M = "HTF bias / trend\nMTF + LTF market structure\nDisplacement\nLiquidity taken\nEntry (OTE, OB, FVG)";

describe("setupSteps", () => {
  it("reads one step per line and tokenizes each to a stable value", () => {
    assert.deepEqual(
      setupSteps(FIVE_M).map((step) => step.value),
      ["HTF_BIAS_TREND", "MTF_LTF_MARKET_STRUCTURE", "DISPLACEMENT", "LIQUIDITY_TAKEN", "ENTRY_OTE_OB_FVG"],
    );
  });

  it("tolerates the ways a checklist actually gets typed", () => {
    const steps = setupSteps("- Displacement\n2. Liquidity taken\n[ ] HTF bias");
    assert.deepEqual(steps.map((step) => step.label), ["Displacement", "Liquidity taken", "HTF bias"]);
  });

  it("treats a long line as prose rather than a step", () => {
    const steps = setupSteps("Displacement\nRemember never to take this one in chop, especially not right after a loss");
    assert.deepEqual(steps.map((step) => step.label), ["Displacement"]);
  });

  it("surfaces a line that reads like a step but cannot be tokenized", () => {
    // normalizeOptionValue caps a value at 40 characters. Such a line used to
    // vanish with no explanation; checklistLines keeps it with a null value so
    // the playbook can say "too long to tick".
    const line = "MTF + LTF market structure shift confirmed on the 5m";
    const lines = checklistLines(`Displacement\n${line}`);
    assert.equal(lines.length, 2);
    assert.equal(lines[1].value, null);
    assert.equal(setupSteps(`Displacement\n${line}`).length, 1);
  });

  it("never repeats a step, so a tick can't be ambiguous", () => {
    assert.equal(setupSteps("Displacement\ndisplacement\nDISPLACEMENT").length, 1);
  });
});

describe("checklistScore", () => {
  const steps = setupSteps(FIVE_M);

  it("counts ticks by value, so reordering the checklist can't move one", () => {
    const score = checklistScore(steps, ["DISPLACEMENT", "LIQUIDITY_TAKEN"]);
    assert.deepEqual(score, { met: 2, total: 5, complete: false });
    const reordered = setupSteps("Liquidity taken\nDisplacement\nHTF bias / trend\nMTF + LTF market structure\nEntry (OTE, OB, FVG)");
    assert.equal(checklistScore(reordered, ["DISPLACEMENT", "LIQUIDITY_TAKEN"])?.met, 2);
  });

  it("returns null when there is no checklist — an untracked trade is not a failed one", () => {
    assert.equal(checklistScore([], ["DISPLACEMENT"]), null);
  });
});

const trade = (steps: string[], rMultiple: number): MetricTrade => ({
  tradeDateTime: new Date(),
  status: "CLOSED",
  setupId: "s1",
  checklistSteps: steps,
  rMultiple,
  netPnl: rMultiple * 100,
});

const resolve = stepResolver([{ id: "s1", checklist: FIVE_M }]);
const ALL = ["HTF_BIAS_TREND", "MTF_LTF_MARKET_STRUCTURE", "DISPLACEMENT", "LIQUIDITY_TAKEN", "ENTRY_OTE_OB_FVG"];
const without = (step: string) => ALL.filter((entry) => entry !== step);

describe("checklistGaps", () => {
  it("counts the step you skip and what it returns against having it", () => {
    const trades = [
      ...Array.from({ length: 6 }, () => trade(without("DISPLACEMENT"), -0.5)),
      ...Array.from({ length: 4 }, () => trade(ALL, 1.5)),
    ];
    const [top] = checklistGaps(trades, resolve);
    assert.equal(top.value, "DISPLACEMENT");
    assert.equal(top.missed, 6);
    assert.equal(top.tracked, 10);
    assert.equal(top.avgRMissed, -0.5);
    assert.equal(top.avgRMet, 1.5);
  });

  it("ignores trades with no setup — there is no model to grade them against", () => {
    assert.deepEqual(checklistGaps([{ ...trade(ALL, 1), setupId: null }], resolve), []);
  });
});

describe("the checklist leak", () => {
  const leakTitles = (count: number) =>
    analyticsLeaks(
      Array.from({ length: count }, () => trade(without("DISPLACEMENT"), -0.5)),
      [],
      [],
      checklistGaps(Array.from({ length: count }, () => trade(without("DISPLACEMENT"), -0.5)), resolve),
    ).map((leak) => leak.title);

  it("stays quiet below MIN_SAMPLE — three skips is a Tuesday, not a leak", () => {
    assert.ok(!leakTitles(MIN_SAMPLE - 1).some((title) => title.includes("Displacement")));
  });

  it("speaks up once the sample supports it", () => {
    assert.ok(leakTitles(MIN_SAMPLE + 2).some((title) => title.includes("Displacement")));
  });
});

describe("practiceSuggestion", () => {
  it("nudges earlier than the leak does, because it claims less", () => {
    const gaps = checklistGaps(Array.from({ length: 2 }, () => trade(without("DISPLACEMENT"), -0.5)), resolve);
    assert.equal(practiceSuggestion(gaps)?.text, "Wait for: Displacement");
  });

  it("says nothing when there is nothing to say", () => {
    assert.equal(practiceSuggestion(checklistGaps([trade(ALL, 1)], resolve)), null);
  });
});
