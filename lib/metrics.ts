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
  emotionalState?: string | null;
  followedPlan?: string | null;
  entryPrice?: number | null;
  stopPrice?: number | null;
  exitPrice?: number | null;
  maePrice?: number | null;
  mfePrice?: number | null;
  quantity?: number | null;
  totalOrderValue?: number | null;
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

// Gross realized P&L derived from price movement and position size, so a trade
// with entry, exit, and either quantity or order value computes its P&L even when
// the trader never typed a realized number. Direction sets the sign; size can come
// from quantity directly or be backed out of order value (notional / entry price).
export function calculateRealizedPnl(args: {
  entryPrice?: number | null;
  exitPrice?: number | null;
  quantity?: number | null;
  totalOrderValue?: number | null;
  direction?: string | null;
}): number | null {
  const { entryPrice, exitPrice, direction } = args;
  if (entryPrice == null || exitPrice == null || !direction || direction === "UNKNOWN") return null;
  let quantity = args.quantity ?? null;
  if (quantity == null && args.totalOrderValue != null && entryPrice) {
    quantity = args.totalOrderValue / entryPrice;
  }
  if (quantity == null) return null;
  const perUnit = direction === "SHORT" ? entryPrice - exitPrice : exitPrice - entryPrice;
  const value = perUnit * quantity;
  return Number.isFinite(value) ? roundTo(value, 2) : null;
}

// One intuitive resolve for the objective numbers: an explicitly entered realized
// P&L wins; otherwise derive it from entry/exit/size. Then net out fees and funding,
// each treated as 0 when left blank. Returns nulls only when there's truly nothing
// to compute from.
export function resolveObjectivePnl(args: {
  entryPrice?: number | null;
  exitPrice?: number | null;
  quantity?: number | null;
  totalOrderValue?: number | null;
  direction?: string | null;
  realizedPnl?: number | null;
  fees?: number | null;
  funding?: number | null;
}): { realizedPnl: number | null; netPnl: number | null } {
  const realizedPnl = args.realizedPnl ?? calculateRealizedPnl(args);
  return { realizedPnl, netPnl: calculateNetPnl(realizedPnl, args.fees, args.funding) };
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
  // Fall back to a derived realized P&L (from entry/exit/size) so older trades and
  // analytics stay correct even if netPnl was never persisted.
  return resolveObjectivePnl({
    entryPrice: trade.entryPrice,
    exitPrice: trade.exitPrice,
    quantity: trade.quantity,
    totalOrderValue: trade.totalOrderValue,
    direction: trade.direction,
    realizedPnl: trade.realizedPnl,
    fees: trade.fees,
    funding: trade.funding,
  }).netPnl;
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

export function conditionPerformance(trades: MetricTrade[], labelFor: (value: string) => string): BucketStats[] {
  const closed = trades.filter((trade) => trade.status === "CLOSED");
  const groups = new Map<string, MetricTrade[]>();
  for (const trade of closed) {
    for (const condition of trade.conditions ?? []) {
      groups.set(condition, [...(groups.get(condition) ?? []), trade]);
    }
  }
  return Array.from(groups.entries())
    .map(([key, group]) => bucketStats(key, labelFor(key), group))
    .sort((a, b) => b.count - a.count);
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

  const worstSetup = [...setups]
    .filter((setup) => setup.expectancyR != null && setup.count >= 3)
    .sort((a, b) => (a.expectancyR ?? 0) - (b.expectancyR ?? 0))[0];
  if (worstSetup && (worstSetup.expectancyR ?? 0) < 0) {
    insights.push({
      severity: "medium",
      title: `Setup "${worstSetup.label}" is losing money`,
      detail: `${(worstSetup.expectancyR ?? 0).toFixed(2)}R expectancy over ${worstSetup.count} trades. Consider dropping or reworking this setup.`,
    });
  }

  const worstCondition = [...conditions]
    .filter((condition) => condition.expectancyR != null && condition.count >= 3)
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
