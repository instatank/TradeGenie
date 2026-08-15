import Link from "next/link";
import { eachDayOfInterval, format, isSameDay } from "date-fns";
import { ChevronDown } from "lucide-react";
import { CalendarRangeControls } from "@/components/CalendarRangeControls";
import { PageTitle } from "@/components/Fields";
import { getCalendarRange, isWithinCalendarRange } from "@/lib/calendar";
import { humanize } from "@/lib/constants";
import { db, getTradesWithMistakes } from "@/lib/data";
import { getOptionCatalog } from "@/lib/options";
import { calculateTotalR, calculateWinRate, getTradePnl } from "@/lib/metrics";

export default async function CalendarPage({ searchParams }: { searchParams?: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams ?? {};
  const calendarParams = params.period || params.date ? params : { ...params, period: "month" };
  const range = getCalendarRange(calendarParams);
  const [trades, transcripts, journals, rawExecutions, lessons, weeklyReviews, options] = await Promise.all([
    getTradesWithMistakes(),
    db.list("transcripts"),
    db.list("dailyJournals"),
    db.list("rawExecutions"),
    db.list("lessons"),
    db.list("weeklyReviews"),
    getOptionCatalog(),
  ]);

  const rangeTrades = trades.filter((trade) => isWithinCalendarRange(trade.tradeDateTime, range));
  const rangeTranscripts = transcripts.filter((transcript) => isWithinCalendarRange(transcript.transcriptDateTime, range));
  const rangeJournals = journals.filter((journal) => isWithinCalendarRange(journal.date, range));
  const rangeExecutions = rawExecutions.filter((execution) => isWithinCalendarRange(execution.executionDateTime, range));
  const rangeLessons = lessons.filter((lesson) => isWithinCalendarRange(lesson.createdAt, range));
  const rangeReviews = weeklyReviews.filter((review) => review.weekStart <= range.end && review.weekEnd >= range.start);
  const closedTrades = rangeTrades.filter((trade) => trade.status === "CLOSED");
  const totalEvents = rangeTrades.length + rangeTranscripts.length + rangeJournals.length + rangeExecutions.length + rangeLessons.length + rangeReviews.length;

  // Newest day first, with each day's events precomputed so we can show a recent
  // strip and tuck older days behind a disclosure instead of an endless scroll.
  const RECENT_DAYS = 7;
  const dayData = eachDayOfInterval({ start: range.start, end: range.end })
    .reverse()
    .map((day) => {
      const dayValue = format(day, "yyyy-MM-dd");
      const dayTrades = rangeTrades.filter((trade) => isSameDay(trade.tradeDateTime, day));
      const dayTranscripts = rangeTranscripts.filter((transcript) => isSameDay(transcript.transcriptDateTime, day));
      const dayJournals = rangeJournals.filter((journal) => isSameDay(journal.date, day));
      const dayExecutions = rangeExecutions.filter((execution) => isSameDay(execution.executionDateTime, day));
      const dayLessons = rangeLessons.filter((lesson) => isSameDay(lesson.createdAt, day));
      const dayReviews = rangeReviews.filter((review) => review.weekStart <= day && review.weekEnd >= day);
      const eventCount = dayTrades.length + dayTranscripts.length + dayJournals.length + dayExecutions.length + dayLessons.length + dayReviews.length;
      return { day, dayValue, dayTrades, dayTranscripts, dayJournals, dayExecutions, dayLessons, dayReviews, eventCount };
    });
  // Show the most recent week in full (even empty days, as a steady strip);
  // only surface older days that actually have something logged.
  const recentDays = dayData.slice(0, RECENT_DAYS);
  const earlierDays = dayData.slice(RECENT_DAYS).filter((entry) => entry.eventCount > 0);

  const renderDay = (entry: (typeof dayData)[number]) => {
    const { day, dayValue, dayTrades, dayTranscripts, dayJournals, dayExecutions, dayLessons, dayReviews, eventCount } = entry;
    return (
      <article key={dayValue} className={`panel ${eventCount ? "" : "opacity-70"}`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="font-semibold">{format(day, "EEE, dd MMM")}</h2>
            <p className="text-sm text-forge-muted">{eventCount} item{eventCount === 1 ? "" : "s"}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={`/daily?date=${dayValue}`} className="button-secondary">Daily</Link>
            <Link href={`/trades?period=day&date=${dayValue}`} className="button-secondary">Trades</Link>
            <Link href={`/inbox?period=day&date=${dayValue}`} className="button-secondary">Notes</Link>
          </div>
        </div>

        <div className="mt-4 grid gap-3">
          {dayJournals.map((journal) => (
            <Link key={journal.id} href={`/daily?date=${dayValue}`} className="rounded-md bg-forge-panel p-3 text-sm transition hover:bg-forge-line/40">
              Daily journal · {options.label("tradingMode", journal.tradingMode)} · Discipline {journal.disciplineScore ?? "NA"}
            </Link>
          ))}
          {dayTrades.slice(0, 4).map((trade) => (
            <Link key={trade.id} href={`/trades/${trade.id}`} className="rounded-md bg-forge-panel p-3 text-sm transition hover:bg-forge-line/40">
              <span className="font-medium">{trade.instrument}</span> · {humanize(trade.direction)} · {humanize(trade.status)} · P&L {formatNumber(getTradePnl(trade))}
            </Link>
          ))}
          {dayTranscripts.slice(0, 3).map((transcript) => (
            <Link key={transcript.id} href={`/inbox?period=day&date=${dayValue}`} className="rounded-md bg-forge-panel p-3 text-sm transition hover:bg-forge-line/40">
              Voice note · {humanize(transcript.transcriptType)} · {humanize(transcript.processingStatus)}
            </Link>
          ))}
          {dayExecutions.length ? (
            <Link href={`/import?period=day&date=${dayValue}`} className="rounded-md bg-forge-panel p-3 text-sm transition hover:bg-forge-line/40">
              {dayExecutions.length} raw execution row{dayExecutions.length === 1 ? "" : "s"}
            </Link>
          ) : null}
          {dayLessons.slice(0, 2).map((lesson) => (
            <Link key={lesson.id} href={`/lessons?period=day&date=${dayValue}`} className="rounded-md bg-forge-panel p-3 text-sm transition hover:bg-forge-line/40">
              Lesson · {humanize(lesson.category)} · {preview(lesson.lessonText)}
            </Link>
          ))}
          {dayReviews.length ? (
            <Link href={`/weekly-review?period=day&date=${dayValue}`} className="rounded-md bg-forge-panel p-3 text-sm transition hover:bg-forge-line/40">
              Weekly review covering this day
            </Link>
          ) : null}
          {!eventCount ? <p className="text-sm text-forge-muted">No activity logged.</p> : null}
        </div>
      </article>
    );
  };

  return (
    <main className="page-shell">
      <PageTitle title="Calendar" subtitle="Your recent week up top; older days with activity fold away under a click so the page stays short." />
      <CalendarRangeControls basePath="/calendar" params={calendarParams} range={range} total={totalEvents} />

      <section className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Metric label="Trades" value={rangeTrades.length} />
        <Metric label="Closed trades" value={closedTrades.length} />
        <Metric label="Net P&L" value={formatNumber(closedTrades.reduce((sum, trade) => sum + (getTradePnl(trade) ?? 0), 0))} />
        <Metric label="Total R" value={formatNumber(calculateTotalR(closedTrades))} />
        <Metric label="Win rate" value={formatPercent(calculateWinRate(closedTrades))} />
      </section>

      <section className="space-y-4">
        <div className="grid gap-3 lg:grid-cols-2">
          {recentDays.map(renderDay)}
        </div>

        {earlierDays.length ? (
          <details className="group">
            <summary className="flex cursor-pointer items-center justify-center gap-1 rounded-md border border-forge-line bg-white px-3 py-2 text-sm font-medium text-forge-muted transition hover:bg-forge-panel hover:text-forge-ink [&::-webkit-details-marker]:hidden">
              Show {earlierDays.length} earlier day{earlierDays.length === 1 ? "" : "s"} with activity
              <ChevronDown className="h-4 w-4 transition group-open:rotate-180" aria-hidden="true" />
            </summary>
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              {earlierDays.map(renderDay)}
            </div>
          </details>
        ) : null}
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-forge-line bg-white p-4 shadow-soft">
      <div className="text-xs uppercase tracking-wide text-forge-muted">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
    </div>
  );
}

function formatNumber(value: number | null | undefined) {
  return value == null ? "NA" : value.toFixed(2);
}

function formatPercent(value: number | null) {
  return value == null ? "NA" : `${(value * 100).toFixed(0)}%`;
}

function preview(value: string) {
  return value.length > 90 ? `${value.slice(0, 90)}...` : value;
}
