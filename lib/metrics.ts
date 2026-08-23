import { endOfWeek, format, startOfWeek } from "date-fns";

export type MetricTrade = {
  tradeDateTime: Date;
  status?: string | null;
  direction?: string | null;
  instrument?: string | null;
  setupId?: string | null;
  setupName?: string | null;
  entryGrade?: string | null;
  invalidation?: string | null;
  conditions?: string[];
  timeframes?: string[];
  mechanisms?: string[];
  checklistSteps?: string[];
  emotionalState?: string | null;
  followedPlan?: string | null;
  entryPrice?: number | null;
  stopPrice?: number | null;
  exitPrice?: number | null;
  maePrice?: number | null;
  mfePrice?: number | null;
  realizedPnl?: number | null;
  fees?: number | null;
  funding?: number | null;
  netPnl?: number | null;
  rMultiple?: number | null;
  mistakeTags?: { mistakeTag: { name: string; label: string } }[];
};

export function toNumber(value: FormDataEntryValue | null): number | null {
  if (value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function toText(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

export function calculateNetPnl(realizedPnl?: number | null, fees?: number | null, funding?: number | null) {
  if (realizedPnl == null && fees == null && funding == null) return null;
  return (realizedPnl ?? 0) - (fees ?? 0) + (funding ?? 0);
}

export function calculateRMultiple(args: {
  entryPrice?: number | null;
  stopPrice?: number | null;
  exitPrice?: number | null;
  direction?: string | null;
}) {
  const { entryPrice, stopPrice, exitPrice, direction } = args;
  if (entryPrice == null || stopPrice == null || exitPrice == null || !direction || direction === "UNKNOWN") return null;
  const risk = Math.abs(entryPrice - stopPrice);
  if (!risk) return null;
  const reward = direction === "SHORT" ? entryPrice - exitPrice : exitPrice - entryPrice;
  const value = reward / risk;
  return Number.isFinite(value) ? value : null;
}

export function calculateOrderFields(args: {
  price?: number | null;
  quantity?: number | null;
  totalOrderValue?: number | null;
}) {
  const price = args.price ?? null;
  const providedQuantity = args.quantity ?? null;
  const providedTotal = args.totalOrderValue ?? null;
  const quantity = providedQuantity ?? (price && providedTotal != null ? roundTo(providedTotal / price, 8) : null);
  const totalOrderValue = providedTotal ?? (price != null && quantity != null ? roundTo(price * quantity, 2) : null);
  return { quantity, totalOrderValue };
}

function roundTo(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function calculateWinRate(trades: MetricTrade[]) {
  const closed = trades.filter((trade) => trade.status === "CLOSED" && getTradePnl(trade) != null);
  if (!closed.length) return null;
  const wins = closed.filter((trade) => (getTradePnl(trade) ?? 0) > 0).length;
  return wins / closed.length;
}

export function calculateProfitFactor(trades: MetricTrade[]) {
  const pnlValues = trades.map(getTradePnl).filter((value): value is number => value != null);
  const gains = pnlValues.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const losses = Math.abs(pnlValues.filter((value) => value < 0).reduce((sum, value) => sum + value, 0));
  if (!losses) return gains > 0 ? gains : null;
  return gains / losses;
}

export function calculateExpectancy(trades: MetricTrade[]) {
  const pnlValues = trades.map(getTradePnl).filter((value): value is number => value != null);
  if (!pnlValues.length) return null;
  return pnlValues.reduce((sum, value) => sum + value, 0) / pnlValues.length;
}

export function calculateTotalR(trades: MetricTrade[]) {
  const rValues = trades.map((trade) => trade.rMultiple).filter((value): value is number => value != null);
  if (!rValues.length) return null;
  return rValues.reduce((sum, value) => sum + value, 0);
}

export function calculateRuleAdherenceRate(trades: MetricTrade[]) {
  const reviewed = trades.filter((trade) => trade.followedPlan && trade.followedPlan !== "NA");
  if (!reviewed.length) return null;
  const score = reviewed.reduce((sum, trade) => {
    if (trade.followedPlan === "YES") return sum + 1;
    if (trade.followedPlan === "PARTIAL") return sum + 0.5;
    return sum;
  }, 0);
  return score / reviewed.length;
}

export function mistakeFrequency(trades: MetricTrade[]) {
  const counts = new Map<string, { label: string; count: number }>();
  for (const trade of trades) {
    for (const link of trade.mistakeTags ?? []) {
      const key = link.mistakeTag.name;
      const current = counts.get(key) ?? { label: link.mistakeTag.label, count: 0 };
      counts.set(key, { ...current, count: current.count + 1 });
    }
  }
  return Array.from(counts.values()).sort((a, b) => b.count - a.count);
}

export function emotionalStateFrequency(trades: MetricTrade[]) {
  const counts = new Map<string, number>();
  for (const trade of trades) {
    if (!trade.emotionalState) continue;
    counts.set(trade.emotionalState, (counts.get(trade.emotionalState) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([state, count]) => ({ state, count }))
    .sort((a, b) => b.count - a.count);
}

export function groupTradesByWeek(trades: MetricTrade[]) {
  return trades.reduce<Record<string, MetricTrade[]>>((groups, trade) => {
    const start = startOfWeek(trade.tradeDateTime, { weekStartsOn: 1 });
    const key = format(start, "yyyy-MM-dd");
    groups[key] = groups[key] ?? [];
    groups[key].push(trade);
    return groups;
  }, {});
}

export function summarizeWeeklyStats(trades: MetricTrade[], weekStart: Date, weekEnd: Date) {
  const closed = trades.filter((trade) => trade.status === "CLOSED");
  const totalPnl = closed.reduce((sum, trade) => sum + (getTradePnl(trade) ?? 0), 0);
  const mistakes = mistakeFrequency(closed);
  const emotions = emotionalStateFrequency(closed);
  return {
    weekStart,
    weekEnd,
    totalTrades: closed.length,
    totalPnl,
    totalR: calculateTotalR(closed),
    winRate: calculateWinRate(closed),
    profitFactor: calculateProfitFactor(closed),
    expectancy: calculateExpectancy(closed),
    ruleAdherenceRate: calculateRuleAdherenceRate(closed),
    mostCommonMistake: mistakes[0]?.label ?? null,
    mostCommonEmotionalState: emotions[0]?.state ?? null,
  };
}

export function weekBounds(date = new Date()) {
  return {
    weekStart: startOfWeek(date, { weekStartsOn: 1 }),
    weekEnd: endOfWeek(date, { weekStartsOn: 1 }),
  };
}

export function getTradePnl(trade: MetricTrade) {
  if (trade.netPnl != null) return trade.netPnl;
  return calculateNetPnl(trade.realizedPnl, trade.fees, trade.funding);
}

// THE definition of "reviewed", used by Today, /trades and the trade page so the
// three never disagree. Answering "did I follow my plan?" is what closes the
// loop — the lesson is nudged, never required (an empty lesson used to leave a
// reviewed trade nagging as "Review →" forever).
export function tradeNeedsReview(trade: { status?: string | null; followedPlan?: string | null }) {
  return trade.status === "CLOSED" && (trade.followedPlan ?? "NA") === "NA";
}

// --- Process score: did I follow my own rules, independent of P&L? ---
// This is the beginner's real KPI. A losing trade can be A-grade process;
// a winning trade can be terrible process. We score the second kind down.
export function tradeProcessScore(trade: MetricTrade): number | null {
  const reviewed = trade.status === "CLOSED" || (trade.followedPlan != null && trade.followedPlan !== "NA");
  if (!reviewed) return null;
  let score = 0;
  if (trade.followedPlan === "YES") score += 40;
  else if (trade.followedPlan === "PARTIAL") score += 20;
  if (trade.invalidation && trade.invalidation.trim().length) score += 20;
  if (!trade.mistakeTags || trade.mistakeTags.length === 0) score += 20;
  if (trade.entryGrade === "A") score += 20;
  else if (trade.entryGrade === "B") score += 13;
  else if (trade.entryGrade === "C") score += 6;
  return score;
}

export function averageProcessScore(trades: MetricTrade[]) {
  const scores = trades.map(tradeProcessScore).filter((value): value is number => value != null);
  if (!scores.length) return null;
  return scores.reduce((sum, value) => sum + value, 0) / scores.length;
}

// --- Exit efficiency: how much of the favorable move did I actually capture? ---
export function exitEfficiency(trade: MetricTrade): number | null {
  const { entryPrice, exitPrice, mfePrice, direction } = trade;
  if (entryPrice == null || exitPrice == null || mfePrice == null || !direction || direction === "UNKNOWN") return null;
  const favorable = direction === "SHORT" ? entryPrice - mfePrice : mfePrice - entryPrice;
  if (favorable <= 0) return null;
  const captured = direction === "SHORT" ? entryPrice - exitPrice : exitPrice - entryPrice;
  const value = captured / favorable;
  return Number.isFinite(value) ? value : null;
}

export function averageExitEfficiency(trades: MetricTrade[]) {
  const values = trades.map(exitEfficiency).filter((value): value is number => value != null);
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

// --- 24/7 crypto session bucketing (UTC) ---
export function sessionForDate(date: Date): "ASIA" | "EU" | "US" | "LATE" {
  const hour = date.getUTCHours();
  if (hour < 8) return "ASIA";
  if (hour < 13) return "EU";
  if (hour < 21) return "US";
  return "LATE";
}

// How many closed trades a bucket needs before its numbers mean anything.
// Below this, a 100% win rate is one lucky trade, not an edge — every table
// that groups trades greys those rows out and says how many more are needed,
// so the journal never hands back a confident-looking number it can't support.
// Five is the same line the session chart already drew.
export const MIN_SAMPLE = 5;

export function isThinSample(count: number) {
  return count < MIN_SAMPLE;
}

export type BucketStats = {
  key: string;
  label: string;
  count: number;
  winRate: number | null;
  netPnl: number;
  expectancyR: number | null;
  avgProcessScore: number | null;
};

function bucketStats(key: string, label: string, trades: MetricTrade[]): BucketStats {
  const netPnl = trades.reduce((sum, trade) => sum + (getTradePnl(trade) ?? 0), 0);
  return {
    key,
    label,
    count: trades.length,
    winRate: calculateWinRate(trades),
    netPnl,
    expectancyR: calculateExpectancyR(trades),
    avgProcessScore: averageProcessScore(trades),
  };
}

export function sessionPerformance(trades: MetricTrade[], labels: Record<string, string>): BucketStats[] {
  const closed = trades.filter((trade) => trade.status === "CLOSED");
  const order = ["ASIA", "EU", "US", "LATE"];
  return order
    .map((session) => bucketStats(session, labels[session] ?? session, closed.filter((trade) => sessionForDate(trade.tradeDateTime) === session)))
    .filter((bucket) => bucket.count > 0);
}

export function setupPerformance(
  trades: MetricTrade[],
  setupNameById: Map<string, string>,
): BucketStats[] {
  const closed = trades.filter((trade) => trade.status === "CLOSED");
  const groups = new Map<string, { label: string; trades: MetricTrade[] }>();
  for (const trade of closed) {
    const key = trade.setupId ?? (trade.setupName ? `name:${trade.setupName}` : "unassigned");
    const label = trade.setupId
      ? setupNameById.get(trade.setupId) ?? "Unknown setup"
      : trade.setupName ?? "Unassigned";
    const current = groups.get(key) ?? { label, trades: [] };
    current.trades.push(trade);
    groups.set(key, current);
  }
  return Array.from(groups.entries())
    .map(([key, group]) => bucketStats(key, group.label, group.trades))
    .sort((a, b) => (b.expectancyR ?? Number.NEGATIVE_INFINITY) - (a.expectancyR ?? Number.NEGATIVE_INFINITY));
}

// Group closed trades by a field that holds SEVERAL values at once (conditions,
// timeframes, mechanisms). A trade lands in every bucket it carries, so the
// counts deliberately sum to more than the number of trades — the question
// being asked is "how do I do when X is involved", not "how do I split my
// trades up".
export function multiValuePerformance(
  trades: MetricTrade[],
  valuesOf: (trade: MetricTrade) => string[] | undefined,
  labelFor: (value: string) => string,
): BucketStats[] {
  const closed = trades.filter((trade) => trade.status === "CLOSED");
  const groups = new Map<string, MetricTrade[]>();
  for (const trade of closed) {
    for (const value of valuesOf(trade) ?? []) {
      groups.set(value, [...(groups.get(value) ?? []), trade]);
    }
  }
  return Array.from(groups.entries())
    .map(([key, group]) => bucketStats(key, labelFor(key), group))
    .sort((a, b) => b.count - a.count);
}

export function conditionPerformance(trades: MetricTrade[], labelFor: (value: string) => string): BucketStats[] {
  return multiValuePerformance(trades, (trade) => trade.conditions, labelFor);
}

export function timeframePerformance(trades: MetricTrade[], labelFor: (value: string) => string): BucketStats[] {
  return multiValuePerformance(trades, (trade) => trade.timeframes, labelFor);
}

export function mechanismPerformance(trades: MetricTrade[], labelFor: (value: string) => string): BucketStats[] {
  return multiValuePerformance(trades, (trade) => trade.mechanisms, labelFor);
}

// Did following the model actually pay? Two buckets over the closed trades that
// were taken on a setup with a checklist: every step ticked, versus some step
// missing. Trades on a setup with no checklist are not graded at all — an
// untracked trade is not a failed one, and lumping them in would make the
// "incomplete" bucket meaningless.
export function checklistPerformance(
  trades: MetricTrade[],
  stepTotalFor: (trade: MetricTrade) => number,
): BucketStats[] {
  const complete: MetricTrade[] = [];
  const partial: MetricTrade[] = [];
  for (const trade of trades.filter((entry) => entry.status === "CLOSED")) {
    const total = stepTotalFor(trade);
    if (!total) continue;
    ((trade.checklistSteps?.length ?? 0) >= total ? complete : partial).push(trade);
  }
  return [
    ...(complete.length ? [bucketStats("complete", "Full model — every step", complete)] : []),
    ...(partial.length ? [bucketStats("partial", "Something was missing", partial)] : []),
  ];
}

// --- Funding drag: the silent killer of "profitable" perp strategies ---
export function fundingSummary(trades: MetricTrade[]) {
  const closed = trades.filter((trade) => trade.status === "CLOSED");
  let totalFunding = 0;
  let fundingPaid = 0;
  let grossProfit = 0;
  for (const trade of closed) {
    const funding = trade.funding ?? 0;
    totalFunding += funding;
    if (funding < 0) fundingPaid += Math.abs(funding);
    const realized = trade.realizedPnl ?? getTradePnl(trade) ?? 0;
    if (realized > 0) grossProfit += realized;
  }
  const dragPct = grossProfit > 0 ? fundingPaid / grossProfit : null;
  return { totalFunding, fundingPaid, grossProfit, dragPct };
}

// --- Expectancy, expressed honestly: in R and with its components ---
export function calculateExpectancyR(trades: MetricTrade[]) {
  const rValues = trades.map((trade) => trade.rMultiple).filter((value): value is number => value != null);
  if (!rValues.length) return null;
  return rValues.reduce((sum, value) => sum + value, 0) / rValues.length;
}

// --- "What's hurting me": plain-language leak detection for the lean summary ---
// Turns the same numbers the tables show into prioritized, readable findings so a
// non-technical trader sees the few things worth fixing without reading a grid.
export type LeakInsight = {
  severity: "high" | "medium" | "good";
  title: string;
  detail: string;
};

export function analyticsLeaks(trades: MetricTrade[], setups: BucketStats[], conditions: BucketStats[]): LeakInsight[] {
  const closed = trades.filter((trade) => trade.status === "CLOSED");
  const insights: LeakInsight[] = [];

  const funding = fundingSummary(trades);
  if (funding.dragPct != null && funding.dragPct > 0.15) {
    insights.push({
      severity: "high",
      title: "Funding is bleeding your edge",
      detail: `Funding paid is ${(funding.dragPct * 100).toFixed(0)}% of your gross profit (${funding.fundingPaid.toFixed(2)} paid). Above 15% is the documented red flag for perp traders — favor shorter holds or check funding before entry.`,
    });
  } else if (funding.dragPct != null && funding.dragPct > 0.1) {
    insights.push({
      severity: "medium",
      title: "Funding is starting to add up",
      detail: `Funding paid is ${(funding.dragPct * 100).toFixed(0)}% of gross profit. Not alarming yet, but watch your hold times.`,
    });
  }

  const mistakes = mistakeFrequency(closed);
  const topMistake = mistakes[0];
  if (topMistake && closed.length) {
    const share = topMistake.count / closed.length;
    if (topMistake.count >= 3 && share >= 0.4) {
      insights.push({
        severity: "high",
        title: `"${topMistake.label}" is your most repeated mistake`,
        detail: `It shows up in ${topMistake.count} of ${closed.length} closed trades (${(share * 100).toFixed(0)}%). This is the single highest-leverage habit to break.`,
      });
    } else if (topMistake.count >= 3) {
      insights.push({
        severity: "medium",
        title: `"${topMistake.label}" keeps recurring`,
        detail: `Tagged on ${topMistake.count} closed trades. Worth turning into a hard rule before your next session.`,
      });
    }
  }

  const process = averageProcessScore(closed);
  if (process != null && process < 50) {
    insights.push({
      severity: "high",
      title: "You're often breaking your own rules",
      detail: `Average process score is ${process.toFixed(0)}/100. Process — not P&L — is what you actually control, and this is low.`,
    });
  } else if (process != null && process < 65) {
    insights.push({
      severity: "medium",
      title: "Process is a bit shaky",
      detail: `Average process score is ${process.toFixed(0)}/100. Tighten plan-following and write cleaner invalidations.`,
    });
  }

  const adherence = calculateRuleAdherenceRate(closed);
  if (adherence != null && adherence < 0.5) {
    insights.push({
      severity: "high",
      title: "Plan adherence is low",
      detail: `You fully followed your plan on only ${(adherence * 100).toFixed(0)}% of reviewed trades. The edge you backtested only exists if you trade it.`,
    });
  }

  // MIN_SAMPLE, not 3: "this setup loses money" is a verdict, and three trades
  // can't support one. The mistake-frequency leak above stays at 3 because
  // counting how often you do something is an observation, not an inference.
  const worstSetup = [...setups]
    .filter((setup) => setup.expectancyR != null && setup.count >= MIN_SAMPLE)
    .sort((a, b) => (a.expectancyR ?? 0) - (b.expectancyR ?? 0))[0];
  if (worstSetup && (worstSetup.expectancyR ?? 0) < 0) {
    insights.push({
      severity: "medium",
      title: `Setup "${worstSetup.label}" is losing money`,
      detail: `${(worstSetup.expectancyR ?? 0).toFixed(2)}R expectancy over ${worstSetup.count} trades. Consider dropping or reworking this setup.`,
    });
  }

  const worstCondition = [...conditions]
    .filter((condition) => condition.expectancyR != null && condition.count >= MIN_SAMPLE)
    .sort((a, b) => (a.expectancyR ?? 0) - (b.expectancyR ?? 0))[0];
  if (worstCondition && (worstCondition.expectancyR ?? 0) < 0) {
    insights.push({
      severity: "medium",
      title: `You lose in "${worstCondition.label}" conditions`,
      detail: `${(worstCondition.expectancyR ?? 0).toFixed(2)}R over ${worstCondition.count} trades. This context isn't for you yet — stand aside or size down.`,
    });
  }

  const order = { high: 0, medium: 1, good: 2 };
  insights.sort((a, b) => order[a.severity] - order[b.severity]);

  if (!insights.length) {
    return [
      {
        severity: "good",
        title: "Nothing major is hurting you right now",
        detail: "No heavy funding drag, repeated mistake, or losing setup stands out in your closed trades yet. Keep logging — patterns sharpen with sample size.",
      },
    ];
  }
  return insights.slice(0, 4);
}

// --- Counterfactual discipline curve: what if I had followed my own rules? ---
// Conservative by construction: impulse trades are skipped (0, even winners lose
// their profit), runaway losses are capped at -1R, and nothing hypothetical is
// ever added — the "plan" line never invents upside the trader didn't earn.
export type DisciplinePoint = { label: string; actual: number; plan: number };
export type DisciplineSummary = {
  points: DisciplinePoint[];
  skippedCount: number;
  cappedCount: number;
  delta: number;
  sample: number;
};

const impulseEntryTags = new Set([
  "FOMO_ENTRY",
  "REVENGE_TRADE",
  "NO_PLAN",
  "BOREDOM_TRADE",
  "TRADED_NO_TRADE_CONDITION",
]);

const stopDisciplineTags = new Set(["MOVED_STOP", "HELD_LOSER_TOO_LONG"]);

function hasTag(trade: MetricTrade, names: Set<string>) {
  return (trade.mistakeTags ?? []).some((link) => names.has(link.mistakeTag.name));
}

export function disciplineCurve(trades: MetricTrade[]): DisciplineSummary {
  const closed = trades
    .filter((trade) => trade.status === "CLOSED" && getTradePnl(trade) != null)
    .sort((a, b) => a.tradeDateTime.getTime() - b.tradeDateTime.getTime());

  let actualTotal = 0;
  let planTotal = 0;
  let skippedCount = 0;
  let cappedCount = 0;
  const byDay = new Map<string, DisciplinePoint>();

  for (const trade of closed) {
    const pnl = getTradePnl(trade) ?? 0;
    let planPnl = pnl;
    if (hasTag(trade, impulseEntryTags)) {
      planPnl = 0;
      skippedCount += 1;
    } else if (
      (hasTag(trade, stopDisciplineTags) || trade.followedPlan === "NO") &&
      trade.rMultiple != null &&
      trade.rMultiple < -1 &&
      pnl < 0
    ) {
      planPnl = -Math.abs(pnl / trade.rMultiple);
      cappedCount += 1;
    }
    actualTotal += pnl;
    planTotal += planPnl;
    const label = format(trade.tradeDateTime, "d MMM yy");
    byDay.set(label, {
      label,
      actual: Number(actualTotal.toFixed(2)),
      plan: Number(planTotal.toFixed(2)),
    });
  }

  return {
    points: Array.from(byDay.values()),
    skippedCount,
    cappedCount,
    delta: Number((planTotal - actualTotal).toFixed(2)),
    sample: closed.length,
  };
}

// --- Mistake-cost ledger: what each tagged mistake actually cost, in currency ---
// A trade with several tags contributes its full P&L to each (disclosed in the UI copy).
export type MistakeCost = { name: string; label: string; count: number; totalPnl: number };

export function mistakeCostLedger(trades: MetricTrade[]): MistakeCost[] {
  const closed = trades.filter((trade) => trade.status === "CLOSED" && getTradePnl(trade) != null);
  const ledger = new Map<string, MistakeCost>();
  for (const trade of closed) {
    const pnl = getTradePnl(trade) ?? 0;
    for (const link of trade.mistakeTags ?? []) {
      const key = link.mistakeTag.name;
      const current = ledger.get(key) ?? { name: key, label: link.mistakeTag.label, count: 0, totalPnl: 0 };
      current.count += 1;
      current.totalPnl += pnl;
      ledger.set(key, current);
    }
  }
  return Array.from(ledger.values()).sort((a, b) => a.totalPnl - b.totalPnl);
}

// --- R-multiple histogram: is risk actually capped at -1R in practice? ---
export type RBin = { label: string; count: number; negative: boolean };

export function rHistogram(trades: MetricTrade[]): { bins: RBin[]; sample: number; beyondPlannedLoss: number } {
  const specs: { label: string; negative: boolean; test: (r: number) => boolean }[] = [
    { label: "≤ −2R", negative: true, test: (r) => r <= -2 },
    { label: "−2 to −1R", negative: true, test: (r) => r > -2 && r <= -1 },
    { label: "−1 to 0R", negative: true, test: (r) => r > -1 && r < 0 },
    { label: "0 to 1R", negative: false, test: (r) => r >= 0 && r < 1 },
    { label: "1 to 2R", negative: false, test: (r) => r >= 1 && r < 2 },
    { label: "2 to 3R", negative: false, test: (r) => r >= 2 && r < 3 },
    { label: "> 3R", negative: false, test: (r) => r >= 3 },
  ];
  const rValues = trades
    .filter((trade) => trade.status === "CLOSED")
    .map((trade) => trade.rMultiple)
    .filter((value): value is number => value != null);
  const bins = specs.map((spec) => ({
    label: spec.label,
    count: rValues.filter(spec.test).length,
    negative: spec.negative,
  }));
  return {
    bins,
    sample: rValues.length,
    beyondPlannedLoss: rValues.filter((r) => r < -1).length,
  };
}

// --- Tilt / revenge-window comparison: how do I trade right after a loss? ---
// Grouping looks at the entry decision (any status, entry time only — there is no
// exit timestamp), then stats are computed over each group's closed-with-P&L trades.
export type TiltStats = { count: number; avgR: number | null; winRate: number | null; netPnl: number };

function tiltStats(trades: MetricTrade[]): TiltStats {
  const closed = trades.filter((trade) => trade.status === "CLOSED" && getTradePnl(trade) != null);
  const rValues = closed.map((trade) => trade.rMultiple).filter((value): value is number => value != null);
  const wins = closed.filter((trade) => (getTradePnl(trade) ?? 0) > 0).length;
  return {
    count: closed.length,
    avgR: rValues.length ? rValues.reduce((sum, value) => sum + value, 0) / rValues.length : null,
    winRate: closed.length ? wins / closed.length : null,
    netPnl: closed.reduce((sum, trade) => sum + (getTradePnl(trade) ?? 0), 0),
  };
}

export function tiltAnalysis(
  trades: MetricTrade[],
  windowHours = 2,
): { afterLoss: TiltStats; baseline: TiltStats; windowHours: number } {
  const sorted = [...trades].sort((a, b) => a.tradeDateTime.getTime() - b.tradeDateTime.getTime());
  const windowMs = windowHours * 60 * 60 * 1000;
  const afterLoss: MetricTrade[] = [];
  const rest: MetricTrade[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const prev = i > 0 ? sorted[i - 1] : null;
    const prevPnl = prev ? getTradePnl(prev) : null;
    const isAfterLoss =
      prev != null &&
      prev.status === "CLOSED" &&
      prevPnl != null &&
      prevPnl < 0 &&
      sorted[i].tradeDateTime.getTime() - prev.tradeDateTime.getTime() <= windowMs;
    (isAfterLoss ? afterLoss : rest).push(sorted[i]);
  }
  return { afterLoss: tiltStats(afterLoss), baseline: tiltStats(rest), windowHours };
}

export function expectancyBreakdown(trades: MetricTrade[]) {
  const closed = trades.filter((trade) => trade.status === "CLOSED");
  const pnlValues = closed.map(getTradePnl).filter((value): value is number => value != null);
  const wins = pnlValues.filter((value) => value > 0);
  const losses = pnlValues.filter((value) => value < 0);
  const winRate = pnlValues.length ? wins.length / pnlValues.length : null;
  const avgWin = wins.length ? wins.reduce((sum, value) => sum + value, 0) / wins.length : 0;
  const avgLoss = losses.length ? Math.abs(losses.reduce((sum, value) => sum + value, 0) / losses.length) : 0;
  const expectancyCurrency = pnlValues.length ? pnlValues.reduce((sum, value) => sum + value, 0) / pnlValues.length : null;
  return {
    winRate,
    avgWin,
    avgLoss,
    expectancyCurrency,
    expectancyR: calculateExpectancyR(closed),
    sampleSize: pnlValues.length,
  };
}
