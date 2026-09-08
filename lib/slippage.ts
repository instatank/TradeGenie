// What you asked for, against what you got.
//
// The exchange reports where you were FILLED and never what you asked for; the
// journal records what you asked for and never where you were filled. Slippage
// is the subtraction, and until this file existed nothing in the app performed
// it — "slippage" appeared only in lib/calculator.ts, as a forward-looking
// assumption you type in. This measures the real thing after the fact.
//
// Pure and store-free, like lib/positions.ts, lib/calculator.ts and
// lib/reconcile.ts: the whole point is that a reading can be tested against
// numbers worked by hand, with no network and no database.
//
// THREE RULES THIS FILE WILL NOT BREAK, because the dangerous output here is
// not a crash but a plausible number:
//
//   1. A reference price the trader did not write down is not inferred. No
//      back-solving a stop from the exit, no "it was probably the round number".
//      Without a stop there is no reading, and the caller says so.
//   2. An exit the exchange did not mark as a bracket fill is NOT measured.
//      A manual close has no reference price — you closed where you chose to —
//      and scoring it against the stop would report your own discretion as the
//      exchange's slippage. The signal is the ledger's `tpsl_exit` stage, which
//      has been stored on every row since the importer was written and, until
//      now, read by nothing.
//   3. A reading that cannot be what it claims is flagged, never averaged in.
//      Filled a full R away from the stop is not slippage; it is a moved stop,
//      a partial exit, or a misclassification. Those surface as `suspect` and
//      are excluded from every summary.
//
// SIGN CONVENTION, once, for both legs: **positive means worse for you.**
// A negative reading is real and is kept — a resting limit take-profit can fill
// slightly better than asked — and clamping it at zero would turn a symmetric
// measurement into a one-sided complaint.

import type { Fill, ReconstructedPosition } from "@/lib/positions";
import type { CoindcxTransaction } from "@/lib/coindcx";
import type { Trade } from "@/lib/types";

/** Which planned price this exit is being measured against. */
export type SlippageLeg = "STOP" | "TARGET";

/**
 * Why a trade has no reading. Every one of these is shown to the trader rather
 * than swallowed: "no measurable slippage" and "this exit cannot be measured"
 * are different sentences, and only the second is true most of the time.
 */
export type SlippageRefusal =
  | { ok: false; reason: "NOT_CLOSED"; detail: string }
  | { ok: false; reason: "NOT_LINKED"; detail: string }
  | { ok: false; reason: "NO_REFERENCE"; detail: string }
  | { ok: false; reason: "MANUAL_EXIT"; detail: string }
  | { ok: false; reason: "NO_LEDGER"; detail: string };

export type SlippageReading = {
  ok: true;
  leg: SlippageLeg;
  /** The price you asked for: your stop, or your target. */
  reference: number;
  /** The volume-weighted price you actually got out at. */
  filled: number;
  /** Signed against you: positive is worse than you asked for. In the quote
   *  currency, same units as the two prices above. */
  priceDelta: number;
  /** priceDelta as a share of the reference price. */
  fraction: number;
  /** The same thing in basis points, which is how a book's quality is quoted. */
  bps: number;
  /**
   * priceDelta as a share of the risk you planned (|entry - stop|).
   *
   * THE number that matters, and the reason bps alone is not enough: 5bps of
   * slippage on a 15bps stop is a third of your risk budget, and 5bps on a
   * 150bps stop is a rounding error. Null when there is no planned risk to
   * measure against.
   */
  riskFraction: number | null;
  /** What the slippage cost in money, at the size actually closed, in the
   *  quote currency. Null without a closed quantity. */
  cost: number | null;
  /** What `reference`, `filled`, `priceDelta` and `cost` are denominated in. */
  quoteCurrency: string;
  /** How many exchange fills the exit was made of, and how far apart their
   *  prices were as a share of the reference. A bracket that filled across a
   *  wide range is one number hiding a queue, so the caller can say so. */
  legs: number;
  spreadFraction: number;
  /**
   * The reading is larger than the whole planned risk. Not slippage — a moved
   * stop, a partial take-profit folded into the same VWAP, or the leg
   * classified wrong. Kept and shown, excluded from every summary.
   */
  suspect: boolean;
};

