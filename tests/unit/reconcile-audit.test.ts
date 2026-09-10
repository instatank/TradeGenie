// Does the journal agree with the exchange, and where it doesn't, is it the
// rupee slip?
//
// The numbers here are the owner's own account of the mistake: recording
// everything in rupees, so a $5 loss on a USDT trade was meant to be entered as
// 500 and was sometimes entered as 5. Every assertion is worked from that
// story rather than from whatever the code happened to produce.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { auditJournal, auditMatch, countScaleSlips, isScaleSlip } from "@/lib/reconcile-audit";
import type { Match } from "@/lib/reconcile";
import type { ReconstructedPosition } from "@/lib/positions";
import type { Trade } from "@/lib/types";

const AT = new Date("2026-08-03T09:00:00Z");

function position(overrides: Partial<ReconstructedPosition> = {}): ReconstructedPosition {
  return {
    instrument: "BTC",
    currency: "USDT",
    quoteCurrency: "USDT",
    moneyRate: { inr: 99.88, usdt: 1 },
    direction: "LONG",
    openedAt: AT,
    closedAt: AT,
    status: "CLOSED",
    quantity: 0.1,
    entryPrice: 83_000,
    exitPrice: 82_400,
    closedQuantity: 0.1,
    grossPnl: -60,
    fees: 5,
    funding: 0,
    netPnl: -65,
    fillIds: ["f1", "f2"],
    fundingIds: [],
    ...overrides,
  };
}

function trade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: "t1",
    createdAt: AT,
    updatedAt: AT,
    tradeDateTime: AT,
    marketType: "CRYPTO_PERP",
    instrument: "BTC",
    direction: "LONG",
    status: "CLOSED",
    entryPrice: 83_000,
    stopPrice: null,
    targetPrice: null,
    exitPrice: 82_400,
    quantity: 0.1,
    leverage: null,
    realizedPnl: -60,
    fees: 5,
    funding: 0,
    netPnl: -65,
    rMultiple: null,
    setupName: null,
    setupId: null,
    entryThesis: null,
    invalidation: null,
    concern: null,
    premortem: null,
    conditions: [],
    emotionalState: null,
    riskPosture: null,
    confidenceScore: null,
    entryGrade: "NA",
    exitReason: null,
    followedPlan: null,
    lesson: null,
    notes: null,
    ...overrides,
  } as Trade;
}

const matchOf = (t: Trade, p: ReconstructedPosition): Match => ({ position: p, trade: t, minutesApart: 2, confirmed: false });

describe("spotting the rupee slip", () => {
  it("flags a trade whose P&L was typed 100x too small", () => {
    // The exchange says the trade lost 65. The journal says 0.65 — which is
    // what happens when a $5-ish figure is typed without the rupee conversion.
    const audit = auditMatch(matchOf(trade({ netPnl: -0.65, realizedPnl: -0.6, fees: 0.05 }), position()));
    assert.equal(audit.looksScaled, true);
    const net = audit.gaps.find((gap) => gap.field === "netPnl")!;
    assert.ok(net, "net P&L should be reported as a gap");
    assert.ok(Math.abs(net.ratio! - 100) < 1e-9, `ratio ${net.ratio}`);
  });

  it("does not flag an ordinary small disagreement", () => {
    // Fees rounded to 5.10 against the exchange's 5.00 is a rounding
    // difference, not a slip, and calling it one would bury the real ones.
    const audit = auditMatch(matchOf(trade({ fees: 5.1 }), position()));
    assert.ok(audit.gaps.length > 0, "it still disagrees");
    assert.equal(audit.looksScaled, false, "but it is not a 100x error");
  });

  it("says nothing when the two already agree", () => {
    const audit = auditMatch(matchOf(trade(), position()));
    assert.equal(audit.gaps.length, 0);
    assert.equal(audit.looksScaled, false);
  });

  it("refuses a ratio across a sign flip or a zero", () => {
    // A loss recorded as a gain is a different mistake, and dividing across the
    // sign gives a negative number that would read as a scale factor.
    assert.equal(isScaleSlip(null), false);
    const flipped = auditMatch(matchOf(trade({ netPnl: 65 }), position({ netPnl: -65 })));
    assert.equal(flipped.looksScaled, false, "a sign flip is not a scale slip");
    const fromZero = auditMatch(matchOf(trade({ netPnl: 0 }), position({ netPnl: -65 })));
    assert.equal(fromZero.looksScaled, false, "nothing is 100x of zero");
  });

  it("accepts the band around 100, because fees and funding drift for real reasons", () => {
    assert.equal(isScaleSlip(100), true);
    assert.equal(isScaleSlip(83), true, "a USDT rate is not exactly 100");
    assert.equal(isScaleSlip(1.02), false, "rounding is not a slip");
    assert.equal(isScaleSlip(2), false, "a doubled figure is a different mistake");
    assert.equal(isScaleSlip(10_000), false, "and so is one four orders out");
  });

  it("only looks at MONEY fields for the slip", () => {
    // A quantity is units of a coin and a price is in the quote currency;
    // neither is subject to a rupee conversion, so a 100x gap there is some
    // other error and must not be labelled as this one.
    const audit = auditMatch(matchOf(trade({ quantity: 0.001 }), position({ quantity: 0.1 })));
    assert.ok(audit.gaps.some((gap) => gap.field === "quantity"), "the gap is still reported");
    assert.equal(audit.looksScaled, false, "but a quantity is not a rupee slip");
  });
});

