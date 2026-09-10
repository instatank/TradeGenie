// What you asked for against what you got.
//
// Every number asserted here is worked by hand in the test, not read off the
// implementation — the failure mode of a slippage feature is not a crash, it is
// a plausible-looking figure, and a test that only pins whatever the code
// produced would ratify the bug.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  bracketClosed,
  calculateEntrySlippage,
  calculateSlippage,
  closingFills,
  measureOrder,
  measurePositionOrders,
  plannedRiskFromOrders,
  slippageByInstrument,
  summarizeSlippage,
  type MeasurableOrder,
  type SlippageReading,
} from "@/lib/slippage";
import { reconstructPositions, type Fill } from "@/lib/positions";
import type { CoindcxTransaction } from "@/lib/coindcx";
import type { Trade } from "@/lib/types";

const T0 = new Date("2026-03-01T10:00:00Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

function fill(overrides: Partial<Fill> & Pick<Fill, "id" | "side" | "price">): Fill {
  return {
    instrument: "SOL",
    currency: "USDT",
    quoteCurrency: "USDT",
    quantity: 10,
    fee: 0,
    timestamp: T0,
    orderId: "order-open",
    ...overrides,
  } as Fill;
}

function ledgerRow(overrides: Partial<CoindcxTransaction>): CoindcxTransaction {
  return {
    id: "tx-1",
    instrument: "SOL",
    currency: "USDT",
    stage: "tpsl_exit",
    kind: "EXIT",
    amount: -100,
    fee: 0,
    positionId: "pos-1",
    orderId: "order-exit",
    rate: { inr: null, usdt: 1 },
    timestamp: at(30),
    ...overrides,
  };
}

/** A long that opened at 100 and was closed by its bracket at `exitPrice`. */
function longStoppedAt(exitPrice: number, stage = "tpsl_exit") {
  const fills = [
    fill({ id: "f1", side: "BUY", price: 100, timestamp: T0, orderId: "order-open" }),
    fill({ id: "f2", side: "SELL", price: exitPrice, timestamp: at(30), orderId: "order-exit" }),
  ];
  const { positions } = reconstructPositions(fills);
  return { position: positions[0], fills, ledger: [ledgerRow({ stage })] };
}

const LONG: Pick<Trade, "direction" | "entryPrice" | "stopPrice" | "targetPrice"> = {
  direction: "LONG" as Trade["direction"],
  entryPrice: 100,
  stopPrice: 99.85,
  targetPrice: 100.3,
};

describe("stop slippage", () => {
  it("measures a long stopped out below its stop, and calls it worse for you", () => {
    // Stop 99.85, filled 99.80. You lost 0.05 more per unit than you planned.
    const { position, fills, ledger } = longStoppedAt(99.8);
    const result = calculateSlippage(LONG, position, fills, ledger);
    assert.ok(result.ok, "should produce a reading");

    assert.equal(result.leg, "STOP");
    assert.equal(result.reference, 99.85);
    assert.ok(Math.abs(result.filled - 99.8) < 1e-9);
    // Positive means worse. 99.85 - 99.80 = 0.05.
    assert.ok(Math.abs(result.priceDelta - 0.05) < 1e-9, `priceDelta ${result.priceDelta}`);
    // 0.05 / 99.85 = 0.0500751% = 5.008 bps.
    assert.ok(Math.abs(result.bps - 5.0075) < 0.01, `bps ${result.bps}`);
    // THE number: planned risk was 100 - 99.85 = 0.15, so 0.05 of slip is a
    // third of the whole risk budget.
    assert.ok(Math.abs(result.riskFraction! - 1 / 3) < 1e-6, `riskFraction ${result.riskFraction}`);
    // 10 units closed x 0.05 = 0.50 USDT.
    assert.ok(Math.abs(result.cost! - 0.5) < 1e-9);
    assert.equal(result.quoteCurrency, "USDT");
    assert.equal(result.suspect, false);
  });

  it("uses the same sign for a short, so worse is worse on both sides", () => {
    // Short from 100 with the stop above at 100.15, filled at 100.20.
    const fills = [
      fill({ id: "s1", side: "SELL", price: 100, timestamp: T0, orderId: "order-open" }),
      fill({ id: "s2", side: "BUY", price: 100.2, timestamp: at(30), orderId: "order-exit" }),
    ];
    const { positions } = reconstructPositions(fills);
    const short = { direction: "SHORT" as Trade["direction"], entryPrice: 100, stopPrice: 100.15, targetPrice: 99.7 };

    const result = calculateSlippage(short, positions[0], fills, [ledgerRow({})]);
    assert.ok(result.ok);
    assert.equal(result.leg, "STOP");
    assert.ok(Math.abs(result.priceDelta - 0.05) < 1e-9, "a short filled above its stop is also +0.05 worse");
    assert.ok(Math.abs(result.riskFraction! - 1 / 3) < 1e-6);
  });

  it("keeps a better-than-asked fill negative rather than clamping it at zero", () => {
    // A resting limit can fill BETTER. Reporting that as zero would make the
    // whole measurement one-sided.
    const { position, fills, ledger } = longStoppedAt(100.35);
    const result = calculateSlippage({ ...LONG }, position, fills, ledger);
    assert.ok(result.ok);
    assert.equal(result.leg, "TARGET", "above entry means the target fired, not the stop");
    // Target 100.30, filled 100.35 — 0.05 better than asked.
    assert.ok(Math.abs(result.priceDelta + 0.05) < 1e-9, `priceDelta ${result.priceDelta}`);
    assert.ok(result.bps < 0, "better than asked must read negative");
  });
});

describe("what is refused, and why", () => {
  it("refuses a manual close — your own judgement is not the exchange's slippage", () => {
    const { position, fills, ledger } = longStoppedAt(99.8, "default");
    const result = calculateSlippage(LONG, position, fills, ledger);
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, "MANUAL_EXIT");
  });

  it("refuses when the ledger has no row for the exit at all", () => {
    const { position, fills } = longStoppedAt(99.8);
    const result = calculateSlippage(LONG, position, fills, []);
    assert.equal(result.ok, false);
    // Distinct from MANUAL_EXIT on purpose: "we know you closed it" and "we
    // cannot see this far back" are different facts about the same trade.
    assert.equal(result.ok === false && result.reason, "NO_LEDGER");
  });

  it("refuses to invent a stop that was never written down", () => {
    const { position, fills, ledger } = longStoppedAt(99.8);
    const result = calculateSlippage({ ...LONG, stopPrice: null }, position, fills, ledger);
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, "NO_REFERENCE");
  });

  it("refuses an open position", () => {
    const fills = [fill({ id: "o1", side: "BUY", price: 100 })];
    const { positions } = reconstructPositions(fills);
    const result = calculateSlippage(LONG, positions[0], fills, [ledgerRow({})]);
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, "NOT_CLOSED");
  });

  it("flags a fill a whole R away from the stop as suspect rather than reporting it", () => {
    // Stop 99.85 on 0.15 of planned risk, filled at 99.50 — that is 2.3R of
    // "slippage", which is a moved stop or a misclassification, not a fill.
    const { position, fills, ledger } = longStoppedAt(99.5);
    const result = calculateSlippage(LONG, position, fills, ledger);
    assert.ok(result.ok);
    assert.equal(result.suspect, true);
    assert.equal(summarizeSlippage([result]).count, 0, "a suspect reading must not reach the summary");
    assert.equal(summarizeSlippage([result]).suspectCount, 1, "but it must be counted, not vanish");
  });
});