export type SlippageResult = SlippageReading | SlippageRefusal;

/** The exchange's own word for "my bracket order closed this position". */
const BRACKET_STAGE = "tpsl_exit";

/** Beyond this share of planned risk, a "slippage" reading is something else. */
const SUSPECT_RISK_FRACTION = 1;

function dirSign(direction: Trade["direction"]): 1 | -1 {
  return direction === "SHORT" ? -1 : 1;
}

/**
 * The fills that closed this position: the ones on the opposite side to the
 * direction it was held in.
 *
 * On a flip, the fill that closes this position is the same fill that opens the
 * next one — it is correctly counted here, because relative to THIS position it
 * is a close, and its price is this position's exit price.
 */
export function closingFills(position: ReconstructedPosition, fills: Fill[]): Fill[] {
  const ids = new Set(position.fillIds);
  const closingSide = position.direction === "LONG" ? "SELL" : "BUY";
  return fills
    .filter((fill) => ids.has(fill.id) && fill.side === closingSide)
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
}

/**
 * Did the exchange's own bracket close this position?
 *
 * Joined on `orderId`, which is the real link between a ledger row and a fill:
 * a transaction's `fill_id` is its OWN id, and joining the two endpoints on
 * that field looks right and matches nothing (see lib/coindcx.ts). Returns null
 * when there is no ledger row for these orders at all, which is a different
 * answer from "no, it was manual" and is reported as one.
 */
export function bracketClosed(exitFills: Fill[], ledger: CoindcxTransaction[]): boolean | null {
  const orderIds = new Set(exitFills.map((fill) => fill.orderId).filter((id): id is string => Boolean(id)));
  if (orderIds.size === 0) return null;

  const rows = ledger.filter((row) => row.kind === "EXIT" && row.orderId && orderIds.has(row.orderId));
  if (rows.length === 0) return null;
  return rows.some((row) => row.stage === BRACKET_STAGE);
}

/** Volume-weighted price across fills, or null when there is nothing to weigh. */
function vwap(fills: Fill[]): number | null {
  let notional = 0;
  let quantity = 0;
  for (const fill of fills) {
    notional += fill.price * fill.quantity;
    quantity += fill.quantity;
  }
  return quantity > 0 ? notional / quantity : null;
}

/**
 * Measure one closed, exchange-linked trade against the price it was supposed
 * to close at.
 *
 * Which leg is decided by which side of the entry the exit landed on — a fixed
 * stop is on the losing side by construction and a target is on the winning one
 * — and the ledger, not the geometry, decides whether it was a bracket at all.
 * Geometry alone would happily report a discretionary exit near the stop as a
 * stop-out that slipped.
 */
