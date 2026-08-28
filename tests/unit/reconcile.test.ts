// Joining exchange positions to journal trades.
//
// The failure this file exists to prevent is not a crash — it is the wrong
// numbers landing quietly on the wrong trade, which corrupts the journal in a
// way nothing downstream can detect. So the cases here are the ambiguous ones:
// two trades competing for one position, an established link a closer stranger
// tries to steal, and the subjective fields that must never be touched.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { acceptPatch, changedFields, diffTrade, matchPositions, willCloseTrade, MATCH_WINDOW_HOURS, PROVENANCE_FIELDS } from "@/lib/reconcile";
import type { ReconstructedPosition } from "@/lib/positions";
import type { Trade } from "@/lib/types";

const keyOf = (position: ReconstructedPosition) =>
  `${position.instrument}|${position.currency}|${position.openedAt.getTime()}`;

function position(overrides: Partial<ReconstructedPosition> = {}): ReconstructedPosition {
  return {
    instrument: "ETH",
    currency: "USDT",
    quoteCurrency: "USDT",
    moneyRate: { inr: 99.81, usdt: 1 },
    direction: "LONG",
    openedAt: new Date("2026-08-27T02:00:00Z"),
    closedAt: new Date("2026-08-27T06:00:00Z"),
    status: "CLOSED",
    quantity: 0.5,
    entryPrice: 2484,
    exitPrice: 2512,
    closedQuantity: 0.5,
    grossPnl: 14,
    fees: 0.24,
    funding: -0.09,
    netPnl: 13.67,
    fillIds: ["f1", "f2"],
    fundingIds: ["fund1"],
    ...overrides,
  };
}

function trade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: "t1",
    createdAt: new Date("2026-08-27T02:05:00Z"),
    updatedAt: new Date("2026-08-27T02:05:00Z"),
    tradeDateTime: new Date("2026-08-27T02:05:00Z"),
    marketType: "CRYPTO_PERP",
    instrument: "ETH",
    direction: "LONG",
    status: "OPEN",
    setupName: null,
    entryThesis: "reclaimed the level",
    invalidation: null,
    concern: null,
    emotionalState: "CALM",
    riskPosture: null,
    confidenceScore: null,
    entryGrade: "B",
    exitReason: null,
    followedPlan: null,
    lesson: null,
    notes: null,
    entryPrice: 2480,
    stopPrice: null,
    targetPrice: null,
    exitPrice: null,
    quantity: null,
    leverage: null,
    realizedPnl: null,
    fees: null,
    funding: null,
    netPnl: null,
    rMultiple: null,
    ...overrides,
  } as Trade;
}

