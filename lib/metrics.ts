import { endOfWeek, format, startOfWeek } from "date-fns";

export type MetricTrade = {
  tradeDateTime: Date;
  status?: string | null;
  direction?: string | null;
  emotionalState?: string | null;
  followedPlan?: string | null;
  entryPrice?: number | null;
  stopPrice?: number | null;
  exitPrice?: number | null;
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
