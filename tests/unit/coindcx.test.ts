// Turning CoinDCX records into the app's own shapes.
//
// The fixtures are verbatim records from the live API — the probe's own output,
// not something reconstructed from a doc. That matters here more than usual:
// there is no published schema for this endpoint, so these fixtures ARE the
// schema, and a test that drifted from them would be testing nothing.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { exitWasAutomatic, normalizePair, parseFill, parseFills, parseTransaction, parseTransactions } from "@/lib/coindcx";

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

// A real row from /derivatives/futures/positions/transactions.
const REAL_TRANSACTION = {
  pair: "B-SOL_USDT",
  stage: "tpsl_exit",
  amount: -1305.1716,
  fee_amount: 30.223106124,
  price_in_inr: 1,
  price_in_btc: 1.25537424143e-7,
  price_in_usdt: 0.010019036168720569,
  source: "user",
  parent_type: "Derivatives::Futures::Order",
  parent_id: "27394361-a95b-4c16-9a7e-9446f3de38fc",
  settlement_amount: 0,
  fill_id: "622229f6-a225-11f1-9088-d70b63c5a323",
  margin_currency_short_name: "INR",
  position_id: "29a90352-d399-11f0-b63b-4f5338eb625a",
  created_at: 1787841686907,
  updated_at: 1787841686907,
};

describe("parseTransaction", () => {
  it("maps a real ledger row", () => {
    const transaction = parseTransaction(REAL_TRANSACTION);
    assert.ok(transaction);
    assert.equal(transaction.instrument, "SOL");
    assert.equal(transaction.currency, "INR");
    assert.equal(transaction.stage, "tpsl_exit");
    assert.equal(transaction.kind, "EXIT");
    assert.equal(transaction.amount, -1305.1716);
    assert.equal(transaction.fee, 30.223106124);
    assert.equal(transaction.positionId, "29a90352-d399-11f0-b63b-4f5338eb625a");
    assert.deepEqual(transaction.rate, { inr: 1, usdt: 0.010019036168720569 });
    assert.equal(transaction.timestamp.toISOString(), "2026-08-27T14:41:26.907Z");
  });

  it("links to the trade through parent_id, never through fill_id", () => {
    // The transaction's own fill_id is a v1 UUID and is NOT the trades
    // endpoint's v4 fill_id. Joining on it would match nothing, plausibly.
    const transaction = parseTransaction(REAL_TRANSACTION);
    assert.equal(transaction?.orderId, "27394361-a95b-4c16-9a7e-9446f3de38fc");
    assert.notEqual(transaction?.orderId, transaction?.id);
  });

  it("classifies the stage vocabulary the ledger actually uses", () => {
    const kindOf = (stage: string) => parseTransaction({ ...REAL_TRANSACTION, stage })?.kind;
    assert.equal(kindOf("funding"), "FUNDING");
    assert.equal(kindOf("default"), "EXIT");
    assert.equal(kindOf("exit"), "EXIT");
    assert.equal(kindOf("tpsl_exit"), "EXIT");
  });

  it("tells a bracket exit from a manual one", () => {
    const tpsl = parseTransaction(REAL_TRANSACTION);
    const manual = parseTransaction({ ...REAL_TRANSACTION, stage: "exit" });
    assert.equal(exitWasAutomatic(tpsl!), true);
    assert.equal(exitWasAutomatic(manual!), false);
  });

  it("keeps a zero amount — a fee-only row is still a real row", () => {
    assert.equal(parseTransaction({ ...REAL_TRANSACTION, amount: 0 })?.amount, 0);
  });

  it("rejects a row missing anything load-bearing", () => {
    assert.equal(parseTransaction({ ...REAL_TRANSACTION, fill_id: undefined }), null);
    assert.equal(parseTransaction({ ...REAL_TRANSACTION, amount: "lots" }), null);
    assert.equal(parseTransaction({ ...REAL_TRANSACTION, created_at: null }), null);
    assert.equal(parseTransaction(null), null);
  });
});

describe("parseTransactions", () => {
  it("surfaces a stage it has never seen rather than silently bucketing it", () => {
    // If CoinDCX adds a stage, it must show up loudly — a new funding-like
    // charge quietly classed as OTHER would understate every trade it touched.
    const { transactions, unknownStages } = parseTransactions([
      REAL_TRANSACTION,
      { ...REAL_TRANSACTION, fill_id: "x", stage: "liquidation" },
    ]);
    assert.equal(transactions.length, 2);
    assert.deepEqual(unknownStages, ["liquidation"]);
  });
});