describe("matchPositions", () => {
  it("matches a position to the trade logged minutes later", () => {
    const { matches, unmatched } = matchPositions([position()], [trade()], keyOf);
    assert.equal(matches.length, 1);
    assert.equal(unmatched.length, 0);
    assert.equal(matches[0].trade.id, "t1");
    assert.equal(matches[0].minutesApart, 5);
    assert.equal(matches[0].confirmed, false);
  });

  it("will not match across a direction or a symbol", () => {
    assert.equal(matchPositions([position()], [trade({ direction: "SHORT" })], keyOf).matches.length, 0);
    assert.equal(matchPositions([position()], [trade({ instrument: "BTC" })], keyOf).matches.length, 0);
  });

  it("ignores case and padding in the symbol", () => {
    const { matches } = matchPositions([position()], [trade({ instrument: " eth " })], keyOf);
    assert.equal(matches.length, 1);
  });

  it("refuses a trade logged outside the window", () => {
    const tooOld = trade({
      tradeDateTime: new Date(Date.parse("2026-08-27T02:00:00Z") - (MATCH_WINDOW_HOURS + 1) * 3600_000),
    });
    const { matches, unmatched } = matchPositions([position()], [tooOld], keyOf);
    assert.equal(matches.length, 0);
    assert.equal(unmatched.length, 1);
  });

  it("gives a contested trade to the nearer position, and reports the other", () => {
    // Two ETH longs the same morning, one journal entry. Exactly the case where
    // a naive loop would attach the wrong numbers and nothing would notice.
    const near = position({ openedAt: new Date("2026-08-27T02:00:00Z") });
    const far = position({ openedAt: new Date("2026-08-27T08:00:00Z") });
    const { matches, unmatched } = matchPositions([far, near], [trade()], keyOf);

    assert.equal(matches.length, 1);
    assert.equal(matches[0].position.openedAt.toISOString(), "2026-08-27T02:00:00.000Z");
    assert.equal(unmatched.length, 1);
    assert.equal(unmatched[0].openedAt.toISOString(), "2026-08-27T08:00:00.000Z");
  });

  it("does not depend on the order positions arrive in", () => {
    const a = position({ openedAt: new Date("2026-08-27T02:00:00Z") });
    const b = position({ openedAt: new Date("2026-08-27T08:00:00Z") });
    const forwards = matchPositions([a, b], [trade()], keyOf);
    const backwards = matchPositions([b, a], [trade()], keyOf);
    assert.equal(forwards.matches[0].position.openedAt.getTime(), backwards.matches[0].position.openedAt.getTime());
  });

  it("honours an established link over a closer stranger", () => {
    // Once accepted, a pairing is settled. A proximity heuristic must never
    // get to overrule a decision the trader already made.
    const linked = position({ openedAt: new Date("2026-08-27T09:00:00Z") });
    const established = trade({ id: "old", exchangeKey: keyOf(linked), tradeDateTime: new Date("2026-08-27T20:00:00Z") });
    const tempting = trade({ id: "new", tradeDateTime: new Date("2026-08-27T09:01:00Z") });

    const { matches } = matchPositions([linked], [established, tempting], keyOf);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].trade.id, "old");
    assert.equal(matches[0].confirmed, true);
  });

  it("never lets two positions claim the same trade", () => {
    const first = position({ openedAt: new Date("2026-08-27T02:00:00Z") });
    const second = position({ openedAt: new Date("2026-08-27T02:10:00Z") });
    const { matches, unmatched } = matchPositions([first, second], [trade()], keyOf);
    assert.equal(matches.length, 1);
    assert.equal(unmatched.length, 1);
  });

  it("reports a position with no journal entry rather than inventing one", () => {
    const { matches, unmatched } = matchPositions([position()], [], keyOf);
    assert.equal(matches.length, 0);
    assert.deepEqual(unmatched.map((item) => item.instrument), ["ETH"]);
  });
});

describe("diffTrade", () => {
  it("shows what accepting would change, and what it would not", () => {
    const diff = diffTrade(trade(), position());
    const byField = Object.fromEntries(diff.map((row) => [row.field, row]));

    assert.equal(byField.entryPrice.logged, 2480);
    assert.equal(byField.entryPrice.exchange, 2484);
    assert.equal(byField.entryPrice.changed, true);
    assert.equal(byField.fees.logged, null);
    assert.equal(byField.fees.exchange, 0.24);
    assert.equal(byField.fees.changed, true);
  });

  it("does not flag a value that already agrees", () => {
    const diff = diffTrade(trade({ entryPrice: 2484 }), position());
    assert.equal(diff.find((row) => row.field === "entryPrice")?.changed, false);
  });

  it("offers no exit numbers for a position still open", () => {
    const diff = diffTrade(trade(), position({ status: "OPEN", exitPrice: null, closedAt: null }));
    const byField = Object.fromEntries(diff.map((row) => [row.field, row]));
    assert.equal(byField.netPnl.exchange, null);
    assert.equal(byField.netPnl.changed, false);
    assert.equal(byField.realizedPnl.changed, false);
  });

  it("touches only objective fields — never the trader's words", () => {
    // The guarantee is structural: a field absent from the diff can never be
    // written by a sync, no matter what the apply path does.
    const fields = diffTrade(trade(), position()).map((row) => row.field);
    for (const owned of ["entryThesis", "lesson", "notes", "emotionalState", "entryGrade", "setupName", "tags"]) {
      assert.ok(!fields.includes(owned as keyof Trade), `${owned} must never be synced`);
    }
  });
});

