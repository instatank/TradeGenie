// Everything one trade needs to be replayed: the candles it happened in, the
// fills that made it, and what the market did to it along the way.
//
// This is the only file that joins the three halves — the journal's trade
// record, the exchange's raw fills, and a third-party candle feed — so it is
// the one place that has to know how they disagree.
//
// NEVER LOAD-BEARING, and it renders inside its own <Suspense>. The trade page
// must paint with or without this: a candle provider having a bad day, an
// unmatched trade, a symbol the feed has never heard of — all of them come back
// as a reason string and the rest of the page is untouched. Same rule as the
// SignalDesk bridge, the AI path, and the offsite backup.

import { fetchCandles, INTERVAL_MS, type Candle, type CandleInterval, type ProviderId } from "@/lib/candles";
import { calculateExcursion, driftWindowMinutes, type ExcursionResult } from "@/lib/excursion";
import { exchangeView, positionKey } from "@/lib/coindcx-sync";
import type { Fill } from "@/lib/positions";
import { REPLAY_LEAD_IN_BARS } from "@/lib/replay-shape";
import type { Trade } from "@/lib/types";

/**
 * One mark on the chart. NOT one fill.
 *
 * The probe turned up a real position with 23 fills, 22 of them identical:
 * same second, same side, same price. That is ONE exit order filling against 22
 * counterparties, and CoinDCX reports each leg. Drawing 22 arrows on one candle
 * would read as a broken chart rather than as a big exit, so fills are folded by
 * minute and side, the price volume-weighted, and the leg count kept so the
 * label can say "×22" — which is the interesting part.
 */
export type FillMarker = {
  /** Epoch seconds, bucketed to the chart's interval. */
  time: number;
  side: "BUY" | "SELL";
  /** Volume-weighted across the legs folded in here. */
  price: number;
  quantity: number;
  /** How many exchange fills this one mark represents. */
  legs: number;
  at: Date;
};

export type TradeReplay = {
  ok: true;
  instrument: string;
  interval: CandleInterval;
  candles: Candle[];
  markers: FillMarker[];
  source: ProviderId;
  entryAt: Date;
  /** null when the trade is still open. */
  exitAt: Date | null;
  entryPrice: number;
  exitPrice: number | null;
  stopPrice: number | null;
  targetPrice: number | null;
  direction: "LONG" | "SHORT";
  excursion: ExcursionResult;
  /** True when the fills came from the exchange rather than being inferred from
   *  the trade record. The UI says so: a two-marker chart built from a
   *  hand-logged trade is a sketch, not a record of what you did. */
  fromExchange: boolean;
};

export type TradeReplayResult = TradeReplay | { ok: false; reason: string };

/** Context either side of the trade, as a share of how long it was held. A
 *  chart that starts exactly at the entry hides the setup that produced it. */
const PADDING_RATIO = 0.25;
const MIN_PADDING_MS = 15 * 60 * 1000;
const MAX_PADDING_MS = 4 * 60 * 60 * 1000;

/** A trade still open, or one with no exit time, gets this much chart. */
const OPEN_TRADE_WINDOW_MS = 4 * 60 * 60 * 1000;

/** Above this the chart is unreadable and the fetch needs paging; below ~80 a
 *  1m chart of a short scalp is mostly whitespace. The interval is chosen to
 *  land inside the range rather than being fixed at 1m. */
const MAX_CANDLES = 700;



/**
 * The finest interval that keeps the whole window under MAX_CANDLES.
 *
 * A 40-minute scalp wants 1m bars; a four-day swing at 1m would be 5,760 of
 * them — six pages of fetching to draw a smear. Same chart, different question.
 */
export function chooseInterval(windowMs: number): CandleInterval {
  const ladder: CandleInterval[] = ["1m", "5m", "15m", "1h", "4h", "1d"];
  return ladder.find((interval) => windowMs / INTERVAL_MS[interval] <= MAX_CANDLES) ?? "1d";
}

/**
 * Fold raw fills into one mark per (bucket, side).
 *
 * Pure and exported so the 22-legs-one-order case is pinned by a test rather
 * than discovered on a chart.
 */
