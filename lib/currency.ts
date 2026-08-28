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

// --- The base currency: one number line for everything that gets added up ---
//
// Two margin accounts means an INR trade that made 100 and a USDT trade that
// made 10 are BOTH stored as their own honest number — and a list, a week strip
// or an equity curve that adds them gets 110, when the truth is nearer 1,100.
// Every ratio the journal computes (win rate, R, on-plan %) is immune; every
// SUM is wrong. That is the whole defect this section exists to close.
//
// Where the conversion happens is the design decision, and it is deliberately
// NOT at the write:
//
//   - Converting on write would make a trade unreconcilable against its own
//     CoinDCX statement line. That reconcilability is what caught a ~100x bug
//     once already, and it is worth more than the convenience.
//   - Converting inside the metrics functions would mean threading a target
//     currency through twenty call sites, and lib/metrics.ts is deliberately
//     pure and store-free.
//
// So: convert ONCE, on read, in getTradesWithMistakes() — the single function
// every aggregating page already loads trades through. By the time a number
// reaches lib/metrics.ts it is already on one number line, and no consumer can
// forget to convert because no consumer does the converting.

/** The subset of a Trade this module knows how to move between currencies. */
export type TradeMoney = {
  currency?: string | null;
  moneyRate?: MoneyRate | null;
  realizedPnl?: number | null;
  fees?: number | null;
  funding?: number | null;
  netPnl?: number | null;
};

/**
 * THE list of fields that are money in the wallet's currency.
 *
 * Deliberately short and deliberately explicit. Prices are excluded because a
 * price is in the pair's QUOTE currency (SOL at 104.80 is USDT), quantity is
 * excluded because it is units of the coin and not money at all, and rMultiple
 * is excluded because a ratio has no currency. Getting any of those three wrong
 * is exactly how the earlier ~100x bug hid.
 */
export const BASE_CONVERTED_FIELDS = ["realizedPnl", "fees", "funding", "netPnl"] as const;

export type InBaseCurrency<T> = T & {
  /** The wallet the stored numbers were in, before conversion. */
  nativeCurrency: string | null;
  /** What the numbers on this object are now denominated in. */
  baseCurrency: Currency;
  /** False when the flat fallback rate had to stand in for a recorded one. */
  baseExact: boolean;
};

/**
 * Return a copy of `trade` with its money fields expressed in `base`.
 *
 * A trade with no `currency` is passed through untouched: every hand-logged
 * trade predates the exchange import and its numbers are already in whatever
 * the trader was thinking in, which is the base currency by definition. That
 * makes this a no-op for the entire existing journal — no migration, no
 * behaviour change — and it only starts doing work on trades the exchange
 * stamped.
 *
 * A field that cannot be converted at all becomes null rather than NaN, so it
 * drops out of a sum instead of poisoning it. `baseExact` says when that or the
 * fallback rate happened, so a total can admit to being approximate.
 */
export function toBaseCurrency<T extends TradeMoney>(trade: T, base: Currency): InBaseCurrency<T> {
  const native = trade.currency?.trim().toUpperCase() || null;
  if (!native || native === base) {
    return { ...trade, nativeCurrency: native, baseCurrency: base, baseExact: true };
  }

  const converted: Record<string, unknown> = { ...trade };
  let exact = true;
  for (const field of BASE_CONVERTED_FIELDS) {
    const value = trade[field];
    if (value == null) continue;
    const result = convertAmount(value, native, base, trade.moneyRate);
    if (!Number.isFinite(result.amount)) {
      converted[field] = null;
      exact = false;
      continue;
    }
    converted[field] = result.amount;
    if (!result.exact) exact = false;
  }

  return { ...(converted as T), nativeCurrency: native, baseCurrency: base, baseExact: exact };
}

export function currencySymbol(currency: Currency | string): string {
  const upper = String(currency).toUpperCase();
  if (upper === "INR") return "₹";
  if (upper === "USDT" || upper === "USD") return "$";
  return `${upper} `;
}

/**
 * ONE money formatter for the whole app.
 *
 * There were three copies of this, all identical and all unlabelled — fine
 * while every number was in one currency, and actively misleading the moment
 * two accounts existed: a bare "1,320" reads as rupees to a trader who has
 * both. The symbol is not decoration; it is the thing that makes a converted
 * total checkable.
 */
export function formatMoney(
  value: number,
  currency: Currency | string,
  options: { decimals?: number; signed?: boolean; absolute?: boolean } = {},
): string {
  const { decimals, signed = false, absolute = false } = options;
  // USDT amounts are small — a 13.21 shown as "13" loses the trade. INR ones
  // are ~100x larger, where the paise are noise.
  const places = decimals ?? (String(currency).toUpperCase() === "INR" ? 0 : 2);
  const shown = absolute || signed ? Math.abs(value) : value;
  const body = `${currencySymbol(currency)}${shown.toLocaleString("en-IN", {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  })}`;
  if (!signed) return body;
  return `${value < 0 ? "−" : "+"}${body}`;
}
