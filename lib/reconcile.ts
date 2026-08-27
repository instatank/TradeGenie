// Matching what the exchange did against what you wrote down.
//
// The journal and the exchange record the same trade from two ends. You log at
// entry, in your own words, approximately. The exchange knows the exact prices,
// the real fees and the funding — but nothing about why. Reconciling means
// joining them without either side overwriting what the other is authoritative
// about.
//
// The rules that follow from that, and which the rest of this file enforces:
//
//   - The exchange owns the NUMBERS. Entry, exit, size, fees, funding, P&L.
//   - You own the WORDS, and everything judgemental: thesis, mind state, setup,
//     mechanisms, grade, mistakes, lesson, tags. Nothing here ever writes those.
//   - A position you never journaled is NOT silently turned into a trade. It is
//     surfaced so you can log it. Auto-creating trades would remove the reason
//     the journal exists, which is the habit of writing down why.
//
// Pure and store-free, so the matching can be tested without a network or a
// database — the same reasoning as lib/calculator.ts and lib/positions.ts.

import type { ReconstructedPosition } from "@/lib/positions";
import type { Trade } from "@/lib/types";

/**
 * How far apart a logged trade and an exchange position may sit and still be
 * the same trade. You normally log within minutes of entering, but writing up
 * the evening after is normal too, and a trade taken late at night gets
 * journaled the next morning. 36 hours covers that without being so wide that
 * two separate swings at the same symbol blur together.
 */
export const MATCH_WINDOW_HOURS = 36;

const MATCH_WINDOW_MS = MATCH_WINDOW_HOURS * 60 * 60 * 1000;

export type Match = {
  position: ReconstructedPosition;
  trade: Trade;
  /** How far apart the two entry times were, in minutes. Shown so a match that
   *  looks wrong can be judged rather than just trusted. */
  minutesApart: number;
  /** True when the trade already carries this position's key — an established
   *  link, not a fresh guess. */
  confirmed: boolean;
};

export type MatchResult = {
  matches: Match[];
  /** Exchange positions with no journal entry. These become the Today nudge —
   *  never an auto-created trade. */
  unmatched: ReconstructedPosition[];
};

function sameInstrument(a: string, b: string): boolean {
  return a.trim().toUpperCase() === b.trim().toUpperCase();
}

function sameDirection(position: ReconstructedPosition, trade: Trade): boolean {
  return position.direction === trade.direction;
}

/**
 * Join exchange positions to journal trades.
 *
 * An existing link always wins: once a trade carries a position's key, that
 * pairing is settled and no proximity heuristic gets to second-guess it.
 * Everything else is matched nearest-in-time first, so when two candidates
 * compete for one trade the closer one takes it and the other is reported
 * unmatched rather than both quietly claiming it.
 */
