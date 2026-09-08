// What the market did while you were in the trade.
//
// The journal knows your entry, your exit and your P&L. It has never known the
// path between them, and the path is where the lessons are: whether the stop
// was nearly hit before the trade worked, how far it ran after you closed,
// whether the stop you say you had was ever actually touched. Every one of
// those is a question about candles the journal now has (lib/candles.ts).
//
// Pure and store-free, like lib/positions.ts and lib/metrics.ts. It takes
// candles and a few numbers off a trade and returns numbers. No network, no
// Firestore, no currency conversion — by the time a price reaches here it is
// already in the pair's quote currency, which is the only currency a price is
// ever in.
//
// THREE RULES IT REFUSES TO BREAK:
//
// 1. **Incomplete candles produce null, never a number.** MAE computed over a
//    window the feed only half covers UNDERSTATES the heat you took, and an
//    understated MAE is the single most dangerous output this module could
//    produce: it says a stop was comfortable when it was nearly hit. So
//    coverage is checked first and a gap at either end refuses the whole
//    calculation rather than quietly narrowing it.
//
// 2. **A 1m candle has no intra-minute path.** The candle containing the entry
//    also contains price action from before the entry, and the exit candle from
//    after the exit. We cannot know which part of that minute was yours, so
//    both are included whole and the excursions are CONSERVATIVE by
//    construction — they can overstate heat by up to one candle's range, never
//    understate it. Erring wide is the safe direction for a risk number.
//
// 3. **A disagreement is reported, not resolved.** The candle feed is a proxy
//    for the venue that actually filled you (see lib/candles.ts), and the
//    deeper book's wicks run tighter — so a stop-out that shows on your
//    exchange may not appear in this data at all. When the trade says one thing
//    and the candles say another, that gap is itself the finding, and
//    `stopCheck` names it instead of picking a winner.

import { INTERVAL_MS, type Candle, type CandleInterval } from "@/lib/candles";

export type ExcursionInput = {
  direction: "LONG" | "SHORT";
  entryAt: Date;
  entryPrice: number;
  /** null while the position is still open — excursions then run to the last
   *  candle available, which is the honest answer for a live trade. */
  exitAt: Date | null;
  exitPrice: number | null;
  /** The planned stop. Without it there is no R, so the moves are reported as
   *  percentages only — still useful, just less sharp. */
  stopPrice?: number | null;
};

/** One extreme of the move, in the three units a trader actually thinks in. */
export type Extreme = {
  price: number;
  /** Distance from entry as a fraction of the entry price. Always positive:
   *  the direction is implied by which extreme this is. */
  movePct: number;
  /** The same distance as a multiple of the risk taken (|entry − stop|). Null
   *  when no stop was recorded — the ratio has no denominator. */
  moveR: number | null;
  at: Date;
};

export type StopCheck =
  /** No stop on the trade, so there is nothing to check. */
  | { kind: "NO_STOP" }
  /** Price reached the stop while the position was open. */
  | { kind: "REACHED"; at: Date; /** How far past the stop it went, as a fraction of the stop. */ beyond: number }
  /** Price never reached it. On a trade that closed at a loss near the stop
   *  this is the interesting case: either the venue printed a wick this feed
   *  did not, or the exit was a decision rather than a stop-out. */
  | { kind: "NOT_REACHED"; /** Closest approach, as a fraction of the stop price. */ closestBy: number };

export type Drift = {
  /** How long after the exit this looks, in minutes. */
  windowMinutes: number;
  /** The best price for the position you HAD, after you left it. This is the
   *  "left on the table" number. */
  bestPrice: number;
  /** The worst it got after you left — the "good exit" number. */
  worstPrice: number;
  /** bestPrice against the exit, as a fraction of the exit price. */
  continuationPct: number;
  /** The same as a multiple of the risk taken, when a stop was recorded. */
  continuationR: number | null;
  candles: number;
};

export type Excursion = {
  /** Worst it went against you while open — the heat. */
  mae: Extreme;
  /** Best it went in your favour while open. */
  mfe: Extreme;
  /** How much of the way to the stop the heat got, as a fraction. 1 means the
   *  stop was reached in price terms. Null without a stop. This is the number
   *  that answers "was my stop too tight". */
  heatToStop: number | null;
  stopCheck: StopCheck;
  /** Null while the trade is open — there is no "after" yet. */
  drift: Drift | null;
  /** How the numbers were produced, so a UI can say so rather than implying
   *  these came off the exchange. */
  source: { interval: CandleInterval; candles: number };
};