export function aggregateFills(
  fills: Array<{ timestamp: Date; price: number; quantity: number; side: "BUY" | "SELL" }>,
  interval: CandleInterval,
): FillMarker[] {
  const step = INTERVAL_MS[interval] / 1000;
  const buckets = new Map<string, FillMarker & { notional: number; uniform: boolean; firstPrice: number }>();

  for (const fill of fills) {
    const time = Math.floor(fill.timestamp.getTime() / 1000 / step) * step;
    const key = `${time}|${fill.side}`;
    const existing = buckets.get(key);

    if (existing) {
      existing.notional += fill.price * fill.quantity;
      existing.quantity += fill.quantity;
      existing.legs += 1;
      existing.uniform = existing.uniform && fill.price === existing.firstPrice;
      // Volume-weighted, so a big leg moves the mark more than a dust one.
      // Falls back to the last price if every leg had zero quantity, which
      // would otherwise divide by zero and render NaN on the chart.
      //
      // When every leg filled at the SAME price — the common case, and exactly
      // what one order against many counterparties looks like — the answer is
      // that price, stated verbatim. Summing 22 copies of 87.6 and dividing
      // gives 87.59999999999997, which is float error this function
      // INTRODUCED; the house rule against tidying exchange numbers is about
      // not discarding precision we were handed, not about manufacturing noise.
      existing.price = existing.uniform
        ? existing.firstPrice
        : existing.quantity > 0
          ? existing.notional / existing.quantity
          : fill.price;
    } else {
      buckets.set(key, {
        time,
        side: fill.side,
        price: fill.price,
        quantity: fill.quantity,
        notional: fill.price * fill.quantity,
        legs: 1,
        at: fill.timestamp,
        uniform: true,
        firstPrice: fill.price,
      });
    }
  }

  // Rebuilt field by field rather than destructured, so the bookkeeping the
  // fold needs (running notional, whether every leg shared a price) cannot leak
  // out into the value the chart renders.
  return [...buckets.values()]
    .map(
      (bucket): FillMarker => ({
        time: bucket.time,
        side: bucket.side,
        price: bucket.price,
        quantity: bucket.quantity,
        legs: bucket.legs,
        at: bucket.at,
      }),
    )
    .sort((a, b) => a.time - b.time);
}

/**
 * The fills belonging to this trade, from the exchange.
 *
 * A trade is linked to a reconstructed position by `exchangeKey` — the same key
 * /import reconciles on — and the position carries the ids of its own fills. So
 * this never guesses which fills were "near" a trade: it follows the link the
 * trader already accepted.
 */
async function exchangeFillsForTrade(trade: Trade): Promise<Fill[] | null> {
  if (!trade.exchangeKey) return null;

  const view = await exchangeView();
  const position = view.positions.find((candidate) => positionKey(candidate) === trade.exchangeKey);
  if (!position) return null;

  const byId = new Map(view.fills.map((fill) => [fill.id, fill]));
  const fills = position.fillIds
    .map((id) => byId.get(id))
    .filter((fill): fill is Fill => Boolean(fill))
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  return fills.length > 0 ? fills : null;
}

/**
 * Build the replay for one trade.
 *
 * Returns a reason rather than throwing, for every way this can come up empty:
 * an unusable trade record, a symbol the feed doesn't carry, a window the feed
 * can't cover. The caller renders the reason.
 */
