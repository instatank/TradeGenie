import Link from "next/link";
import { format, startOfWeek } from "date-fns";
import { ArrowUpRight, CalendarDays, ChevronRight, Plus, X } from "lucide-react";
import { PageTitle, SelectField } from "@/components/Fields";
import { PaginationControls, ViewTabs, normalizePage, normalizePageSize, paginate } from "@/components/ListControls";
import { TagPills } from "@/components/TagPills";
import { getCalendarRange, isWithinCalendarRange } from "@/lib/calendar";
import { directions, emotionalStates, entryGrades, followedPlanOptions, humanize, marketTypes, tradeStatuses } from "@/lib/constants";
import { db, getTradesWithMistakes } from "@/lib/data";
import { calculateTotalR, calculateWinRate, getTradePnl } from "@/lib/metrics";

const tradeViews = [
  { label: "All", value: "all" },
  { label: "Open", value: "open" },
  { label: "Needs review", value: "needs-review" },
  { label: "Closed", value: "closed" },
];

// The trade log reads like a journal, not a spreadsheet: trades grouped by
// day with the day's P&L, one clean row per trade, tap anywhere to open it.
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

  const closed = trades.filter((trade) => trade.status === "CLOSED");
  const netPnl = closed.reduce((sum, trade) => sum + (getTradePnl(trade) ?? 0), 0);
  const winRate = calculateWinRate(closed);
  const totalR = calculateTotalR(closed);

  const pagedTrades = paginate(trades, page, pageSize);
  const dayGroups = groupByDay(pagedTrades);

  return (
    <main className="page-shell max-w-5xl">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <PageTitle title="Trades" subtitle="Your trading story, day by day. Tap any trade to open or review it." />
        <Link href="/trades/new" className="button"><Plus className="h-4 w-4" /> Log a trade</Link>
      </div>

      <ViewTabs basePath="/trades" current={view} params={params} tabs={tradeViews} />

      {calendarRange.active ? <RangeChip basePath="/trades" params={params} label={calendarRange.label} /> : null}

      <form className="mb-4 flex flex-wrap items-end gap-2">
        <input type="hidden" name="view" value={view} />
        <label className="field">
          <span className="text-xs font-medium text-forge-muted">Symbol</span>
          <input name="instrument" defaultValue={params.instrument} placeholder="BTC…" className="input w-28 uppercase placeholder:normal-case" />
        </label>
        <label className="field">
          <span className="text-xs font-medium text-forge-muted">From</span>
          <input name="from" type="date" defaultValue={params.from} className="input" />
        </label>
        <label className="field">
          <span className="text-xs font-medium text-forge-muted">To</span>
          <input name="to" type="date" defaultValue={params.to} className="input" />
        </label>
        <button className="button" type="submit">Filter</button>
        <Link href="/trades" className="button-secondary">Clear</Link>
        <details className="relative min-w-0 basis-full" open={hasAdvancedFilters(params)}>
          <summary className="cursor-pointer py-1 text-sm font-medium text-forge-muted hover:text-forge-ink">More filters &amp; sorting</summary>
          <div className="mt-2 grid gap-3 rounded-xl border border-forge-line bg-white p-3 shadow-soft sm:grid-cols-3 lg:grid-cols-4">
            <SelectField label="Market type" name="marketType" options={marketTypes} includeBlank defaultValue={params.marketType} />
            <SelectField label="Direction" name="direction" options={directions} includeBlank defaultValue={params.direction} />
            <SelectField label="Status" name="status" options={tradeStatuses} includeBlank defaultValue={params.status} />
            <SelectField label="Grade" name="entryGrade" options={entryGrades} includeBlank defaultValue={params.entryGrade} />
            <SelectField label="Followed plan" name="followedPlan" options={followedPlanOptions} includeBlank defaultValue={params.followedPlan} />
            <SelectField label="Mind state" name="emotionalState" options={emotionalStates} includeBlank defaultValue={params.emotionalState} />
            <label className="field">
              <span className="label">Mistake tag</span>
              <select name="mistakeTagId" defaultValue={params.mistakeTagId ?? ""} className="input">
                <option value="">Any</option>
                {mistakeTags.sort((a, b) => a.label.localeCompare(b.label)).map((tag) => <option key={tag.id} value={tag.id}>{tag.label}</option>)}
              </select>
            </label>
            <label className="field">
              <span className="label">Sort</span>
              <select name="sort" defaultValue={sort} className="input">
                <option value="date-desc">Newest first</option>
                <option value="date-asc">Oldest first</option>
                <option value="instrument-asc">Symbol A-Z</option>
                <option value="pnl-desc">P&L high-low</option>
                <option value="pnl-asc">P&L low-high</option>
                <option value="r-desc">R high-low</option>
                <option value="r-asc">R low-high</option>
              </select>
            </label>
            <label className="field">
              <span className="label">Rows per page</span>
              <select name="pageSize" defaultValue={String(pageSize)} className="input">
                <option value="10">10</option>
                <option value="25">25</option>
                <option value="50">50</option>
              </select>
            </label>
          </div>
        </details>
      </form>

      {trades.length ? (
        <p className="mb-4 text-sm text-forge-muted">
          <span className="font-semibold text-forge-ink">{trades.length}</span> trade{trades.length === 1 ? "" : "s"}
          {closed.length ? (
            <>
              {" · net P&L "}
              <span className={`font-semibold ${netPnl >= 0 ? "text-forge-green" : "text-forge-red"}`}>{formatMoney(netPnl)}</span>
              {winRate != null ? <>{" · win rate "}<span className="font-semibold text-forge-ink">{(winRate * 100).toFixed(0)}%</span></> : null}
              {totalR != null ? <>{" · total "}<span className={`font-semibold ${totalR >= 0 ? "text-forge-green" : "text-forge-red"}`}>{totalR.toFixed(1)}R</span></> : null}
            </>
          ) : null}
        </p>
      ) : null}

      <div className="space-y-4">
        {dayGroups.map((group) => (
          <section key={group.key} className="overflow-hidden rounded-xl border border-forge-line bg-white shadow-soft">
            <header className="flex items-baseline justify-between gap-3 border-b border-forge-line bg-forge-panel/70 px-4 py-2">
              <h2 className="text-sm font-semibold">{group.label}</h2>
              {group.pnl != null ? (
                <span className={`text-sm font-semibold ${group.pnl >= 0 ? "text-forge-green" : "text-forge-red"}`}>
                  {group.pnl >= 0 ? "+" : ""}{formatMoney(group.pnl)}
                </span>
              ) : (
                <span className="text-xs text-forge-muted">no closed P&L</span>
              )}
            </header>
            <div className="divide-y divide-forge-line">
              {group.trades.map((trade) => <TradeRow key={trade.id} trade={trade} />)}
            </div>
          </section>
        ))}
        {!trades.length ? (
          <div className="panel muted">
            No trades match this view. <Link href="/trades/new" className="text-forge-blue hover:underline">Log your first one</Link> — symbol and direction is all it takes.
          </div>
        ) : null}
      </div>

      {trades.length > pageSize ? <PaginationControls basePath="/trades" params={params} page={page} pageSize={pageSize} total={trades.length} /> : null}
    </main>
  );
}

