// Joining exchange positions to journal trades.
//
// The failure this file exists to prevent is not a crash — it is the wrong
// numbers landing quietly on the wrong trade, which corrupts the journal in a
// way nothing downstream can detect. So the cases here are the ambiguous ones:
// two trades competing for one position, an established link a closer stranger
// tries to steal, and the subjective fields that must never be touched.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { acceptPatch, archiveTradeRecord, changedFields, diffTrade, matchPositions, willCloseTrade, ARCHIVE_IDENTITY_FIELDS, MATCH_WINDOW_HOURS, PROVENANCE_FIELDS, SUBJECTIVE_FIELDS } from "@/lib/reconcile";
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

// The archive path — the one place exchange data becomes a NEW trade.
//
// The danger here is the opposite of the accept path's. An accept can only
// overwrite fields diffTrade lists, so the subjective half is safe by
// construction. A create writes every field on the record, so nothing stops it
// putting "imported from CoinDCX" in the notes, "NA" in the plan, or an
// #archive tag into the trader's own vocabulary — each of which would be the
// machine writing words in their name. These tests are the guard.
describe("archiveTradeRecord", () => {
  it("takes every number from the exchange and nothing else", () => {
    const source = position();
    const record = archiveTradeRecord(source, "ETH|USDT|1", { marketType: "CRYPTO_PERP", now: new Date("2026-08-29T09:00:00Z") });

    assert.equal(record.entryPrice, source.entryPrice);
    assert.equal(record.exitPrice, source.exitPrice);
    assert.equal(record.quantity, source.quantity);
    assert.equal(record.fees, source.fees);
    assert.equal(record.funding, source.funding);
    assert.equal(record.realizedPnl, source.grossPnl);
    assert.equal(record.netPnl, source.netPnl);
    assert.equal(record.instrument, "ETH");
    assert.equal(record.direction, "LONG");
    assert.equal(record.status, "CLOSED");
    assert.equal(record.exchangeKey, "ETH|USDT|1");
    assert.equal(record.currency, "USDT");
    assert.deepEqual(record.moneyRate, { inr: 99.81, usdt: 1 });
    assert.equal(record.reconstructed, true);
  });

  it("writes not one word of the trader's", () => {
    const record = archiveTradeRecord(position(), "k", { marketType: "CRYPTO_PERP", now: new Date() });
    for (const field of SUBJECTIVE_FIELDS) {
      const value = record[field];
      const empty = value === null || value === undefined || (Array.isArray(value) && value.length === 0);
      assert.ok(empty, `${field} must be empty on an archived trade, got ${JSON.stringify(value)}`);
    }
    // NA is the enum's own "nothing recorded", not a grade being asserted.
    assert.equal(record.entryGrade, "NA");
    // A stop and a target are plan, not execution: back-solving one would
    // invent the very thing that was never written.
    assert.equal(record.stopPrice, null);
    assert.equal(record.targetPrice, null);
    assert.equal(record.rMultiple, null);
    // Today's market on a trade from March would be a fabrication with a
    // timestamp on it. The bridge captures entry conditions or nothing.
    assert.equal(record.marketContext, null);
  });

  it("files the trade by when it was taken and the record by when it was made", () => {
    const now = new Date("2026-08-29T09:00:00Z");
    const record = archiveTradeRecord(position(), "k", { marketType: "CRYPTO_PERP", now });
    // Back-dating createdAt would credit the journaling streak with days the
    // trader never showed up — the one thing that streak must never do.
    assert.equal(record.createdAt.getTime(), now.getTime());
    assert.equal(record.tradeDateTime.getTime(), new Date("2026-08-27T02:00:00Z").getTime());
  });

  it("logs a position still open on the exchange as open, not closed", () => {
    const live = position({ status: "OPEN", closedAt: null, exitPrice: null, grossPnl: 0, netPnl: 0 });
    const record = archiveTradeRecord(live, "k", { marketType: "CRYPTO_PERP", now: new Date() });
    assert.equal(record.status, "OPEN");
    assert.equal(record.exitPrice, null);
    // Neither P&L figure is knowable until it closes, so neither is asserted.
    assert.equal(record.realizedPnl, null);
    assert.equal(record.netPnl, null);
  });

  it("carries the position key, so logging it twice cannot mint a second copy", () => {
    const source = position();
    const key = keyOf(source);
    const archived = { ...archiveTradeRecord(source, key, { marketType: "CRYPTO_PERP", now: new Date() }), id: "a1" };
    const { matches, unmatched } = matchPositions([source], [archived], keyOf);
    assert.equal(unmatched.length, 0, "an archived position must no longer look unjournaled");
    assert.equal(matches[0]?.confirmed, true);
    // And it arrives already agreeing, so it never lands in "Needs review".
    assert.equal(changedFields(diffTrade(archived, source)).length, 0);
  });

  it("touches no field outside the three named lists", () => {
    // The same containment guarantee acceptPatch has, extended to the create
    // path: if a field appears here that is in none of the lists, either it is
    // a new exception that should be named, or it is the journal's half being
    // written by the exchange.
    const allowed = new Set<string>([
      ...diffTrade(trade(), position()).map((row) => String(row.field)),
      ...PROVENANCE_FIELDS,
      ...ARCHIVE_IDENTITY_FIELDS,
      ...SUBJECTIVE_FIELDS,
      // The record's own bookkeeping, plus the fields explicitly nulled above.
      "createdAt", "updatedAt", "marketType", "entryGrade",
      "stopPrice", "targetPrice", "maePrice", "mfePrice", "totalOrderValue", "leverage", "rMultiple", "marketContext",
    ]);
    const record = archiveTradeRecord(position(), "k", { marketType: "CRYPTO_PERP", now: new Date() });
    for (const field of Object.keys(record)) {
      assert.ok(allowed.has(field), `${field} is written by the archive path but named in no list`);
    }
  });
});
