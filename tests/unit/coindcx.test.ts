// Turning CoinDCX records into the app's own shapes.
//
// The fixtures are verbatim records from the live API — the probe's own output,
// not something reconstructed from a doc. That matters here more than usual:
// there is no published schema for this endpoint, so these fixtures ARE the
// schema, and a test that drifted from them would be testing nothing.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizePair, parseFill, parseFills } from "@/lib/coindcx";

// Straight from /exchange/v1/derivatives/futures/trades.
const REAL_TRADE = {
  price: 107.54,
  quantity: 4.67,
  is_maker: false,
  fee_amount: 0.296304962,
  pair: "B-SOL_USDT",
  side: "buy",
  timestamp: 1787841686516,
  fill_id: "60c17b8d-f232-4b5c-a239-c64513d2c12f",
  order_id: "27394361-a95b-4c16-9a7e-9446f3de38fc",
  settlement_currency_conversion_price: 1,
  margin_currency_short_name: "INR",
};

describe("normalizePair", () => {
  it("reduces the exchange's pair to the symbol the journal uses", () => {
    assert.equal(normalizePair("B-SOL_USDT"), "SOL");
    assert.equal(normalizePair("B-ETH_USDT"), "ETH");
    assert.equal(normalizePair("B-HYPE_USDT"), "HYPE");
  });

  it("survives a symbol with digits in it", () => {
    assert.equal(normalizePair("B-1000PEPE_USDT"), "1000PEPE");
  });

  it("passes anything unrecognised through rather than mangling it", () => {
    // A wrong symbol is worse than an ugly one — it silently splits a position.
    assert.equal(normalizePair("SOL"), "SOL");
    assert.equal(normalizePair("weird-thing"), "weird-thing");
  });
});

describe("parseFill", () => {
  it("maps a real trade onto a Fill", () => {
    const fill = parseFill(REAL_TRADE);
    assert.ok(fill);
    assert.equal(fill.id, "60c17b8d-f232-4b5c-a239-c64513d2c12f");
    assert.equal(fill.instrument, "SOL");
    assert.equal(fill.side, "BUY");
    assert.equal(fill.quantity, 4.67);
    assert.equal(fill.price, 107.54);
    assert.equal(fill.orderId, "27394361-a95b-4c16-9a7e-9446f3de38fc");
    assert.equal(fill.timestamp.toISOString(), "2026-08-27T14:41:26.516Z");
  });

  it("keeps the fee at full precision", () => {
    // The exchange's own UI rounds this to "0.30". Not rounding is the whole
    // point of importing rather than reading the screen.
    assert.equal(parseFill(REAL_TRADE)?.fee, 0.296304962);
  });

  it("treats a missing fee as zero, not as a reason to drop the fill", () => {
    const fill = parseFill({ ...REAL_TRADE, fee_amount: null });
    assert.equal(fill?.fee, 0);
  });

  it("reads sell as SELL", () => {
    assert.equal(parseFill({ ...REAL_TRADE, side: "sell" })?.side, "SELL");
  });

  it("rejects a record missing anything load-bearing", () => {
    assert.equal(parseFill({ ...REAL_TRADE, fill_id: undefined }), null);
    assert.equal(parseFill({ ...REAL_TRADE, pair: undefined }), null);
    assert.equal(parseFill({ ...REAL_TRADE, side: "neither" }), null);
    assert.equal(parseFill({ ...REAL_TRADE, quantity: 0 }), null);
    assert.equal(parseFill({ ...REAL_TRADE, price: null }), null);
    assert.equal(parseFill({ ...REAL_TRADE, timestamp: "yesterday" }), null);
    assert.equal(parseFill(null), null);
    assert.equal(parseFill("not a record"), null);
  });
});

describe("parseFills", () => {
  it("counts what it could not use instead of hiding it", () => {
    const { fills, skipped } = parseFills([REAL_TRADE, { junk: true }, { ...REAL_TRADE, fill_id: "second" }]);
    assert.equal(fills.length, 2);
    assert.equal(skipped, 1);
  });

  it("returns nothing for a non-array body rather than throwing", () => {
    assert.deepEqual(parseFills({ status: "error" }), { fills: [], skipped: 0 });
  });
});
