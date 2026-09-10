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
  type SlippageReading,
  measurePositionOrders,
  type OrderReading,
  type SlippageResult,
} from "@/lib/slippage";
import type { Trade } from "@/lib/types";

/** Both legs for one trade, each with its own reading or its own refusal. */
export type TradeSlippageReport = {
  exit: SlippageResult;
  entry: EntrySlippageResult;
  /**
   * What the EXCHANGE recorded, which beats both of the above when present: the
   * order states its own leg and carries the trigger price actually set, so
   * nothing is inferred from geometry or remembered from the journal.
   *
   * Empty on any trade whose orders were never captured — every trade synced
   * before /orders was called — and that reads as "unknown", never as "no
   * order existed".
   */
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

export type TradeSlippage = { trade: Trade; reading: SlippageReading };

/**
 * Why the trades that produced no reading produced none.
 *
 * This exists because "nothing measurable" is the expected answer most of the
 * time and is indistinguishable, from the outside, from "this feature is
 * broken". Counting where each trade fell out turns a blank panel into a
 * sentence — and, more usefully, tells us WHICH of the four reasons dominates:
 * a pile of MANUAL_EXIT is the feature working as designed on a trader who
 * closes by hand, and a pile of NO_LEDGER is the exchange join failing and is
 * a bug to chase.
 */
export type SlippageCoverage = {
  /** Closed trades considered at all. */
  considered: number;
  /** Of those, how many are reconciled to a position we still hold fills for. */
  linked: number;
  /** Of those, how many produced a reading. */
  measured: number;
  /** Reason → count, over the linked trades that produced nothing. */
  byReason: Record<string, number>;
};

/** Plain English for each refusal, for a reader who did not write the code. */
export const SLIPPAGE_REASON_LABELS: Record<string, string> = {
  NOT_LINKED: "not reconciled against the exchange yet",
  NOT_CLOSED: "still open",
  MANUAL_EXIT: "you closed it by hand, so there is no price it was meant to hit",
  NO_LEDGER: "the exchange ledger has no row for the exit (it does not reach back this far)",
  NO_REFERENCE: "no stop or target was written down before it closed",
};

export type SlippageReadings = { readings: TradeSlippage[]; coverage: SlippageCoverage };

/**
 * Every measurable reading across a set of trades, in ONE pass over the
 * exchange history, plus an account of everything that produced nothing.
 *
 * Deliberately not `getTradeSlippage` in a loop: that would refold the whole
 * fill history per trade, which on the real account is ~425 fills folded once
 * per row on a page that renders hundreds of them.
 */
export async function getSlippageReadings(trades: Trade[]): Promise<SlippageReadings> {
  // Only closed trades can have an exit to measure, so an open book is not a
  // failure and must not be counted as one.
  const closed = trades.filter((trade) => trade.status === "CLOSED");
  const coverage: SlippageCoverage = { considered: closed.length, linked: 0, measured: 0, byReason: {} };
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

      const result = calculateSlippage(trade, position, view.fills, view.ledger);
      if (result.ok) {
        coverage.measured += 1;
        readings.push({ trade, reading: result });
      } else {
        bump(result.reason);
      }
    }

    // Newest first: the fill you took this morning is the one you can still
    // picture, and it is the one worth checking a new number against.
    readings.sort((a, b) => b.trade.tradeDateTime.getTime() - a.trade.tradeDateTime.getTime());
    return { readings, coverage };
  } catch {
    return { readings: [], coverage };
  }
}
