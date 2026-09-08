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
  type SlippageResult,
} from "@/lib/slippage";
import type { Trade } from "@/lib/types";

/** Both legs for one trade, each with its own reading or its own refusal. */
export type TradeSlippageReport = { exit: SlippageResult; entry: EntrySlippageResult };

const NOT_LINKED = (detail: string) => ({ ok: false as const, reason: "NOT_LINKED" as const, detail });

export async function getTradeSlippage(trade: Trade): Promise<TradeSlippageReport> {
  const unlinked = (detail: string): TradeSlippageReport => ({ exit: NOT_LINKED(detail), entry: NOT_LINKED(detail) });

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
    };
  } catch {
    return unlinked("The exchange history could not be read.");
  }
}

export type TradeSlippage = { trade: Trade; reading: SlippageReading };

/**
 * Every measurable reading across a set of trades, in ONE pass over the
 * exchange history.
 *
 * Deliberately not `getTradeSlippage` in a loop: that would refold the whole
 * fill history per trade, which on the real account is ~425 fills folded once
 * per row on a page that renders hundreds of them.
 */
export async function getSlippageReadings(trades: Trade[]): Promise<TradeSlippage[]> {
  const linked = trades.filter((trade) => trade.exchangeKey);
  if (!linked.length) return [];

  try {
    const view = await exchangeView();
    const byKey = new Map(view.positions.map((position) => [positionKey(position), position]));
    const readings: TradeSlippage[] = [];

    for (const trade of linked) {
      const position = byKey.get(trade.exchangeKey!);
      if (!position) continue;
      const result = calculateSlippage(trade, position, view.fills, view.ledger);
      if (result.ok) readings.push({ trade, reading: result });
    }

    return readings;
  } catch {
    return [];
  }
}