/** Why nothing could be computed. Always a sentence a trader can act on. */
export type ExcursionRefusal = { ok: false; reason: string };
export type ExcursionResult = ({ ok: true } & Excursion) | ExcursionRefusal;

/** Post-exit lookahead is proportional to the hold: a twenty-minute trade and a
 *  six-hour trade do not need the same window. Clamped at both ends so a
 *  one-minute scalp still gets a readable answer and a two-day swing does not
 *  drag half a week of candles in. */
const DRIFT_MIN_MINUTES = 30;
const DRIFT_MAX_MINUTES = 240;

/**
 * How far past the exit the aftermath looks, for a trade held this long.
 *
 * Exported because the candle WINDOW has to cover it. The fetch pads either
 * side of the trade in proportion to the hold, which for a three-hour trade is
 * 45 minutes — while the drift window for that same trade is three hours. Sized
 * off the padding alone, the panel would confidently say "after you left (3h)"
 * over 45 minutes of data. Two places deciding how long the aftermath is, is
 * two places that will disagree.
 */
export function driftWindowMinutes(heldMs: number): number {
  return Math.min(DRIFT_MAX_MINUTES, Math.max(DRIFT_MIN_MINUTES, Math.round(heldMs / 60_000)));
}

export function calculateExcursion(
  input: ExcursionInput,
  candles: Candle[],
  interval: CandleInterval,
): ExcursionResult {
  if (candles.length === 0) return { ok: false, reason: "No candles for this trade's window." };
  if (!Number.isFinite(input.entryPrice) || input.entryPrice <= 0) {
    return { ok: false, reason: "The trade has no usable entry price." };
  }

  const stepSeconds = INTERVAL_MS[interval] / 1000;
  const entrySecond = Math.floor(input.entryAt.getTime() / 1000);
  const ordered = [...candles].sort((a, b) => a.time - b.time);

  // Still open? Run to the last candle we hold. That IS the answer for a live
  // position, and refusing would make this useless on exactly the trades a
  // trader is most anxious about.
  const exitSecond = input.exitAt
    ? Math.floor(input.exitAt.getTime() / 1000)
    : ordered[ordered.length - 1].time;

  if (exitSecond < entrySecond) return { ok: false, reason: "The trade's exit is before its entry." };

  const entryBucket = Math.floor(entrySecond / stepSeconds) * stepSeconds;
  const exitBucket = Math.floor(exitSecond / stepSeconds) * stepSeconds;

  // Rule 1. A feed that starts after the entry, or ends before the exit, cannot
  // see the whole path — and the part it cannot see is exactly where the worst
  // price may have been.
  if (ordered[0].time > entryBucket) {
    return { ok: false, reason: "The candle feed starts after this trade opened, so the heat can't be measured." };
  }
  if (ordered[ordered.length - 1].time < exitBucket) {
    return { ok: false, reason: "The candle feed ends before this trade closed, so the heat can't be measured." };
  }

  const held = ordered.filter((candle) => candle.time >= entryBucket && candle.time <= exitBucket);
  if (held.length === 0) return { ok: false, reason: "No candles cover the time this trade was open." };

  const long = input.direction === "LONG";
  const { entryPrice, stopPrice } = input;
  const risk = stopPrice != null && Number.isFinite(stopPrice) ? Math.abs(entryPrice - stopPrice) : null;
  const usableRisk = risk !== null && risk > 0 ? risk : null;

  // Rule 2: whole candles, both ends. Conservative by construction.
  const worst = long ? minBy(held, (candle) => candle.low) : maxBy(held, (candle) => candle.high);
  const best = long ? maxBy(held, (candle) => candle.high) : minBy(held, (candle) => candle.low);

  const maePrice = long ? worst.low : worst.high;
  const mfePrice = long ? best.high : best.low;

  const mae = extreme(maePrice, Math.abs(entryPrice - maePrice), entryPrice, usableRisk, worst.time);
  const mfe = extreme(mfePrice, Math.abs(mfePrice - entryPrice), entryPrice, usableRisk, best.time);

  // Only count heat as heat: a trade that never traded below its entry has a
  // MAE at the entry, not a negative one.
  const adverse = long ? Math.max(0, entryPrice - maePrice) : Math.max(0, maePrice - entryPrice);
  const heatToStop = usableRisk !== null ? adverse / usableRisk : null;

  return {
    ok: true,
    mae,
    mfe,
    heatToStop,
    stopCheck: checkStop(held, input, long),
    drift: input.exitAt ? calculateDrift(ordered, input, exitBucket, stepSeconds, long, usableRisk) : null,
    source: { interval, candles: held.length },
  };
}