type TradeRowData = Awaited<ReturnType<typeof getTradesWithMistakes>>[number];

// Row = objective data only; tap it for an in-place preview (numbers + notes),
// and the full trade page is one more click from there.
function TradeRow({ trade }: { trade: TradeRowData }) {
  const pnl = getTradePnl(trade);
  const needsReview = trade.status === "CLOSED" && ((trade.followedPlan ?? "NA") === "NA" || !trade.lesson);
  return (
    <details className="group">
      <summary className="flex cursor-pointer items-center gap-3 px-4 py-3 transition hover:bg-forge-panel/60">
        <ChevronRight className="h-4 w-4 shrink-0 text-forge-muted transition group-open:rotate-90" aria-hidden="true" />
        <span className="w-11 shrink-0 text-xs tabular-nums text-forge-muted">{format(trade.tradeDateTime, "HH:mm")}</span>
        <span className="w-16 shrink-0 font-semibold">{trade.instrument}</span>
        <DirectionBadge direction={trade.direction} />
        <StatusBadge status={trade.status} />
        <span className="hidden min-w-0 flex-1 truncate text-sm tabular-nums text-forge-muted md:block">
          {trade.entryPrice != null ? (
            <>
              {formatPrice(trade.entryPrice)}
              {trade.exitPrice != null ? <> → {formatPrice(trade.exitPrice)}</> : trade.stopPrice != null ? <> · stop {formatPrice(trade.stopPrice)}</> : null}
              {trade.leverage != null ? <> · {formatLoose(trade.leverage)}x</> : null}
            </>
          ) : (
            <span className="text-xs">{trade.setupName ?? ""}</span>
          )}
        </span>
        <PlanBadge plan={trade.followedPlan} />
        {trade.entryGrade && trade.entryGrade !== "NA" ? <GradeBadge grade={trade.entryGrade} /> : null}
        {trade.mistakeTags.length ? (
          <span className="hidden shrink-0 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-forge-red sm:inline" title={trade.mistakeTags.map((link) => link.mistakeTag.label).join(", ")}>
            {trade.mistakeTags.length}✕
          </span>
        ) : null}
        <span className="ml-auto shrink-0 text-right">
          {needsReview ? (
            <span className="text-sm font-medium text-forge-blue">Review →</span>
          ) : pnl != null ? (
            <>
              <span className={`block text-sm font-semibold tabular-nums ${pnl >= 0 ? "text-forge-green" : "text-forge-red"}`}>
                {pnl >= 0 ? "+" : ""}{formatMoney(pnl)}
              </span>
              {trade.rMultiple != null ? <span className="block text-xs tabular-nums text-forge-muted">{trade.rMultiple >= 0 ? "+" : ""}{trade.rMultiple.toFixed(1)}R</span> : null}
            </>
          ) : (
            <span className="text-xs text-forge-muted">{trade.status === "OPEN" ? "open" : ""}</span>
          )}
        </span>
        <Link
          href={`/trades/${trade.id}`}
          className="shrink-0 rounded-md p-1.5 text-forge-muted transition hover:bg-forge-panel hover:text-forge-ink"
          title={`Open ${trade.instrument} trade`}
          aria-label={`Open ${trade.instrument} trade page`}
        >
          <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </summary>
      <TradePreview trade={trade} pnl={pnl} needsReview={needsReview} />
    </details>
  );
}

