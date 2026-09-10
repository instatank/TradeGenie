// Turning CoinDCX records into the app's own shapes.
//
// The fixtures are verbatim records from the live API — the probe's own output,
// not something reconstructed from a doc. That matters here more than usual:
// there is no published schema for this endpoint, so these fixtures ARE the
// schema, and a test that drifted from them would be testing nothing.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bracketLegOf, exitWasAutomatic, formatProbeReport, FUTURES_PROBES, normalizePair, orderIsBracket, parseFill, parseFills, parseOrder, parseOrders, parseTransaction, parseTransactions, referencePriceOf } from "@/lib/coindcx";

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

describe("the /orders probe survives whatever comes back", () => {
  // NOT a schema test, and deliberately so. Nothing in this repo knows what an
  // order row looks like yet — that is the entire reason the probe exists — so
  // a fixture here would be an invention wearing a fixture's authority, which
  // is the opposite of how every other shape in this file was established.
  //
  // What IS testable, and worth testing: the probe must never throw. It runs in
  // a deployed route against a live account the dev container cannot reach, so
  // an exception is not a red test — it is a 500 in the owner's browser, one
  // wasted round trip, and a redeploy before anyone learns anything. These
  // cases are every way a response can surprise it.
  const orderProbes = FUTURES_PROBES.filter((probe) => probe.path.endsWith("/orders"));

  const render = (body: unknown) =>
    formatProbeReport(orderProbes.map((probe) => ({ probe, status: 200, ok: true, body })));

  it("probes the orders endpoint at all", () => {
    assert.ok(orderProbes.length >= 2, "several payload variants, since the payload is a guess");
    assert.ok(orderProbes.every((probe) => probe.summary), "each must summarise rather than dump raw rows");
  });

  it("handles an empty array without claiming the endpoint failed", () => {
    const report = render([]);
    assert.match(report, /empty array/);
  });

  it("handles a 4xx error body, which is as informative as a success here", () => {
    // CoinDCX names the missing parameter in the body; that is how the payload
    // gets settled, so it must print rather than be swallowed.
    const report = formatProbeReport(
      orderProbes.map((probe) => ({ probe, status: 422, ok: false, body: { message: "status is required" } })),
    );
    assert.match(report, /status is required/);
    assert.match(report, /HTTP 422/);
  });

  it("does not throw on rows carrying none of the expected fields", () => {
    const report = render([{ something_nobody_predicted: 1 }]);
    // It must SAY the names were absent rather than printing a confident empty
    // list — the shape dump underneath is then the only thing worth reading.
    assert.match(report, /NONE of the expected names/);
    assert.match(report, /something_nobody_predicted/);
  });

  it("counts a present-but-null price field as unpopulated", () => {
    // The dangerous case: a field that exists and is always null looks like a
    // working reference price until every reading comes out empty.
    const report = render([
      { stop_price: null, price: 100 },
      { stop_price: null, price: 101 },
    ]);
    assert.match(report, /stop_price: present 2\/2, non-empty 0/);
    assert.match(report, /price: present 2\/2, non-empty 2/);
  });

  it("survives nulls, nested objects and a non-array body", () => {
    for (const body of [null, "gateway timeout", { error: "nope" }, [null], [{ nested: { a: 1 } }], [{ x: undefined }]]) {
      assert.doesNotThrow(() => render(body), `threw on ${JSON.stringify(body)}`);
    }
  });
});

// Verbatim rows from /derivatives/futures/orders on the live account. Like
// every other fixture in this file these ARE the schema — there is no published
// one — so they are pasted unedited rather than tidied into what the parser
// would find convenient.
const REAL_STOP_ORDER = {
  id: "56f5d96c-e9d8-4b34-a24c-d924ea2f3380",
  client_order_id: null,
  pair: "B-HYPE_USDT",
  side: "sell",
  status: "filled",
  order_type: "stop_market",
  stop_trigger_instruction: "last_price",
  notification: "email_notification",
  leverage: 1,
  maker_fee: 0.0236,
  taker_fee: 0.059,
  fee_amount: 0.522986207,
  price: 86.937,
  stop_price: 85.8,
  avg_price: 85.81,
  total_quantity: 10.33,
  remaining_quantity: 0,
  cancelled_quantity: 0,
  ideal_margin: 0,
  order_category: "complete_tpsl",
  stage: "tpsl_exit",
  group_id: "de9487c9B-HYPE_USDT1788790889",
  liquidation_fee: null,
  position_margin_type: "isolated",
  settlement_currency_conversion_price: 1,
  take_profit_price: null,
  stop_loss_price: null,
  margin_currency_short_name: "USDT",
  display_message: null,
  group_status: null,
  created_at: 1788790889208,
  updated_at: 1788794308719,
};

