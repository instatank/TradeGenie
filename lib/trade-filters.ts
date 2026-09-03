import { getCalendarRange, isWithinCalendarRange } from "@/lib/calendar";
import { getTradePnl, type MetricTrade } from "@/lib/metrics";
import type { OptionCatalog } from "@/lib/options";
import { filterTradesByQuery } from "@/lib/search";
import type { TradeInBaseCurrency } from "@/lib/data";

/**
 * THE trade filter. One spec, one predicate, shared by /trades and /analytics.
 *
 * Both pages ask the same question of the same records — "which trades am I
 * looking at" — and before this they answered it twice: /trades had an inline
 * chain of .filter() calls and /analytics had no filtering at all. Adding a
 * dimension to a second copy is how the two would drift, the same way two tag
 * tokenizers drifted in DayOS.
 *
 * Three rules hold it together:
 *
 * 1. **The URL is the filter.** Nothing here is stored; a filtered view IS its
 *    query string, which is what lets `SavedViews` keep working when this file
 *    grows a dimension it has never heard of.
 * 2. **The param names are shared.** `?direction=LONG&setupId=x` means the same
 *    thing on both pages, so a saved view — and muscle memory — carries across,
 *    and a link can be handed from one page to the other.
 * 3. **Free text goes through the search grammar**, not a second matcher:
 *    `filterTradesByQuery` runs `#tag` exact-membership and AND-substring words
 *    over `tradeSearchDoc`, so one typed word reaches the setup, the mood, a
 *    mechanism, a mistake label or anything written on the trade.
 */
export type TradeFilters = {
  from: Date | null;
  to: Date | null;
  instrument: string | null;
  marketType: string | null;
  direction: string | null;
  status: string | null;
  entryGrade: string | null;
  setupGrade: string | null;
  followedPlan: string | null;
  emotionalState: string | null;
  riskPosture: string | null;
  setupId: string | null;
  timeframe: string | null;
  mechanism: string | null;
  condition: string | null;
  /** A mistake tag id, or the two meta-answers: any mistake at all, or none. */
  mistakeTagId: string | null;
  /** Split closed trades by result — the one filter that reads an outcome
   *  rather than a decision, and the reason it is named separately. */
  outcome: "wins" | "losses" | null;
  /** Archive trades (rebuilt from exchange fills, never journaled) carry no
   *  words at all, so they distort any table about how trades were taken.
   *  "journaled" excludes them; "archive" is the back catalogue on its own. */
  journaled: "journaled" | "archive" | null;
  query: string;
};

export type FilterParams = Record<string, string | undefined>;

/** Every param this predicate reads. Exported so a page can tell "the trader
 *  filtered something" from "the trader is just on this page", without keeping
 *  a second list that rots. */
export const TRADE_FILTER_PARAMS = [
  "from", "to", "instrument", "marketType", "direction", "status", "entryGrade", "setupGrade",
  "followedPlan", "emotionalState", "riskPosture", "setupId", "timeframe", "mechanism",
  "condition", "mistakeTagId", "outcome", "journaled", "q", "period", "date",
] as const;

const text = (value: string | undefined) => {
  const trimmed = (value ?? "").trim();
  return trimmed.length ? trimmed : null;
};

const oneOf = <T extends string>(value: string | undefined, allowed: readonly T[]): T | null => {
  const clean = text(value);
  return clean && (allowed as readonly string[]).includes(clean) ? (clean as T) : null;
};

export function parseTradeFilters(params: FilterParams): TradeFilters {
  return {
    from: params.from ? new Date(params.from) : null,
    // The end of the named day, not midnight at the start of it — a "to" of
    // today must include today's trades, which is what the T23:59:59 is for.
    to: params.to ? new Date(`${params.to}T23:59:59`) : null,
    instrument: text(params.instrument)?.toUpperCase() ?? null,
    marketType: text(params.marketType),
    direction: text(params.direction),
    status: text(params.status),
    entryGrade: text(params.entryGrade),
    setupGrade: text(params.setupGrade),
    followedPlan: text(params.followedPlan),
    emotionalState: text(params.emotionalState),
    riskPosture: text(params.riskPosture),
    setupId: text(params.setupId),
    timeframe: text(params.timeframe),
    mechanism: text(params.mechanism),
    condition: text(params.condition),
    mistakeTagId: text(params.mistakeTagId),
    outcome: oneOf(params.outcome, ["wins", "losses"] as const),
    journaled: oneOf(params.journaled, ["journaled", "archive"] as const),
    query: params.q ?? "",
  };
}