export function calculateSlippage(
  trade: Pick<Trade, "direction" | "entryPrice" | "stopPrice" | "targetPrice">,
  position: ReconstructedPosition,
  fills: Fill[],
  ledger: CoindcxTransaction[],
): SlippageResult {
  if (position.status !== "CLOSED") {
    return { ok: false, reason: "NOT_CLOSED", detail: "This position is still open, so there is no exit to measure." };
  }

  const exitFills = closingFills(position, fills);
  const filled = vwap(exitFills);
  if (filled === null) {
    return { ok: false, reason: "NOT_LINKED", detail: "No exchange fills are linked to this trade, so there is no fill price to compare against." };
  }

  const bracket = bracketClosed(exitFills, ledger);
  if (bracket === null) {
    return {
      ok: false,
      reason: "NO_LEDGER",
      detail: "The exchange's transaction ledger has no row for this exit, so there is no way to tell whether your bracket closed it or you did. The ledger does not reach as far back as the fills.",
    };
  }
  if (!bracket) {
    return {
      ok: false,
      reason: "MANUAL_EXIT",
      detail: "You closed this one yourself — the exchange records no stop or target fill. A discretionary exit has no price it was supposed to hit, so measuring it against your stop would report your own judgement as slippage.",
    };
  }

  const sign = dirSign(trade.direction);
  const entry = trade.entryPrice;
  // Losing side of the entry means the stop fired; winning side means the
  // target did. With no entry recorded there is nothing to take a side of, and
  // guessing the leg is exactly the invented number rule 1 forbids.
  if (entry == null || !Number.isFinite(entry)) {
    return { ok: false, reason: "NO_REFERENCE", detail: "This trade has no entry price, so there is no way to tell whether the exit was on the stop side or the target side." };
  }

  const onLosingSide = (filled - entry) * sign < 0;
  const leg: SlippageLeg = onLosingSide ? "STOP" : "TARGET";
  const reference = leg === "STOP" ? trade.stopPrice : trade.targetPrice;

  if (reference == null || !Number.isFinite(reference) || reference <= 0) {
    return {
      ok: false,
      reason: "NO_REFERENCE",
      detail:
        leg === "STOP"
          ? "Your bracket closed this trade on the losing side, but no stop price was written down — so there is nothing to measure the fill against."
          : "Your bracket closed this trade in profit, but no target price was written down — so there is nothing to measure the fill against.",
    };
  }

  // One formula for both legs, and it is worth seeing why: worse always means
  // filled further from the reference in the direction that costs you, which is
  // below a long's stop AND below a long's target, above a short's stop AND
  // above a short's target. That is `(reference - filled) * sign` every time.
  const priceDelta = (reference - filled) * sign;
  const fraction = priceDelta / reference;
  const plannedRisk = trade.stopPrice != null && Number.isFinite(trade.stopPrice) ? Math.abs(entry - trade.stopPrice) : null;
  const riskFraction = plannedRisk && plannedRisk > 0 ? priceDelta / plannedRisk : null;

  const prices = exitFills.map((fill) => fill.price);
  const spread = prices.length ? Math.max(...prices) - Math.min(...prices) : 0;

  return {
    ok: true,
    leg,
    reference,
    filled,
    priceDelta,
    fraction,
    bps: fraction * 10_000,
    riskFraction,
    cost: position.closedQuantity > 0 ? priceDelta * position.closedQuantity : null,
    quoteCurrency: position.quoteCurrency || position.currency,
    legs: exitFills.length,
    spreadFraction: spread / reference,
    suspect: riskFraction != null && Math.abs(riskFraction) > SUSPECT_RISK_FRACTION,
  };
}

/**
 * What getting IN cost you, against the price you were aiming for.
 *
 * Simpler than the exit in one way and harder in another: there is no bracket
 * to identify — an entry is an entry — but the reference price exists only if
 * you wrote it down, because the exchange never records what you asked for.
 * That is what `Trade.plannedEntryPrice` is for, and why it had to be a field
 * of its own: `entryPrice` is in diffTrade(), so a sync replaces it with the
 * real fill and the two halves of this subtraction become the same number.
 *
 * THE SIGN IS INVERTED RELATIVE TO THE EXIT, and that is not a bug. Getting in
 * worse means paying MORE than you wanted on a long and receiving LESS on a
 * short — `(filled - reference) * sign`. Getting out worse means being filled
 * BELOW a long's stop or target — `(reference - filled) * sign`. Both read
 * "positive is worse for you"; they differ because you are on opposite sides of
 * the trade.
 */
