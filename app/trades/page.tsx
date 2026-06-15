import Link from "next/link";
import { format, startOfWeek } from "date-fns";
import { Plus } from "lucide-react";
import { CalendarRangeControls } from "@/components/CalendarRangeControls";
import { PageTitle, SelectField, TextField } from "@/components/Fields";
import { PaginationControls, ViewTabs, normalizePage, normalizePageSize, paginate } from "@/components/ListControls";
import { TradeLogTable } from "@/components/TradeLogTable";
import { getCalendarRange, isWithinCalendarRange } from "@/lib/calendar";
import { directions, emotionalStates, entryGrades, followedPlanOptions, marketTypes, tradeStatuses } from "@/lib/constants";
import { db, getTradesWithMistakes } from "@/lib/data";
import { getTradePnl } from "@/lib/metrics";

const tradeViews = [
  { label: "All", value: "all" },
  { label: "Open", value: "open" },
  { label: "Closed", value: "closed" },
  { label: "Needs Review", value: "needs-review" },
  { label: "Mistakes", value: "mistakes" },
  { label: "This Week", value: "this-week" },
];

export default async function TradesPage({ searchParams }: { searchParams?: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams ?? {};
  const [mistakeTags, allTrades] = await Promise.all([db.list("mistakeTags"), getTradesWithMistakes()]);
  const from = params.from ? new Date(params.from) : null;
  const to = params.to ? new Date(`${params.to}T23:59:59`) : null;
  const view = params.view ?? "all";
  const sort = params.sort ?? "date-desc";
  const page = normalizePage(params.page);
  const pageSize = normalizePageSize(params.pageSize, [10, 25, 50], 25);
  const calendarRange = getCalendarRange(params);
  const thisWeek = startOfWeek(new Date(), { weekStartsOn: 1 });
  const trades = allTrades
    .filter((trade) => applyTradeView(trade, view, thisWeek))
    .filter((trade) => isWithinCalendarRange(trade.tradeDateTime, calendarRange))
    .filter((trade) => !params.instrument || trade.instrument.includes(params.instrument.toUpperCase()))
    .filter((trade) => !pickEnum(marketTypes, params.marketType) || trade.marketType === params.marketType)
    .filter((trade) => !pickEnum(directions, params.direction) || trade.direction === params.direction)
    .filter((trade) => !pickEnum(tradeStatuses, params.status) || trade.status === params.status)
    .filter((trade) => !pickEnum(entryGrades, params.entryGrade) || trade.entryGrade === params.entryGrade)
    .filter((trade) => !pickEnum(followedPlanOptions, params.followedPlan) || trade.followedPlan === params.followedPlan)
    .filter((trade) => !pickEnum(emotionalStates, params.emotionalState) || trade.emotionalState === params.emotionalState)
    .filter((trade) => !from || trade.tradeDateTime >= from)
    .filter((trade) => !to || trade.tradeDateTime <= to)
    .filter((trade) => !params.mistakeTagId || trade.mistakeTags.some((link) => link.mistakeTagId === params.mistakeTagId))
    .sort((a, b) => compareTrades(a, b, sort));
  const pagedTrades = paginate(trades, page, pageSize);
  const tradeRows = pagedTrades.map((trade) => ({
    id: trade.id,
    dateLabel: format(trade.tradeDateTime, "dd MMM yyyy"),
    timeLabel: format(trade.tradeDateTime, "HH:mm"),
    instrument: trade.instrument,
    direction: trade.direction,
    status: trade.status,
    marketType: trade.marketType,
    setupName: trade.setupName,
    entryThesis: trade.entryThesis,
    invalidation: trade.invalidation,
    concern: trade.concern,
    emotionalState: trade.emotionalState,
    riskPosture: trade.riskPosture,
    confidenceScore: trade.confidenceScore,
    entryGrade: trade.entryGrade,
    exitReason: trade.exitReason,
    followedPlan: trade.followedPlan,
    lesson: trade.lesson,
    notes: trade.notes,
    entryPrice: trade.entryPrice,
    stopPrice: trade.stopPrice,
    targetPrice: trade.targetPrice,
    exitPrice: trade.exitPrice,
    quantity: trade.quantity,
    totalOrderValue: trade.totalOrderValue ?? null,
    leverage: trade.leverage,
    pnl: getTradePnl(trade),
    rMultiple: trade.rMultiple,
    mistakes: trade.mistakeTags.map((link) => link.mistakeTag.label),
  }));

  return (
    <main className="page-shell">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <PageTitle title="Trades" subtitle="Journal-level trade ideas with subjective notes, objective data, and mistakes." />
        <Link href="/trades/new" className="button"><Plus className="h-4 w-4" /> New trade</Link>
      </div>

      <ViewTabs basePath="/trades" current={view} params={params} tabs={tradeViews} />
      <CalendarRangeControls basePath="/trades" params={params} range={calendarRange} total={trades.length} />

      <details className="panel mb-4" open={hasActiveTradeControls(params)}>
        <summary className="cursor-pointer text-sm font-semibold">
          Filters & sorting
          <span className="ml-2 font-normal text-forge-muted">{trades.length} trade{trades.length === 1 ? "" : "s"}</span>
        </summary>
        <form className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <TextField label="From" name="from" type="date" defaultValue={params.from} />
          <TextField label="To" name="to" type="date" defaultValue={params.to} />
          <TextField label="Instrument" name="instrument" defaultValue={params.instrument} />
          <SelectField label="Market type" name="marketType" options={marketTypes} includeBlank defaultValue={params.marketType} />
          <SelectField label="Direction" name="direction" options={directions} includeBlank defaultValue={params.direction} />
          <SelectField label="Status" name="status" options={tradeStatuses} includeBlank defaultValue={params.status} />
          <SelectField label="Entry grade" name="entryGrade" options={entryGrades} includeBlank defaultValue={params.entryGrade} />
          <SelectField label="Followed plan" name="followedPlan" options={followedPlanOptions} includeBlank defaultValue={params.followedPlan} />
          <SelectField label="Emotional state" name="emotionalState" options={emotionalStates} includeBlank defaultValue={params.emotionalState} />
          <label className="field">
            <span className="label">Sort</span>
            <select name="sort" defaultValue={sort} className="input">
              <option value="date-desc">Newest first</option>
              <option value="date-asc">Oldest first</option>
              <option value="instrument-asc">Instrument A-Z</option>
              <option value="pnl-desc">P&L high-low</option>
              <option value="pnl-asc">P&L low-high</option>
              <option value="r-desc">R high-low</option>
              <option value="r-asc">R low-high</option>
            </select>
          </label>
          <label className="field">
            <span className="label">Rows</span>
            <select name="pageSize" defaultValue={String(pageSize)} className="input">
              <option value="10">10</option>
              <option value="25">25</option>
              <option value="50">50</option>
            </select>
          </label>
          <label className="field">
            <span className="label">Mistake tag</span>
            <select name="mistakeTagId" defaultValue={params.mistakeTagId ?? ""} className="input">
              <option value="">None</option>
              {mistakeTags.map((tag) => <option key={tag.id} value={tag.id}>{tag.label}</option>)}
            </select>
          </label>
          <div className="flex items-end gap-2 lg:col-span-5">
            <input type="hidden" name="view" value={view} />
            <button className="button" type="submit">Apply filters</button>
            <Link href="/trades" className="button-secondary">Clear</Link>
          </div>
        </form>
      </details>

      <TradeLogTable trades={tradeRows} />
      <PaginationControls basePath="/trades" params={params} page={page} pageSize={pageSize} total={trades.length} />
    </main>
  );
}

function pickEnum(options: readonly string[], value: string | undefined) {
  return value && options.includes(value) ? value : undefined;
}

function hasActiveTradeControls(params: Record<string, string | undefined>) {
  const passiveKeys = new Set(["view", "page", "period", "date"]);
  return Object.entries(params).some(([key, value]) => Boolean(value) && !passiveKeys.has(key));
}

type TradeRow = Awaited<ReturnType<typeof getTradesWithMistakes>>[number];

function applyTradeView(trade: TradeRow, view: string, thisWeek: Date) {
  if (view === "open") return trade.status === "OPEN" || trade.status === "IDEA";
  if (view === "closed") return trade.status === "CLOSED";
  if (view === "needs-review") return !trade.invalidation || (trade.status === "CLOSED" && !trade.lesson) || !trade.followedPlan;
  if (view === "mistakes") return trade.mistakeTags.length > 0;
  if (view === "this-week") return trade.tradeDateTime >= thisWeek;
  return true;
}

function compareTrades(a: TradeRow, b: TradeRow, sort: string) {
  if (sort === "date-asc") return a.tradeDateTime.getTime() - b.tradeDateTime.getTime();
  if (sort === "instrument-asc") return a.instrument.localeCompare(b.instrument) || b.tradeDateTime.getTime() - a.tradeDateTime.getTime();
  if (sort === "pnl-desc") return (getTradePnl(b) ?? Number.NEGATIVE_INFINITY) - (getTradePnl(a) ?? Number.NEGATIVE_INFINITY);
  if (sort === "pnl-asc") return (getTradePnl(a) ?? Number.POSITIVE_INFINITY) - (getTradePnl(b) ?? Number.POSITIVE_INFINITY);
  if (sort === "r-desc") return (b.rMultiple ?? Number.NEGATIVE_INFINITY) - (a.rMultiple ?? Number.NEGATIVE_INFINITY);
  if (sort === "r-asc") return (a.rMultiple ?? Number.POSITIVE_INFINITY) - (b.rMultiple ?? Number.POSITIVE_INFINITY);
  return b.tradeDateTime.getTime() - a.tradeDateTime.getTime();
}
