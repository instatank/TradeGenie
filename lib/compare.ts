import {
  bucketStatsFor,
  calculateProfitFactor,
  expectancyBreakdown,
  MIN_SAMPLE,
  type MetricTrade,
} from "@/lib/metrics";
import type { SavedView } from "@/lib/types";

/**
 * Side-by-side comparison for /analytics: the filtered set against something
 * to judge it by.
 *
 * The comparison target is a FILTER SPEC, not a special kind of saved object —
 * `?vs=` holds a query string, and a saved view is simply the convenient way to
 * pick one. That is the whole design: a saved view is already just a URL
 * (lib/types.ts `SavedView.path`), so "compare against a saved view" and
 * "compare against an arbitrary filter" are the same feature, and neither
 * needs storage of its own.
 *
 * Two targets are built in because they answer questions a saved view cannot:
 *
 * - **rest** — everything NOT in the filtered set. This is the default, and it
 *   is the one that actually answers "is this worth doing more of". Comparing a
 *   subset against the whole journal compares it against a set that CONTAINS
 *   it, so a strong subset drags its own baseline up and the gap reads smaller
 *   than it is. The complement has no such contamination.
 * - **all** — the whole journal, for when "how does this compare to my overall
 *   record" is genuinely the question being asked. Offered, but not the default,
 *   and the overlap is stated on screen rather than left to be discovered.
 */
export type ComparisonTarget =
  | { kind: "rest" }
  | { kind: "all" }
  | { kind: "filter"; query: string; label: string };

export const COMPARE_REST = "rest";
export const COMPARE_ALL = "all";

/** The query string of a saved view, if it points at /analytics. Saved views
 *  from other pages are not offered: their params filter a list, not this page,
 *  and half of them (`view`, `page`, `sort`) mean something different here. */
export function analyticsViewQuery(view: SavedView): string | null {
  const [path, query] = view.path.split("?");
  if (path !== "/analytics") return null;
  return query ?? "";
}

export function parseComparison(vs: string | undefined, views: SavedView[]): ComparisonTarget | null {
  const raw = (vs ?? "").trim();
  if (!raw) return null;
  if (raw === COMPARE_REST) return { kind: "rest" };
  if (raw === COMPARE_ALL) return { kind: "all" };
  // A saved view is matched by its query string, so renaming a view keeps a
  // comparison URL working and two views with identical filters are the same
  // comparison — which they are.
  const match = views.find((view) => analyticsViewQuery(view) === raw);
  return { kind: "filter", query: raw, label: match?.name ?? "Comparison filter" };
}

/** The query string a comparison target filters by, for the page to turn into
 *  params. `rest` has none — it is defined by subtraction, not by a filter. */
export function comparisonQuery(target: ComparisonTarget): string | null {
  return target.kind === "filter" ? target.query : null;
}

export type ComparisonMetric = {
  label: string;
  /** How to read the number. The page owns currency formatting. */
  format: "count" | "percent" | "r" | "money" | "score" | "ratio";
  a: number | null;
  b: number | null;
  /** Whether a higher number is the better outcome. `null` for trade counts —
   *  more trades is neither good nor bad, and colouring it would imply it is. */
  higherIsBetter: boolean | null;
};

export type Comparison = {
  aLabel: string;
  bLabel: string;
  aCount: number;
  bCount: number;
  metrics: ComparisonMetric[];
  /** Closed trades present on BOTH sides. Non-zero means the two sets overlap,
   *  so the comparison is not between independent groups — stated, never hidden. */
  overlap: number;
  /** Either side too small to conclude anything from. */
  thin: boolean;
};

/**
 * Build the comparison. Both sides go through `bucketStatsFor`, which is the
 * same function the analytics tables use — so a number here can never disagree
 * with the same number in a table below it.
 */
