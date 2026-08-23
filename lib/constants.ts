// The daily loop lives in the primary nav; everything else is one click away
// under "More" so the header stays calm and uncluttered. Nothing is removed.
export const primaryNavItems = [
  { href: "/", label: "Today" },
  { href: "/inbox", label: "Capture" },
  { href: "/trades", label: "Trades" },
  { href: "/assets", label: "Assets" },
  { href: "/daily", label: "Review" },
];

export const moreNavItems = [
  { href: "/calendar", label: "Calendar" },
  { href: "/notes", label: "Notes" },
  { href: "/playbook", label: "Playbook" },
  { href: "/analytics", label: "Analytics" },
  { href: "/calculator", label: "Calculator" },
  { href: "/lessons", label: "Lessons" },
  { href: "/import", label: "Import" },
  { href: "/weekly-review", label: "Weekly Review" },
  { href: "/settings", label: "Settings" },
];

export const navItems = [...primaryNavItems, ...moreNavItems];

export const tradingModes = ["LIVE", "PAPER", "OBSERVE_ONLY", "NO_TRADING"] as const;
export const currentStates = ["CALM", "SHARP", "TIRED", "DISTRACTED", "ANXIOUS", "TILTED", "BORED", "OVERCONFIDENT", "UNKNOWN"] as const;
export const marketTypes = ["CRYPTO_PERP", "CRYPTO_SPOT", "INDIAN_INDEX", "INDIAN_STOCK", "OTHER"] as const;
export const directions = ["LONG", "SHORT", "UNKNOWN"] as const;
export const tradeStatuses = ["IDEA", "OPEN", "CLOSED", "CANCELLED"] as const;
export const emotionalStates = ["CALM", "SHARP", "TIRED", "DISTRACTED", "ANXIOUS", "TILTED", "BORED", "OVERCONFIDENT", "FOMO", "REVENGE", "UNKNOWN"] as const;
export const riskPostures = ["REDUCED", "NORMAL", "AGGRESSIVE", "UNKNOWN"] as const;
export const entryGrades = ["A", "B", "C", "NA"] as const;
export const followedPlanOptions = ["YES", "NO", "PARTIAL", "NA"] as const;
export const transcriptTypes = ["UNKNOWN", "DAILY_CHECKIN", "TRADE_ENTRY_NOTE", "TRADE_EXIT_REVIEW", "EOD_REVIEW", "WEEKLY_REFLECTION", "PLAYBOOK_NOTE", "GENERAL_LEARNING_NOTE", "MISTAKE_REFLECTION"] as const;
export const lessonCategories = ["ENTRY_DISCIPLINE", "EXIT_DISCIPLINE", "RISK_MANAGEMENT", "PSYCHOLOGY", "MARKET_CONDITION", "SETUP_SPECIFIC", "PROCESS", "OTHER"] as const;
export const lessonSourceTypes = ["TRADE", "DAILY_REVIEW", "WEEKLY_REVIEW", "TRANSCRIPT", "MANUAL"] as const;
export const setupDirectionBiases = ["LONG", "SHORT", "BOTH"] as const;

// Timeframe chip for an asset thread note. GENERAL = no specific timeframe.
export const assetTimeframes = ["HTF", "MTF", "LTF", "GENERAL"] as const;

// Merged mind-state field: replaces both currentStates (9) and emotionalStates (11).
// Old stored values (SHARP, DISTRACTED, BORED, REVENGE, UNKNOWN) still display via humanize().
export const mindStateOptions = ["CALM", "TIRED", "ANXIOUS", "TILTED", "FOMO", "OVERCONFIDENT"] as const;

// humanize() would render FOMO as "Fomo" — keep the acronym.
export function mindStateLabel(state: string) {
  return state === "FOMO" ? "FOMO" : humanize(state);
}

// Trimmed lesson categories for new entries. Old values (EXIT_DISCIPLINE, MARKET_CONDITION,
// SETUP_SPECIFIC) stored on existing lessons still display correctly via humanize().
export const coreLessonCategories = ["ENTRY_DISCIPLINE", "RISK_MANAGEMENT", "PSYCHOLOGY", "PROCESS", "OTHER"] as const;

// The 9 mistake tags shown by default on the trade detail page.
// The remaining 9 appear under a "More" toggle — no data is removed.
export const primaryMistakeTagNames = new Set([
  "FOMO_ENTRY",
  "REVENGE_TRADE",
  "OVERSIZED",
  "MOVED_STOP",
  "NO_PLAN",
  "CHASED_BREAKOUT",
  "CUT_WINNER_EARLY",
  "HELD_LOSER_TOO_LONG",
  "OVERTRADED",
]);