export async function getTradeReplay(trade: Trade): Promise<TradeReplayResult> {
  try {
    if (trade.direction !== "LONG" && trade.direction !== "SHORT") {
      return { ok: false, reason: "This trade has no direction recorded, so there is nothing to replay." };
    }
    if (trade.entryPrice == null || !Number.isFinite(trade.entryPrice)) {
      return { ok: false, reason: "This trade has no entry price, so there is nothing to place on a chart." };
    }

    const fills = await exchangeFillsForTrade(trade);
    const entryAt = fills?.[0]?.timestamp ?? trade.tradeDateTime;

    // The exchange knows when the position actually closed; the journal does
    // not — Trade has no exit timestamp, only tradeDateTime at the entry. So a
    // hand-logged closed trade genuinely has no end, and inventing one from
    // updatedAt would date the chart to whenever the record was last touched.
    const lastFill = fills && fills.length > 1 ? fills[fills.length - 1].timestamp : null;
    const exitAt = trade.status === "CLOSED" ? lastFill : null;

    const heldMs = exitAt ? Math.max(exitAt.getTime() - entryAt.getTime(), 60_000) : OPEN_TRADE_WINDOW_MS;
    const padding = Math.min(MAX_PADDING_MS, Math.max(MIN_PADDING_MS, heldMs * PADDING_RATIO));
    // The trailing edge must cover the aftermath the excursion will measure,
    // not just the chart's cosmetic padding — otherwise "after you left (3h)"
    // gets computed over 45 minutes and nothing says so.
    const trailing = exitAt ? Math.max(padding, driftWindowMinutes(heldMs) * 60_000) : padding;
    const endsAt = (exitAt?.getTime() ?? entryAt.getTime() + OPEN_TRADE_WINDOW_MS) + trailing;

    // The lead-in is measured in BARS, not minutes, so it always fills the
    // chart's window — but the bar size depends on how long the window is,
    // which depends on the lead-in. Settle it by iterating: a couple of passes
    // is always enough, and the loop is bounded so it cannot spin.
    let interval = chooseInterval(endsAt - (entryAt.getTime() - padding));
    let leading = padding;
    for (let pass = 0; pass < 3; pass += 1) {
      leading = Math.max(padding, REPLAY_LEAD_IN_BARS * INTERVAL_MS[interval]);
      const settled = chooseInterval(endsAt - (entryAt.getTime() - leading));
      if (settled === interval) break;
      interval = settled;
    }

    const from = new Date(entryAt.getTime() - leading);
    const to = new Date(endsAt);

    const feed = await fetchCandles({ instrument: trade.instrument, interval, from, to });
    if (feed.candles.length === 0 || !feed.source) return { ok: false, reason: feed.detail };

    const markers = fills
      ? aggregateFills(fills, interval)
      : syntheticMarkers(trade, entryAt, exitAt, interval);

    return {
      ok: true,
      instrument: trade.instrument,
      interval,
      candles: feed.candles,
      markers,
      source: feed.source,
      entryAt,
      exitAt,
      entryPrice: trade.entryPrice,
      exitPrice: trade.exitPrice ?? null,
      stopPrice: trade.stopPrice ?? null,
      targetPrice: trade.targetPrice ?? null,
      direction: trade.direction,
      fromExchange: fills !== null,
      excursion: excursionFor(trade, entryAt, exitAt, feed.candles, interval),
    };
  } catch (error) {
    // Nothing about a chart is worth taking the trade page down for.
    return { ok: false, reason: error instanceof Error ? error.message : "The replay could not be built." };
  }
}

/**
 * Excursions, but only when the window they'd be measured over is the trade.
 *
 * A CLOSED trade with no exit timestamp is the trap. `Trade` stores
 * tradeDateTime at the entry and nothing at the exit, so a hand-logged trade
 * that has been closed has no end — and calculateExcursion, handed exitAt:
 * null, runs to the last candle it holds because that IS the right answer for
 * a position still open. On a closed trade it is not: it would report heat from
 * hours after the trader had already left, as "the risk you took". Numbers
 * about the wrong window are worse than no numbers, so this refuses and says
 * which fact is missing.
 *
 * The chart still draws — seeing the market around a trade is useful even when
 * its bounds are unknown. Only the claims about the trade are withheld.
 */
function excursionFor(
  trade: Trade,
  entryAt: Date,
  exitAt: Date | null,
  candles: Candle[],
  interval: CandleInterval,
): ExcursionResult {
  if (trade.status === "CLOSED" && exitAt === null) {
    return {
      ok: false,
      reason:
        "This trade is closed but has no exit time recorded — only trades linked to exchange fills carry one. " +
        "Measuring the heat would mean guessing when you actually got out.",
    };
  }

  return calculateExcursion(
    {
      direction: trade.direction as "LONG" | "SHORT",
      entryAt,
      entryPrice: trade.entryPrice as number,
      exitAt,
      exitPrice: trade.exitPrice ?? null,
      stopPrice: trade.stopPrice ?? null,
    },
    candles,
    interval,
  );
}

/**
 * A hand-logged trade has no fills, only the two prices the trader typed. Mark
 * those, and let the caller say the chart is a sketch rather than a record.
 */
function syntheticMarkers(
  trade: Trade,
  entryAt: Date,
  exitAt: Date | null,
  interval: CandleInterval,
): FillMarker[] {
  const long = trade.direction === "LONG";
  const legs: Array<{ timestamp: Date; price: number; quantity: number; side: "BUY" | "SELL" }> = [
    {
      timestamp: entryAt,
      price: trade.entryPrice as number,
      quantity: trade.quantity ?? 0,
      side: long ? "BUY" : "SELL",
    },
  ];

  if (exitAt && trade.exitPrice != null) {
    legs.push({
      timestamp: exitAt,
      price: trade.exitPrice,
      quantity: trade.quantity ?? 0,
      side: long ? "SELL" : "BUY",
    });
  }

  return aggregateFills(legs, interval);
}
