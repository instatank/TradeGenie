// The calculator decides whether a trade is worth taking once fees are paid,
// so its arithmetic is the most consequential pure code in the app. These
// numbers are the owner's own worked example from CLAUDE.md — locking them in
// means a refactor can't quietly change the answer he sizes positions on.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  breakEven,
  calculatePositionSize,
  calculateTrade,
  expectancyAt,
  type CalcInput,
  type SizeInput,
} from "@/lib/calculator";

// 0.3% move planned at 2R gross, 0.045% taker each side.
const worked: CalcInput = {
  direction: "LONG",
  entry: 100,
  target: 100.3,
  stop: 99.85,
  entryFeePct: 0.045,
  exitFeePct: 0.045,
  accountSize: 10_000,
  riskPct: 1,
  leverage: 10,
  fundingPct: 0,
  hoursHeld: 0,
  slippagePct: 0,
};

const close = (actual: number, expected: number, tolerance: number, label: string) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: expected ~${expected}, got ${actual}`,
  );

describe("calculateTrade — the owner's worked example", () => {
  it("turns a 2R plan into 0.87R once fees are paid", () => {
    const result = calculateTrade(worked);
    assert.ok(result);
    close(result.grossR, 2, 1e-9, "grossR");
    close(result.netR, 0.87, 0.01, "netR");
  });

  it("moves the break-even win rate from 33% to 53%", () => {
    const result = calculateTrade(worked)!;
    close(result.grossBreakEvenWinRate!, 0.3333, 0.001, "gross break-even win rate");
    close(result.netBreakEvenWinRate!, 0.5334, 0.001, "net break-even win rate");
  });

  it("reports the fee bite as a share of the move, not of risk", () => {
    // 0.09% round trip against a 0.3% move.
    close(calculateTrade(worked)!.costBitePct, 30.045, 0.01, "cost bite %");
  });

  it("slippage is off by default and costs real R when switched on", () => {
    const withSlip = calculateTrade({ ...worked, slippagePct: 0.02 })!;
    close(withSlip.netR, 0.61, 0.01, "netR with slippage");
    close(withSlip.netBreakEvenWinRate!, 0.6224, 0.001, "net break-even win rate with slippage");
    assert.equal(calculateTrade(worked)!.slippageOn, false);
    assert.equal(withSlip.slippageOn, true);
  });
});

describe("calculateTrade — sizing and costs", () => {
  it("sizes so a stop-out costs exactly the risk budget, fees included", () => {
    const result = calculateTrade(worked)!;
    close(result.riskBudget, 100, 1e-9, "risk budget (1% of 10k)");
    // The whole point: netLoss is the budget, not the budget plus the fee bill.
    close(result.netLoss, result.riskBudget, 0.01, "net loss at stop");
  });

  it("charges the exit fee on the exit price, so break-even is solved not approximated", () => {
    const result = calculateTrade(worked)!;
    // breakEven() takes fee *fractions*, not percents.
    const solved = breakEven(100, 1, 0.00045, 0.00045, 0);
    close(result.breakEvenPrice, solved, 1e-9, "breakEven() agrees with the full result");

    // A naive "entry + costs" puts break-even at 100.09. The real answer is
    // higher, because the exit fee is charged on the exit price rather than on
    // entry. The gap is tiny at 0.045% and grows with the fee — at 1% a side
    // the approximation is out by a visible margin, which is the whole reason
    // this is solved rather than added up.
    assert.ok(solved > 100.09, `solved ${solved} should exceed the naive 100.09`);
    const fat = breakEven(100, 1, 0.01, 0.01, 0);
    assert.ok(fat - 102 > 0.02, `at 1% a side the naive 102 is visibly wrong; solved ${fat}`);
  });

  it("funding is charged over the hours actually held", () => {
    const free = calculateTrade(worked)!;
    const paid = calculateTrade({ ...worked, fundingPct: 0.01, hoursHeld: 8 })!;
    assert.equal(free.fundingCost, 0);
    assert.ok(paid.fundingCost > 0, "funding should cost something over 8h");
    assert.ok(paid.netR < free.netR, "funding should reduce net R");
  });
});

describe("calculateTrade — warnings instead of silent nonsense", () => {
  it("flags a long whose stop sits above entry", () => {
    const result = calculateTrade({ ...worked, stop: 100.5 })!;
    assert.ok(result.warnings.length > 0, "a stop on the wrong side must warn");
  });

  it("works symmetrically for a short", () => {
    const short = calculateTrade({ ...worked, direction: "SHORT", target: 99.7, stop: 100.15 })!;
    assert.deepEqual(short.warnings, []);
    close(short.grossR, 2, 1e-9, "short grossR");
    close(short.netR, 0.87, 0.01, "short netR");
  });
});

describe("expectancyAt", () => {
  it("is negative below the break-even win rate and positive above it", () => {
    const result = calculateTrade(worked)!;
    const breakEvenRate = result.netBreakEvenWinRate!;
    assert.ok(expectancyAt(result, breakEvenRate - 0.1).perTradeR < 0, "below break-even loses");
    assert.ok(expectancyAt(result, breakEvenRate + 0.1).perTradeR > 0, "above break-even wins");
    close(expectancyAt(result, breakEvenRate).perTradeR, 0, 0.01, "at break-even is flat");
  });
});

// The plain question — "how many units?" — has to be answerable without a
// target, and it has to agree with the textbook equation the owner already
// knows once fees are switched off. These pin both.
describe("calculatePositionSize — the simple question, answered on its own", () => {
  const free: SizeInput = { ...worked, entryFeePct: 0, exitFeePct: 0 };

  it("is the textbook equation exactly when trading costs nothing", () => {
    const size = calculatePositionSize(free)!;
    // 1% of 10,000 = 100, stop is 0.15 away → 666.67 units.
    close(size.quantity, 100 / 0.15, 1e-9, "size with no fees");
    close(size.quantity, size.naiveQuantity, 1e-9, "no fees means no correction");
    close(size.overshoot, 0, 1e-9, "nothing to back out");
  });

  it("needs no target at all", () => {
    const size = calculatePositionSize({ ...worked, entry: 100, stop: 99.85 });
    assert.ok(size, "sizing must work without a target");
    assert.ok(size.quantity > 0);
  });

  it("makes a stop-out cost exactly the risk budget, fees included", () => {
    const size = calculatePositionSize(worked)!;
    close(size.quantity * size.netRiskPerUnit, size.riskBudget, 1e-9, "loss at stop == budget");
  });

  it("shows what the textbook size would really have cost", () => {
    const size = calculatePositionSize(worked)!;
    assert.ok(size.naiveQuantity > size.quantity, "the textbook size is always the bigger one");
    assert.ok(size.naiveLoss > size.riskBudget, "and it loses more than the budget");
    close(size.overshoot, size.naiveLoss - size.riskBudget, 1e-12, "overshoot is the gap");
    // Two 0.045% fees on a 0.15% stop distance is a ~60% overshoot — the whole
    // reason the corrected size exists rather than being a rounding detail.
    assert.ok(size.overshoot / size.riskBudget > 0.5, `overshoot was only ${size.overshoot}`);
  });

  it("slippage widens the loss, so the size gets smaller again", () => {
    const dry = calculatePositionSize(worked)!;
    const slipped = calculatePositionSize({ ...worked, slippagePct: 0.02 })!;
    assert.ok(slipped.quantity < dry.quantity, "allowing for slippage must shrink the size");
    close(slipped.quantity * slipped.netRiskPerUnit, slipped.riskBudget, 1e-9, "still exactly the budget");
  });

  it("agrees with the full trade result, so there is one definition of size", () => {
    const size = calculatePositionSize(worked)!;
    const full = calculateTrade(worked)!;
    close(size.quantity, full.quantity, 1e-12, "sizing must not fork");
    close(size.notional, full.notional, 1e-12, "notional must not fork");
    close(size.margin, full.margin, 1e-12, "margin must not fork");
  });

  it("works symmetrically for a short", () => {
    const short = calculatePositionSize({ ...worked, direction: "SHORT", stop: 100.15 })!;
    assert.deepEqual(short.warnings, []);
    close(short.quantity * short.netRiskPerUnit, short.riskBudget, 1e-9, "short loss at stop == budget");
  });

  it("refuses nonsense instead of returning a number", () => {
    assert.equal(calculatePositionSize({ ...worked, stop: 100 }), null, "entry == stop has no size");
    assert.equal(calculatePositionSize({ ...worked, entry: 0 }), null, "no entry, no size");
    const wrongSide = calculatePositionSize({ ...worked, stop: 100.5 })!;
    assert.ok(wrongSide.warnings.length > 0, "a stop above entry on a long must warn");
  });
});