describe("acceptPatch", () => {
  it("writes the exchange's numbers and stamps the link", () => {
    const match = { position: position(), trade: trade(), minutesApart: 5, confirmed: false };
    const patch = acceptPatch(match, "ETH|USDT|1");

    assert.equal(patch.exchangeKey, "ETH|USDT|1");
    assert.equal(patch.entryPrice, 2484);
    assert.equal(patch.fees, 0.24);
    assert.equal(patch.funding, -0.09);
    assert.equal(patch.netPnl, 13.67);
    assert.equal(patch.status, "CLOSED");
  });

  it("carries nothing the diff did not list", () => {
    const match = { position: position(), trade: trade(), minutesApart: 5, confirmed: false };
    // The allowed set is diffTrade's own fields plus the NAMED provenance
    // exceptions — read from the constant, not retyped here, so adding a
    // writable field has to be a deliberate edit to that list.
    const allowed = new Set<string>([...diffTrade(match.trade, match.position).map((row) => String(row.field)), ...PROVENANCE_FIELDS]);
    for (const key of Object.keys(acceptPatch(match, "k"))) {
      assert.ok(allowed.has(key), `${key} is not an allowed synced field`);
    }
  });

  it("stamps what the numbers are denominated in, and at what rate", () => {
    // Without these two, a USDT trade's 13.67 is indistinguishable from ₹13.67
    // the moment it lands in a total. The rate is the exchange's own, frozen.
    const match = { position: position(), trade: trade(), minutesApart: 5, confirmed: false };
    const patch = acceptPatch(match, "k");
    assert.equal(patch.currency, "USDT");
    assert.deepEqual(patch.moneyRate, { inr: 99.81, usdt: 1 });
  });

  it("leaves a trade that already agrees almost untouched", () => {
    const exact = position();
    const already = trade({
      entryPrice: exact.entryPrice,
      exitPrice: exact.exitPrice,
      quantity: exact.quantity,
      fees: exact.fees,
      funding: exact.funding,
      realizedPnl: exact.grossPnl,
      netPnl: exact.netPnl,
      status: "CLOSED",
    });
    const patch = acceptPatch({ position: exact, trade: already, minutesApart: 0, confirmed: false }, "k");
    // Provenance is always stamped; no NUMBER is rewritten.
    assert.deepEqual(Object.keys(patch), ["exchangeKey", "currency", "moneyRate"]);
    assert.equal(changedFields(diffTrade(already, exact)).length, 0);
  });
});

describe("willCloseTrade", () => {
  const match = (tradeStatus: string, positionStatus: "OPEN" | "CLOSED") => ({
    position: position({ status: positionStatus, closedAt: positionStatus === "CLOSED" ? new Date() : null }),
    trade: trade({ status: tradeStatus as Trade["status"] }),
    minutesApart: 5,
    confirmed: false,
  });

  it("is true for the case this whole feature is most useful for", () => {
    // Open in the journal, closed on the exchange days ago. Without this the
    // trade sits open forever, and a numbers-only diff would not surface it.
    assert.equal(willCloseTrade(match("OPEN", "CLOSED")), true);
    assert.equal(acceptPatch(match("OPEN", "CLOSED"), "k").status, "CLOSED");
  });

  it("is false when the journal already knows", () => {
    assert.equal(willCloseTrade(match("CLOSED", "CLOSED")), false);
    assert.equal(acceptPatch(match("CLOSED", "CLOSED"), "k").status, undefined);
  });

  it("never closes a trade the exchange still shows open", () => {
    assert.equal(willCloseTrade(match("OPEN", "OPEN")), false);
    assert.equal(acceptPatch(match("OPEN", "OPEN"), "k").status, undefined);
  });
});
