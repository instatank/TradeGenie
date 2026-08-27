// Combining two margin accounts into one set of totals.
//
// The rates here are real ones the exchange stamped on real transactions, which
// is the point of the module: the journal never invents an exchange rate, and a
// total that had to guess says so instead of looking precise.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { convertAmount, FALLBACK_INR_PER_USDT, sumInCurrency } from "@/lib/currency";

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
