// The setup grade — the trader's read on the OPPORTUNITY, as opposed to
// entryGrade, which is a mark on how they took it. These tests hold the two
// promises that make the field worth storing: the grades stay separate values
// (so a filter and an analytics row mean one thing), and the table reads in
// grade order rather than in order of how often each grade was taken.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { setupGradePerformance, type MetricTrade } from "@/lib/metrics";
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