// The in-place preview: key numbers on one side, the trade's own words on the
// other. Editing and everything else lives on the full trade page.
function TradePreview({ trade, pnl, needsReview }: { trade: TradeRowData; pnl: number | null; needsReview: boolean }) {
  const notes = [
    ["Thesis", trade.entryThesis],
    ["Invalidation", trade.invalidation],
    ["Exit reason", trade.exitReason],
    ["Lesson", trade.lesson],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]));
  const facts: [string, string, ("good" | "bad")?][] = [
    ["Entry", formatPrice(trade.entryPrice)],
    ["Stop", formatPrice(trade.stopPrice)],
    ["Target", formatPrice(trade.targetPrice)],
    ["Exit", formatPrice(trade.exitPrice)],
    ["Size", formatLoose(trade.quantity)],
    ["Leverage", trade.leverage != null ? `${formatLoose(trade.leverage)}x` : "—"],
    ["P&L", pnl != null ? `${pnl >= 0 ? "+" : ""}${formatMoney(pnl)}` : "—", pnl == null ? undefined : pnl >= 0 ? "good" : "bad"],
    ["R", trade.rMultiple != null ? `${trade.rMultiple >= 0 ? "+" : ""}${trade.rMultiple.toFixed(2)}` : "—", trade.rMultiple == null ? undefined : trade.rMultiple >= 0 ? "good" : "bad"],
  ];
  return (
    <div className="border-t border-forge-line bg-forge-panel/40 px-4 py-4">
      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        <div>
          <div className="grid grid-cols-4 gap-x-3 gap-y-2 rounded-lg border border-forge-line bg-white p-3">
            {facts.map(([label, value, tone]) => (
              <span key={label}>
                <span className="block text-[10px] font-medium uppercase tracking-wide text-forge-muted">{label}</span>
                <span className={`block text-sm font-medium tabular-nums ${tone === "good" ? "text-forge-green" : tone === "bad" ? "text-forge-red" : value === "—" ? "text-forge-muted" : ""}`}>
                  {value}
                </span>
              </span>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href={`/trades/${trade.id}`} className="button-secondary min-h-9 px-3 text-sm">
              {needsReview ? "Review this trade" : "Open full trade"} <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </div>
        <div className="min-w-0 space-y-2">
          {notes.map(([label, text]) => (
            <p key={label} className="text-sm">
              <span className="font-semibold">{label}:</span> <span className="text-forge-muted">{text}</span>
            </p>
          ))}
          {!notes.length ? <p className="text-sm text-forge-muted">No notes on this trade yet — open it to add the story.</p> : null}
          <div className="flex flex-wrap gap-1.5 pt-1">
            {trade.setupName ? <InfoChip label={`Setup: ${trade.setupName}`} /> : null}
            {trade.emotionalState && trade.emotionalState !== "UNKNOWN" ? <InfoChip label={`Mind: ${humanize(trade.emotionalState)}`} /> : null}
            {trade.mistakeTags.map((link) => (
              <span key={link.id} className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-forge-red">{link.mistakeTag.label}</span>
            ))}
            <TagPills tags={trade.tags} />
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoChip({ label }: { label: string }) {
  return <span className="rounded-full bg-forge-panel px-2 py-0.5 text-xs text-forge-muted">{label}</span>;
}

function PlanBadge({ plan }: { plan: string | null }) {
  if (!plan || plan === "NA") return null;
  const config: Record<string, { label: string; className: string }> = {
    YES: { label: "plan ✓", className: "bg-emerald-50 text-forge-green" },
    PARTIAL: { label: "plan ~", className: "bg-amber-50 text-amber-700" },
    NO: { label: "plan ✗", className: "bg-red-50 text-forge-red" },
  };
  const entry = config[plan];
  if (!entry) return null;
  return <span className={`hidden shrink-0 rounded-full px-2 py-0.5 text-xs font-medium sm:inline ${entry.className}`}>{entry.label}</span>;
}

function GradeBadge({ grade }: { grade: string }) {
  const className = grade === "A" ? "bg-emerald-50 text-forge-green" : grade === "B" ? "bg-amber-50 text-amber-700" : "bg-red-50 text-forge-red";
  return <span className={`hidden shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold sm:inline ${className}`}>{grade}</span>;
}

function DirectionBadge({ direction }: { direction: string }) {
  if (direction === "UNKNOWN") return null;
  const isLong = direction === "LONG";
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${isLong ? "bg-emerald-50 text-forge-green" : "bg-red-50 text-forge-red"}`}>
      {isLong ? "Long" : "Short"}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "CLOSED") return null; // closed is the default state; P&L tells that story
  const styles: Record<string, string> = {
    OPEN: "bg-sky-50 text-forge-blue",
    IDEA: "bg-forge-panel text-forge-muted",
    CANCELLED: "bg-forge-panel text-forge-muted line-through",
  };
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${styles[status] ?? "bg-forge-panel text-forge-muted"}`}>{humanize(status)}</span>;
}

function RangeChip({ basePath, params, label }: { basePath: string; params: Record<string, string | undefined>; label: string }) {
  const clearedParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value && key !== "period" && key !== "date" && key !== "page") clearedParams.set(key, value);
  }
  const query = clearedParams.toString();
  return (
    <p className="mb-4 flex w-fit items-center gap-2 rounded-full border border-forge-blue/30 bg-sky-50 px-3 py-1.5 text-sm">
      <CalendarDays className="h-4 w-4 text-forge-blue" aria-hidden="true" />
      {label}
      <Link href={query ? `${basePath}?${query}` : basePath} className="text-forge-muted transition hover:text-forge-ink" title="Show all dates" aria-label="Clear date range">
        <X className="h-4 w-4" aria-hidden="true" />
      </Link>
    </p>
  );
}

function groupByDay(trades: TradeRowData[]) {
  const groups = new Map<string, TradeRowData[]>();
  for (const trade of trades) {
    const key = format(trade.tradeDateTime, "yyyy-MM-dd");
    groups.set(key, [...(groups.get(key) ?? []), trade]);
  }
  return [...groups.entries()].map(([key, dayTrades]) => {
    const closedWithPnl = dayTrades.filter((trade) => trade.status === "CLOSED" && getTradePnl(trade) != null);
    return {
      key,
      label: format(dayTrades[0].tradeDateTime, "EEEE, d MMMM yyyy"),
      pnl: closedWithPnl.length ? closedWithPnl.reduce((sum, trade) => sum + (getTradePnl(trade) ?? 0), 0) : null,
      trades: dayTrades,
    };
  });
}

function pickEnum(options: readonly string[], value: string | undefined) {
  return value && options.includes(value) ? value : undefined;
}

function hasAdvancedFilters(params: Record<string, string | undefined>) {
  return ["marketType", "direction", "status", "entryGrade", "followedPlan", "emotionalState", "mistakeTagId", "sort", "pageSize"].some(
    (key) => params[key] && !(key === "sort" && params[key] === "date-desc") && !(key === "pageSize" && params[key] === "25"),
  );
}

function applyTradeView(trade: TradeRowData, view: string, thisWeek: Date) {
  if (view === "open") return trade.status === "OPEN" || trade.status === "IDEA";
  if (view === "closed") return trade.status === "CLOSED";
  if (view === "needs-review") return trade.status === "CLOSED" && ((trade.followedPlan ?? "NA") === "NA" || !trade.lesson);
  if (view === "mistakes") return trade.mistakeTags.length > 0;
  if (view === "this-week") return trade.tradeDateTime >= thisWeek;
  return true;
}

function compareTrades(a: TradeRowData, b: TradeRowData, sort: string) {
  if (sort === "date-asc") return a.tradeDateTime.getTime() - b.tradeDateTime.getTime();
  if (sort === "instrument-asc") return a.instrument.localeCompare(b.instrument) || b.tradeDateTime.getTime() - a.tradeDateTime.getTime();
  if (sort === "pnl-desc") return (getTradePnl(b) ?? Number.NEGATIVE_INFINITY) - (getTradePnl(a) ?? Number.NEGATIVE_INFINITY);
  if (sort === "pnl-asc") return (getTradePnl(a) ?? Number.POSITIVE_INFINITY) - (getTradePnl(b) ?? Number.POSITIVE_INFINITY);
  if (sort === "r-desc") return (b.rMultiple ?? Number.NEGATIVE_INFINITY) - (a.rMultiple ?? Number.NEGATIVE_INFINITY);
  if (sort === "r-asc") return (a.rMultiple ?? Number.POSITIVE_INFINITY) - (b.rMultiple ?? Number.POSITIVE_INFINITY);
  return b.tradeDateTime.getTime() - a.tradeDateTime.getTime();
}

function formatMoney(value: number) {
  return value.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

function formatPrice(value: number | null | undefined) {
  return value == null ? "—" : value.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function formatLoose(value: number | null | undefined) {
  return value == null ? "—" : String(value);
}