export function calculateEntrySlippage(
  trade: Pick<Trade, "direction" | "plannedEntryPrice" | "stopPrice">,
  position: ReconstructedPosition,
): EntrySlippageResult {
  const reference = trade.plannedEntryPrice;
  if (reference == null || !Number.isFinite(reference) || reference <= 0) {
    return {
      ok: false,
      reason: "NO_REFERENCE",
      detail: "No intended entry price was written down, so there is nothing to compare your fill against. Fill in \u201cEntry you wanted\u201d when you log a trade and this starts working.",
    };
  }

  const filled = position.entryPrice;
  if (!Number.isFinite(filled) || filled <= 0) {
    return { ok: false, reason: "NOT_LINKED", detail: "This position has no usable entry fill price." };
  }

  const sign = dirSign(trade.direction);
  const priceDelta = (filled - reference) * sign;
  const fraction = priceDelta / reference;
  // Measured against the risk you planned, which for an entry means the stop
  // you set relative to the price you WANTED — not to the one you got. Slipping
  // into a trade quietly widens the real risk, and that is the cost worth
  // seeing.
  const plannedRisk = trade.stopPrice != null && Number.isFinite(trade.stopPrice) ? Math.abs(reference - trade.stopPrice) : null;

  return {
    ok: true,
    reference,
    filled,
    priceDelta,
    fraction,
    bps: fraction * 10_000,
    riskFraction: plannedRisk && plannedRisk > 0 ? priceDelta / plannedRisk : null,
    cost: position.quantity > 0 ? priceDelta * position.quantity : null,
    quoteCurrency: position.quoteCurrency || position.currency,
  };
}

export type EntrySlippageReading = {
  ok: true;
  reference: number;
  filled: number;
  priceDelta: number;
  fraction: number;
  bps: number;
  riskFraction: number | null;
  cost: number | null;
  quoteCurrency: string;
};

export type EntrySlippageResult =
  | EntrySlippageReading
  | { ok: false; reason: "NO_REFERENCE" | "NOT_LINKED"; detail: string };

// ── Aggregating ─────────────────────────────────────────────────────────────

export type SlippageSummary = {
  /** Readings that survived every guard — the ones the numbers are built on. */
  count: number;
  /** Readings excluded as `suspect`, reported so a missing trade is explained. */
  suspectCount: number;
  /**
   * MEDIAN, never mean. One gap-through of a stop on a thin book is ten times
   * a normal fill, and a mean over twenty readings would let that single trade
   * decide what "my slippage" is. The median says what usually happens; `worst`
   * says what the tail looks like. Both, separately, or neither is honest.
   */
  medianBps: number | null;
  worstBps: number | null;
  /** Median slippage as a share of planned risk, over readings that have one. */
  medianRiskFraction: number | null;
  /** How many readings came out better than asked (a negative delta). */
  betterThanAsked: number;
};

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function summarizeSlippage(readings: SlippageReading[]): SlippageSummary {
  const usable = readings.filter((reading) => !reading.suspect);
  const bps = usable.map((reading) => reading.bps);
  const risk = usable.map((reading) => reading.riskFraction).filter((value): value is number => value != null);

  return {
    count: usable.length,
    suspectCount: readings.length - usable.length,
    medianBps: median(bps),
    // The worst fill you took, which for slippage means the most positive —
    // sorting by magnitude would let a great fill masquerade as a bad one.
    worstBps: usable.length ? Math.max(...bps) : null,
    medianRiskFraction: median(risk),
    betterThanAsked: usable.filter((reading) => reading.bps < 0).length,
  };
}

export type SlippageGroup = SlippageSummary & { key: string; label: string };

/**
 * Slippage per symbol, because slippage is a property of a book and not of a
 * trader. SOL and BTC do not have the same depth, and one number spanning both
 * is an average of two different questions.
 */
export function slippageByInstrument(entries: Array<{ instrument: string; reading: SlippageReading }>): SlippageGroup[] {
  const buckets = new Map<string, SlippageReading[]>();
  for (const entry of entries) {
    const key = entry.instrument.trim().toUpperCase();
    const bucket = buckets.get(key);
    if (bucket) bucket.push(entry.reading);
    else buckets.set(key, [entry.reading]);
  }

  return [...buckets.entries()]
    .map(([key, readings]) => ({ key, label: key, ...summarizeSlippage(readings) }))
    .sort((a, b) => (b.medianBps ?? -Infinity) - (a.medianBps ?? -Infinity));
}
