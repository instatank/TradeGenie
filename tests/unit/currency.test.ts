// Combining two margin accounts into one set of totals.
//
// The rates here are real ones the exchange stamped on real transactions, which
// is the point of the module: the journal never invents an exchange rate, and a
// total that had to guess says so instead of looking precise.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { convertAmount, FALLBACK_INR_PER_USDT, formatMoney, sumInCurrency, toBaseCurrency } from "@/lib/currency";

// From a real INR-margined transaction row.
const INR_RATE = { inr: 1, usdt: 0.010019036168720569 };
// From a real USDT-margined transaction row the same week.
const USDT_RATE = { inr: 99.88, usdt: 1 };

function closeTo(actual: number, expected: number, tolerance = 1e-9) {
  assert.ok(Math.abs(actual - expected) < tolerance, `expected ${actual} ≈ ${expected}`);
}

describe("convertAmount", () => {
  it("does nothing when the currency already matches", () => {
    const result = convertAmount(6.32487, "USDT", "USDT", USDT_RATE);
    assert.equal(result.amount, 6.32487);
    assert.equal(result.exact, true);
  });

  it("uses the rate the exchange recorded, not one we made up", () => {
    // The real SOL exit: -1305.1716 INR at 0.010019036168720569 USDT per INR.
    const result = convertAmount(-1305.1716, "INR", "USDT", INR_RATE);
    closeTo(result.amount, -1305.1716 * 0.010019036168720569);
    assert.equal(result.exact, true);
    // Sanity: about -13.08 USDT, not -1305 and not -130,000.
    assert.ok(result.amount < -13 && result.amount > -13.1);
  });

  it("converts the other way with the same recorded rate", () => {
    const result = convertAmount(6.32487, "USDT", "INR", USDT_RATE);
    closeTo(result.amount, 6.32487 * 99.88);
    assert.equal(result.exact, true);
  });

  it("falls back to the flat rate when a row carries none — and says so", () => {
    const result = convertAmount(10, "USDT", "INR", null);
    assert.equal(result.amount, 10 * FALLBACK_INR_PER_USDT);
    assert.equal(result.exact, false);
  });

  it("treats a zero or nonsense rate as missing rather than multiplying by it", () => {
    // A rate of 0 would silently turn every converted number into zero.
    assert.equal(convertAmount(10, "USDT", "INR", { inr: 0, usdt: 1 }).exact, false);
    assert.equal(convertAmount(10, "USDT", "INR", { inr: Number.NaN, usdt: 1 }).exact, false);
  });

  it("refuses an unknown currency it has no rate for", () => {
    // A wrong number inside a total is worse than an obviously missing one.
    assert.ok(Number.isNaN(convertAmount(10, "BTC", "INR", null).amount));
  });
});

describe("sumInCurrency", () => {
  it("adds across both margin accounts at their own recorded rates", () => {
    const total = sumInCurrency(
      [
        { value: 6.32487, currency: "USDT", rate: USDT_RATE },
        { value: -1305.1716, currency: "INR", rate: INR_RATE },
      ],
      "INR",
    );
    closeTo(total.value, 6.32487 * 99.88 - 1305.1716);
    assert.equal(total.exact, true);
    assert.equal(total.dropped, 0);
  });

  it("marks the whole total inexact if any single row had to guess", () => {
    const total = sumInCurrency(
      [
        { value: 100, currency: "INR", rate: INR_RATE },
        { value: 1, currency: "USDT", rate: null },
      ],
      "INR",
    );
    assert.equal(total.value, 100 + FALLBACK_INR_PER_USDT);
    assert.equal(total.exact, false);
  });

  it("counts what it could not convert instead of treating it as zero", () => {
    // Same rule as unattributed funding: a total that quietly omits a trade is
    // the kind of wrong number a journal never recovers from.
    const total = sumInCurrency(
      [
        { value: 50, currency: "INR", rate: INR_RATE },
        { value: 999, currency: "BTC", rate: null },
      ],
      "INR",
    );
    assert.equal(total.value, 50);
    assert.equal(total.dropped, 1);
    assert.equal(total.exact, false);
  });
});