export function matchPositions(positions: ReconstructedPosition[], trades: Trade[], keyOf: (position: ReconstructedPosition) => string): MatchResult {
  const matches: Match[] = [];
  const unmatched: ReconstructedPosition[] = [];
  const claimedTradeIds = new Set<string>();

  const byKey = new Map<string, Trade>();
  for (const trade of trades) {
    if (trade.exchangeKey) byKey.set(trade.exchangeKey, trade);
  }

  // Established links first, so they can't be stolen by a closer stranger.
  const stillLoose: ReconstructedPosition[] = [];
  for (const position of positions) {
    const linked = byKey.get(keyOf(position));
    if (!linked) {
      stillLoose.push(position);
      continue;
    }
    claimedTradeIds.add(linked.id);
    matches.push({
      position,
      trade: linked,
      minutesApart: minutesBetween(position.openedAt, linked.tradeDateTime),
      confirmed: true,
    });
  }

  // Then proposals, best-first across all candidates rather than per position,
  // so the order positions happen to arrive in cannot change the outcome.
  type Proposal = { position: ReconstructedPosition; trade: Trade; distance: number };
  const proposals: Proposal[] = [];
  for (const position of stillLoose) {
    for (const trade of trades) {
      if (trade.exchangeKey) continue;
      if (!sameInstrument(position.instrument, trade.instrument)) continue;
      if (!sameDirection(position, trade)) continue;
      const distance = Math.abs(position.openedAt.getTime() - trade.tradeDateTime.getTime());
      if (distance > MATCH_WINDOW_MS) continue;
      proposals.push({ position, trade, distance });
    }
  }
  proposals.sort((a, b) => a.distance - b.distance);

  const takenPositions = new Set<ReconstructedPosition>();
  for (const proposal of proposals) {
    if (takenPositions.has(proposal.position)) continue;
    if (claimedTradeIds.has(proposal.trade.id)) continue;
    takenPositions.add(proposal.position);
    claimedTradeIds.add(proposal.trade.id);
    matches.push({
      position: proposal.position,
      trade: proposal.trade,
      minutesApart: Math.round(proposal.distance / 60000),
      confirmed: false,
    });
  }

  for (const position of stillLoose) {
    if (!takenPositions.has(position)) unmatched.push(position);
  }

  return { matches, unmatched };
}

function minutesBetween(a: Date, b: Date): number {
  return Math.round(Math.abs(a.getTime() - b.getTime()) / 60000);
}

export type FieldDiff = {
  field: keyof Trade;
  label: string;
  logged: number | null;
  exchange: number | null;
  /** True when accepting would actually change the stored value. */
  changed: boolean;
};

// Below this, two numbers are the same number wearing different rounding.
const SAME = 1e-9;

function differs(logged: number | null, exchange: number | null): boolean {
  if (exchange === null) return false;
  if (logged === null) return true;
  return Math.abs(logged - exchange) > SAME;
}

/**
 * What accepting the exchange's version would change.
 *
 * Only the objective columns appear here — this is the list of fields the
 * exchange is allowed to touch, and it is deliberately short. A field absent
 * from it can never be written by a sync, which is what keeps the journal's
 * subjective half safe by construction rather than by care.
 */
export function diffTrade(trade: Trade, position: ReconstructedPosition): FieldDiff[] {
  const rows: Array<[keyof Trade, string, number | null, number | null]> = [
    ["entryPrice", "Entry price", trade.entryPrice, position.entryPrice],
    ["exitPrice", "Exit price", trade.exitPrice, position.exitPrice],
    ["quantity", "Quantity", trade.quantity, position.quantity],
    ["fees", "Fees", trade.fees, position.fees],
    ["funding", "Funding", trade.funding, position.funding],
    ["realizedPnl", "Realized P&L (gross)", trade.realizedPnl, position.status === "CLOSED" ? position.grossPnl : null],
    ["netPnl", "Net P&L (after costs)", trade.netPnl, position.status === "CLOSED" ? position.netPnl : null],
  ];

  return rows.map(([field, label, logged, exchange]) => ({
    field,
    label,
    logged,
    exchange,
    changed: differs(logged, exchange),
  }));
}

/** Just the fields worth writing — the ones that would actually change. */
export function changedFields(diff: FieldDiff[]): FieldDiff[] {
  return diff.filter((row) => row.changed);
}

/**
 * The patch to apply when a match is accepted.
 *
 * Built only from the diff, so it can never contain a field diffTrade does not
 * list. Status follows the exchange too: a position the exchange shows closed
 * is closed, whatever the journal still says.
 */
export function acceptPatch(match: Match, key: string): Partial<Trade> {
  const patch: Partial<Trade> = { exchangeKey: key };
  for (const row of changedFields(diffTrade(match.trade, match.position))) {
    if (row.exchange === null) continue;
    (patch as Record<string, unknown>)[row.field] = row.exchange;
  }
  if (match.position.status === "CLOSED" && match.trade.status !== "CLOSED") {
    patch.status = "CLOSED";
  }
  return patch;
}
