// Joining the pure slippage maths to what is actually stored.
//
// lib/slippage.ts knows nothing about the store, so this is the one file that
// fetches — the same split as lib/positions.ts against lib/coindcx-sync.ts, and
// for the same reason: every number that could be wrong lives on the pure side
// where a test can work it by hand.
//
// NEVER LOAD-BEARING. A trade page and the analytics page both render this, and
// both must paint with the exchange import switched off entirely. Every path
// here returns a refusal or an empty list; nothing throws.

import { exchangeView } from "@/lib/coindcx-sync";
import { positionKey } from "@/lib/coindcx-sync";
import {
  calculateEntrySlippage,
  calculateSlippage,
  type EntrySlippageResult,
  measurePositionOrders,
  ordersForPosition,
  type OrderReading,
  type SlippageResult,
} from "@/lib/slippage";
import type { Trade } from "@/lib/types";

/** Everything one trade's panel needs: the exchange's own reading, and the
 *  journal-based fallback for a trade with no order records behind it. */
export type TradeSlippageReport = {
  exit: SlippageResult;
  entry: EntrySlippageResult;
  /** What the EXCHANGE recorded. Preferred over both fields above whenever it
   *  is non-empty — it carries the order's own type and its own trigger price,
   *  so nothing is inferred or remembered. */
  orders: OrderReading[];
};

const NOT_LINKED = (detail: string) => ({ ok: false as const, reason: "NOT_LINKED" as const, detail });

export async function getTradeSlippage(trade: Trade): Promise<TradeSlippageReport> {
  const unlinked = (detail: string): TradeSlippageReport => ({ exit: NOT_LINKED(detail), entry: NOT_LINKED(detail), orders: [] });

  if (!trade.exchangeKey) {
    return unlinked("This trade has not been reconciled against an exchange position, so there are no real fills to compare your prices against.");
  }

  try {
    const view = await exchangeView();
    const position = view.positions.find((candidate) => positionKey(candidate) === trade.exchangeKey);
    if (!position) {
      return unlinked("The exchange position this trade was linked to is no longer in the imported history.");
    }
    return {
      exit: calculateSlippage(trade, position, view.fills, view.ledger),
      entry: calculateEntrySlippage(trade, position),
      orders: measurePositionOrders(position, view.fills, view.orders),
    };
  } catch {
    return unlinked("The exchange history could not be read.");
  }
}

/** One trade's headline reading for the aggregate. */
export type TradeSlippage = { trade: Trade; reading: OrderReading };

/**
 * Why the closed trades that produced no reading produced none.
 *
 * "Nothing measurable" is the expected answer most of the time and is
 * indistinguishable from "this feature is broken" unless the reasons are
 * counted. It is also the diagnostic: a pile of NO_ORDERS means the sync has
 * not captured order history yet, which is fixable, while a pile of
 * MANUAL_EXIT is the feature working as designed.
 */
export type SlippageCoverage = {
  considered: number;
  /** Reconciled to a position whose fills we still hold. */
  linked: number;
  /** Of those, how many had exchange ORDER records behind them. */
  withOrders: number;
  measured: number;
  byReason: Record<string, number>;
};

export const SLIPPAGE_REASON_LABELS: Record<string, string> = {
  NOT_LINKED: "not reconciled against the exchange yet",
  NO_ORDERS: "no exchange order records (synced before order history was captured)",
  NO_REFERENCE: "closed at market, so there was no price it was meant to hit",
};

export type SlippageReadings = { readings: TradeSlippage[]; coverage: SlippageCoverage };

/**
 * Every measurable reading across a set of trades, in ONE pass over the
 * exchange history.
 *
 * BUILT ONLY ON THE EXCHANGE'S OWN ORDER RECORDS, deliberately. The
 * journal-based path (calculateSlippage) still exists and still renders on a
 * single trade page as a labelled fallback, but it must not feed an aggregate,
 * because it is unreliable in two ways that a median cannot repair:
 *
 *   1. THE OBSERVED FAILURE: its reference is the stop the trader TYPED. Move a
 *      stop after entry, or type it approximately, and the journal keeps a
 *      number that was never the live bracket — so the "slip" is the distance
 *      between two unrelated prices rather than the quality of a fill. Two real
 *      BTC stop-outs read as -290bps (96% of the whole risk) and +205bps (219%,
 *      excluded) this way, on the most liquid book there is, where real
 *      execution slip is single-digit bps.
 *   2. A latent one, not the cause of the above but reachable: it infers
 *      stop-vs-target from GEOMETRY — which side of entry the exit landed on. A
 *      take-profit that finished below entry would be read as a stop and scored
 *      against the stop price. (On the two trades above the label was correct;
 *      both genuinely stopped out. The reference was the problem.)
 *
 * An order row carries the exchange's own order_type AND its own trigger price,
 * so neither failure is reachable from it.
 */
export async function getSlippageReadings(trades: Trade[]): Promise<SlippageReadings> {
  const closed = trades.filter((trade) => trade.status === "CLOSED");
  const coverage: SlippageCoverage = { considered: closed.length, linked: 0, withOrders: 0, measured: 0, byReason: {} };
  const bump = (reason: string) => {
    coverage.byReason[reason] = (coverage.byReason[reason] ?? 0) + 1;
  };

  if (!closed.length) return { readings: [], coverage };

  try {
    const view = await exchangeView();
    const byKey = new Map(view.positions.map((position) => [positionKey(position), position]));
    const readings: TradeSlippage[] = [];

    for (const trade of closed) {
      const position = trade.exchangeKey ? byKey.get(trade.exchangeKey) : undefined;
      if (!position) {
        bump("NOT_LINKED");
        continue;
      }
      coverage.linked += 1;

      // Two different situations, and the counts matter: no order rows behind
      // THIS position (the sync predates order capture) versus rows that asked
      // for no price (a market close). Both produce nothing, so the join is
      // checked before the measuring rather than blaming the sync for the
      // trader's own discretion.
      const joined = ordersForPosition(position, view.fills, view.orders);
      if (!joined.length) {
        bump("NO_ORDERS");
        continue;
      }
      coverage.withOrders += 1;

      const orders = measurePositionOrders(position, view.fills, view.orders);

      // The EXIT legs only. An entry fill is a different question (how well did
      // I get in) and averaging it with exit quality answers neither.
      const exits = orders.filter((reading) => !reading.opening);
      if (!exits.length) {
        bump("NO_REFERENCE");
        continue;
      }

      coverage.measured += 1;
      // The worst exit leg represents the trade: a position closed by a partial
      // take-profit and then a stop has two readings, and the stop is the one
      // that cost money. Averaging them inside one trade would hide it.
      const worst = exits.reduce((a, b) => (b.bps > a.bps ? b : a));
      readings.push({ trade, reading: worst });
    }

    readings.sort((a, b) => b.trade.tradeDateTime.getTime() - a.trade.tradeDateTime.getTime());
    return { readings, coverage };
  } catch {
    return { readings: [], coverage };
  }
}