describe("auditing the whole journal", () => {
  it("separates what can be fixed from what can never be checked", () => {
    const good = trade({ id: "clean" });
    const bad = trade({ id: "scaled", netPnl: -0.65, realizedPnl: -0.6, fees: 0.05 });
    const orphan = trade({ id: "orphan", instrument: "DOGE" });

    const audit = auditJournal(
      [matchOf(good, position()), matchOf(bad, position())],
      [good, bad, orphan],
    );

    assert.equal(audit.considered, 3);
    assert.equal(audit.matched, 2);
    assert.equal(audit.clean, 1);
    assert.equal(audit.disagreeing.length, 1);
    assert.equal(countScaleSlips(audit), 1);
    // The one a sync can never repair, which is the harder problem.
    assert.deepEqual(audit.unmatched.map((t) => t.id), ["orphan"]);
  });

  it("puts the scale slips first, since they are the ones worth reading", () => {
    const rounding = trade({ id: "rounding", fees: 5.1 });
    const scaled = trade({ id: "scaled", netPnl: -0.65 });
    const audit = auditJournal([matchOf(rounding, position()), matchOf(scaled, position())], [rounding, scaled]);
    assert.deepEqual(audit.disagreeing.map((entry) => entry.trade.id), ["scaled", "rounding"]);
  });
});

describe("auto-apply cannot reach the trader's own words", () => {
  // The sync now writes to trades WITHOUT anyone pressing Accept. That is only
  // safe because the patch is built from acceptPatch(), which is built from
  // diffTrade(), which lists objective columns only — so a thesis, mood, grade,
  // lesson or tag is unreachable by construction rather than by care.
  //
  // This is a SOURCE-level guard on purpose. A behavioural test proves today's
  // patch is clean; this proves no future edit can quietly start writing trades
  // from the sync by some other route.
  it("the sync's writer builds its patch only from acceptPatch", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(new URL("../../app/actions.ts", import.meta.url), "utf8");

    const start = source.indexOf("async function applyExchangeNumbers");
    assert.ok(start > 0, "applyExchangeNumbers must exist — the sync's only writer");
    const body = source.slice(start, source.indexOf("\n}", start));

    assert.match(body, /acceptPatch\(match, key\)/, "it must patch from acceptPatch");
    // One db.update, and its payload must be the spread patch. Any literal
    // field assignment alongside it would be a field nothing has vetted.
    const updates = body.match(/db\.update\(/g) ?? [];
    assert.equal(updates.length, 1, "exactly one write");
    assert.match(body, /db\.update\("trades", match\.trade\.id, \{ \.\.\.patch, updatedAt: new Date\(\) \}\)/);

    for (const forbidden of ["entryThesis", "lesson", "notes", "emotionalState", "entryGrade", "setupGrade", "tags", "followedPlan"]) {
      assert.ok(!body.includes(forbidden), `${forbidden} must never appear in the sync's writer`);
    }
  });

  it("skips a trade that would not change, so nothing looks edited that was not", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(new URL("../../app/actions.ts", import.meta.url), "utf8");
    const body = source.slice(source.indexOf("async function applyExchangeNumbers"));
    assert.match(body, /continue;/, "an unchanged match must be skipped, not rewritten");
  });
});