describe("the exit fills it measures", () => {
  it("takes the volume-weighted price across every closing leg, not the first", () => {
    // A stop that walked the book: 5 at 99.82, 15 at 99.78. VWAP = 99.79.
    const fills = [
      fill({ id: "f1", side: "BUY", price: 100, quantity: 20, timestamp: T0 }),
      fill({ id: "f2", side: "SELL", price: 99.82, quantity: 5, timestamp: at(30), orderId: "order-exit" }),
      fill({ id: "f3", side: "SELL", price: 99.78, quantity: 15, timestamp: at(30), orderId: "order-exit" }),
    ];
    const { positions } = reconstructPositions(fills);
    const result = calculateSlippage(LONG, positions[0], fills, [ledgerRow({})]);
    assert.ok(result.ok);
    assert.ok(Math.abs(result.filled - 99.79) < 1e-9, `vwap ${result.filled}`);
    assert.equal(result.legs, 2);
    // The queue is visible: 0.04 of spread on a 99.85 reference.
    assert.ok(Math.abs(result.spreadFraction - 0.04 / 99.85) < 1e-9);
  });

  it("counts only the fills on the closing side", () => {
    const fills = [
      fill({ id: "f1", side: "BUY", price: 100, timestamp: T0 }),
      fill({ id: "f2", side: "BUY", price: 100.1, timestamp: at(1) }),
      fill({ id: "f3", side: "SELL", price: 99.8, quantity: 20, timestamp: at(30), orderId: "order-exit" }),
    ];
    const { positions } = reconstructPositions(fills);
    assert.deepEqual(closingFills(positions[0], fills).map((f) => f.id), ["f3"]);
  });
});