export function buildComparison(
  aTrades: MetricTrade[],
  bTrades: MetricTrade[],
  labels: { a: string; b: string },
): Comparison {
  const a = bucketStatsFor("a", labels.a, aTrades);
  const b = bucketStatsFor("b", labels.b, bTrades);
  const aExpectancy = expectancyBreakdown(aTrades);
  const bExpectancy = expectancyBreakdown(bTrades);

  const closedIds = (trades: MetricTrade[]) =>
    new Set(trades.filter((trade) => trade.status === "CLOSED").map((trade) => idOf(trade)).filter(Boolean));
  const aIds = closedIds(aTrades);
  const bIds = closedIds(bTrades);
  let overlap = 0;
  for (const id of aIds) if (bIds.has(id)) overlap += 1;

  return {
    aLabel: labels.a,
    bLabel: labels.b,
    aCount: a.count,
    bCount: b.count,
    overlap,
    thin: a.count < MIN_SAMPLE || b.count < MIN_SAMPLE,
    metrics: [
      { label: "Closed trades", format: "count", a: a.count, b: b.count, higherIsBetter: null },
      { label: "Win rate", format: "percent", a: a.winRate, b: b.winRate, higherIsBetter: true },
      { label: "Expectancy", format: "r", a: a.expectancyR, b: b.expectancyR, higherIsBetter: true },
      {
        label: "P&L per trade",
        format: "money",
        a: aExpectancy.expectancyCurrency,
        b: bExpectancy.expectancyCurrency,
        higherIsBetter: true,
      },
      // Win rate alone says nothing about whether the wins are worth having.
      // These two next to it are the whole shape of how the money is made:
      // "I win 40% of the time and my winners are 3x my losers" is a complete
      // description of a strategy; either number on its own is not.
      { label: "Average win", format: "money", a: emptyToNull(aExpectancy.avgWin), b: emptyToNull(bExpectancy.avgWin), higherIsBetter: true },
      // Shown as a positive magnitude, so a SMALLER average loss is the better
      // outcome — hence higherIsBetter: false.
      { label: "Average loss", format: "money", a: emptyToNull(aExpectancy.avgLoss), b: emptyToNull(bExpectancy.avgLoss), higherIsBetter: false },
      // Gross wins / gross losses. The best single "is this worth doing"
      // number, and a ratio, so it compares two slices of different sizes
      // fairly where a total never can. Null when there are no losses yet:
      // the ratio is undefined, not infinite.
      {
        label: "Profit factor",
        format: "ratio",
        a: calculateProfitFactor(closedOf(aTrades)),
        b: calculateProfitFactor(closedOf(bTrades)),
        higherIsBetter: true,
      },
      { label: "Net P&L", format: "money", a: a.netPnl, b: b.netPnl, higherIsBetter: true },
      { label: "Process score", format: "score", a: a.avgProcessScore, b: b.avgProcessScore, higherIsBetter: true },
    ],
  };
}

const closedOf = (trades: MetricTrade[]) => trades.filter((trade) => trade.status === "CLOSED");

/** expectancyBreakdown returns 0 for "no wins" and "no losses" alike, which in
 *  a comparison would read as a real average of zero rather than "none yet". */
function emptyToNull(value: number) {
  return value === 0 ? null : value;
}

/** A trade's id, when the caller passed real trades. MetricTrade does not
 *  require one (the metrics never needed it), so overlap degrades to 0 rather
 *  than throwing if it is ever called with synthetic rows. */
function idOf(trade: MetricTrade): string {
  return (trade as MetricTrade & { id?: string }).id ?? "";
}

/** Net P&L is a total, so it scales with how many trades a side has: the bigger
 *  side wins it almost by definition. Comparing totals across sets of different
 *  sizes is the most common way a comparison lies. Every other row here is a
 *  per-trade figure or a ratio and is fair as-is, so the panel marks the one
 *  exception rather than badging the seven that need no warning. */
export const TOTAL_METRICS = new Set(["Net P&L"]);