// --- The defect this section exists to close ---
//
// An INR trade that made 100 and a USDT trade that made 10 are both honest
// numbers. Adding them naively gives 110, when the truth is nearer 1,100. Every
// ratio the journal computes is immune; every SUM is wrong. toBaseCurrency is
// the one place that fixes it, and these tests pin the exact behaviour the rest
// of the app leans on.
describe("toBaseCurrency — one number line for everything that gets added up", () => {
  it("leaves a hand-logged trade completely alone", () => {
    // No currency stamp = every trade logged before the exchange import. Its
    // numbers are already in whatever the trader was thinking in, so this must
    // be a no-op for the entire existing journal — no migration, no surprises.
    const trade = { realizedPnl: 250, fees: 3, funding: -1, netPnl: 246 };
    const result = toBaseCurrency(trade, "INR");
    assert.deepEqual(
      { realizedPnl: result.realizedPnl, fees: result.fees, funding: result.funding, netPnl: result.netPnl },
      trade,
    );
    assert.equal(result.nativeCurrency, null);
    assert.equal(result.baseExact, true);
  });

  it("does nothing when the trade is already in the base currency", () => {
    const result = toBaseCurrency({ currency: "USDT", moneyRate: USDT_RATE, netPnl: 13.208 }, "USDT");
    assert.equal(result.netPnl, 13.208);
    assert.equal(result.baseExact, true);
  });

  it("carries a USDT trade into INR at the exchange's own rate", () => {
    // The owner's real SOL trade: -12.796 gross / -13.208 net USDT. On an INR
    // base these have to read as roughly -1,278 and -1,319, not -12.8 and -13.2.
    const result = toBaseCurrency(
      { currency: "USDT", moneyRate: USDT_RATE, realizedPnl: -12.796, fees: 0.412, funding: 0, netPnl: -13.208 },
      "INR",
    );
    closeTo(result.realizedPnl!, -12.796 * 99.88);
    closeTo(result.netPnl!, -13.208 * 99.88);
    closeTo(result.fees!, 0.412 * 99.88);
    assert.equal(result.baseExact, true);
    assert.equal(result.nativeCurrency, "USDT");
  });

  it("never touches prices, quantity or R — they are not money in the wallet", () => {
    // The ~100x bug that started all of this was a price being treated as if it
    // were in the margin currency. A price is in the pair's QUOTE currency, a
    // quantity is units of the coin, and an R multiple is a ratio.
    const trade = {
      currency: "USDT" as const,
      moneyRate: USDT_RATE,
      netPnl: 10,
      entryPrice: 104.8,
      exitPrice: 101.2,
      quantity: 4.67,
      rMultiple: -1.4,
    };
    const result = toBaseCurrency(trade, "INR");
    assert.equal(result.entryPrice, 104.8);
    assert.equal(result.exitPrice, 101.2);
    assert.equal(result.quantity, 4.67);
    assert.equal(result.rMultiple, -1.4);
    closeTo(result.netPnl!, 10 * 99.88);
  });

  it("admits it when no recorded rate was available", () => {
    const result = toBaseCurrency({ currency: "USDT", moneyRate: null, netPnl: 10 }, "INR");
    assert.equal(result.netPnl, 10 * FALLBACK_INR_PER_USDT);
    assert.equal(result.baseExact, false, "a fallback rate must never look exact");
  });

  it("drops an unconvertible field rather than poisoning a total with NaN", () => {
    const result = toBaseCurrency({ currency: "EUR", moneyRate: null, netPnl: 10 }, "INR");
    assert.equal(result.netPnl, null);
    assert.equal(result.baseExact, false);
  });

  it("leaves nulls null — a missing number must not become zero", () => {
    const result = toBaseCurrency({ currency: "USDT", moneyRate: USDT_RATE, netPnl: null, fees: 0.5 }, "INR");
    assert.equal(result.netPnl, null);
    closeTo(result.fees!, 0.5 * 99.88);
  });

  it("makes the mixed-account sum come out right", () => {
    // The exact case the owner raised: +100 INR and +10 USDT.
    const inrTrade = toBaseCurrency({ currency: "INR", moneyRate: INR_RATE, netPnl: 100 }, "INR");
    const usdtTrade = toBaseCurrency({ currency: "USDT", moneyRate: USDT_RATE, netPnl: 10 }, "INR");
    const total = (inrTrade.netPnl ?? 0) + (usdtTrade.netPnl ?? 0);
    closeTo(total, 100 + 10 * 99.88);
    // The wrong answer this whole change exists to stop.
    assert.notEqual(Math.round(total), 110);
  });
});

describe("formatMoney", () => {
  it("labels the currency, because an unlabelled total cannot be checked", () => {
    assert.equal(formatMoney(1320, "INR"), "₹1,320");
    assert.equal(formatMoney(13.208, "USDT"), "$13.21");
  });

  it("signs a value without losing the symbol", () => {
    assert.equal(formatMoney(-1320, "INR", { signed: true }), "−₹1,320");
    assert.equal(formatMoney(1320, "INR", { signed: true }), "+₹1,320");
  });
});