function extreme(price: number, move: number, entryPrice: number, risk: number | null, timeSeconds: number): Extreme {
  return {
    price,
    movePct: move / entryPrice,
    moveR: risk !== null ? move / risk : null,
    at: new Date(timeSeconds * 1000),
  };
}

/**
 * Did price actually reach the stop while the position was open?
 *
 * Rule 3 lives here. A NOT_REACHED on a trade that closed at its stop is not an
 * error to be smoothed over — it means either this feed's book never printed
 * the wick that stopped you out, or the "stop" was a decision. Both are worth
 * knowing and neither is knowable from the trade record alone.
 */
function checkStop(held: Candle[], input: ExcursionInput, long: boolean): StopCheck {
  const { stopPrice } = input;
  if (stopPrice == null || !Number.isFinite(stopPrice) || stopPrice <= 0) return { kind: "NO_STOP" };

  const touching = held.find((candle) => (long ? candle.low <= stopPrice : candle.high >= stopPrice));

  if (touching) {
    const reached = long ? touching.low : touching.high;
    return { kind: "REACHED", at: new Date(touching.time * 1000), beyond: Math.abs(stopPrice - reached) / stopPrice };
  }

  const closest = long
    ? Math.min(...held.map((candle) => candle.low)) - stopPrice
    : stopPrice - Math.max(...held.map((candle) => candle.high));

  return { kind: "NOT_REACHED", closestBy: Math.abs(closest) / stopPrice };
}

/**
 * Where price went after you left.
 *
 * "Best" and "worst" are both from the point of view of the position you HAD:
 * for a long you closed, best is how much higher it went (what you left on the
 * table) and worst is how far it fell (what getting out saved you). Reporting
 * only one of them would turn a neutral measurement into a nudge in one
 * direction, and cutting winners early and holding losers too long are both
 * real — the number should not take a side.
 */
function calculateDrift(
  ordered: Candle[],
  input: ExcursionInput,
  exitBucket: number,
  stepSeconds: number,
  long: boolean,
  risk: number | null,
): Drift | null {
  const exitPrice = input.exitPrice;
  if (exitPrice == null || !Number.isFinite(exitPrice) || exitPrice <= 0) return null;
  if (!input.exitAt) return null;

  const windowMinutes = driftWindowMinutes(input.exitAt.getTime() - input.entryAt.getTime());
  const until = exitBucket + windowMinutes * 60;

  // Strictly after the exit candle: the candle you exited in is the trade, not
  // the aftermath, and counting it would credit the drift with your own fill.
  const after = ordered.filter((candle) => candle.time > exitBucket + stepSeconds - 1 && candle.time <= until);
  if (after.length === 0) return null;

  const bestPrice = long ? Math.max(...after.map((c) => c.high)) : Math.min(...after.map((c) => c.low));
  const worstPrice = long ? Math.min(...after.map((c) => c.low)) : Math.max(...after.map((c) => c.high));
  const continuation = long ? bestPrice - exitPrice : exitPrice - bestPrice;

  return {
    windowMinutes,
    bestPrice,
    worstPrice,
    // Signed on purpose: a negative continuation means it never went further
    // your way at all, which is a good exit and must not read as a small loss.
    continuationPct: continuation / exitPrice,
    continuationR: risk !== null ? continuation / risk : null,
    candles: after.length,
  };
}

function minBy<T>(items: T[], value: (item: T) => number): T {
  return items.reduce((best, item) => (value(item) < value(best) ? item : best));
}

function maxBy<T>(items: T[], value: (item: T) => number): T {
  return items.reduce((best, item) => (value(item) > value(best) ? item : best));
}