/** Is anything actually narrowed? An unfiltered page is just the page. */
export function hasActiveFilters(filters: TradeFilters) {
  return Object.entries(filters).some(([key, value]) =>
    key === "query" ? String(value).trim().length > 0 : value != null,
  );
}

/**
 * Apply the filters. `params` is passed alongside because the calendar range
 * (`?period=&date=`, how /calendar deep-links into a list) is its own parsed
 * shape and re-deriving it here would be a second implementation of the one
 * comparison in lib/calendar.ts.
 *
 * A null dimension filters nothing, so an empty spec returns every trade —
 * a filter's neutral state is "everything", never "nothing".
 */
export function applyTradeFilters<T extends TradeInBaseCurrency>(
  trades: T[],
  filters: TradeFilters,
  options: OptionCatalog,
  params: FilterParams = {},
): T[] {
  const calendarRange = getCalendarRange(params);
  // Free text first: it is the widest net, and running it once over the whole
  // set is cheaper than re-parsing the query per predicate.
  return filterTradesByQuery(trades, filters.query, options)
    .filter((trade) => isWithinCalendarRange(trade.tradeDateTime, calendarRange))
    .filter((trade) => !filters.from || trade.tradeDateTime >= filters.from)
    .filter((trade) => !filters.to || trade.tradeDateTime <= filters.to)
    .filter((trade) => !filters.instrument || trade.instrument.includes(filters.instrument))
    .filter((trade) => !filters.marketType || trade.marketType === filters.marketType)
    .filter((trade) => !filters.direction || trade.direction === filters.direction)
    .filter((trade) => !filters.status || trade.status === filters.status)
    .filter((trade) => !filters.entryGrade || trade.entryGrade === filters.entryGrade)
    .filter((trade) => !filters.setupGrade || trade.setupGrade === filters.setupGrade)
    .filter((trade) => !filters.followedPlan || trade.followedPlan === filters.followedPlan)
    .filter((trade) => !filters.emotionalState || trade.emotionalState === filters.emotionalState)
    .filter((trade) => !filters.riskPosture || trade.riskPosture === filters.riskPosture)
    .filter((trade) => !filters.setupId || trade.setupId === filters.setupId)
    .filter((trade) => !filters.timeframe || (trade.timeframes ?? []).includes(filters.timeframe))
    .filter((trade) => !filters.mechanism || (trade.mechanisms ?? []).includes(filters.mechanism))
    .filter((trade) => !filters.condition || (trade.conditions ?? []).includes(filters.condition))
    .filter((trade) => matchesMistake(trade, filters.mistakeTagId))
    .filter((trade) => matchesOutcome(trade, filters.outcome))
    .filter((trade) => matchesJournaled(trade, filters.journaled));
}

/** `any` / `none` are meta-answers, so they can never collide with a real tag
 *  id (a UUID). Asking "which of my trades carry no mistake at all" is a
 *  question the id-only filter could not express. */
export const MISTAKE_ANY = "any";
export const MISTAKE_NONE = "none";

function matchesMistake(trade: TradeInBaseCurrency, mistakeTagId: string | null) {
  if (!mistakeTagId) return true;
  const count = trade.mistakeTags.length;
  if (mistakeTagId === MISTAKE_ANY) return count > 0;
  if (mistakeTagId === MISTAKE_NONE) return count === 0;
  return trade.mistakeTags.some((link) => link.mistakeTagId === mistakeTagId);
}

/**
 * A win is a closed trade that made money. An open trade is neither a win nor
 * a loss, and a closed one with no P&L recorded is unknown — both are excluded
 * rather than counted as losses, because "no number yet" is not a result.
 * Breakeven (exactly 0) counts as neither, for the same reason.
 */
function matchesOutcome(trade: MetricTrade, outcome: TradeFilters["outcome"]) {
  if (!outcome) return true;
  if (trade.status !== "CLOSED") return false;
  const pnl = getTradePnl(trade);
  if (pnl == null || pnl === 0) return false;
  return outcome === "wins" ? pnl > 0 : pnl < 0;
}

function matchesJournaled(trade: TradeInBaseCurrency, journaled: TradeFilters["journaled"]) {
  if (!journaled) return true;
  return journaled === "archive" ? Boolean(trade.reconstructed) : !trade.reconstructed;
}