describe("bracketClosed", () => {
  it("joins on orderId, never on the transaction's own id", () => {
    // The trap pinned in lib/coindcx.ts: a transaction's fill_id is ITS id, so
    // joining the endpoints on fill_id matches nothing. This asserts the join
    // survives a ledger row whose id collides with a fill's.
    const exit = [fill({ id: "f9", side: "SELL", price: 99.8, orderId: "order-exit" })];
    const row = ledgerRow({ id: "f9", orderId: "order-exit" });
    assert.equal(bracketClosed(exit, [row]), true);
    assert.equal(bracketClosed(exit, [ledgerRow({ id: "f9", orderId: "someone-elses-order" })]), null);
  });

  it("returns null, not false, when nothing in the ledger covers these orders", () => {
    const exit = [fill({ id: "f9", side: "SELL", price: 99.8, orderId: "order-exit" })];
    assert.equal(bracketClosed(exit, []), null);
    assert.equal(bracketClosed([fill({ id: "f9", side: "SELL", price: 1, orderId: null })], [ledgerRow({})]), null);
  });
});

describe("entry slippage", () => {
  it("is inverted relative to the exit, because you are on the other side", () => {
    // Wanted in at 100, actually filled at 100.05: you paid 0.05 more.
    const fills = [
      fill({ id: "f1", side: "BUY", price: 100.05, timestamp: T0 }),
      fill({ id: "f2", side: "SELL", price: 99.8, timestamp: at(30), orderId: "order-exit" }),
    ];
    const { positions } = reconstructPositions(fills);
    const result = calculateEntrySlippage({ direction: "LONG" as Trade["direction"], plannedEntryPrice: 100, stopPrice: 99.85 }, positions[0]);
    assert.ok(result.ok);
    assert.ok(Math.abs(result.priceDelta - 0.05) < 1e-9, `priceDelta ${result.priceDelta}`);
    // Risk is measured off the price you WANTED (100 - 99.85 = 0.15), because
    // slipping in is precisely what silently widens the real risk.
    assert.ok(Math.abs(result.riskFraction! - 1 / 3) < 1e-6);
  });

  it("says nothing at all when no intended entry was written down", () => {
    const { position } = longStoppedAt(99.8);
    const result = calculateEntrySlippage({ direction: "LONG" as Trade["direction"], plannedEntryPrice: null, stopPrice: 99.85 }, position);
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, "NO_REFERENCE");
  });
});