// A mistake tag the trader invented is by definition one they care about, so it
// sits with the primary chips in the review panel rather than under "More
// mistake tags" — the fold exists to hide the nine built-ins nobody taps, not
// the label you just wrote. Anything not in the shipped set is one of yours.
export function isPrimaryMistakeTag(name: string) {
  return primaryMistakeTagNames.has(name) || !defaultMistakeTagNames.has(name);
}

// Tradezella-style "Condition" tag bucket: the market context a trade was taken in.
// Lets you later ask "do I only make money on trend days and lose in chop?".
export const conditionTagOptions = [
  ["TREND_DAY", "Trend day", "Clear directional trend across the session."],
  ["RANGE_CHOP", "Range / chop", "Sideways, choppy, mean-reverting conditions."],
  ["NEWS_DRIVEN", "News driven", "Move driven by a scheduled or breaking news catalyst."],
  ["HIGH_FUNDING", "High funding", "Funding rate was elevated, raising the cost of holding."],
  ["LOW_LIQUIDITY", "Low liquidity", "Thin book, wide spreads, weekend or off-hours."],
  ["HIGH_VOLATILITY", "High volatility", "Large, fast candles and expanded ranges."],
  ["LOW_VOLATILITY", "Low volatility", "Compressed ranges, slow tape."],
  ["MAJOR_LEVEL", "At major level", "Trade taken at a significant HTF level."],
  ["COUNTER_TREND", "Counter trend", "Trade taken against the prevailing trend."],
  ["BTC_LED", "BTC led", "Move was driven by BTC rather than the instrument itself."],
] as const;

export const conditionTagValues: string[] = conditionTagOptions.map(([value]) => value);

export function conditionLabel(value: string) {
  return conditionTagOptions.find(([tag]) => tag === value)?.[1] ?? humanize(value);
}

// Crypto-relevant 24/7 session buckets (UTC).
export const sessionLabels: Record<string, string> = {
  ASIA: "Asia (00–08 UTC)",
  EU: "Europe (08–13 UTC)",
  US: "US (13–21 UTC)",
  LATE: "Late/Asia open (21–24 UTC)",
};

export function humanize(value: string | null | undefined) {
  if (!value) return "None";
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export const defaultMistakeTags = [
  ["FOMO_ENTRY", "FOMO entry", "Entered from fear of missing the move."],
  ["REVENGE_TRADE", "Revenge trade", "Took a trade to recover emotionally from a loss."],
  ["OVERSIZED", "Oversized", "Position size was too large for the plan."],
  ["MOVED_STOP", "Moved stop", "Moved the stop against the original plan."],
  ["NO_CLEAR_INVALIDATION", "No clear invalidation", "Entered without a clean invalidation level."],
  ["CHASED_BREAKOUT", "Chased breakout", "Entered late after price had already extended."],
  ["EXITED_TOO_EARLY", "Exited too early", "Closed before the planned exit without a strong reason."],
  ["IGNORED_MARKET_REGIME", "Ignored market regime", "Trade fought the broader market condition."],
  ["TRADED_NO_TRADE_CONDITION", "Traded no-trade condition", "Traded despite pre-defined conditions to stand aside."],
  ["POOR_SLEEP_OR_STATE", "Poor sleep or state", "Traded while energy or mental state was poor."],
  ["OVERTRADED", "Overtraded", "Took too many trades relative to the plan."],
  ["ENTERED_LATE", "Entered late", "Entry was materially later than the intended zone."],
  ["CUT_WINNER_EARLY", "Cut winner early", "Closed a winning trade before the plan developed."],
  ["HELD_LOSER_TOO_LONG", "Held loser too long", "Stayed in a losing trade after invalidation."],
  ["NO_PLAN", "No plan", "Trade had no clear thesis, risk, or exit plan."],
  ["BOREDOM_TRADE", "Boredom trade", "Entered mainly because nothing was happening."],
  ["IMPULSIVE_EXIT", "Impulsive exit", "Exited reactively instead of following the plan."],
  ["MISSED_TRADE_MANAGEMENT", "Missed trade management", "Did not actively manage the trade when required."],
] as const;

export const defaultMistakeTagNames = new Set<string>(defaultMistakeTags.map(([name]) => name));
