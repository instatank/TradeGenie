// How much of the journal's money can be trusted.
//
// The journal was hand-typed for months before the exchange import existed, and
// hand-typing money is where the errors are. The owner's own account of it:
// they were recording everything in rupees, so a $5 loss on a USDT-margined
// trade was entered as 500 — and sometimes, by slip, as 5. A trade that should
// read ₹500 reads ₹5, and nothing in the app could tell the difference, because
// ₹5 is a perfectly valid number.
//
// This module does not guess and does not repair. It COMPARES: every closed
// trade against the CoinDCX position it matches, field by field, and reports
// where the two disagree. The exchange is the source of truth for money, so a
// disagreement is a journal error by definition — the only question is how big
// and how many.
//
// Pure and store-free, like every other module whose numbers matter, so the
// 100x detection can be worked by hand in a test rather than eyeballed on a
// page that is itself the thing under suspicion.

import { changedFields, diffTrade, type Match } from "@/lib/reconcile";
import type { Trade } from "@/lib/types";

/**
 * How far off a single money field is, expressed as the ratio the journal would
 * have to be multiplied by to reach the exchange's figure.
 *
 * A ratio near 100 is the owner's suspected slip (₹5 typed where ₹500 was
 * meant). A ratio near 1 is a rounding difference. Anything else is its own
 * kind of wrong and is reported as-is rather than forced into a story.
 */
export type FieldGap = {
  field: string;
  label: string;
  logged: number | null;
  exchange: number;
  /** exchange / logged, when both are non-zero and same-signed. Null otherwise —
   *  a ratio against zero or across a sign flip means nothing. */
  ratio: number | null;
};

export type TradeAudit = {
  trade: Trade;
  instrument: string;
  /** True when the trade already carried this position's key — an established
   *  link rather than a fresh proximity guess. */
  confirmed: boolean;
  gaps: FieldGap[];
  /**
   * At least one money field is off by roughly 100x. Named separately from
   * "disagrees" because it is a specific, correctable mistake with a known
   * cause, and because seeing the count is what turns the owner's hunch into
   * something decided rather than believed.
   */
  looksScaled: boolean;
};

export type JournalAudit = {
  /** Closed trades looked at. */
  considered: number;
  /** Matched to a CoinDCX position. */
  matched: number;
  /** Matched AND already agreeing with the exchange — nothing to do. */
  clean: number;
  /** Matched and disagreeing. These are the repairable ones. */
  disagreeing: TradeAudit[];
  /**
   * Closed trades with no CoinDCX position at all. Their numbers can never be
   * checked against anything, which is a harder problem than a wrong number:
   * a wrong number can be corrected, an unverifiable one can only be trusted or
   * deleted. Named so the size of that set is known rather than assumed small.
   */
  unmatched: Trade[];
};

/** Money fields only. A quantity is units of a coin and a price is in the quote
 *  currency; neither is subject to the rupee-conversion slip this looks for. */
const MONEY_FIELDS = new Set(["fees", "funding", "realizedPnl", "netPnl"]);

/** Within this factor of 100, a gap is the suspected rupee slip. Wide on
 *  purpose: fees and funding drift between the two records for real reasons, so
 *  a gap of 80x or 130x is still obviously the same mistake, and a tight band
 *  would miss the very rows the owner is trying to find. */
const SCALE_LOW = 50;
const SCALE_HIGH = 200;

function ratioOf(logged: number | null, exchange: number): number | null {
  if (logged === null || logged === 0 || exchange === 0) return null;
  // A sign flip is a different error (a loss recorded as a gain), and dividing
  // across it produces a negative ratio that would read as a scale factor.
  if (Math.sign(logged) !== Math.sign(exchange)) return null;
  return exchange / logged;
}

export function isScaleSlip(ratio: number | null): boolean {
  if (ratio === null) return false;
  const magnitude = Math.abs(ratio);
  return magnitude >= SCALE_LOW && magnitude <= SCALE_HIGH;
}

/** One trade against its exchange position. */
export function auditMatch(match: Match): TradeAudit {
  const rows = changedFields(diffTrade(match.trade, match.position));

  const gaps: FieldGap[] = rows
    .filter((row) => row.exchange !== null)
    .map((row) => ({
      field: String(row.field),
      label: row.label,
      logged: row.logged,
      exchange: row.exchange as number,
      ratio: ratioOf(row.logged, row.exchange as number),
    }));

  return {
    trade: match.trade,
    instrument: match.position.instrument,
    confirmed: match.confirmed,
    gaps,
    looksScaled: gaps.some((gap) => MONEY_FIELDS.has(gap.field) && isScaleSlip(gap.ratio)),
  };
}

/**
 * The whole journal against the whole exchange history.
 *
 * Takes matches and the unmatched trades rather than doing its own matching, so
 * this can never disagree with what /import shows: one matcher, one answer.
 */
export function auditJournal(matches: Match[], closedTrades: Trade[]): JournalAudit {
  const audits = matches.map(auditMatch);
  const matchedIds = new Set(matches.map((match) => match.trade.id));

  return {
    considered: closedTrades.length,
    matched: matches.length,
    clean: audits.filter((audit) => audit.gaps.length === 0).length,
    disagreeing: audits
      .filter((audit) => audit.gaps.length > 0)
      // Scale slips first: they are the biggest errors and the ones with a
      // known cause, so they are what a reader should see before scrolling.
      .sort((a, b) => Number(b.looksScaled) - Number(a.looksScaled)),
    unmatched: closedTrades.filter((trade) => !matchedIds.has(trade.id)),
  };
}

/** How many of the disagreeing trades carry a suspected rupee slip. */
export function countScaleSlips(audit: JournalAudit): number {
  return audit.disagreeing.filter((entry) => entry.looksScaled).length;
}