describe("summarising", () => {
  const reading = (bps: number, suspect = false): SlippageReading => ({
    ok: true,
    leg: "STOP",
    reference: 100,
    filled: 100,
    priceDelta: 0,
    fraction: bps / 10_000,
    bps,
    riskFraction: bps / 100,
    cost: null,
    quoteCurrency: "USDT",
    legs: 1,
    spreadFraction: 0,
    suspect,
  });

  it("reports the median, so one gap-through cannot decide what normal is", () => {
    // Four ordinary fills and one disaster. The mean is 24.4bps — a number that
    // describes none of these trades. The median is 4.
    const summary = summarizeSlippage([reading(2), reading(3), reading(4), reading(5), reading(108)]);
    assert.equal(summary.medianBps, 4);
    assert.equal(summary.worstBps, 108, "the tail is reported separately, never averaged away");
    assert.equal(summary.count, 5);
  });

  it("takes the most positive as worst, not the largest magnitude", () => {
    // -40bps is the BEST fill here. Sorting by magnitude would print it as the
    // worst, which is exactly backwards.
    assert.equal(summarizeSlippage([reading(-40), reading(6)]).worstBps, 6);
    assert.equal(summarizeSlippage([reading(-40), reading(6)]).betterThanAsked, 1);
  });

  it("gives every symbol its own number, because depth is a property of a book", () => {
    const groups = slippageByInstrument([
      { instrument: "SOL", reading: reading(9) },
      { instrument: "SOL", reading: reading(11) },
      { instrument: "BTC", reading: reading(1) },
    ]);
    assert.deepEqual(groups.map((group) => group.label), ["SOL", "BTC"], "worst median first");
    assert.equal(groups[0].medianBps, 10);
    assert.equal(groups[1].medianBps, 1);
  });

  it("returns nulls rather than zeros when there is nothing to summarise", () => {
    // A zero here would read as "no slippage", which is a claim. Null is "we
    // did not measure any", which is the truth.
    const empty = summarizeSlippage([]);
    assert.equal(empty.medianBps, null);
    assert.equal(empty.worstBps, null);
    assert.equal(empty.count, 0);
  });
});

