// Two margin accounts, one set of totals.
//
// The trader runs separate INR and USDT margin accounts on CoinDCX, so a trade's
// numbers are denominated in whichever account it was taken in. Per-trade that is
// fine — R-multiple, win rate, expectancy and on-plan % are ratios and do not
// care what currency they came from. It only bites when numbers get *added*: a
// day's P&L, the week strip, the equity curve.
//
// The rule this module exists to hold: **the stored number is never converted.**
// A converted P&L cannot be reconciled against the exchange statement, and the
// moment a record holds a derived figure, the journal stops being a record of
// what happened. Conversion happens here, at display time, and only for totals.
//
// The rate is not invented either. Every CoinDCX transaction stamps the value of
// its own margin currency in both currencies at the moment it happened —
// price_in_inr / price_in_usdt — so a historical total uses the historical rate
// for free, with no FX feed and no extra network call.

export type Currency = "INR" | "USDT";

/**
 * The value of ONE unit of some record's margin currency, in each currency, as
 * the exchange recorded it. An INR-margined row reads `{ inr: 1, usdt: 0.01002 }`;
 * a USDT-margined one reads `{ inr: 99.88, usdt: 1 }`.
 */
export type MoneyRate = {
  inr: number | null;
  usdt: number | null;
};

/**
 * Used only when a record carries no rate of its own. The owner proposed a flat
 * 100:1 before we knew the exchange supplied real rates; measured against a real
 * row it was within 0.19% (the true rate that day was 99.81), which is more than
 * good enough for the one job left to it — keeping a total roughly honest when
 * the exact rate is missing.
 */
export const FALLBACK_INR_PER_USDT = 100;

function usable(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export type Converted = {
  amount: number;
  /** False when the fallback rate had to be used — surface it, don't hide it. */
  exact: boolean;
};

/**
 * Convert an amount denominated in `native` into `target`.
 *
 * Returns `exact: false` when it had to fall back to the flat rate, so a caller
 * showing a total can say the total is approximate rather than implying a
 * precision it does not have.
 */
export function convertAmount(
  amount: number,
  native: string,
  target: Currency,
  rate: MoneyRate | null | undefined,
): Converted {
  // Same currency: nothing to do, and nothing that could go wrong.
  if (native.toUpperCase() === target) return { amount, exact: true };

  const recorded = target === "INR" ? rate?.inr : rate?.usdt;
  if (usable(recorded)) return { amount: amount * recorded, exact: true };

  // No recorded rate. Fall back, but only between the two currencies we know.
  const from = native.toUpperCase();
  if (from === "USDT" && target === "INR") {
    return { amount: amount * FALLBACK_INR_PER_USDT, exact: false };
  }
  if (from === "INR" && target === "USDT") {
    return { amount: amount / FALLBACK_INR_PER_USDT, exact: false };
  }

  // An unknown currency with no rate. Refusing is right: a wrong number in a
  // total is worse than an obviously missing one.
  return { amount: NaN, exact: false };
}

export type Amount = {
  value: number;
  currency: string;
  rate?: MoneyRate | null;
};

export type Total = {
  value: number;
  currency: Currency;
  /** True only if every input converted at a rate the exchange actually recorded. */
  exact: boolean;
  /** Inputs that could not be converted at all, and so are missing from `value`. */
  dropped: number;
};

/**
 * Add up amounts that may be in different currencies.
 *
 * Anything unconvertible is counted in `dropped` rather than silently treated as
 * zero — the same rule as unattributed funding in lib/positions.ts. A total that
 * quietly omits a trade is the kind of wrong number a journal never recovers from.
 */
export function sumInCurrency(amounts: Amount[], target: Currency): Total {
  let value = 0;
  let exact = true;
  let dropped = 0;

  for (const amount of amounts) {
    const converted = convertAmount(amount.value, amount.currency, target, amount.rate);
    if (!Number.isFinite(converted.amount)) {
      dropped += 1;
      exact = false;
      continue;
    }
    value += converted.amount;
    if (!converted.exact) exact = false;
  }

  return { value, currency: target, exact, dropped };
}