// A cancelled limit order, also verbatim. Note stop_price and avg_price are
// BOTH 0 here — the trap the parser exists to survive.
const REAL_CANCELLED_LIMIT = {
  id: "394baf63-b89b-4a0f-a611-93910c69430a",
  pair: "B-BTC_USDT",
  side: "buy",
  status: "cancelled",
  order_type: "limit_order",
  price: 78715,
  stop_price: 0,
  avg_price: 0,
  total_quantity: 0.019,
  remaining_quantity: 0,
  cancelled_quantity: 0.019,
  fee_amount: 0,
  stage: "default",
  margin_currency_short_name: "USDT",
  created_at: 1788934119787,
  updated_at: 1788935662084,
};

describe("parseOrder", () => {
  it("reads the price asked for and the price got, off one row", () => {
    const order = parseOrder(REAL_STOP_ORDER)!;
    assert.ok(order);
    assert.equal(order.id, "56f5d96c-e9d8-4b34-a24c-d924ea2f3380");
    assert.equal(order.instrument, "HYPE");
    assert.equal(order.quoteCurrency, "USDT");
    assert.equal(order.currency, "USDT");
    assert.equal(order.side, "SELL");
    assert.equal(order.orderType, "stop_market");
    assert.equal(order.stage, "tpsl_exit");
    // The whole point: the trigger this trader set, and the fill they got.
    assert.equal(order.referencePrice, 85.8);
    assert.equal(order.avgPrice, 85.81);
    assert.equal(order.quantity, 10.33);
    // Unrounded, like a fill's fee. The exchange UI shows "0.52".
    assert.equal(order.fee, 0.522986207);
  });

  it("never treats 0 as a price", () => {
    // THE trap. CoinDCX uses 0 and null interchangeably for "not applicable":
    // a limit order reports stop_price 0, and an unfilled one reports avg_price
    // 0. Reading either as a real price puts a reference of zero on the order
    // and reports slippage in the thousands of percent.
    const order = parseOrder(REAL_CANCELLED_LIMIT)!;
    assert.equal(order.referencePrice, 78715, "a limit order asks for its limit price");
    assert.equal(order.avgPrice, null, "0 means it never filled, not that it filled at zero");
  });

  it("refuses a row missing anything it is keyed on", () => {
    assert.equal(parseOrder({ ...REAL_STOP_ORDER, id: undefined }), null);
    assert.equal(parseOrder({ ...REAL_STOP_ORDER, pair: undefined }), null);
    assert.equal(parseOrder({ ...REAL_STOP_ORDER, side: "sideways" }), null);
    assert.equal(parseOrder({ ...REAL_STOP_ORDER, created_at: undefined }), null);
    assert.equal(parseOrder(null), null);
  });

  it("counts what it had to skip rather than dropping it silently", () => {
    const { orders, skipped } = parseOrders([REAL_STOP_ORDER, null, { junk: true }, REAL_CANCELLED_LIMIT]);
    assert.equal(orders.length, 2);
    assert.equal(skipped, 2);
  });
});

describe("referencePriceOf — which field holds the price you asked for", () => {
  it("takes the trigger from both bracket types, which share the field", () => {
    // Measured: stop_price is populated on stop_market AND take_profit_market,
    // 4 of 4 across the probed pages, and 0 on everything else.
    assert.equal(referencePriceOf("stop_market", { price: 86.9, stop_price: 85.8 }), 85.8);
    assert.equal(referencePriceOf("take_profit_market", { price: 86.9, stop_price: 88.39 }), 88.39);
  });

  it("takes the limit from a limit order", () => {
    assert.equal(referencePriceOf("limit_order", { price: 78715, stop_price: 0 }), 78715);
  });

  it("returns null for a market order, which is the right answer and not a gap", () => {
    // A market order asked for whatever the book had. Scoring its fill against
    // any reference invents an intention the trader never expressed — the same
    // refusal as measuring a discretionary exit against a stop.
    assert.equal(referencePriceOf("market_order", { price: 87.6, stop_price: 0 }), null);
  });

  it("returns null for an order type nobody has seen yet", () => {
    // A type CoinDCX adds later must not acquire a reference price by falling
    // through to `price` — that would be a confident wrong number, which is the
    // one output this whole feature must not produce.
    assert.equal(referencePriceOf("trailing_stop_market", { price: 100, stop_price: 99 }), null);
  });
});

describe("the exchange states the leg, so nothing has to infer it", () => {
  it("names stop and target from the order type", () => {
    assert.equal(bracketLegOf("stop_market"), "STOP");
    assert.equal(bracketLegOf("take_profit_market"), "TARGET");
    assert.equal(bracketLegOf("limit_order"), null);
    assert.equal(bracketLegOf("market_order"), null);
  });

  it("knows which types are the exchange's own bracket firing", () => {
    assert.equal(orderIsBracket("stop_market"), true);
    assert.equal(orderIsBracket("take_profit_market"), true);
    assert.equal(orderIsBracket("limit_order"), false);
  });
});