describe("measuring against the exchange's own order", () => {
  const order = (overrides: Partial<MeasurableOrder>): MeasurableOrder => ({
    id: "o1",
    side: "SELL",
    orderType: "stop_market",
    status: "filled",
    referencePrice: 85.8,
    avgPrice: 85.81,
    quantity: 10.33,
    quoteCurrency: "USDT",
    updatedAt: at(30),
    ...overrides,
  });

  it("reproduces the owner's real HYPE stop, which slipped IN THEIR FAVOUR", () => {
    // Verbatim from the live account: a long's stop set at 85.80 that filled at
    // 85.81 — one tick better than asked. This is the case that justifies
    // keeping negative readings rather than clamping at zero.
    const reading = measureOrder(order({}), false)!;
    assert.ok(reading);
    assert.equal(reading.leg, "STOP", "the exchange states the leg; nothing infers it");
    assert.ok(Math.abs(reading.priceDelta + 0.01) < 1e-9, `priceDelta ${reading.priceDelta}`);
    assert.ok(reading.bps < 0, "filled better than asked must read negative");
    assert.ok(Math.abs(reading.bps + 1.1655) < 0.01, `bps ${reading.bps}`);
  });

  it("uses SIDE as the only rule, so entry and exit need no separate formula", () => {
    // A SELL wants a higher price; a BUY wants a lower one. That single
    // statement replaces the "inverted on the entry" special case the
    // journal-based path needs.
    const sold = measureOrder(order({ side: "SELL", referencePrice: 100, avgPrice: 99.9 }), false)!;
    const bought = measureOrder(order({ side: "BUY", referencePrice: 100, avgPrice: 100.1 }), true)!;
    assert.ok(Math.abs(sold.priceDelta - 0.1) < 1e-9, "selling lower than asked is worse");
    assert.ok(Math.abs(bought.priceDelta - 0.1) < 1e-9, "buying higher than asked is worse, by the same amount");
    assert.equal(bought.opening, true);
  });

  it("declines a market order rather than inventing a price it asked for", () => {
    assert.equal(measureOrder(order({ orderType: "market_order", referencePrice: null }), true), null);
  });

  it("declines an order that never filled", () => {
    assert.equal(measureOrder(order({ status: "cancelled", avgPrice: null }), false), null);
  });

  it("measures a limit order, which has a reference but is neither leg", () => {
    const reading = measureOrder(order({ orderType: "limit_order", referencePrice: 87, avgPrice: 87 }), true)!;
    assert.ok(reading);
    assert.equal(reading.leg, null);
    assert.equal(reading.priceDelta, 0);
  });

  it("only scores orders that actually produced this position's fills", () => {
    // A stop resting on another position in the same symbol must never be
    // scored against this one. The join is fill.orderId → order.id.
    const fills = [
      fill({ id: "f1", side: "BUY", price: 100, timestamp: T0, orderId: "mine-open" }),
      fill({ id: "f2", side: "SELL", price: 99.8, timestamp: at(30), orderId: "mine-exit" }),
    ];
    const { positions } = reconstructPositions(fills);

    const readings = measurePositionOrders(positions[0], fills, [
      order({ id: "mine-open", side: "BUY", orderType: "limit_order", referencePrice: 100, avgPrice: 100, updatedAt: T0 }),
      order({ id: "mine-exit", side: "SELL", referencePrice: 99.85, avgPrice: 99.8, updatedAt: at(30) }),
      order({ id: "someone-elses", side: "SELL", referencePrice: 50, avgPrice: 40, updatedAt: at(31) }),
    ]);

    assert.equal(readings.length, 2, "the stranger's order must not be counted");
    assert.deepEqual(readings.map((reading) => reading.opening), [true, false], "chronological, entry first");
    // The exit: stop 99.85, filled 99.80, a SELL, so 0.05 worse.
    assert.ok(Math.abs(readings[1].priceDelta - 0.05) < 1e-9);
  });

  it("returns nothing when no orders are held, rather than guessing", () => {
    // Every trade synced before orders were captured is in this state, and it
    // must read as "unknown", never as "no order existed".
    const fills = [
      fill({ id: "f1", side: "BUY", price: 100, timestamp: T0 }),
      fill({ id: "f2", side: "SELL", price: 99.8, timestamp: at(30) }),
    ];
    const { positions } = reconstructPositions(fills);
    assert.deepEqual(measurePositionOrders(positions[0], fills, []), []);
  });
});

describe("the BTC failure: a reference price that was never the live bracket", () => {
  // Two real stop-outs on BTC read as -290.6 bps (96% of the whole risk) and
  // +204.9 bps (219%) — on the deepest book there is, where real execution slip
  // is single-digit bps. Both were genuine stop-outs, so the leg was right; the
  // REFERENCE was wrong. This pins the difference between the two paths.
  const T = new Date("2026-08-03T09:00:00Z");
  const later = new Date("2026-08-03T11:00:00Z");

  // Long BTC from 83,000. Stop originally at 80,000 and TYPED into the journal
  // as such — then moved up to 82,400 on the exchange to cut the loss. It
  // filled at 82,390: eleven bps of real slip, which is a good fill.
  const fills = [
    fill({ id: "b1", instrument: "BTC", side: "BUY", price: 83_000, quantity: 0.1, timestamp: T, orderId: "open" }),
    fill({ id: "b2", instrument: "BTC", side: "SELL", price: 82_390, quantity: 0.1, timestamp: later, orderId: "stop" }),
  ];
  const { positions } = reconstructPositions(fills);
  const position = positions[0];

  const liveStop: MeasurableOrder = {
    id: "stop",
    side: "SELL",
    orderType: "stop_market",
    status: "filled",
    referencePrice: 82_400,
    avgPrice: 82_390,
    quantity: 0.1,
    quoteCurrency: "USDT",
    updatedAt: later,
  };

  it("the journal path produces the nonsense figure, because it scores the STALE stop", () => {
    const journal = calculateSlippage(
      { direction: "LONG" as Trade["direction"], entryPrice: 83_000, stopPrice: 80_000, targetPrice: 90_000 },
      position,
      fills,
      [ledgerRow({ instrument: "BTC", orderId: "stop" })],
    );
    assert.ok(journal.ok);
    assert.equal(journal.leg, "STOP", "the LEG was never the problem — both trades really did stop out");
    // 80,000 typed vs 82,390 filled = 2,390 'better than the stop', on a typed
    // risk of 3,000 — 80% of the whole risk, from a fill that was actually fine.
    assert.ok(journal.bps < -250, `journal bps ${journal.bps} should be the wild figure`);
    assert.ok(Math.abs(journal.riskFraction!) > 0.75, "and it eats most of the supposed risk");
  });

  it("the order path gets it right, because the exchange knows where the stop actually was", () => {
    const [reading] = measurePositionOrders(position, fills, [liveStop]);
    assert.ok(reading, "the stop order should produce a reading");
    assert.equal(reading.leg, "STOP");
    // 82,400 asked, 82,390 got, on a SELL: 10 worse. 10/82,400 = 1.2 bps.
    assert.ok(Math.abs(reading.priceDelta - 10) < 1e-6, `priceDelta ${reading.priceDelta}`);
    assert.ok(Math.abs(reading.bps - 1.2136) < 0.01, `bps ${reading.bps} — a normal BTC fill`);
    assert.equal(reading.suspect, false);
  });

  it("measures risk against the stop that was really on the exchange", () => {
    // 83,000 entry against the LIVE 82,400 stop is 600 of risk, not the 3,000
    // the journal still had written down. Getting this wrong is what turns a
    // 1.2 bps fill into "96% of your risk".
    assert.equal(plannedRiskFromOrders(83_000, [liveStop]), 600);
    const [reading] = measurePositionOrders(position, fills, [liveStop]);
    assert.ok(Math.abs(reading.riskFraction! - 10 / 600) < 1e-9, `riskFraction ${reading.riskFraction}`);
    assert.ok(reading.riskFraction! < 0.02, "under 2% of risk — which is the truth about this fill");
  });

  it("reports no risk share rather than a wrong one when no stop order backs the position", () => {
    assert.equal(plannedRiskFromOrders(83_000, []), null);
    const tpOnly: MeasurableOrder = { ...liveStop, orderType: "take_profit_market" };
    assert.equal(plannedRiskFromOrders(83_000, [tpOnly]), null, "a take-profit is not a risk boundary");
    const [reading] = measurePositionOrders(position, fills, [{ ...tpOnly, id: "stop" }]);
    assert.equal(reading.riskFraction, null);
    assert.equal(reading.suspect, false, "unknown risk is not a suspect reading");
  });

  it("keeps the two exit legs apart when a position is closed in stages", () => {
    // A partial take-profit and then a stop are two different fills answering
    // two different questions. The journal path blends them into one VWAP and
    // scores that against a single reference, which is meaningless.
    const staged = [
      fill({ id: "s1", instrument: "BTC", side: "BUY", price: 83_000, quantity: 0.2, timestamp: T, orderId: "open" }),
      fill({ id: "s2", instrument: "BTC", side: "SELL", price: 84_000, quantity: 0.1, timestamp: at(60), orderId: "tp" }),
      fill({ id: "s3", instrument: "BTC", side: "SELL", price: 82_390, quantity: 0.1, timestamp: at(120), orderId: "stop" }),
    ];
    const built = reconstructPositions(staged).positions[0];
    const readings = measurePositionOrders(built, staged, [
      { ...liveStop, id: "tp", orderType: "take_profit_market", referencePrice: 84_010, avgPrice: 84_000, updatedAt: at(60) },
      { ...liveStop, id: "stop", updatedAt: at(120) },
    ]);
    assert.equal(readings.length, 2, "one reading per order, never one blended average");
    assert.deepEqual(readings.map((r) => r.leg), ["TARGET", "STOP"]);
  });
});
